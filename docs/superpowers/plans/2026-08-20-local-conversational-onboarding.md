# Local Conversational Onboarding Implementation Plan

> **SUPERSEDED AFTER TASK 0 — DO NOT EXECUTE TASK 1 OR LATER.** Task 0's closed onboarding
> vocabulary/parsers remain valid and are already implemented. Every Qwen/GGUF/`node-llama-cpp`,
> model-download, native-ABI, zero-external-model and byte-equivalence instruction below is stale.
> The approved successor design is
> [`2026-08-20-codex-cli-runtime-design.md`](../specs/2026-08-20-codex-cli-runtime-design.md).
> Execute the replacement plans
> [`2026-08-21-codex-cli-runtime.md`](2026-08-21-codex-cli-runtime.md) and
> [`2026-08-21-local-conversational-onboarding.md`](2026-08-21-local-conversational-onboarding.md)
> instead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structured-only start screen with a fully local conversational onboarding that produces verified Profile and Preference snapshots, purges chat content, and immediately hands one successful Continue request to the existing Country Frontier stream.

**Source specification:** `docs/superpowers/specs/2026-08-20-local-conversational-onboarding-design.md` (`approved`).

**Architecture:** The questionnaire is the only source of truth. Decision owns the closed field catalog, applicability, normalizers, provenance and final validation. Application owns `extractMessage` and one atomic completion flow through one capability-specific local-model port. Infrastructure provides one exported concrete `QwenLocalModelAdapter`, an immutable SQLite receipt writer keyed by a session-owned completion command, and the existing Country Frontier. React owns the temporary transcript, draft and completion command ID. Existing `@1` replay remains exact; `@2` uses explicit branches rather than a schema registry or generic decision engine.

**Tech Stack:** Node 24.13.0, pnpm 11.19.0, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, Zod 4.4.3, `node-llama-cpp` 3.20.0, Qwen2.5-1.5B-Instruct Q4_K_M.

## Global Constraints

- Implement only `onboarding-fields@1`; do not add a rules engine, question graph, workflow engine, provider registry, retry state, background job or transcript store.
- The model may propose values and a next question. Only deterministic span reproduction, allowlisted participant-scoped field IDs, field normalizers, schemas and cross-field rules may mutate or block the questionnaire.
- `не знаю`, absent text and ambiguity leave an applicable field empty. Explicit numeric zero remains valid.
- Only a reproduced proposal that conflicts with a present field whose current `origin === "manual"` creates `model_overwrite_unreviewed`. It is yellow, reversible and nonblocking. Empty fields and prior model-origin fields follow the ordinary guarded model update path. The reducer, not the model, assigns the closed reason `explicit_new_information`.
- Persist only confirmed structured snapshots, one immutable completion receipt and the approved provenance/version whitelist. Never persist transcript, message excerpts, spans, session participant descriptors, prompts, raw output, embeddings, KV state or model caches.
- Preserve exact replay of `relocation-profile@1`, `preference-profile@1` and `cold-start-assessment@1`; new writes use `relocation-profile@2`, `preference-profile@2` and the explicit `cold-start-assessment@2` path.
- Never coerce `relocation-profile@2` into the RU/RUB-only `@1` shape. Missing route-specific insurance or legality stays unknown/procedural; no new onboarding value may be fabricated.
- Country ranking consumes only the five country criteria from `preference-profile@2`. After an explicit resolved-country selection, the four city preferences must map exactly against that installed package's City Criteria defaults, be confirmed and persisted as a `CityCriteriaSnapshot`, and only then enter City Frontier.
- No external model endpoint, key, telemetry or production fallback is permitted. Official-source HTTPS remains a separate Country/City research capability and is allowed only after local onboarding handoff.
- The three existing `.superpowers/brainstorm/*` directories are user-owned and must remain untouched.

## Cross-plan boundary

This plan amends the Start boundary described by `docs/superpowers/plans/2026-08-13-vs-4a-city-frontier-core.md`: its Task 14 `presentCityFrontierSetup` must not replace confirmed onboarding values with defaults and must not ask for a second confirmation. It uses the `startCityFrontierFromPreferences` contract in Task 7 below. The full-product execution schedule must therefore complete City Frontier Core Tasks 9, 13 and 14 and Delivery Tasks 16 and 18 before onboarding Task 7; Task 7 is a hard product requirement, not an optional or deferred tail.

The approved `docs/superpowers/specs/2026-08-20-country-assessment-v2-design.md` and its separate `docs/superpowers/plans/2026-08-20-country-assessment-v2.md` own every `relocation-profile@2` formal-assessment rule. Exact full-product execution order is onboarding Tasks 0–6B, the complete Country Assessment V2 plan, onboarding Task 6C, City Frontier Core Tasks 9/13/14 plus Delivery Tasks 16/18, then onboarding Tasks 7–9. This plan owns questionnaire/receipt/handoff only and must not invent or duplicate applicant, household, passport, work, currency, Evidence/Dossier or route-verdict semantics.

---

### Task 0: Define the authoritative grammar vocabulary before feasibility

**Files:**
- Create: `src/decision/onboarding-catalog.ts`
- Create: `src/decision/onboarding-model-output.ts`
- Create: `src/decision/iso-codes.ts`
- Create: `tests/domain/onboarding-model-output.test.ts`

This task is deliberately pure and precedes the native runtime. It owns the only field-ID vocabulary imported by the JSON grammar, questionnaire, reducer and UI; Task 1 must not carry a copied list. Participant IDs never enter model output: extraction and review use session descriptors, while Task 3 resolves them to internal participant IDs.

```ts
export const COUNTRY_PREFERENCE_IDS = [
  "outside_cis", "europe", "personal_safety", "infrastructure", "peace_and_stability",
] as const;
export const CITY_PREFERENCE_IDS = [
  "safety", "long_term_rent", "urban_transit", "fixed_broadband",
] as const;

export type CountryPreferenceId = typeof COUNTRY_PREFERENCE_IDS[number];
export type UniversalCityPreferenceId = typeof CITY_PREFERENCE_IDS[number];
export type PreferencePart = "mode" | "importance" | "target";
export type ParticipantLeafId =
  | "citizenships" | "passport" | "current_work" | "remote_continuation"
  | "monthly_income" | "education" | "relevant_experience_years";
export type ParticipantDescriptor = "self" | `companion.${number}`;

export type CanonicalDecimal = string;
export type CanonicalDay = string;
export type IsoCountryCode = string;
export type IsoCurrencyCode = string;
export interface CurrentLocationValue {
  readonly countryCode: IsoCountryCode;
  readonly city: string;
}
export type MoveHorizonValue =
  | "within_3_months" | "3_to_6_months" | "6_to_12_months"
  | "more_than_12_months";
export type MovingPartyValue = "alone" | "with_companions";
export type ParticipantRelationship =
  "self" | "spouse" | "minor_child" | "other_family";
export type PassportValue = "absent" | { readonly validUntil: CanonicalDay };
export interface CurrentWorkValue {
  readonly status:
    | "not_working" | "employment" | "self_employment"
    | "contract_service" | "other";
  readonly occupation?: string;
}
export type RemoteContinuationValue = "yes" | "no";
export interface MonthlyIncomeValue {
  readonly amount: CanonicalDecimal;
  readonly currency: IsoCurrencyCode;
  readonly basis: "net" | "gross";
}
export interface SavingsValue {
  readonly min: CanonicalDecimal;
  readonly max: CanonicalDecimal;
  readonly currency: IsoCurrencyCode;
}
export interface EducationValue {
  readonly level: "none" | "secondary" | "vocational" | "higher";
  readonly field?: string;
}
export type PreferenceMode = "required" | "weighted";
export type PreferenceImportance = 1 | 2 | 3 | 4 | 5;

export type OnboardingBaseFieldId =
  | "current_location" | "move_horizon" | "moving_party" | "participants" | "savings";
export type CountryPreferenceFieldId =
  `country_preferences.${CountryPreferenceId}.${PreferencePart}`;
export type CityPreferenceFieldId =
  `city_preferences.${UniversalCityPreferenceId}.${PreferencePart}`;
export type CityPreferenceTargetFieldId =
  `city_preferences.${UniversalCityPreferenceId}.target`;
export type ParticipantProposalFieldId =
  `participants.${ParticipantDescriptor}.${ParticipantLeafId}`;
export type OnboardingModelFieldId =
  | OnboardingBaseFieldId | ParticipantProposalFieldId
  | CountryPreferenceFieldId | CityPreferenceFieldId;

export type QuestionnaireIssueCode =
  | "required_empty" | "invalid_value" | "placeholder_value"
  | "party_mismatch" | "work_mismatch" | "range_mismatch";

export interface ParticipantRosterProposal {
  readonly descriptor: ParticipantDescriptor;
  readonly relationship: "self" | "spouse" | "minor_child" | "other_family";
}
export interface LocalFieldProposal<F extends OnboardingModelFieldId, V> {
  readonly fieldId: F;
  readonly typedValue: V;
  readonly messageId: string;
  readonly sourceSpan: { readonly start: number; readonly end: number };
}
export type ParsedLocalFieldProposal =
  | LocalFieldProposal<"current_location", CurrentLocationValue>
  | LocalFieldProposal<"move_horizon", MoveHorizonValue>
  | LocalFieldProposal<"moving_party", MovingPartyValue>
  | LocalFieldProposal<"participants", readonly ParticipantRosterProposal[]>
  | LocalFieldProposal<"savings", SavingsValue>
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.citizenships`,
      readonly IsoCountryCode[]
    >
  | LocalFieldProposal<`participants.${ParticipantDescriptor}.passport`, PassportValue>
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.current_work`,
      CurrentWorkValue
    >
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.remote_continuation`,
      RemoteContinuationValue
    >
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.monthly_income`,
      MonthlyIncomeValue
    >
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.education`,
      EducationValue
    >
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.relevant_experience_years`,
      number
    >
  | LocalFieldProposal<
      `country_preferences.${CountryPreferenceId}.mode`,
      PreferenceMode
    >
  | LocalFieldProposal<
      `country_preferences.${CountryPreferenceId}.importance`,
      PreferenceImportance
    >
  | LocalFieldProposal<
      `country_preferences.${CountryPreferenceId}.target`,
      "required_true" | "maximize"
    >
  | LocalFieldProposal<
      `city_preferences.${UniversalCityPreferenceId}.mode`,
      PreferenceMode
    >
  | LocalFieldProposal<
      `city_preferences.${UniversalCityPreferenceId}.importance`,
      PreferenceImportance
    >
  | LocalFieldProposal<
      `city_preferences.${UniversalCityPreferenceId}.target`,
      string
    >;
export interface LocalExtractionResult {
  readonly schemaVersion: "onboarding-model-output@1";
  readonly proposals: readonly ParsedLocalFieldProposal[];
  readonly nextQuestion: string;
}
export interface LocalReviewResult {
  readonly schemaVersion: "onboarding-review-output@1";
  readonly issues: readonly {
    readonly fieldId: OnboardingModelFieldId;
    readonly reasonCode: QuestionnaireIssueCode;
  }[];
}

export function parseLocalExtractionOutput(value: unknown): LocalExtractionResult;
export function parseLocalReviewOutput(value: unknown): LocalReviewResult;
```

The two parsers require exact object keys, dense bounded arrays, a non-empty bounded `nextQuestion`, finite integer span coordinates, the closed issue codes and the exact field-ID grammar. The extraction parser dispatches each field ID to the exact value guard above: strict keys, ISO country/currency/day syntax, canonical non-negative decimals, finite non-negative integer experience, bounded non-empty text and unique dense lists. It performs structural/canonical validation but no semantic cross-field decision. For `fieldId === "participants"`, `typedValue` is exactly one ordered dense roster beginning with `self`, followed by `companion.0..N` without gaps or duplicates. These parsers validate untrusted model JSON only; they do not reproduce a span, decide applicability or mutate a draft.

- [ ] Write REDs for exact 5+4 criterion IDs and ordering, every allowed field/value form, canonical decimals/days/codes, zero, unknown IDs/parts/codes, forbidden internal participant IDs, sparse/duplicate/non-dense rosters, extra keys, malformed arrays/spans and bounded question text.
- [ ] Implement only constants, canonical ISO/day/decimal guards, types and strict pure output parsers. Do not import React, Application or Infrastructure and do not add a registry/rules graph.
- [ ] Run `pnpm exec vitest run tests/domain/onboarding-model-output.test.ts`, `pnpm run typecheck`, `pnpm exec eslint src/decision/onboarding-catalog.ts src/decision/onboarding-model-output.ts src/decision/iso-codes.ts tests/domain/onboarding-model-output.test.ts`, and `git diff --check`.
- [ ] Commit boundary: `feat: define onboarding model vocabulary`.

---

### Task 1: Pin the native runtime and pass the full feasibility gate

**Prerequisite:** Task 0 is complete and its pure tests/typecheck pass. The feasibility grammar imports `OnboardingModelFieldId`, `QuestionnaireIssueCode`, `parseLocalExtractionOutput` and `parseLocalReviewOutput`; it must not redeclare or approximate them.

**Files:**
- Create: `.node-version`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `next.config.ts`
- Modify: `.gitignore`
- Create: `src/infrastructure/local-model/local-model-manifest.ts`
- Create: `src/infrastructure/local-model/qwen-runtime.ts`
- Create: `src/infrastructure/local-model/onboarding-model.ts`
- Create: `evals/onboarding-feasibility.ts`
- Create: `evals/fixtures/onboarding/cases.json`
- Create: `tests/integration/local-model-runtime.test.ts`

**Pinned environment and artifact:**

```ts
export const LOCAL_MODEL_MANIFEST = Object.freeze({
  runtime: "node-llama-cpp@3.20.0",
  repository: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  revision: "91cad51170dc346986eccefdc2dd33a9da36ead9",
  sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  fileName: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  byteLength: 1_117_320_736,
  sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
  contextSize: 4096,
  seed: 42,
  temperature: 0,
  nodeVersion: "v24.13.0",
} as const);
```

Write `24.13.0` to `.node-version`, set `packageManager: "pnpm@11.19.0"` and `engines.node: "24.13.x"`, install with `pnpm add --save-exact node-llama-cpp@3.20.0`, and add `node-llama-cpp` to `serverExternalPackages` in `next.config.ts`. The runtime preflight must compare `process.version` to the manifest and record/assert `process.versions.modules` in its diagnostic so a Next/Node/native-ABI mismatch fails here rather than at request time. Do not create `package-lock.json` or use `npm`.

`qwen-runtime.ts` exports the concrete class `QwenLocalModelAdapter`. Its only generation seam is `generateJson({ prompt, grammar, maxTokens, signal }): Promise<string>`; it is a pinned Infrastructure class, not an Application port, provider client or registry. It loads the immutable model once, but creates a fresh context sequence for every call and disposes that sequence in `finally` on success, invalid JSON, abort and inference error. It must not retain transcript text, prompt text, raw output or KV state between requests. `onboarding-model.ts` accepts that exact class and owns only the two fixed templates (`extract@1`, `review@1`), two strict JSON grammars and bounded output settings. Both grammars are generated from Task 0's closed constants, and every decoded value is passed through Task 0's corresponding parser before the feasibility assertion; a hand-maintained second field/issue list is forbidden.

- [ ] Write RED unit/integration tests for missing artifact, wrong size/hash, wrong Node version, exposed native-ABI diagnostic, fixed generation settings, fresh sequence per call, and exactly-once disposal on success/error/abort. Assert no `fetch`, socket or telemetry call during model loading/inference.
- [ ] Before package installation or the 1.04-GiB artifact download, obtain explicit user approval. Install with pnpm only, download only the pinned URL, verify SHA-256, and add `models/*.gguf` to `.gitignore`.
- [ ] Build a real-device feasibility fixture covering Russian free text, all closed output grammar branches, one-message `self + spouse` descriptor extraction without internal IDs, omitted values, `не знаю`, explicit zero, correction, prompt injection, malicious JSON-looking text, unusual valid ISO/currency values, malformed output and final-review issue codes. Check Task 0 parser acceptance plus expected proposal semantics; do not depend on Task 2/3 draft code and do not require byte-identical sampled text.
- [ ] Run `pnpm exec vitest run tests/integration/local-model-runtime.test.ts` and `pnpm exec tsx evals/onboarding-feasibility.ts` with the real pinned artifact. Require every grammar/adversarial case to pass and record extraction/review p50/p95 plus the canonical interaction model wall time against the 35-second product budget.
- [ ] If Metal/native loading, Russian extraction/review, grammar validity, privacy audit or latency fails, stop before Task 2 and report the feasibility blocker. Do not switch models/providers, add a fallback or add retries within this plan.
- [ ] Run `pnpm run typecheck`, scoped `pnpm exec eslint`, and `git diff --check`.
- [ ] Commit boundary: `feat: prove local onboarding runtime`.

---

### Task 2: Define the closed questionnaire and immutable `@2` snapshots

**Files:**
- Create: `src/decision/onboarding-questionnaire.ts`
- Create: `src/decision/onboarding-provenance.ts`
- Modify: `src/decision/relocation-profile.ts`
- Modify: `src/decision/preference-profile.ts`
- Create: `tests/domain/onboarding-questionnaire.test.ts`
- Create: `tests/domain/relocation-profile.test.ts`
- Create: `tests/domain/preference-profile.test.ts`

**Core surface:**

```ts
// Each owning Task 2 module imports/re-exports the shared value vocabulary from Task 0.
import type {
  CityPreferenceFieldId,
  CountryPreferenceFieldId,
  CountryPreferenceId,
  CurrentLocationValue,
  CurrentWorkValue,
  EducationValue,
  IsoCountryCode,
  MonthlyIncomeValue,
  MoveHorizonValue,
  MovingPartyValue,
  OnboardingBaseFieldId,
  ParticipantLeafId,
  ParticipantRelationship,
  PassportValue,
  PreferenceImportance,
  PreferenceMode,
  QuestionnaireIssueCode,
  RemoteContinuationValue,
  SavingsValue,
  UniversalCityPreferenceId,
} from "./onboarding-catalog";

export const ONBOARDING_SCHEMA_VERSION = "onboarding-fields@1" as const;

export type ParticipantId = string;
export type QuestionnaireApplicability = "required" | "not_applicable";
export type QuestionnaireFieldOrigin = "empty" | "model" | "manual";
export type QuestionnaireOverwriteReviewState =
  | "model_overwrite_unreviewed"
  | "model_overwrite_confirmed"
  | "model_overwrite_reverted";

export interface ParticipantRosterValue {
  readonly participantId: ParticipantId;
  readonly relationship: ParticipantRelationship;
}

export type ParticipantFieldId = `participants.${ParticipantId}.${ParticipantLeafId}`;
export type OnboardingFieldId =
  | OnboardingBaseFieldId | ParticipantFieldId
  | CountryPreferenceFieldId | CityPreferenceFieldId;
export type OnboardingFieldValue =
  | CurrentLocationValue | MoveHorizonValue | MovingPartyValue
  | readonly ParticipantRosterValue[] | readonly IsoCountryCode[] | PassportValue
  | CurrentWorkValue | RemoteContinuationValue | MonthlyIncomeValue | SavingsValue
  | EducationValue | number | PreferenceMode | PreferenceImportance | string;

export interface QuestionnaireModelOverwrite {
  readonly previousValue: OnboardingFieldValue;
  readonly proposedValue: OnboardingFieldValue;
  readonly reasonCode: "explicit_new_information";
  readonly reviewState: QuestionnaireOverwriteReviewState;
}
export interface QuestionnaireFieldState {
  readonly fieldId: OnboardingFieldId;
  readonly applicability: QuestionnaireApplicability;
  readonly rawInput: unknown | null;
  readonly normalizedValue: OnboardingFieldValue | null;
  readonly origin: QuestionnaireFieldOrigin;
  readonly overwrite: QuestionnaireModelOverwrite | null;
}
export interface OnboardingDraft {
  readonly schemaVersion: "onboarding-draft@1";
  readonly fields: readonly QuestionnaireFieldState[];
}

export type QuestionnaireFieldChange =
  | {
      readonly kind: "manual_set";
      readonly fieldId: OnboardingFieldId;
      readonly rawInput: unknown;
    }
  | {
      readonly kind: "guarded_model_set";
      readonly fieldId: OnboardingFieldId;
      readonly normalizedValue: OnboardingFieldValue;
    }
  | { readonly kind: "confirm_model_overwrite"; readonly fieldId: OnboardingFieldId }
  | { readonly kind: "revert_model_overwrite"; readonly fieldId: OnboardingFieldId };

export interface QuestionnaireIssue {
  readonly fieldId: OnboardingFieldId;
  readonly reasonCode: QuestionnaireIssueCode;
  readonly blocking: true;
}
export type QuestionnaireReview =
  | { readonly kind: "ready"; readonly issues: readonly [] }
  | {
      readonly kind: "blocked";
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
    };

export type QuestionnaireProvenanceEntry =
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "not_applicable";
      readonly origin: "empty";
      readonly reviewState: "not_applicable";
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly origin: "manual" | "model";
      readonly reviewState: "accepted";
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly origin: "manual" | "model";
      readonly reviewState: QuestionnaireOverwriteReviewState;
      readonly previousValue: OnboardingFieldValue;
      readonly proposedValue: OnboardingFieldValue;
      readonly reasonCode: "explicit_new_information";
    };
export interface QuestionnaireProvenance {
  readonly schemaVersion: "onboarding-provenance@1";
  readonly entries: readonly QuestionnaireProvenanceEntry[];
}

export type ApplicableValue<T> =
  | { readonly applicability: "required"; readonly value: T }
  | { readonly applicability: "not_applicable" };
export interface RelocationParticipantV2 {
  readonly participantId: ParticipantId;
  readonly relationship: ParticipantRelationship;
  readonly citizenships: readonly IsoCountryCode[];
  readonly passport: PassportValue;
  readonly currentWork: ApplicableValue<CurrentWorkValue>;
  readonly remoteContinuation: ApplicableValue<RemoteContinuationValue>;
  readonly monthlyIncome: ApplicableValue<MonthlyIncomeValue>;
  readonly education: ApplicableValue<EducationValue>;
  readonly relevantExperienceYears: ApplicableValue<number>;
}
export interface RelocationProfileV2Snapshot {
  readonly schemaVersion: "relocation-profile@2";
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: {
    readonly currentLocation: CurrentLocationValue;
    readonly moveHorizon: MoveHorizonValue;
    readonly movingParty: MovingPartyValue;
    readonly participants: readonly [RelocationParticipantV2, ...RelocationParticipantV2[]];
    readonly savings: SavingsValue;
  };
}

export type CountryPreferenceCriterionV2<I extends CountryPreferenceId> =
  | {
      readonly id: I;
      readonly mode: "required";
      readonly importance: PreferenceImportance;
      readonly target: "required_true";
    }
  | {
      readonly id: I;
      readonly mode: "weighted";
      readonly importance: PreferenceImportance;
      readonly target: "maximize";
    };
export interface UniversalCityPreferenceCriterionV2<I extends UniversalCityPreferenceId> {
  readonly id: I;
  readonly mode: PreferenceMode;
  readonly importance: PreferenceImportance;
  readonly target: string;
}
export type CountryPreferenceTupleV2 = readonly [
  CountryPreferenceCriterionV2<"outside_cis">,
  CountryPreferenceCriterionV2<"europe">,
  CountryPreferenceCriterionV2<"personal_safety">,
  CountryPreferenceCriterionV2<"infrastructure">,
  CountryPreferenceCriterionV2<"peace_and_stability">,
];
export type UniversalCityPreferenceTupleV2 = readonly [
  UniversalCityPreferenceCriterionV2<"safety">,
  UniversalCityPreferenceCriterionV2<"long_term_rent">,
  UniversalCityPreferenceCriterionV2<"urban_transit">,
  UniversalCityPreferenceCriterionV2<"fixed_broadband">,
];
export interface PreferenceProfileV2Snapshot {
  readonly schemaVersion: "preference-profile@2";
  readonly id: string;
  readonly confirmedAt: string;
  readonly countryCriteria: CountryPreferenceTupleV2;
  readonly cityCriteria: UniversalCityPreferenceTupleV2;
}

export interface OnboardingVersionTuple {
  readonly runtime: "node-llama-cpp@3.20.0";
  readonly modelRevision: "91cad51170dc346986eccefdc2dd33a9da36ead9";
  readonly extractionPrompt: "extract@1";
  readonly reviewPrompt: "review@1";
  readonly extractionSchema: "onboarding-extraction@1";
  readonly reviewSchema: "onboarding-review@1";
  readonly parameters: "onboarding-qwen-params@1";
}

export function createOnboardingDraft(nextParticipantId: () => string): OnboardingDraft;
export function participantFieldApplicability(input: {
  readonly relationship: ParticipantRelationship;
  readonly fieldId: ParticipantLeafId;
  readonly currentWork: CurrentWorkValue | null;
}): QuestionnaireApplicability;
export function reconcileOnboardingApplicability(draft: OnboardingDraft): OnboardingDraft;
export function setQuestionnaireField(
  draft: OnboardingDraft,
  change: QuestionnaireFieldChange,
): OnboardingDraft;
export function reconstructOnboardingDraft(value: unknown): OnboardingDraft;
export function reviewQuestionnaire(draft: unknown): QuestionnaireReview;
export function deriveQuestionnaireProvenance(
  draft: OnboardingDraft,
): QuestionnaireProvenance;
export function reconstructQuestionnaireProvenance(
  value: unknown,
): QuestionnaireProvenance;
export interface ConfirmedOnboardingValues {
  readonly schemaVersion: "confirmed-onboarding-values@1";
  readonly profile: Omit<RelocationProfileV2Snapshot, "id" | "confirmedAt">;
  readonly preferences: Omit<PreferenceProfileV2Snapshot, "id" | "confirmedAt">;
  readonly provenance: QuestionnaireProvenance;
  readonly modelVersions: OnboardingVersionTuple;
}

export function confirmOnboardingValues(input: {
  readonly draft: unknown;
  readonly provenance: QuestionnaireProvenance;
  readonly modelVersions: OnboardingVersionTuple;
}): ConfirmedOnboardingValues;

export function materializeOnboardingSnapshots(input: {
  readonly confirmed: ConfirmedOnboardingValues;
  readonly confirmedAt: string;
}): {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
};

export function reconstructRelocationProfileV2(
  value: unknown,
): RelocationProfileV2Snapshot;
export function reconstructPreferenceProfileV2(
  value: unknown,
): PreferenceProfileV2Snapshot;
export function rehydrateOnboardingDraft(input: {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
}): OnboardingDraft;
```

Task 0's constants are the exact approved catalog: current location, horizon, moving party, stable participants, participant citizenship/passport/work/remote/income/education/experience, savings, five country criteria and four universal city criteria. `OnboardingDraft.fields` is in canonical catalog order: the five base cells, participant leaf cells in roster order, then each country and city criterion's `mode/importance/target`. It contains exactly one cell per current roster-derived catalog address; conditionally hidden participant cells remain present as `not_applicable` with null input/value, `origin: "empty"` and no overwrite. The only applicability table is: citizenship/passport always required; all remaining participant leaves are not applicable for `minor_child`; for other participants current work/income/education/experience are required, while remote continuation is required exactly when the normalized work status is not `not_working`. `alone` requires an exact one-member self roster; `with_companions` requires self plus at least one companion. Roster order and IDs remain stable across edits.

Manual input is retained in `rawInput` so `-`, `не знаю` and malformed text can remain visible and produce `placeholder_value`/`invalid_value`; only a successful field normalizer populates `normalizedValue`. A guarded model change always carries a normalized value. Applicability reconciliation clears hidden raw/normalized values and all session overwrite history. `QuestionnaireProvenance` is the complete durable whitelist in the same canonical order: it contains no raw input, message ID, span or excerpt. A reverted overwrite's final value/origin is the previous manual value; confirmed and unresolved overwrites use the proposed model value; only unresolved state renders yellow and it remains nonblocking.

`confirmOnboardingValues` rejects every blocking review, exact-reconstructs the provenance against the draft, and returns canonical timestamp-free values. `materializeOnboardingSnapshots` derives IDs from the two canonical payloads with the one store-owned `confirmedAt`. `reconstructRelocationProfileV2` and `reconstructPreferenceProfileV2` require exact keys, canonical order, IDs/digests and fresh deep-frozen copies; `@1` reconstructors and bytes remain untouched. `rehydrateOnboardingDraft` exact-binds provenance field/value/applicability state to both snapshot IDs' content and cannot create a value absent from the snapshots. The session reducer assigns stable participant IDs; the model never supplies or changes them. Decision never imports an Application or Infrastructure type, and UI/prompts do not copy applicability.

- [ ] Write RED tests for exact draft shape and ordering; every applicability transition; exactly one `self`; companion add/remove/stable IDs; hidden raw/value/provenance clearing; placeholder raw input; ISO dates/codes/currencies; canonical decimals; zero values; savings range; exact typed 5+4 tuples; all overwrite review states; provenance binding; and fresh deep-frozen snapshots/reconstructed drafts.
- [ ] Add explicit historical tests proving `@1` confirmation and reconstruction stay byte-equivalent. `@2` is a separate discriminated branch, not a generic schema registry.
- [ ] Run `pnpm exec vitest run tests/domain/onboarding-questionnaire.test.ts tests/domain/relocation-profile.test.ts tests/domain/preference-profile.test.ts`; expect missing-contract failures.
- [ ] Implement the smallest pure domain module, timestamp-free confirmation and the two `@2` snapshot variants. Do not change Country ranking yet; that exact consumer ripple is Task 6A.
- [ ] Run focused tests, `pnpm run typecheck`, scoped `pnpm exec eslint` and `git diff --check`.
- [ ] Commit boundary: `feat: define onboarding questionnaire`.

---

### Task 3: Guard allowlisted model proposals and own session transitions

**Files:**
- Create: `src/decision/onboarding-model-contract.ts`
- Create: `src/decision/onboarding-session.ts`
- Create: `tests/domain/onboarding-model-contract.test.ts`
- Create: `tests/domain/onboarding-session.test.ts`

**Model boundary:**

```ts
export interface SessionMessage {
  readonly id: string;
  readonly text: string;
}

export interface OnboardingSessionState {
  readonly draft: OnboardingDraft;
  readonly descriptorBindings: Readonly<Partial<Record<ParticipantDescriptor, string>>>;
}

export interface GuardedFieldProposal {
  readonly fieldId: OnboardingFieldId;
  readonly normalizedValue: OnboardingFieldValue;
}

export interface GuardedExtraction {
  readonly proposals: readonly GuardedFieldProposal[];
  readonly nextQuestion: string;
}

export function guardExtraction(input: {
  readonly message: SessionMessage;
  readonly output: unknown;
  readonly session: OnboardingSessionState;
}): GuardedExtraction;

export function applyGuardedExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly extraction: GuardedExtraction;
  readonly nextParticipantId: () => string;
}): OnboardingSessionState;

export function reconstructOnboardingSessionState(
  value: unknown,
): OnboardingSessionState;

export function projectDraftForLocalReview(
  session: OnboardingSessionState,
): unknown;
export function corroborateModelReview(input: {
  readonly session: OnboardingSessionState;
  readonly output: unknown;
}): readonly QuestionnaireIssue[];
```

Task 0's proposal has exactly `fieldId`, `typedValue`, `messageId` and `sourceSpan`. `OnboardingSessionState` contains the questionnaire draft plus the temporary descriptor-to-participant-ID map. For `fieldId: "participants"`, `typedValue` is Task 0's exact ordered `ParticipantRosterProposal[]`: `self` plus zero or more `companion.N` descriptors. Descriptors are session-only ordinal handles, never snapshot IDs. The guard first calls `parseLocalExtractionOutput`, validates and independently reproduces the roster proposal from the same source span, then validates descriptor-addressed leaves against that candidate roster and Task 2 applicability. The reducer applies the roster first, retains an existing descriptor binding, allocates stable internal IDs for new descriptors, removes bindings for removed descriptors, and only then applies leaf proposals. Neither prompt nor model output contains an internal participant ID. This allows one first message to populate `self` and a newly mentioned spouse without a second extraction pass.

The guard validates span bounds, exact message binding, text reproduction and the Task 2 field normalizer before returning internal field IDs plus closed values. Only a conflict with a current `origin === "manual"` creates `model_overwrite_unreviewed`; a conflict with `origin === "model"` is an ordinary guarded update. The reducer records `explicit_new_information` and Confirm/Revert state deterministically; the model supplies no overwrite reason. `reconstructOnboardingSessionState` exact-reconstructs the browser-supplied draft and descriptor bindings, requires one-to-one bindings for the current roster, rejects extra/accessor/sparse/cyclic values and returns a fresh frozen copy. `projectDraftForLocalReview` replaces internal participant IDs with the existing session descriptors and includes no raw transcript. A model review issue is accepted only after `parseLocalReviewOutput`, descriptor resolution and `reviewQuestionnaire` independently prove the same internal field/reason pair.

- [ ] Write RED tests for unknown/duplicate descriptor paths, forbidden internal participant IDs, malformed/non-dense rosters, duplicate/missing `self`, descriptor leaves absent from the candidate roster, inapplicable leaves, malformed arrays/objects, out-of-range or cross-message spans, prompt injection, `не знаю`, ambiguity, explicit zero, correction and unusual valid values.
- [ ] Write reducer REDs for a single first message containing complete `self + spouse` facts, stable descriptor-to-ID allocation across later messages, companion add/remove, manual edit precedence, `origin === "manual"` overwrite Confirm/Revert, ordinary model-origin replacement, unreviewed yellow state, hidden-value clearing, exact untrusted session reconstruction and immutable provenance transitions.
- [ ] Run the two focused suites; expect missing-module failures.
- [ ] Implement the guards and reducer without Infrastructure calls, transcript persistence or a generic rule graph.
- [ ] Run `pnpm exec vitest run tests/domain/onboarding-model-contract.test.ts tests/domain/onboarding-session.test.ts`, `pnpm run typecheck`, scoped `pnpm exec eslint` and `git diff --check`.
- [ ] Commit boundary: `feat: guard onboarding proposals`.

---

### Task 4: Implement the use cases and command-scoped completion receipt

**Files:**
- Create: `src/application/onboarding.ts`
- Create: `src/application/onboarding-contracts.ts`
- Modify: `src/infrastructure/local-model/onboarding-model.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Create: `tests/integration/onboarding.test.ts`
- Create: `tests/integration/onboarding-composition.test.ts`

**Inward ports and result:**

```ts
export interface LocalOnboardingModelPort {
  readonly versions: OnboardingVersionTuple;
  extract(input: LocalOnboardingExtractionInput): Promise<unknown>;
  review(input: LocalOnboardingReviewInput): Promise<unknown>;
}

export interface LocalOnboardingExtractionInput {
  readonly message: SessionMessage;
  readonly questionnaire: unknown;
}

export interface LocalOnboardingReviewInput {
  readonly questionnaire: unknown;
}

export interface ExtractOnboardingMessageCommand {
  readonly schemaVersion: "onboarding-message-command@1";
  readonly message: SessionMessage;
  readonly session: OnboardingSessionState;
}

export interface ContinueOnboardingCommand {
  readonly schemaVersion: "onboarding-continue-command@1";
  readonly completionCommandId: string;
  readonly session: OnboardingSessionState;
}

export interface ExtractOnboardingMessageResult {
  readonly schemaVersion: "onboarding-message-result@1";
  readonly session: OnboardingSessionState;
  readonly nextQuestion: string;
}

export type CompleteOnboardingResult =
  | {
      readonly kind: "blocked";
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
      readonly followUpQuestion: string;
    }
  | {
      readonly kind: "launched";
      readonly receipt: OnboardingCompletionReceipt;
      readonly prepared: PlaceFrontierPrepared;
    };

export interface OnboardingApplicationPorts {
  readonly model: LocalOnboardingModelPort;
  readonly confirmations: OnboardingConfirmationStorePort;
  readonly frontier: ConfirmedOnboardingFrontierPort;
  readonly nextParticipantId: () => string;
}

export function reconstructExtractOnboardingMessageCommand(
  value: unknown,
): ExtractOnboardingMessageCommand;
export function reconstructContinueOnboardingCommand(
  value: unknown,
): ContinueOnboardingCommand;
export function extractMessage(
  input: ExtractOnboardingMessageCommand,
  ports: Pick<OnboardingApplicationPorts, "model" | "nextParticipantId">,
): Promise<ExtractOnboardingMessageResult>;
export function completeOnboarding(
  input: ContinueOnboardingCommand,
  ports: Pick<OnboardingApplicationPorts, "model" | "confirmations" | "frontier">,
): Promise<CompleteOnboardingResult>;

export interface OnboardingCompletionReceipt {
  readonly schemaVersion: "onboarding-completion-receipt@1";
  readonly completionCommandId: string;
  readonly receiptId: string;
  readonly confirmationDigest: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly frontierRunId: string;
  readonly confirmedAt: string;
}

export interface ConfirmedOnboardingWrite {
  readonly completionCommandId: string;
  readonly confirmed: ConfirmedOnboardingValues;
}

export interface OnboardingConfirmationStorePort {
  commitOrReplay(input: ConfirmedOnboardingWrite): OnboardingCompletionReceipt;
  loadBySnapshotBindingsVerified(input: {
    readonly profileId: string;
    readonly preferenceProfileId: string;
  }): VerifiedOnboardingConfirmation;
}

export interface VerifiedOnboardingConfirmation {
  readonly receipt: OnboardingCompletionReceipt;
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
  readonly modelVersions: OnboardingVersionTuple;
}

export interface ConfirmedOnboardingFrontierPort {
  prepareFromOnboardingReceipt(
    receipt: OnboardingCompletionReceipt,
  ): Promise<PlaceFrontierPrepared>;
}
```

React creates one lowercase UUID `completionCommandId` with `crypto.randomUUID()` for the current Continue intent and keeps it only in onboarding-session memory. An ambiguous or failed handoff with unchanged confirmed values reuses that ID when the user presses the ordinary Continue action again; any draft/provenance change invalidates the intent and the next Continue gets a new ID. It is an idempotency token, not a retry action/state or durable session. A new onboarding session always receives a new command ID, even when its answers are identical.

The two command reconstructors require the exact schema literal and top-level keys, a bounded lowercase UUID/message, and a fresh `reconstructOnboardingSessionState` result; HTTP routes pass no open metadata. `extractMessage` projects that reconstructed session for the model, guards the raw result against the exact message, and applies it with the server-owned `nextParticipantId`. `completeOnboarding` projects the same reconstructed session for final local review and deterministic corroboration, calls `confirmOnboardingValues`, then passes the timestamp-free `ConfirmedOnboardingWrite` to the store. The store's injected clock is the sole owner of `confirmedAt` and snapshot construction. On the first successful command transaction it calls `materializeOnboardingSnapshots` once, derives safe fixed `receiptId` and `frontierRunId` values from the validated command through the existing integrity seam, and writes the result. The same command plus the same canonical confirmed values returns that exact receipt; the same command plus different values is a conflict. `confirmationDigest` is the existing integrity/HMAC digest over the final persisted snapshots, provenance, versions, command/run bindings and `confirmedAt`; it is never a uniqueness or idempotency key. A different command may therefore confirm identical values into a fresh snapshot/run.

After commit/replay, `completeOnboarding` performs idempotent Place Frontier preparation for the receipt's fixed run ID. It returns either blocking issues plus a deterministic assistant follow-up question, or `{ kind: "launched", receipt, prepared }`; it never returns a pair of IDs for the browser to launch separately.

This task is also the production composition boundary. Construct one process-owned `QwenLocalModelAdapter`, wrap that exact instance with the fixed `onboarding-model.ts` capability, prove it satisfies `LocalOnboardingModelPort`, and inject the resulting port and exact version tuple into one exported onboarding Application instance. The adapter is lazy-loaded, so constructing composition does not download or perform inference. Task 5's message route and Task 6C's Continue route must import this composed Application; neither route may exist with a fake, unbound or late-swapped model. Task 9 only re-runs the product gate and does not take composition ownership back.

- [ ] Write RED integration tests with fake model/store/frontier ports for exact message/Continue command reconstruction and closed results, extraction, direct manual edits, manual-origin overwrite Confirm/Revert, ordinary model-origin replacement, empty/placeholder blockers, ignored false model blocker, valid completion, same-command replay, same-command/different-input conflict, different-command/same-values fresh confirmation, digest tamper, one fixed `frontierRunId` per command, model outage preserving caller state, and zero persistence/frontier calls on failure.
- [ ] Pin closed public errors `local_model_unavailable`, `local_model_invalid_output`, `onboarding_confirmation_integrity_error` and `onboarding_frontier_handoff_failed`. Assert errors contain no prompt, transcript, excerpt or raw output.
- [ ] Prove there is no retry action/state, no draft/transcript port and no generalized provider/workflow interface.
- [ ] Implement `extractMessage` and `completeOnboarding` plus the deterministic follow-up question table for each blocking issue code; then wire the one concrete local capability in composition before either HTTP route is added.
- [ ] Run `pnpm exec vitest run tests/integration/onboarding.test.ts tests/integration/onboarding-composition.test.ts`, `pnpm run typecheck`, `pnpm exec eslint src/application/onboarding.ts src/application/onboarding-contracts.ts src/infrastructure/local-model/onboarding-model.ts src/infrastructure/composition-root.ts tests/integration/onboarding.test.ts tests/integration/onboarding-composition.test.ts`, and `git diff --check`.
- [ ] Commit boundary: `feat: orchestrate onboarding completion`.

---

### Task 5: Persist atomically and extract the shared frontier stream response

**Files:**
- Create: `src/infrastructure/sqlite/onboarding-store.ts`
- Modify: `src/infrastructure/sqlite/profile-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Create: `src/app/api/onboarding/message/route.ts`
- Create: `src/app/api/place-frontier/stream-response.ts`
- Modify: `src/app/api/place-frontier/route.ts`
- Create: `tests/integration/onboarding-store.test.ts`
- Create: `tests/integration/onboarding-transport.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/integration/place-frontier-transport.test.ts`

Add immutable `onboarding_confirmations` keyed uniquely by `completion_command_id` and bound to the two `@2` profile rows, canonical durable provenance, exact version tuple, integrity-only confirmation digest, fixed Country Frontier run ID and `confirmed_at`. A single `transaction.immediate()` first checks the command ID. An existing command reconstructs its snapshots/receipt and exact-compares the incoming timestamp-free confirmed values; an exact match replays and a mismatch conflicts. A new command chooses `confirmedAt`, calls `materializeOnboardingSnapshots`, inserts both snapshots plus the receipt, then reloads and canonical-compares them. `loadBySnapshotBindingsVerified` requires exactly one confirmation row for the exact profile/preference pair, reconstructs both `@2` snapshots and provenance/model versions, recomputes the receipt digest over the complete binding, and returns a fresh frozen `VerifiedOnboardingConfirmation`. Do not place a uniqueness constraint on `confirmation_digest`. No receipt column may contain message IDs, excerpts, spans, prompts, raw output or transcript.

Extract the existing finite NDJSON response construction from `/api/place-frontier` into `stream-response.ts` without changing the historical `/api/place-frontier` request or bytes. `/api/onboarding/message` calls the concrete composed `extractMessage` from Task 4; its module cannot accept a default fake or construct another model. Do not create `/api/onboarding/continue` or production-wire `ConfirmedOnboardingFrontierPort` in this task: the successful handoff depends on the approved `@2` Country Assessment implementation and is completed only in Task 6C. Task 4 continues to verify completion against a fake frontier port, while this task makes the durable receipt and shared finite-stream response available to that later integration.

- [ ] Write store REDs for all-or-nothing insert, one clock read and one snapshot materialization for a new command, exact replay under the same concurrent command/input, same-command/different-input conflict, different-command/same-values fresh rows, exact snapshot-pair verified load, provenance/digest/snapshot binding tamper rejection, immutable triggers, fresh copies and the durable-key privacy allowlist.
- [ ] Write transport REDs for the strict bounded onboarding-message request, concrete composed local-model invocation, no body echo, closed local-model errors and no server transcript/session endpoint. Keep Continue success, blocking-review response and receipt-to-frontier replay assertions for Task 6C, where their production dependency exists.
- [ ] Refactor `/api/place-frontier` to reuse `createPlaceFrontierStreamResponse` without changing its historical request contract or stream bytes.
- [ ] Implement schema/store/routes. Never log request content; log only closed error code, receipt ID/run ID and timings.
- [ ] Run `pnpm exec vitest run tests/integration/onboarding-store.test.ts tests/integration/onboarding-transport.test.ts tests/integration/database-schema.test.ts tests/integration/place-frontier-transport.test.ts`, `pnpm run typecheck`, the existing schema preflight, scoped `pnpm exec eslint` and `git diff --check`.
- [ ] Commit boundary: `feat: persist onboarding confirmation`.

---

### Task 6A: Persist and rank the explicit `@2` snapshots

**Files:**
- Modify: `src/decision/place-ranker.ts`
- Modify: `src/infrastructure/sqlite/profile-store.ts`
- Modify: `src/infrastructure/sqlite/place-frontier-store.ts`
- Modify: `tests/domain/place-ranker.test.ts`
- Modify: `tests/integration/profile-store.test.ts`
- Modify: `tests/integration/place-frontier.test.ts`

Keep every `@1` literal, confirmer and replay byte path intact. The existing `loadRelocationVerified(id)` remains V1-only permanently. Add receipt-specific `loadRelocationV2Verified(id)` and `loadPreferenceV2Verified(id)` methods that accept only their exact `@2` schemas. Country Assessment V2 Task 4 separately owns `loadRelocationAnyVerified(id)` and its closed `@1 | @2` Cold Start consumers; it must not widen or replace either version-specific loader. Add one capability-specific `loadPreferenceForRankingVerified(id)` with a closed `@1 | @2` switch so the unchanged `place-ranking@1` snapshot can be reconstructed from either preference schema; unknown schemas fail integrity and there is no schema registry. `SqlitePlaceFrontierStore` uses only that closed ranking loader. In `place-ranker.ts`, use two closed branches: the existing `@1` confirmer and the `@2` confirmer from Task 2. Both project exactly the same five country criteria. The four city preferences and every relocation-profile field have zero effect on Country ranking.

- [ ] Write RED tests for immutable `@2` profile/preference round-trip, participant preservation, equivalent `@1/@2` five-criterion ranking, zero city-criteria influence, unknown schema rejection and exact historical `@1` bytes.
- [ ] Add persisted-ranking REDs proving an `@2` preference-backed `place-ranking@1` round-trips and reconstructs identically, a tampered preference binding fails closed, and the historical `@1` ranking/store bytes stay identical.
- [ ] Run `pnpm exec vitest run tests/domain/place-ranker.test.ts tests/integration/profile-store.test.ts tests/integration/place-frontier.test.ts`; expect failures at the missing explicit `@2` branches.
- [ ] Implement only the closed profile-store, ranker and persisted-ranking branches.
- [ ] Re-run the focused tests, then run `pnpm run typecheck`, `pnpm exec eslint src/decision/place-ranker.ts src/infrastructure/sqlite/profile-store.ts src/infrastructure/sqlite/place-frontier-store.ts tests/domain/place-ranker.test.ts tests/integration/profile-store.test.ts tests/integration/place-frontier.test.ts`, and `git diff --check`.
- [ ] Commit boundary: `feat: persist onboarding snapshots`.

---

### Task 6B: Define the read-only Country assessment input

**Files:**
- Create: `src/decision/country-assessment-input-v2.ts`
- Create: `tests/domain/country-assessment-input-v2.test.ts`

```ts
export interface CountryAssessmentInputV2 {
  readonly schemaVersion: "country-assessment-input@2";
  readonly profileSnapshotId: string;
  readonly profile: RelocationProfileV2Snapshot;
}

export function projectCountryAssessmentInputV2(
  profile: RelocationProfileV2Snapshot,
): Readonly<CountryAssessmentInputV2>;

export function reconstructCountryAssessmentInputV2(
  input: unknown,
): Readonly<CountryAssessmentInputV2>;
```

This is a lossless, deep-frozen, read-only projection, not another persisted artifact. `projectCountryAssessmentInputV2` always derives `profileSnapshotId` from `profile.id`; `reconstructCountryAssessmentInputV2` exact-reconstructs the nested `relocation-profile@2` and rejects any `profileSnapshotId !== profile.id` binding. It selects no applicant, combines no household values, maps no work relation, converts no currency, fills no route-specific field and produces no marker, reason, formula or verdict. Those are Country Assessment rules, not onboarding implementation details.

- [ ] Write RED tests that every participant ID and exact typed value survives projection, caller mutation cannot alter it, session descriptors are absent, unknown/extra schema input fails, a mismatched outer/nested profile ID fails integrity, and no verdict/marker/reason/formula field exists.
- [ ] Run `pnpm exec vitest run tests/domain/country-assessment-input-v2.test.ts`; expect a missing-module failure.
- [ ] Implement only `projectCountryAssessmentInputV2` and its exact reconstructor.
- [ ] Re-run the focused test, then run `pnpm run typecheck`, `pnpm exec eslint src/decision/country-assessment-input-v2.ts tests/domain/country-assessment-input-v2.test.ts`, and `git diff --check`.
- [ ] Commit boundary: `feat: project country assessment input`.

---

### Task 6C: Bind the confirmed receipt to the completed `@2` Country Frontier

**Prerequisite gate:** Tasks 5, 6A and 6B are complete. The separate implementation plan at `docs/superpowers/plans/2026-08-20-country-assessment-v2.md` must also be fully implemented and verified against the approved `docs/superpowers/specs/2026-08-20-country-assessment-v2-design.md`. That plan exclusively owns Country Evidence/Dossier evolution, `ColdStartAssessmentInputV2`, `ColdStartComparatorV2`, `COLD_START_ASSESSMENT_V2_RULES_VERSION` and the exact `assessColdStartV2(input: ColdStartAssessmentInputV2): ColdStartComparatorV2` implementation, plus the closed `@1 | @2` Cold Start, Country Verifier, marker reconstruction, persisted participant projection, stream/view-model normalization and Yellow Resolution store/transport replay. This task adds only schema-neutral fixed-operation/resume persistence around that finished V2 path; it does not change a claim, Evidence/Dossier schema, parser, assessor, marker or verdict. If the separate plan is incomplete, stop here; do not create a placeholder assessor, reuse `@1`, synthesize yellow/unknown, or widen a version to plain `string`.

**Files:**
- Modify: `src/application/cold-start.ts`
- Modify: `src/application/country-verifier.ts`
- Modify: `src/application/place-frontier.ts`
- Modify: `src/research/research-plan.ts`
- Modify: `src/infrastructure/cold-start-composition.ts`
- Modify: `src/infrastructure/country-verifier-adapter.ts`
- Modify: `src/infrastructure/place-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/infrastructure/sqlite/evidence-store.ts`
- Modify: `src/infrastructure/sqlite/place-frontier-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Create: `src/app/api/onboarding/continue/route.ts`
- Modify: `tests/integration/cold-start.test.ts`
- Modify: `tests/integration/evidence-store.test.ts`
- Modify: `tests/integration/onboarding-transport.test.ts`
- Modify: `tests/integration/place-frontier.test.ts`
- Modify: `tests/integration/place-frontier-transport.test.ts`
- Modify: `tests/integration/research-plan.test.ts`
- Modify: `tests/integration/database-schema.test.ts`

Implement the existing exact `ConfirmedOnboardingFrontierPort.prepareFromOnboardingReceipt(receipt: OnboardingCompletionReceipt): Promise<PlaceFrontierPrepared>` without changing the historical direct-draft `/api/place-frontier` contract. This receipt-only path loads exact `relocation-profile@2` and `preference-profile@2` snapshots, requires their IDs to equal the receipt bindings, uses `receipt.frontierRunId` as the run ID and `receipt.confirmedAt` as the deterministic ranking `assessmentAt`, and keeps `RankingSnapshot` at `place-ranking@1` and Country Frontier at `country-frontier@1`.

For a new run, prepare and persist exactly one ranking. The receipt path uses a first-writer-wins insert-or-reload transaction: after `INSERT ... ON CONFLICT DO NOTHING`, it loads the fixed run and requires the stored run/profile/preference/time/context bindings, so concurrent exact preparation returns the winner rather than overwriting or regenerating it. For an existing run, load that ranking directly instead of constructing another snapshot. If its shortlist already exists, `runPlaceFrontier` presents the verified persisted read model and emits its terminal result without calling `CountryVerifierPort.check`, official-source research or any writer. A conflicting existing binding fails integrity. Historical direct `appendRanking` behavior remains unchanged. This is command/run replay, not an automatic retry loop or assessment regeneration.

Every fixed Country Frontier child check also has one immutable operation anchor:

```ts
export interface CountryCheckRunRecord {
  readonly schemaVersion: "country-check-run@1";
  readonly parentRunId: string;
  readonly countryCode: string;
  readonly childRunId: string;
  readonly profileId: string;
  readonly startedAt: string;
  readonly assessmentDate: string;
  readonly knowledgeBaselineRevisionId: string | null;
}

export interface CountryCheckRunStorePort {
  beginOrLoad(input: {
    readonly parentRunId: string;
    readonly countryCode: string;
    readonly childRunId: string;
    readonly profileId: string;
    readonly proposedStartedAt: string;
    readonly proposedKnowledgeBaselineRevisionId: string | null;
  }): CountryCheckRunRecord;
}
```

Add immutable `country_check_runs` with unique `(parent_run_id, country_code)`, unique `child_run_id`, and exact profile/start-date/baseline bindings. The first writer fixes `startedAt`, `assessmentDate = startedAt.slice(0, 10)` and the current verified Knowledge baseline; every later invocation reloads that record and canonical-compares parent/country/deterministic child/profile. A live execution deadline is newly bounded for each HTTP request, but it cannot change the persisted semantic assessment date or baseline. This row is fixed operation provenance, not retry status: it has no attempt counter, pending flag, recovery action or transition graph.

Make evidence preparation interruption-safe. `SqliteEvidenceStore.loadUnsealedArtifactsVerified(childRunId)` returns fresh verified `sealed = 0` captures for that exact child run, and `loadVerifiedBundleIfPresent(childRunId + ":evidence", expected)` returns either one exact sealed bundle or `undefined`. Before any request, Cold Start follows exactly one branch:

1. If the sealed bundle exists, verify run/profile/assessment/context/baseline, replay it and continue idempotent Dossier/Knowledge publication; do not capture, append, update a sealed row or call `seal` again.
2. Otherwise load the unsealed captures and pass them as `retainedArtifacts` to `prepareEvidencePlan`. Its `requestStep` matches at most one retained artifact by the canonical request tuple `(runId, sourceId, role, method, url, bodyMediaType?, bodySha256?)`, revalidates bytes hash plus full stored capture provenance, returns it without network/budget consumption, and performs the live request only when no retained match exists. Duplicate, mismatched or foreign retained artifacts fail integrity. Newly captured artifacts keep their original `capturedAt`; existing rows are never deleted, rewritten or timestamped again.

An abort may therefore leave an immutable run anchor and zero or more unsealed artifacts, but never a synthetic terminal result. With the unchanged draft, the browser keeps the same `completionCommandId`; pressing the ordinary `Продолжить` again replays the receipt/ranking, reloads the same child anchor, consumes the retained captures and completes the one fixed run. There is no automatic loop, special recovery endpoint/button or durable retry state. If a terminal shortlist or sealed child result already exists, it is presentation-only replay.

`/api/onboarding/continue` validates the bounded request and calls the concrete composed `completeOnboarding` from Task 4, returns blocking review as finite JSON with `followUpQuestion`, and on `{ kind: "launched" }` returns the prepared or replayed Country Frontier through the shared finite NDJSON response in the same POST. The route cannot inject a fake/late model, and the browser never makes a second `/api/place-frontier` launch request.

- [ ] Verify the prerequisite before editing: `test -f docs/superpowers/plans/2026-08-20-country-assessment-v2.md`, `test -f src/decision/cold-start-assessment-v2.ts`, and `rg -n "export function assessColdStartV2|input: ColdStartAssessmentInputV2|COLD_START_ASSESSMENT_V2_RULES_VERSION" src/decision/cold-start-assessment-v2.ts`. Then run the separate plan's documented focused suite; if any check fails, stop and report that prerequisite rather than editing its files here.
- [ ] Add receipt-handoff REDs for exact `@2` loads, receipt/profile/preference/run/time binding, one persisted ranking, same-command replay, concurrent exact preparation, conflicting binding failure, successful same-POST NDJSON and no second browser launch.
- [ ] Add completed-run replay REDs proving the persisted `@2` ranking, shortlist, participant-derived formal verdict and `cold-start-assessment@2` marker survive receipt replay without a verifier/research call, new write or changed terminal semantics; retain exact historical `@1` preparation and stream bytes. The prerequisite plan remains the sole owner of marker/Yellow Resolution reconstruction tests.
- [ ] Add interruption REDs for abort immediately after the first persisted artifact, exact child start/baseline reuse, retained request replay without a second network call for that request, remaining capture completion through the ordinary Continue action, sealed-evidence continuation without reseal/mutation, and integrity failure for altered/duplicate/foreign retained artifacts. Assert no retry UI/state/route/attempt column exists.
- [ ] Run `pnpm exec vitest run tests/integration/cold-start.test.ts tests/integration/evidence-store.test.ts tests/integration/research-plan.test.ts tests/integration/database-schema.test.ts tests/integration/onboarding-transport.test.ts tests/integration/place-frontier.test.ts tests/integration/place-frontier-transport.test.ts`; expect failures only at the missing receipt/fixed-run/resume/replay seams.
- [ ] Implement the immutable child anchor and retained/sealed Evidence branches first, then receipt-bound preparation, receipt-specific insert-or-reload, completed-run presentation and the concrete Continue route. Re-run the focused command, then run `pnpm run typecheck`, `pnpm exec eslint src/application/cold-start.ts src/application/country-verifier.ts src/application/place-frontier.ts src/research/research-plan.ts src/infrastructure/cold-start-composition.ts src/infrastructure/country-verifier-adapter.ts src/infrastructure/place-frontier-composition.ts src/infrastructure/composition-root.ts src/infrastructure/sqlite/evidence-store.ts src/infrastructure/sqlite/place-frontier-store.ts src/app/api/onboarding/continue/route.ts tests/integration/cold-start.test.ts tests/integration/evidence-store.test.ts tests/integration/research-plan.test.ts tests/integration/database-schema.test.ts tests/integration/onboarding-transport.test.ts tests/integration/place-frontier.test.ts tests/integration/place-frontier-transport.test.ts`, and `git diff --check`.
- [ ] Commit boundary: `feat: launch assessed onboarding frontier`.

---

### Task 7: Bind explicit country selection to persisted City Criteria

**Hard prerequisite:** Task 6C is complete, and City Frontier Core Tasks 9, 13 and 14 plus Delivery Tasks 16 and 18, including installed package/default lookup, `SqliteCityCriteriaStore`, `CityFrontierApplication.startCityFrontier`, its Start route and `CityFrontierStart`, are implemented. If any prerequisite is absent, stop Task 7, execute those named VS-4A tasks next, verify their documented gates, and then resume here. The full-product plan cannot defer or omit Task 7.

**Files:**
- Modify: `src/decision/city-criteria.ts`
- Modify: `src/application/city-frontier.ts`
- Modify: `src/infrastructure/sqlite/city-criteria-store.ts`
- Modify: `src/infrastructure/city-frontier-composition.ts`
- Modify: `src/app/api/city-frontier/start/route.ts`
- Modify: `src/experience/components/CityFrontierStart.tsx`
- Modify: `tests/domain/city-criteria.test.ts`
- Modify: `tests/integration/city-frontier.test.ts`
- Modify: `tests/integration/city-frontier-store.test.ts`
- Modify: `tests/integration/city-frontier-transport.test.ts`
- Modify: `tests/integration/city-frontier-experience.test.tsx`

**Amended Start contract:**

```ts
export type CityPreferenceMappingResult =
  | { readonly kind: "mapped"; readonly criteria: CityCriteriaSnapshot["criteria"] }
  | {
      readonly kind: "preference_correction_required";
      readonly fieldId: CityPreferenceTargetFieldId;
      readonly reasonCode: "city_target_not_installed";
    };

export interface CityPreferenceCorrectionRequired {
  readonly kind: "preference_correction_required";
  readonly resolvedCountryShortlistRevisionId: string;
  readonly fieldId: CityPreferenceTargetFieldId;
  readonly reasonCode: "city_target_not_installed";
}

export interface StartCityFrontierFromPreferencesInput {
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly commandId: string;
}

export function mapConfirmedCityPreferences(input: {
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly defaults: InstalledCityCriteriaDefaults;
  readonly evaluators: CityCriterionEvaluatorRegistry;
}): CityPreferenceMappingResult;

export interface CityFrontierApplication {
  startCityFrontierFromPreferences(
    input: StartCityFrontierFromPreferencesInput,
  ): Promise<CityFrontierReadModel | CityPreferenceCorrectionRequired>;
  // Existing Continue/Present methods remain unchanged.
}
```

`startCityFrontierFromPreferences` must call the existing `requireResolvedCountryShortlistForCity(revisionId)`, require an explicit `countryCode` that is an exact effective-green entry, and recover the exact relocation/preference IDs from that resolved revision. It loads the verified `preference-profile@2`, resolves the selected package through `resolveApprovedCityCriteriaDefaults`, and requires the resulting `InstalledCityCriteriaDefaults.mappingVersion` to equal the verified installed manifest binding. For each of the four criteria it preserves the user's `mode`, `importance` and canonical target, binds the installed `definitionId`, and asks that installed evaluator's `canonicalizeTarget` whether the target is representable. It must never replace a confirmed target with a default.

If all four map, confirm an immutable `CityCriteriaSnapshot`, persist/reload it through `SqliteCityCriteriaStore`, and pass its ID plus the resolved revision/country/profile/preference bindings into the existing `startCityFrontier`. The existing Start writer remains the single atomic owner of pre-city parent, ranking and frontier root; there is no second confirmation screen.

If one target cannot map, return the first catalog-ordered target field ID (`city_preferences.<criterion>.target`) with `city_target_not_installed` and perform zero Criteria/ranking/frontier writes. `CityFrontierStart` renders the exact correction link `?flow=onboarding-correction&source=<resolvedCountryShortlistRevisionId>&field=<fieldId>`; Task 8 owns that target view after it creates `OnboardingStart`. Do not guess, drop or default the target.

- [ ] Write REDs for exact resolved effective-green selection, source snapshot bindings, four exact installed-default mappings, persisted/reloaded Criteria ID passed to City Frontier, no second confirmation, exact command replay, and zero writes for an unmappable target.
- [ ] Add City Frontier experience REDs proving the unmappable result renders the exact resolved-revision/field correction link and no editable criteria or second confirmation.
- [ ] Implement only this boundary atop the existing City Frontier Core; do not duplicate package lookup, Criteria persistence or the City decision pipeline.
- [ ] Run `pnpm exec vitest run tests/domain/city-criteria.test.ts tests/integration/city-frontier.test.ts tests/integration/city-frontier-store.test.ts tests/integration/city-frontier-transport.test.ts tests/integration/city-frontier-experience.test.tsx`, `pnpm run typecheck`, scoped `pnpm exec eslint` and `git diff --check`.
- [ ] Commit boundary: `feat: hand confirmed preferences to city frontier`.

---

### Task 8: Deliver one questionnaire/chat workspace and the real neutral globe

**Files:**
- Create: `src/application/onboarding-correction.ts`
- Create: `src/app/api/onboarding/correction/route.ts`
- Create: `src/experience/components/OnboardingStart.tsx`
- Create: `src/experience/components/OnboardingQuestionnaire.tsx`
- Create: `src/experience/components/OnboardingChat.tsx`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/experience/components/ProductShell.tsx`
- Modify: `src/experience/components/WorkspaceGlobe.tsx`
- Modify: `src/experience/research-map/ResearchGlobe.module.css`
- Modify: `src/experience/research-map/contracts.ts`
- Modify: `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/integration/onboarding-experience.test.tsx`
- Create: `tests/integration/onboarding-correction.test.ts`
- Modify: `tests/integration/product-shell.test.tsx`
- Modify: `tests/integration/research-globe-canvas.test.tsx`

Add a real neutral presentation to the existing globe: optional origin, no marker/label/route/verdict, slow idle rotation only when motion is allowed, and the same renderer/canvas. `ResearchGlobeCanvas` must not synthesize an origin marker when `origin` is absent. `ProductShell` must render that explicit presentation during onboarding rather than hiding or duplicating the globe.

Desktop uses one viewport-height workspace: a single left scroll container (questionnaire followed by chat/composer) at roughly `2/3`, plus a pinned globe at roughly `1/3`. The initial questionnaire is compact and the free-text composer is visible/focused; after the first submitted message the questionnaire expands into its synchronized editable state without introducing a second page or nested form/chat scroll trap. Mobile order is compact globe, pinned latest-question control, questionnaire, chat/composer; tapping the control scrolls/focuses the current assistant question/composer, and no horizontal overflow is possible.

When final review finds a blocking issue, append its deterministic `followUpQuestion` as the next assistant chat message, focus the referenced field and keep the same draft/transcript. On successful Continue, wait until the NDJSON Country Frontier handoff is accepted, replace the onboarding view with the existing stream UI, then purge all browser transcript/draft content. A failed response/handoff preserves the local session. Never fire a second launch request.

The correction read boundary is exact and browser-safe:

```ts
export interface OnboardingCorrectionReadModel {
  readonly schemaVersion: "onboarding-correction-read@1";
  readonly sourceRevisionId: string;
  readonly focusFieldId: CityPreferenceTargetFieldId;
  readonly draft: OnboardingDraft;
  readonly provenance: QuestionnaireProvenance;
}

export interface OnboardingCorrectionPorts {
  readonly resolutions: {
    requireResolvedCountryShortlistForCity(
      revisionId: string,
    ): Promise<ResolvedCountryShortlistSnapshot>;
  };
  readonly confirmations: OnboardingConfirmationStorePort;
}

export async function loadOnboardingCorrectionVerified(
  input: {
    readonly sourceRevisionId: string;
    readonly fieldId: CityPreferenceTargetFieldId;
  },
  ports: OnboardingCorrectionPorts,
): Promise<OnboardingCorrectionReadModel>;
```

For `?flow=onboarding-correction&source=<resolvedCountryShortlistRevisionId>&field=<fieldId>`, the bounded correction route calls only `loadOnboardingCorrectionVerified`. The use case calls `requireResolvedCountryShortlistForCity`, then `loadBySnapshotBindingsVerified` with that revision's exact `profileSnapshotId` and `preferenceProfileSnapshotId`. It requires the verified receipt's two IDs to equal the resolution source, revalidates the receipt digest over the exact snapshots/provenance/model versions, reconstructs both `@2` snapshots, binds every provenance entry to those values, and calls `rehydrateOnboardingDraft`. It rejects historical/non-onboarding snapshots, a non-target/unknown field, a field absent from the reconstructed catalog, any receipt/provenance/snapshot mismatch, and any extra request key.

The returned read model is a fresh frozen projection and contains only the source revision ID, focus field, structured draft and closed provenance required to render/edit it. It contains no completion command/receipt/run ID, confirmation digest, HMAC, prompt, span, message ID, transcript, model output or free-form explanation. `OnboardingStart` starts with an empty transcript and focuses the exact city-preference target. The correction session owns a fresh `completionCommandId`. Successful Continue creates a new immutable receipt and reruns Country Frontier before another country selection; it never mutates the old Profile/Preference/receipt, uses the old completion command, or rebinds the old resolved revision.

- [ ] Write RED UI tests pinning compact initial state, expansion only after the first message, form/chat synchronization, conditional fields, manual edits, yellow Confirm/Revert only for manual-origin replacement, ordinary model-origin updates without yellow state, nonblocking yellow Continue, and a blocking final-review assistant follow-up.
- [ ] Pin one desktop left scroll workspace, pinned right globe, mobile ordering/latest-question focus behavior, visible composer, no horizontal scroll and reduced-motion auto-rotation off. Assert neutral mode produces no marker/label/route/verdict.
- [ ] Pin failed-request session preservation, same-payload command-ID reuse, command rotation after a draft/provenance change, and successful post-stream-handoff purge; assert one `/api/onboarding/continue` call per user Continue and zero browser `/api/place-frontier` launch calls.
- [ ] Add Application/transport REDs proving exact resolved-revision load; resolution -> receipt -> snapshot/provenance binding; browser-safe exact keys; fresh frozen projection; rejection of historical, unknown/non-target, tampered and mismatched inputs; and no transcript/message/integrity secret exposure.
- [ ] Add correction-view REDs proving exact resolved-revision/field validation and focus, empty transcript/no transcript fetch, a fresh completion command, immutable old snapshots/receipt, and successful correction -> new receipt -> Country Frontier -> new country selection.
- [ ] Implement by reusing `ProductShell`, `WorkspaceGlobe`, `ResearchGlobeCanvas` and the extracted Place Frontier stream response/consumer. Make onboarding the default `/`; preserve every explicit historical `?flow=...` route.
- [ ] Run `pnpm exec vitest run tests/integration/onboarding-correction.test.ts tests/integration/onboarding-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/onboarding-transport.test.ts`, `pnpm run typecheck`, `pnpm exec eslint src/application/onboarding-correction.ts src/app/api/onboarding/correction/route.ts src/experience/components/OnboardingStart.tsx src/experience/components/OnboardingQuestionnaire.tsx src/experience/components/OnboardingChat.tsx src/experience/components/ProductShell.tsx src/experience/components/WorkspaceGlobe.tsx src/experience/research-map/contracts.ts src/experience/research-map/ResearchGlobeCanvas.tsx src/app/page.tsx src/infrastructure/composition-root.ts tests/integration/onboarding-correction.test.ts tests/integration/onboarding-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/onboarding-transport.test.ts`, `pnpm run build`, and `git diff --check`.
- [ ] Commit boundary: `feat: deliver onboarding workspace`.

---

### Task 9: Pass the complete product gate

**Prerequisite:** Task 6C, the separate Country Assessment V2 plan, the named VS-4A prerequisites, and onboarding Tasks 7 and 8 are complete. This gate cannot waive the post-country City scenario.

**Files:**
- Create: `evals/onboarding.ts`
- Modify: `evals/fixtures/onboarding/cases.json`
- Modify: `tests/integration/local-model-runtime.test.ts`
- Modify: `tests/integration/onboarding.test.ts`
- Modify: `tests/integration/onboarding-transport.test.ts`

Do not edit composition or introduce another wiring pass here. Inspect and assert Task 4's one exported `QwenLocalModelAdapter`, exact capability-specific `LocalOnboardingModelPort`, version tuple and composed Application used by both production routes. The immutable model may be shared, but every request receives a new context sequence disposed in `finally`. Load/inference/abort/grammar failures remain the closed errors from Task 4 without prompts, request text or raw output. Do not add a model choice, generic adapter factory, retry, fallback, cache or conversation context.

- [ ] Re-run the full real-model grammar/adversarial/latency suite from Task 1, then add the approved end-to-end fixture: one first message with distinct `self + spouse` facts -> visible manual completion -> final review -> one command-scoped atomic receipt -> one Country Frontier NDJSON handoff. Require the canonical interaction to fit the 35-second narrative budget on the recorded demo Mac.
- [ ] Assert fresh context sequence/disposal for concurrent and failing requests, exact version provenance, zero model-phase network/telemetry calls, no sensitive error/log payload, same-command completion replay, different-command fresh completion, and no duplicate Frontier run.
- [ ] Run `pnpm run test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `git diff --check`, and `rg -n "OPENAI|ANTHROPIC|api[_-]?key|https?://" src/infrastructure/local-model src/application/onboarding.ts src/app/api/onboarding`; review every match and fail on any external model SDK/key/endpoint or persisted chat field.
- [ ] Run the required explicit country-selection -> mapped/persisted City Criteria -> City Frontier acceptance scenario and the unmappable-target -> verified correction load -> new receipt/Country Frontier -> new selection scenario. Any missing VS-4A/Task 7 dependency fails this gate rather than becoming a deferral.
- [ ] Commit boundary: `feat: complete local onboarding`.

## Completion Gate

Onboarding is complete only when Task 1's real local-model gate passed before product implementation; a fresh local run accepts free text, keeps the compact-to-expanded questionnaire and chat in one workspace, preserves/reverses only manual-origin overwrites, asks a chat follow-up for blocking final-review issues, atomically writes/replays one command-scoped `@2` receipt without chat content, hands the same request to one fixed interruption-safe Country Frontier run, and purges the browser session only after stream handoff. Historical `@1` replay must remain exact. The full product gate also requires the separate Country Assessment V2 plan, Task 6C, the named VS-4A prerequisites and Task 7: an explicit effective-green selection maps confirmed targets against installed defaults, persists the resulting `CityCriteriaSnapshot`, starts City Frontier, and an unmappable target returns through the verified correction flow. None of these scenarios is optional or deferred.
