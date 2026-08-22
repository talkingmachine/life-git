# Local Conversational Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical start screen with a local questionnaire-and-chat workspace that uses the installed Codex CLI for guarded extraction/review, persists exact `@2` snapshots, and hands one successful Continue action directly to Country Frontier.

**Architecture:** Decision owns the closed questionnaire, applicability, source-span guards, provenance, deterministic review, and snapshot materialization. Application owns extraction and completion use cases through a narrow `OnboardingModelPort`; Infrastructure wraps the shared Codex adapter, persists one immutable confirmation receipt, and composes the existing Frontier. React owns only the unsaved transcript/draft and renders the questionnaire as the source of truth.

**Tech Stack:** TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, SQLite/better-sqlite3 13.0.3, Vitest 4.1.10, pnpm 11.19.0, shared Codex CLI runtime.

**Spec:** `docs/superpowers/specs/2026-08-20-local-conversational-onboarding-design.md`

## Global Constraints

- Task 0 is complete in commits `6e67783`, `fdc5962`, and `aa747e3`. Preserve `src/decision/onboarding-catalog.ts`, `src/decision/onboarding-model-output.ts`, and their historical tests except for a proven bug.
- Runtime Tasks 1–4 and their real feasibility gate must be complete before Task 3. The user explicitly deferred the separate Task 5 network/privacy audit on 2026-08-22 after its single fail-closed run; that audit remains open but does not block product implementation. Do not add another process adapter or runtime facade.
- Questionnaire state is authoritative. Codex proposes only allowlisted values and closed review codes; deterministic guards alone mutate or block the form.
- Missing text, ambiguity, `-`, and `не знаю` remain empty. Explicit numeric zero remains valid.
- Only a guarded proposal that replaces an existing manual value becomes nonblocking yellow `model_overwrite_unreviewed`; Confirm and Revert are local deterministic actions.
- No automatic retry, retry state/button, transcript store, prompt/raw-output store, question graph, rules engine, provider abstraction, or background workflow.
- Preserve exact `relocation-profile@1`, `preference-profile@1`, and `cold-start-assessment@1` bytes. New onboarding writes explicit `@2` branches.
- Do not coerce `@2` data into RU/RUB-only `@1`. Country Assessment V2 is a mandatory separate plan, not an onboarding shortcut.
- Official-source research starts only after successful local confirmation. Codex never creates Evidence, ranking, marker, eligibility, calculation, or verdict.
- Preserve the three user-owned `.superpowers/brainstorm/*` directories and never stage them.

## Execution Order Across Existing Plans

1. This plan Tasks 1–2.
2. Tasks 1–4 and the passing real feasibility gate in `docs/superpowers/plans/2026-08-21-codex-cli-runtime.md`; its Task 5 audit may remain deferred under the recorded user decision.
3. This plan Tasks 3–5.
4. This plan Task 6, which executes all tasks in `docs/superpowers/plans/2026-08-20-country-assessment-v2.md`.
5. This plan Tasks 7–8 for the first working onboarding → Country Frontier slice.
6. City Knowledge Tasks 9–10, City Core Tasks 11–15, and Delivery Tasks 16–19 from the approved VS-4A plans.
7. This plan Task 9 for City Criteria/correction integration.

The first honest working product checkpoint is after Task 8. Task 9 completes the approved correction and City handoff but must not delay testing the default onboarding path.

---

### Task 0: Preserve the completed model-output vocabulary

**Files:**
- Verify unchanged: `src/decision/onboarding-catalog.ts`
- Verify unchanged: `src/decision/onboarding-model-output.ts`
- Verify unchanged: `src/decision/iso-codes.ts`
- Verify unchanged: `tests/domain/onboarding-model-output.test.ts`

**Interfaces:**
- Produces: `OnboardingModelFieldId`, `ParsedLocalFieldProposal`, `QuestionnaireIssueCode`, `parseLocalExtractionOutput`, and `parseLocalReviewOutput` for Tasks 1–4.

- [x] **Step 1: Confirm the existing focused suite.** `pnpm exec vitest run tests/domain/onboarding-model-output.test.ts` passed when Task 0 was committed.
- [x] **Step 2: Preserve the exact contracts.** No implementation work remains in this task.

---

### Task 1: Define the questionnaire, provenance, and immutable `@2` snapshots

**Files:**
- Create: `src/decision/onboarding-questionnaire.ts`
- Create: `src/decision/onboarding-provenance.ts`
- Modify: `src/decision/relocation-profile.ts`
- Modify: `src/decision/preference-profile.ts`
- Create: `tests/domain/onboarding-questionnaire.test.ts`
- Create: `tests/domain/relocation-profile.test.ts`
- Create: `tests/domain/preference-profile.test.ts`

**Interfaces:**
- Consumes: Task 0 field/value vocabulary.
- Produces: the exact draft, deterministic review, provenance, and `@2` materializers consumed by Tasks 2, 4, 5, and Country Assessment V2.

```ts
export type ParticipantId = string;
export type QuestionnaireFieldOrigin = "empty" | "model" | "manual";
export type QuestionnaireApplicability = "required" | "not_applicable";
export interface ParticipantRosterValue {
  readonly participantId: ParticipantId;
  readonly relationship: ParticipantRelationship;
}

export type ParticipantFieldId = `participants.${ParticipantId}.${ParticipantLeafId}`;
export type OnboardingFieldId =
  | OnboardingBaseFieldId
  | ParticipantFieldId
  | CountryPreferenceFieldId
  | CityPreferenceFieldId;
export type OnboardingFieldValue =
  | CurrentLocationValue
  | MoveHorizonValue
  | MovingPartyValue
  | readonly ParticipantRosterValue[]
  | readonly IsoCountryCode[]
  | PassportValue
  | CurrentWorkValue
  | RemoteContinuationValue
  | MonthlyIncomeValue
  | SavingsValue
  | EducationValue
  | number
  | PreferenceMode
  | PreferenceImportance
  | string;

export interface QuestionnaireModelOverwriteValuePair {
  readonly previousValue: OnboardingFieldValue;
  readonly proposedValue: OnboardingFieldValue;
  readonly reasonCode: "explicit_new_information";
}
export type QuestionnaireModelOverwrite = QuestionnaireModelOverwriteValuePair & (
  | { readonly reviewState: "model_overwrite_unreviewed" | "model_overwrite_confirmed" }
  | { readonly reviewState: "model_overwrite_reverted" }
);

export type QuestionnaireFieldState =
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "not_applicable";
      readonly rawInput: null;
      readonly normalizedValue: null;
      readonly origin: "empty";
      readonly overwrite: null;
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly rawInput: unknown | null;
      readonly normalizedValue: null;
      readonly origin: "empty";
      readonly overwrite: null;
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly rawInput: unknown | null;
      readonly normalizedValue: OnboardingFieldValue;
      readonly origin: "manual" | "model";
      readonly overwrite: null;
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly rawInput: unknown | null;
      readonly normalizedValue: OnboardingFieldValue;
      readonly origin: "model";
      readonly overwrite: QuestionnaireModelOverwrite & {
        readonly reviewState: "model_overwrite_unreviewed" | "model_overwrite_confirmed";
      };
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly rawInput: unknown | null;
      readonly normalizedValue: OnboardingFieldValue;
      readonly origin: "manual";
      readonly overwrite: QuestionnaireModelOverwrite & {
        readonly reviewState: "model_overwrite_reverted";
      };
    };

export interface OnboardingDraft {
  readonly schemaVersion: "onboarding-draft@1";
  readonly fields: readonly QuestionnaireFieldState[];
}

export interface QuestionnaireIssue {
  readonly fieldId: OnboardingFieldId;
  readonly reasonCode: QuestionnaireIssueCode;
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
      readonly origin: "model";
      readonly reviewState: "model_overwrite_unreviewed" | "model_overwrite_confirmed";
      readonly previousValue: OnboardingFieldValue;
      readonly proposedValue: OnboardingFieldValue;
      readonly reasonCode: "explicit_new_information";
    }
  | {
      readonly fieldId: OnboardingFieldId;
      readonly applicability: "required";
      readonly origin: "manual";
      readonly reviewState: "model_overwrite_reverted";
      readonly previousValue: OnboardingFieldValue;
      readonly proposedValue: OnboardingFieldValue;
      readonly reasonCode: "explicit_new_information";
    };

export interface QuestionnaireProvenance {
  readonly schemaVersion: "onboarding-provenance@1";
  readonly fields: readonly QuestionnaireProvenanceEntry[];
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

export interface ConfirmedOnboardingValues {
  readonly schemaVersion: "confirmed-onboarding-values@1";
  readonly profile: Omit<RelocationProfileV2Snapshot, "id" | "confirmedAt">;
  readonly preferences: Omit<PreferenceProfileV2Snapshot, "id" | "confirmedAt">;
  readonly provenance: QuestionnaireProvenance;
}

export function createOnboardingDraft(nextParticipantId: () => string): OnboardingDraft;
export type QuestionnaireFieldChange =
  | { readonly kind: "manual_set"; readonly fieldId: OnboardingFieldId; readonly rawInput: unknown }
  | {
      readonly kind: "guarded_model_set";
      readonly fieldId: OnboardingFieldId;
      readonly normalizedValue: OnboardingFieldValue;
    }
  | { readonly kind: "confirm_model_overwrite"; readonly fieldId: OnboardingFieldId }
  | { readonly kind: "revert_model_overwrite"; readonly fieldId: OnboardingFieldId };
export function applyQuestionnaireFieldChange(
  draft: OnboardingDraft,
  change: QuestionnaireFieldChange,
): OnboardingDraft;
export function reconcileOnboardingApplicability(draft: OnboardingDraft): OnboardingDraft;
export function reviewQuestionnaire(draft: OnboardingDraft): QuestionnaireReview;
export function confirmOnboardingValues(draft: OnboardingDraft): ConfirmedOnboardingValues;
export function materializeOnboardingSnapshots(input: {
  readonly confirmedAt: string;
  readonly values: ConfirmedOnboardingValues;
}): {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
};
export function reconstructOnboardingDraft(value: unknown): OnboardingDraft;
export function reconstructQuestionnaireProvenance(value: unknown): QuestionnaireProvenance;
export function reconstructRelocationProfileV2(value: unknown): RelocationProfileV2Snapshot;
export function reconstructPreferenceProfileV2(value: unknown): PreferenceProfileV2Snapshot;
export function rehydrateOnboardingDraft(input: {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
}): OnboardingDraft;
```

`OnboardingDraft.fields` is in canonical catalog order and has exactly one cell per current
roster-derived address. Manual `rawInput` remains session-only so malformed text and placeholders stay
visible; only a successful field normalizer populates `normalizedValue`. Hidden cells retain neither
raw/normalized data nor overwrite history. A guarded model update may enter Decision only through
`guarded_model_set`; the reducer alone assigns `explicit_new_information`. Confirmed and unresolved
overwrites use the proposed value, while Revert restores the previous manual value. The closed
provenance union preserves exact applicability and typed old/new values without raw input or spans.
`createOnboardingDraft` allocates the structural `self` participant immediately; because the approved
origin union intentionally has no `system` member, this single user-owned form default is represented
as `origin: "manual"` with `rawInput: null`, never as a model proposal.

Applicability is the closed approved table: `citizenships` and `passport` are required for every
participant; all other participant leaves are `not_applicable` for `minor_child`; for every other
participant work, income, education, and experience are required, while remote continuation is
required only when work status is not `not_working`. `alone` has exactly one `self` participant;
`with_companions` has `self` plus at least one companion. Durable participant IDs are bounded
lowercase UUIDs, remain stable across roster edits, never appear in model output, and are not names.

`RelocationProfileV2Snapshot` contains the exact participant-ordered situation fields from the spec,
including current location, move horizon, moving party, citizenships, passport status, work,
remote continuation, income, education, experience, and savings interval. `PreferenceProfileV2Snapshot`
contains exactly the five country and four universal city criteria with mode/importance/target. Both
are closed, recursively frozen, content-addressed versioned values; `@1` constructors and loaders
remain unchanged. Rehydration exact-binds every provenance entry to the two verified snapshots and
never recreates raw input, transcript, message IDs, descriptors, spans, prompts, or model output.

- [ ] **Step 1: Write RED questionnaire tests.** Cover every applicability transition, `alone`/companions, minor-child exclusions, clearing hidden values, zero, empty/placeholder values, exact 5+4 criteria, manual/model origin, yellow Confirm/Revert, unresolved yellow nonblocking, dense participant order, immutable fresh copies, and hostile borrowed graphs.
- [ ] **Step 2: Write RED snapshot tests.** Prove all `@2` fields and provenance survive exact reconstruction while existing `@1` bytes remain unchanged.
- [ ] **Step 3: Run RED.** Run `pnpm exec vitest run tests/domain/onboarding-questionnaire.test.ts tests/domain/relocation-profile.test.ts tests/domain/preference-profile.test.ts`; expect missing modules/types.
- [ ] **Step 4: Implement pure Decision code only.** No React, SQLite, Codex, or Application import is allowed.
- [ ] **Step 5: Run GREEN and static gates.** Re-run the focused Vitest command, then `pnpm run typecheck`, `pnpm exec eslint src/decision/onboarding-questionnaire.ts src/decision/onboarding-provenance.ts src/decision/relocation-profile.ts src/decision/preference-profile.ts tests/domain/onboarding-questionnaire.test.ts tests/domain/relocation-profile.test.ts tests/domain/preference-profile.test.ts`, and `git diff --check`.
- [ ] **Step 6: Commit.**

```bash
git add src/decision/onboarding-questionnaire.ts src/decision/onboarding-provenance.ts \
  src/decision/relocation-profile.ts src/decision/preference-profile.ts \
  tests/domain/onboarding-questionnaire.test.ts tests/domain/relocation-profile.test.ts \
  tests/domain/preference-profile.test.ts
git commit -m "feat: define onboarding questionnaire"
```

---

### Task 2: Guard source spans and own session transitions

**Files:**
- Create: `src/decision/onboarding-model-contract.ts`
- Create: `src/decision/onboarding-session.ts`
- Create: `tests/domain/onboarding-model-contract.test.ts`
- Create: `tests/domain/onboarding-session.test.ts`

**Interfaces:**
- Consumes: Tasks 0–1 parsers and draft reducer.
- Produces: browser-safe session reconstruction and guarded extraction/review for Task 4.

```ts
export interface SessionMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface OnboardingSessionState {
  readonly sessionVersion: "onboarding-session@1";
  readonly completionCommandId: string;
  readonly messages: readonly SessionMessage[];
  readonly draft: OnboardingDraft;
  readonly descriptorBindings: Readonly<Partial<Record<ParticipantDescriptor, ParticipantId>>>;
}

export const ONBOARDING_SESSION_LIMITS = Object.freeze({
  maxMessages: 64,
  maxMessageUtf8Bytes: 8_192,
  maxSessionUtf8Bytes: 114_688,
  maxParticipants: 20,
  maxFields: 172, // 5 base + 20 * 7 participant + 5 * 3 country + 4 * 3 city
  maxNextQuestionUtf8Bytes: 2_048,
} as const);

export type ParticipantLeafValue<L extends ParticipantLeafId> =
  L extends "citizenships" ? readonly IsoCountryCode[] :
  L extends "passport" ? PassportValue :
  L extends "current_work" ? CurrentWorkValue :
  L extends "remote_continuation" ? RemoteContinuationValue :
  L extends "monthly_income" ? MonthlyIncomeValue :
  L extends "education" ? EducationValue :
  L extends "relevant_experience_years" ? number : never;

export type GuardedParticipantLeafProposal = {
  readonly [L in ParticipantLeafId]: {
    readonly kind: "participant_leaf";
    readonly descriptor: ParticipantDescriptor;
    readonly leafId: L;
    readonly normalizedValue: ParticipantLeafValue<L>;
  };
}[ParticipantLeafId];

export type GuardedExtractionProposal =
  | {
      readonly kind: "participant_roster";
      readonly roster: readonly ParticipantRosterProposal[];
    }
  | {
      readonly kind: "non_participant_field";
      readonly fieldId:
        | Exclude<OnboardingBaseFieldId, "participants">
        | CountryPreferenceFieldId
        | CityPreferenceFieldId;
      readonly normalizedValue: OnboardingFieldValue;
    }
  | GuardedParticipantLeafProposal;

export interface GuardedExtraction {
  readonly proposals: readonly GuardedExtractionProposal[];
  readonly nextQuestion: string;
}

export function createOnboardingSession(input: {
  readonly nextParticipantId: () => string;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState;
export function guardExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly userMessage: SessionMessage;
  readonly rawModelOutput: unknown;
}): GuardedExtraction;
export function applyGuardedExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly userMessage: SessionMessage;
  readonly extraction: GuardedExtraction;
  readonly nextParticipantId: () => string;
  readonly nextAssistantMessageId: () => string;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState;
export function applySessionFieldChange(input: {
  readonly session: OnboardingSessionState;
  readonly change: QuestionnaireFieldChange;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState;
export function projectQuestionnaireForModel(session: OnboardingSessionState): unknown;
export function corroborateModelReview(input: {
  readonly session: OnboardingSessionState;
  readonly rawModelOutput: unknown;
}): readonly QuestionnaireIssue[];
export function reconstructOnboardingSessionState(value: unknown): OnboardingSessionState;
```

For each proposal, `guardExtraction` requires the exact current user `messageId`, treats spans as
UTF-16 code-unit offsets, rejects an empty/out-of-range span or a boundary that splits a surrogate
pair, and extracts that exact substring. Codex owns semantic interpretation. After UTF-16 structural
validation, the guard first drops a proposal whose whole span normalizes by NFKC/case/whitespace to
`-`, `не знаю`, `неизвестно`, `unknown`, `n/a` or `na`; only a non-placeholder span must contain at
least one Unicode letter or number, otherwise the whole extraction is rejected. It accepts
`typedValue` only through Task 0's exact field-specific schema and allowlist. It does not add
a second natural-language grammar, JSON-span convention, substring comparison, confidence score or
heuristic inference layer. Structural output errors, wrong message IDs and malformed spans reject the
whole extraction; a well-formed placeholder proposal alone is omitted so other explicit facts in the
same message remain usable.
Participant descriptors `self`/`companion.N` remain descriptor + typed leaf proposals through
`guardExtraction`; model output never chooses durable participant IDs. `applyGuardedExtraction`
applies the explicit `participant_roster` arm first and then applies participant leaves in canonical
field order, so a first-message `remote_continuation` is evaluated after that participant's
`current_work` regardless of model proposal order. Model roster reconciliation retains IDs only for
an unchanged relationship prefix and permits unambiguous tail add/remove; middle removal, reorder or
relationship rebinding rejects before callbacks or draft mutation. Manual roster edits already carry
durable IDs, preserve the remaining participant values, and rebuild ordinal descriptor bindings from
their new order. New descriptors receive UUIDs only inside apply, after validation. An absent,
duplicate, gapped or rebound descriptor is rejected before any draft mutation. A descriptor string itself can never be used as a
`ParticipantId`, written into `OnboardingDraft.fields`, or passed to the field reducer. A model issue survives only when its
reason code is corroborated by the matching field parser or deterministic cross-field rule.
`corroborateModelReview` resolves every `self`/`companion.N` issue through the session's exact
one-to-one `descriptorBindings` before it can return a durable `QuestionnaireIssue`; an absent,
removed, duplicate, or rebound descriptor is ignored rather than guessed from roster position.

`completionCommandId` is generated once with `crypto.randomUUID()` when the browser creates the
session. It remains stable across an unchanged Continue submission and an ambiguous transport
failure. A user or assistant message that leaves authoritative values/provenance unchanged does not
rotate it. Any roster/applicability/value/provenance change, including a guarded model update,
manual edit, Confirm, or Revert, rotates it once to a fresh UUID before the next Continue, making the
changed questionnaire a new explicit completion command.
`applyGuardedExtraction` obtains the appended assistant question ID only from
`nextAssistantMessageId`; message IDs and completion command IDs are distinct lowercase UUIDs.
`reconstructOnboardingSessionState` validates the lowercase UUID, exact message and draft shapes, and
one-to-one bindings for the current roster. It rejects before projection when any exact
`ONBOARDING_SESSION_LIMITS` count, per-message UTF-8 limit or whole serialized-session UTF-8 limit is
exceeded; arrays must be dense and every retained
field must belong to the bounded roster-derived catalog. Model projections exclude the command ID, internal
participant IDs, raw invalid input, overwrite history, and unrelated transcript text.

- [ ] **Step 1: Write RED model-contract tests.** Include an ordinary Russian multi-fact message, wrong message/span, valid non-ASCII UTF-16 offsets, split-surrogate boundaries, empty/punctuation-only spans, exact `не знаю`/`-` omission while retaining sibling facts, descriptor gaps, unknown field, prompt injection, strict typed-value schema enforcement, spouse review issue mapping, and ignored review issues for removed/rebound/unknown companion descriptors. Do not require a JSON-shaped span or a second natural-language parser.
- [ ] **Step 2: Write RED reducer tests.** Include complete `self + spouse` roster and companion leaves in one message with leaves before roster and remote before work, the explicit descriptor-roster arm, UUID allocation only inside apply, an assertion that no draft field ID or participant ID contains `self`/`companion.`, stable descriptor bindings, allowed tail add/remove, rejected model middle removal/reorder/rebind before callbacks, manual middle removal/reorder preserving durable participant data and rebuilding descriptors, new value, ordinary model replacement, manual replacement yellow state, Confirm/Revert, applicability clearing, command-ID rotation exactly once per authoritative mutation, stable ID after message-only/no-op/blocked failure, unique user/assistant message IDs, per-message/aggregate byte limits, next-question append, immutability, and hostile session reconstruction.
- [ ] **Step 3: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/domain/onboarding-model-contract.test.ts tests/domain/onboarding-session.test.ts`; expect missing modules, implement the minimum pure functions, and re-run it.
- [ ] **Step 4: Run static gates.** Run `pnpm run typecheck`, `pnpm exec eslint src/decision/onboarding-model-contract.ts src/decision/onboarding-session.ts tests/domain/onboarding-model-contract.test.ts tests/domain/onboarding-session.test.ts`, and `git diff --check`.
- [ ] **Step 5: Commit.**

```bash
git add src/decision/onboarding-model-contract.ts src/decision/onboarding-session.ts \
  tests/domain/onboarding-model-contract.test.ts tests/domain/onboarding-session.test.ts
git commit -m "feat: guard onboarding session"
```

---

### Task 3: Bind the two onboarding capabilities to the shared Codex adapter

**Prerequisite:** Codex runtime Tasks 1–4 and the passing real feasibility artifact are complete. Runtime Task 5 remains a recorded deferred audit and is not a product dependency.

**Files:**
- Modify: `src/decision/onboarding-catalog.ts`
- Modify: `src/decision/onboarding-model-output.ts`
- Modify: `src/decision/onboarding-model-contract.ts`
- Create: `src/application/onboarding-contracts.ts`
- Create: `src/infrastructure/codex-cli/onboarding-schema.ts`
- Create: `src/infrastructure/codex-cli/onboarding-model.ts`
- Modify: `tests/domain/onboarding-model-output.test.ts`
- Modify: `tests/domain/onboarding-model-contract.test.ts`
- Create: `tests/domain/onboarding-schema.test.ts`
- Create: `tests/integration/codex-onboarding-model.test.ts`
- Create: `evals/onboarding-feasibility.ts`
- Create: `evals/fixtures/onboarding/cases.json`

**Interfaces:**
- Consumes: Task 0 parsers, Task 2 model projections, and the shared `CodexCliModelAdapter`.
- Produces: the only `OnboardingModelPort` consumed by Task 4.

Before writing the schemas, finish the Task 0 single-source-of-truth seam. Export readonly tuples
for every closed runtime vocabulary already owned by `onboarding-catalog.ts`: base field IDs,
participant leaf IDs and relationships, move horizons, moving-party values, work statuses, remote
continuation values, income bases, education levels, preference modes/importances, country target
values, and questionnaire issue codes. `onboarding-model-output.ts` must build its Sets from those
tuples; the schema module consumes the same tuples and the existing country/city criterion tuples.
ISO country/currency and canonical decimal/day values remain pattern-constrained in JSON Schema and
are finally accepted only by the existing strict Task 0 parser. Do not create a second literal
allowlist in Infrastructure.

Task 2 also exports a closed `OnboardingQuestionnaireProjection` and
`reconstructOnboardingQuestionnaireProjection(value: unknown)`. The reconstructor owns and freezes
exactly `{schemaVersion:"onboarding-questionnaire-projection@1", fields:[{fieldId, applicability,
normalizedValue}]}` in canonical questionnaire order, rejects extra/missing/symbol/accessor/sparse/
cyclic/decorated values, and validates every field/value/applicability pair. The model wrapper calls
this reconstructor before measuring or serializing either prompt; untrusted `questionnaire: unknown`
is never passed directly to `JSON.stringify`.

```ts
export interface OnboardingModelVersions {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@1";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-model-output@1";
  readonly reviewSchema: "onboarding-review-output@1";
}

export const ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES = 65_536;
export const ONBOARDING_REVIEW_MAX_PROMPT_BYTES = 98_304;
export const ONBOARDING_EXTRACTION_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxStdoutBytes: 131_072,
  maxStderrBytes: 16_384,
  maxEvents: 64,
} as const satisfies CodexInvocationLimits);
export const ONBOARDING_REVIEW_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  maxStdoutBytes: 65_536,
  maxStderrBytes: 16_384,
  maxEvents: 64,
} as const satisfies CodexInvocationLimits);

export interface OnboardingModelPort {
  readonly versions: OnboardingModelVersions;
  extract(input: {
    readonly message: SessionMessage;
    readonly questionnaire: unknown;
    readonly signal: AbortSignal;
  }): Promise<LocalExtractionResult>;
  review(input: {
    readonly questionnaire: unknown;
    readonly signal: AbortSignal;
  }): Promise<LocalReviewResult>;
}

export type OnboardingModelErrorCode =
  | "onboarding_model_aborted"
  | "onboarding_model_invalid"
  | "onboarding_model_runtime_failed";

export class OnboardingModelError extends Error {
  readonly name: "OnboardingModelError";
  readonly code: OnboardingModelErrorCode;
  readonly runtimeCode?: CodexRuntimeErrorCode;
}

export function createCodexOnboardingModel(
  runtime: CodexCliModelAdapter,
): OnboardingModelPort;

export interface OnboardingModelFeasibilityArtifact {
  readonly schemaVersion: "onboarding-model-feasibility@1";
  readonly fixtureVersion: "onboarding-cases@1";
  readonly fixtureDigest: string;
  readonly invocationVersion: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPromptVersion: "onboarding-extract@1";
  readonly reviewPromptVersion: "onboarding-review@1";
  readonly extractionSchemaVersion: "onboarding-model-output@1";
  readonly reviewSchemaVersion: "onboarding-review-output@1";
  readonly extractionPromptDigest: string;
  readonly reviewPromptDigest: string;
  readonly extractionSchemaDigest: string;
  readonly reviewSchemaDigest: string;
  readonly extractionLimits: typeof ONBOARDING_EXTRACTION_LIMITS;
  readonly reviewLimits: typeof ONBOARDING_REVIEW_LIMITS;
  readonly caseResults: readonly {
    readonly caseId: string;
    readonly status: "passed";
    readonly elapsedMs: number;
  }[];
  readonly rawPromptStored: false;
  readonly rawOutputStored: false;
  readonly transcriptStored: false;
  readonly artifactDigest: string;
}
```

The wrapper owns exactly two prompts, two JSON Schemas, and the exact prompt/process limits above,
all below the shared runtime maxima. It rejects an oversized UTF-8 prompt before calling the adapter. It calls one
`invokeJson` per method, requires the returned invocation/template/schema metadata to match the
request and fixed version tuple, and applies Task 0's strict parser only to `CodexJsonResult.value`.
It has no retry method, conversation resume, provider switch, fallback, or raw-output accessor.
Before any asynchronous work it rejects an inactive signal as
`OnboardingModelError("onboarding_model_aborted")`. It never rethrows the caller's abort reason.
After the single adapter call it checks the signal again. A `CodexRuntimeError` becomes a new
content-free `OnboardingModelError("onboarding_model_runtime_failed", runtimeCode)`; metadata
mismatch, projection/schema/parser failure, non-Codex rejection, or invalid owned result becomes a
new content-free `OnboardingModelError("onboarding_model_invalid")`. The error has no `cause`, raw
message, prompt, result, stdout or stderr. `message === code`.

The extraction prompt makes the descriptor grammar executable rather than implicit: a roster starts
with `self/self`, continues with `companion.0`, `companion.1`, and so on in mention order, reuses those
descriptors in participant field IDs, and never emits the same field ID twice. The 30-second extraction
ceiling reflects the measured prepared-Mac companion case; review retains its separate 15-second ceiling.
City values are normalized to their canonical nominative Russian form while the evidence span keeps
the user's original inflected wording.
`guardExtraction` canonicalizes an explicit roster equal to the current descriptor roster away as a
no-op; an actual roster change remains a guarded proposal and retains the existing reconciliation rules.

The fixture is one exact plain object
`{fixtureVersion:"onboarding-cases@1", cases:[...]}` with this fixed order:
`extract_self_ru`, `extract_companion`, `extract_zero_unusual_iso`, `extract_unknown`,
`extract_correction`, `extract_prompt_injection`, `review_final_blockers`. Extraction cases contain
only `{caseId,kind:"extract",sessionSeed,userMessage,expectedProposals}`; review contains only
`{caseId,kind:"review",sessionSeed,expectedIssues}`. `sessionSeed` is the compact exact object
`{schemaVersion:"onboarding-feasibility-session-seed@1",initialParticipantId,
initialCompletionCommandId,nextCompletionCommandIds,changes}`; every change is an exact
`manual_set` `{kind,fieldId,rawInput}`. The gate reconstructs it only through
`createOnboardingSession`, ordered `applySessionFieldChange`, exact consumption of all completion
IDs, and final `reconstructOnboardingSessionState`; roster `rawInput` carries companion UUIDs. The fixture
reader rejects extra/missing/accessor/symbol/sparse/decorated graphs before any callback.
`expectedProposals` is the exact canonical guarded
proposal projection without `nextQuestion`; the gate additionally requires a non-empty bounded
`nextQuestion`. `expectedIssues` is the exact canonical deterministic issue sequence returned after
`corroborateModelReview`. The cases cover self facts, a spouse roster/leaves, explicit zero, assigned
unusual ISO/currency, placeholders omitted while sibling facts survive, a correction, an injection
near legitimate text, and a fully populated questionnaire with only the pinned final blockers.
Malformed schema/output belongs only to the fake adapter/parser RED tests because a real strict-schema
invocation cannot be required to emit malformed output.

`fixtureDigest` is SHA-256 over the exact fixture bytes. Prompt/schema digests are SHA-256 over their
canonical UTF-8 bytes. `artifactDigest` is SHA-256 over canonical JSON of every artifact member except
`artifactDigest`, including all four version labels, both fixed limit objects, all five binding
digests and ordered case results. Digests are integrity bindings, not anonymization; raw prompt,
output and transcript remain absent.

- [ ] **Step 0: Close the vocabulary and projection prerequisites.** Export the Task 0 tuples, make the parser consume them, add the exact Task 2 projection reconstructor, and prove tuple/parser/schema parity plus hostile projection rejection before any serialization callback.
- [ ] **Step 1: Write RED schema tests.** Generate schemas only from Task 0 constants; verify every allowed field/reason and rejection of unknown keys/values.
- [ ] **Step 2: Write RED adapter tests with a fake shared runtime.** Assert exact capability/template/schema versions and every pinned prompt/timeout/stdout/stderr/event limit, metadata binding, parsing of owned `.value`, minimal questionnaire projection, one call, pre-adapter rejection at each prompt byte boundary, parser enforcement, abort/error mapping, and no raw content in errors.
- [ ] **Step 3: Run RED, implement, and run fake GREEN.** Run `pnpm exec vitest run tests/domain/onboarding-schema.test.ts tests/integration/codex-onboarding-model.test.ts`; expect missing capability modules, implement both wrappers, and re-run it.
- [ ] **Step 4: Add the exact synthetic eval fixture and a fake eval contract test.** Prove the fixed case order and guarded semantic oracles, exact one call per case, canonical digest recomputation, and that any failure leaves no passing artifact. Before validation or a model call, remove any stale target artifact. Write the final newline-terminated artifact atomically with mode `0600` only after every case passes; never write a partial/passing artifact on failure.
- [ ] **Step 5: Obtain explicit authorization for the prepared-Mac OpenAI calls, then run the real gate once.** Run `pnpm exec tsx evals/onboarding-feasibility.ts --artifact data/evals/onboarding-model-feasibility.json`. The direct CLI entrypoint first calls the existing `registerNodeCodexRuntime()` (the same bundled-executable, preflight, feature-inventory, validated temp-root, closed-environment and process wiring used by Node instrumentation), then obtains the singleton only through `getCodexCliModelAdapter()`; it must not assume Next instrumentation ran under `tsx`. Require guarded semantic acceptance and the exact closed artifact above. There is exactly one `invokeJson` per ordered fixture case and no retry. If authorization is absent or any case fails, stop with the target artifact absent and without fallback or prompt weakening that expands authority.
- [ ] **Step 6: Run static gates and commit.** Run `pnpm run typecheck`, `pnpm exec eslint src/application/onboarding-contracts.ts src/infrastructure/codex-cli/onboarding-schema.ts src/infrastructure/codex-cli/onboarding-model.ts tests/domain/onboarding-schema.test.ts tests/integration/codex-onboarding-model.test.ts evals/onboarding-feasibility.ts`, and `git diff --check`.

```bash
git add src/application/onboarding-contracts.ts \
  src/decision/onboarding-catalog.ts src/decision/onboarding-model-output.ts \
  src/decision/onboarding-model-contract.ts \
  src/infrastructure/codex-cli/onboarding-schema.ts \
  src/infrastructure/codex-cli/onboarding-model.ts \
  tests/domain/onboarding-model-output.test.ts tests/domain/onboarding-model-contract.test.ts \
  tests/domain/onboarding-schema.test.ts tests/integration/codex-onboarding-model.test.ts \
  evals/onboarding-feasibility.ts evals/fixtures/onboarding/cases.json
git commit -m "feat: extract onboarding with Codex"
```

---

### Task 4: Implement extraction and server-side completion review

**Files:**
- Modify: `src/application/onboarding-contracts.ts`
- Create: `src/application/onboarding.ts`
- Create: `tests/integration/onboarding.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and a write/handoff port supplied in Tasks 5–7.
- Produces: `extractMessage` and `completeOnboarding` for HTTP routes.

```ts
export interface OnboardingReceipt {
  readonly schemaVersion: "onboarding-receipt@1";
  readonly receiptId: string;
  readonly completionCommandId: string;
  readonly confirmationDigest: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly frontierRunId: string;
  readonly confirmedAt: string;
}

export interface VerifiedOnboardingConfirmation {
  readonly receipt: OnboardingReceipt;
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
  readonly versions: OnboardingModelVersions;
}

export interface OnboardingCompletionPort {
  commitOrReplay(input: {
    readonly completionCommandId: string;
    readonly confirmed: ConfirmedOnboardingValues;
    readonly versions: OnboardingModelVersions;
  }): Promise<OnboardingReceipt>;
}

export interface OnboardingConfirmationReadPort {
  loadBySnapshotBindingsVerified(input: {
    readonly profileId: string;
    readonly preferenceProfileId: string;
  }): Promise<VerifiedOnboardingConfirmation>;
}

export interface ConfirmedOnboardingFrontierPort {
  prepareFromOnboardingReceipt(receipt: OnboardingReceipt): Promise<PlaceFrontierPrepared>;
}

export interface ExtractOnboardingMessageCommand {
  readonly schemaVersion: "onboarding-message-command@1";
  readonly session: OnboardingSessionState;
  readonly message: SessionMessage;
}

export interface ContinueOnboardingCommand {
  readonly schemaVersion: "onboarding-continue-command@1";
  readonly session: OnboardingSessionState;
}

export type CompleteOnboardingResult =
  | {
      readonly kind: "blocked";
      readonly session: OnboardingSessionState;
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
      readonly followUpQuestion: string;
    }
  | {
      readonly kind: "launched";
      readonly receipt: OnboardingReceipt;
      readonly prepared: PlaceFrontierPrepared;
    };

export function reconstructExtractOnboardingMessageCommand(
  value: unknown,
): ExtractOnboardingMessageCommand;
export function reconstructContinueOnboardingCommand(value: unknown): ContinueOnboardingCommand;
export async function extractMessage(
  command: ExtractOnboardingMessageCommand,
  ports: {
    readonly model: OnboardingModelPort;
    readonly nextParticipantId: () => string;
    readonly nextAssistantMessageId: () => string;
    readonly nextCompletionCommandId: () => string;
  },
  signal: AbortSignal,
): Promise<OnboardingSessionState>;

export async function completeOnboarding(
  command: ContinueOnboardingCommand,
  ports: {
    readonly model: OnboardingModelPort;
    readonly completion: OnboardingCompletionPort;
    readonly frontier: ConfirmedOnboardingFrontierPort;
  },
  signal: AbortSignal,
): Promise<CompleteOnboardingResult>;
```

`completeOnboarding` reconstructs the untrusted session, calls model review exactly once, combines
only corroborated issues with deterministic review, and writes nothing when blocked or unavailable.
When ready it passes timestamp-free confirmed values, fixed versions, and the session's stable
completion command ID to `commitOrReplay`, then prepares Frontier only from that receipt. The store
owns first-write IDs/time and exact duplicate-submission replay. A receipt may remain durable if the
later Frontier handoff fails; a later ordinary Continue with the unchanged command replays it and
the same fixed run. Model errors are closed service errors; the caller session remains unchanged.
Both command reconstructors accept exact top-level keys/schema literals and a bounded session only.

- [ ] **Step 1: Write RED use-case tests.** Cover exact command reconstruction, extraction and one command-ID rotation, a distinct injected lowercase UUID for the assistant question, rejection of duplicate/invalid assistant IDs without reusing a completion/participant ID, blocked deterministic/model review, unsupported model issue ignored, launched receipt/prepared result, unresolved yellow publication, one model call, zero writes/frontier calls on review failure, durable receipt plus surfaced handoff error, same-command replay, abort, and no retry surface.
- [ ] **Step 2: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/integration/onboarding.test.ts`; expect the use-case module to be absent, implement both use cases, and re-run it.
- [ ] **Step 3: Run static gates and commit.** Run `pnpm run typecheck`, `pnpm exec eslint src/application/onboarding-contracts.ts src/application/onboarding.ts tests/integration/onboarding.test.ts`, and `git diff --check`.

```bash
git add src/application/onboarding-contracts.ts src/application/onboarding.ts \
  tests/integration/onboarding.test.ts
git commit -m "feat: complete onboarding review"
```

---

### Task 5: Persist confirmation atomically and add explicit `@2` reads

**Files:**
- Create: `src/infrastructure/sqlite/onboarding-store.ts`
- Modify: `src/infrastructure/sqlite/profile-store.ts`
- Modify: `src/infrastructure/sqlite/schema.sql`
- Modify: `src/infrastructure/sqlite/db.ts`
- Modify: `src/decision/place-ranker.ts`
- Modify: `src/infrastructure/sqlite/place-frontier-store.ts`
- Create: `src/decision/country-assessment-input-v2.ts`
- Create: `tests/integration/onboarding-store.test.ts`
- Create: `tests/domain/country-assessment-input-v2.test.ts`
- Modify: `tests/integration/profile-store.test.ts`
- Modify: `tests/integration/database-schema.test.ts`
- Modify: `tests/domain/place-ranker.test.ts`
- Modify: `tests/integration/place-frontier.test.ts`

**Interfaces:**
- Consumes: Task 4 completion payload.
- Produces: immutable receipt plus exact `@2` loaders used by Country Assessment V2 and Task 7.

```ts
export interface OnboardingStore
  extends OnboardingCompletionPort, OnboardingConfirmationReadPort {}

export interface ProfileStoreV2Reads {
  loadRelocationV2Verified(id: string): Promise<RelocationProfileV2Snapshot>;
  loadPreferenceV2Verified(id: string): Promise<PreferenceProfileV2Snapshot>;
  loadPreferenceForRankingVerified(
    id: string,
  ): Promise<PreferenceProfileSnapshot | PreferenceProfileV2Snapshot>;
}

export interface CountryAssessmentInputV2 {
  readonly schemaVersion: "country-assessment-input@2";
  readonly profileSnapshotId: string;
  readonly profile: RelocationProfileV2Snapshot;
}

export function projectCountryAssessmentInputV2(
  profile: RelocationProfileV2Snapshot,
): CountryAssessmentInputV2;
export function reconstructCountryAssessmentInputV2(
  value: unknown,
): CountryAssessmentInputV2;
```

The confirmation store keeps the snapshot-pair loader unchanged. It makes every first-write
confirmation pair unique by issuing one store-owned monotonic `confirmedAt` inside the same
`BEGIN IMMEDIATE` transaction:

```ts
const observedMs = clock().getTime(); // exactly one clock call on a first write
const previousMs = previousConfirmedAt === undefined
  ? Number.NEGATIVE_INFINITY
  : new Date(previousConfirmedAt).getTime();
const issuedMs = Math.max(observedMs, previousMs + 1);
const confirmedAt = new Date(issuedMs).toISOString();
```

`previousConfirmedAt` is the greatest persisted confirmation instant. Both the observed value and
the prior value must be canonical 24-character millisecond UTC instants. Since both `@2` snapshot
IDs hash their canonical payload including `confirmedAt`, two different completion commands with
identical values and the same wall-clock millisecond receive `T` and `T+1ms`, distinct
content-addressed snapshot IDs, and an unambiguous pair. The table enforces both
`UNIQUE(confirmed_at)` and `UNIQUE(profile_id, preference_profile_id)`; the loader queries at most
two rows and requires exactly one instead of using `MAX`, `ORDER BY`, or latest-wins behavior.

Receipt and Frontier identities use the existing canonical JSON and SHA-256 primitives with exact
domain separation:

```ts
const receiptId = `onboarding-receipt:${sha256Text(canonicalJson({
  schemaVersion: "onboarding-receipt-id@1",
  completionCommandId,
}))}`;

const frontierRunId = `onboarding-frontier:${sha256Text(canonicalJson({
  schemaVersion: "onboarding-frontier-run-id@1",
  completionCommandId,
}))}`;
```

The stored digest is the lowercase HMAC-SHA-256 of the canonical full binding below. The integrity
key is injected into the store and is never persisted. `confirmationDigest` is deliberately not
unique because distinct user actions may confirm identical questionnaire values.

```ts
export interface OnboardingConfirmationDigestPayload {
  readonly schemaVersion: "onboarding-confirmation-binding@1";
  readonly receipt: Omit<OnboardingReceipt, "confirmationDigest">;
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
  readonly versions: OnboardingModelVersions;
}

const confirmationDigest = hmacSha256(
  canonicalJson(digestPayload),
  hmacKey,
);
```

The exact new table and immutability contract are:

```sql
CREATE TABLE IF NOT EXISTS onboarding_confirmations (
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'onboarding-receipt@1'),
  receipt_id TEXT PRIMARY KEY,
  completion_command_id TEXT NOT NULL UNIQUE,
  confirmation_digest TEXT NOT NULL CHECK (
    length(confirmation_digest) = 64
    AND confirmation_digest NOT GLOB '*[^0-9a-f]*'
  ),
  profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  preference_profile_id TEXT NOT NULL REFERENCES profile_snapshots(id),
  frontier_run_id TEXT NOT NULL UNIQUE,
  confirmed_at TEXT NOT NULL UNIQUE,
  provenance_json TEXT NOT NULL,
  versions_json TEXT NOT NULL,
  UNIQUE (profile_id, preference_profile_id),
  CHECK (profile_id <> preference_profile_id)
);

CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_update
BEFORE UPDATE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS onboarding_confirmations_no_delete
BEFORE DELETE ON onboarding_confirmations
BEGIN
  SELECT RAISE(ABORT, 'onboarding_confirmation_is_immutable');
END;
```

Both foreign keys target `profile_snapshots(id)` with SQLite's default `NO ACTION` / `MATCH NONE`.
There is no premature foreign key from `frontier_run_id`: Task 5 reserves one run per confirmation,
while Task 7 creates the first Frontier snapshot. `db.ts` preflights the exact table SQL, both
foreign keys, unique constraints, and both immutable triggers; an incompatible existing object
requires `database_schema_reset_required`.

`commitOrReplay` uses one synchronous transaction-safe insert path; it never nests an async profile
store method or awaits inside a `better-sqlite3` transaction callback. Its exact order is:

1. Descriptor-safely snapshot the timestamp-free confirmed values and require the fixed version
   tuple and validated lowercase completion UUID.
2. Start `BEGIN IMMEDIATE` and load by `completion_command_id` before any clock or materializer call.
3. For an existing command, verified-load the receipt, both `@2` snapshots, provenance, versions,
   derived IDs and HMAC; reconstruct the timestamp-free confirmed values and exact-canonical-compare
   them and the versions with the incoming values. A match returns the original frozen receipt with
   zero clock, materializer, or writer calls; a mismatch throws `onboarding_completion_conflict`.
4. For a first write, call the clock once, derive the monotonic `confirmedAt`, call
   `materializeOnboardingSnapshots({confirmedAt, values})` once, derive the two IDs and digest, insert
   both snapshots and the confirmation, verified-reload the complete binding, then commit.
5. A content-ID collision is accepted only after exact verified equality. Any other failure rolls
   back both snapshots and the confirmation.

`BEGIN IMMEDIATE` serializes first writers. A concurrent same-command loser observes the committed
winner at step 2 and therefore also performs zero clock/materializer/writer work.

Keep existing `loadRelocationVerified`/`loadPreferenceVerified` V1-only for historical consumers;
add exact V2-only loaders and one closed `@1 | @2` preference loader used only by ranking. The
Country Assessment V2 plan remains owner of the Any-loader and schema dispatch in Cold Start.
`commitOrReplay` starts `BEGIN IMMEDIATE` and loads by completion command ID first. An existing row
reconstructs its snapshots/provenance/versions and exact-compares them with the incoming timestamp-free
confirmed values; a match returns the original receipt without reading the clock or rematerializing,
and a mismatch conflicts. For a first write the store reads the clock once, materializes both
content-addressed snapshots once, derives safe fixed receipt/run IDs from the validated UUID, and
inserts snapshots, canonical provenance, versions, integrity-only digest, receipt, and Frontier run
binding in the same transaction. The confirmation digest is not unique: a different command may
confirm identical answers as a new user action. `loadBySnapshotBindingsVerified` recomputes the full
binding and returns fresh frozen values. No transcript/message/span/prompt/raw model output column is
allowed.

The country-assessment projector is a lossless descriptor-safe copy of the verified profile. It
requires `profileSnapshotId === profile.id`, exact `relocation-profile@2`, dense participant order,
and all typed participant values; it performs no aggregation, route selection, or verdict.

- [ ] **Step 1: Write RED schema/store tests.** Cover atomicity, one clock/materialization on first write, content-addressed snapshot IDs, exact domain-separated receipt/run IDs, duplicate-submission idempotence after an ambiguous response failure without another clock/materialization, concurrent same-command convergence, changed-draft command rotation, same-command values/version conflict, two different commands with identical values and one clock millisecond receiving `T`/`T+1ms` and distinct unambiguous pairs, exact snapshot-pair verified load, duplicate pair/time/command/run rejection with duplicate digest allowed, forced post-snapshot rollback, digest/provenance/version/receipt-binding tamper, exact schema preflight and immutable triggers, forbidden columns, and V1 byte compatibility.
- [ ] **Step 2: Write RED ranking tests.** `preference-profile@2` ranks only its five country criteria; city preferences do not affect country ordering.
- [ ] **Step 3: Write RED country-input tests.** Cover every profile field, exact ID binding, dense order, hostile descriptors, no aggregation, and fresh frozen output.
- [ ] **Step 4: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/integration/onboarding-store.test.ts tests/domain/country-assessment-input-v2.test.ts tests/integration/profile-store.test.ts tests/integration/database-schema.test.ts tests/domain/place-ranker.test.ts tests/integration/place-frontier.test.ts`; expect only the new seams to fail, implement them, and re-run it.
- [ ] **Step 5: Run static gates.** Run `pnpm run typecheck`, `pnpm exec eslint src/infrastructure/sqlite/onboarding-store.ts src/infrastructure/sqlite/profile-store.ts src/decision/place-ranker.ts src/decision/country-assessment-input-v2.ts src/infrastructure/sqlite/place-frontier-store.ts tests/integration/onboarding-store.test.ts tests/domain/country-assessment-input-v2.test.ts tests/integration/profile-store.test.ts tests/integration/database-schema.test.ts tests/domain/place-ranker.test.ts tests/integration/place-frontier.test.ts`, and `git diff --check`; the focused GREEN command in Step 4 is the database preflight.
- [ ] **Step 6: Commit.**

```bash
git add src/infrastructure/sqlite/onboarding-store.ts src/infrastructure/sqlite/profile-store.ts \
  src/infrastructure/sqlite/schema.sql src/infrastructure/sqlite/db.ts \
  src/decision/place-ranker.ts src/decision/country-assessment-input-v2.ts \
  src/infrastructure/sqlite/place-frontier-store.ts \
  tests/integration/onboarding-store.test.ts tests/integration/profile-store.test.ts \
  tests/domain/country-assessment-input-v2.test.ts \
  tests/integration/database-schema.test.ts tests/domain/place-ranker.test.ts \
  tests/integration/place-frontier.test.ts
git commit -m "feat: persist onboarding confirmation"
```

---

### Task 6: Execute the approved Country Assessment V2 plan

**Files:**
- Plan: `docs/superpowers/plans/2026-08-20-country-assessment-v2.md`

**Interfaces:**
- Consumes: Task 5 exact V2 profile reads, `CountryAssessmentInputV2`, and participant order. The
  Country plan itself adds the closed `loadRelocationAnyVerified` dispatch seam.
- Produces: `assessColdStartV2`, `ColdStartReadModelAny`, and a persisted/replayed V2 participant assessment projection for Task 7.

Historical references in that plan to onboarding Tasks `2`, `6A`, `6B`, and `6C` map respectively to
this plan's Task 1 domain snapshots, Task 5 V2 store/ranking branch, Task 5 country-input projector,
and Task 7 receipt handoff. They are seam names, not instructions to execute the superseded plan.

- [ ] **Step 1: Execute every Country Assessment V2 task with its documented RED command, GREEN command, and commit boundary.** Do not create an onboarding-owned assessor/projection substitute.
- [ ] **Step 2: Run its completion gate.** Run the exact focused commands recorded in that plan, then `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.
- [ ] **Step 3: Do not proceed if V2 dispatch is missing.** Never coerce `@2` to `@1` or synthesize a country verdict.

Task 6 has no umbrella commit: its files and commits are exactly the five task commits owned by the
Country Assessment V2 plan.

---

### Task 7: Compose production routes and hand the same Continue action to Frontier

**Files:**
- Create: `src/app/api/onboarding/route-contract.ts`
- Create: `src/app/api/onboarding/message/route.ts`
- Create: `src/app/api/onboarding/continue/route.ts`
- Create: `src/app/api/place-frontier/stream-response.ts`
- Modify: `src/app/api/place-frontier/route.ts`
- Modify: `src/application/onboarding-contracts.ts`
- Modify: `src/application/onboarding.ts`
- Modify: `src/application/place-frontier.ts`
- Modify: `src/infrastructure/place-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/infrastructure/sqlite/onboarding-store.ts`
- Modify: `src/infrastructure/sqlite/place-frontier-store.ts`
- Modify: `tests/integration/onboarding.test.ts`
- Modify: `tests/integration/onboarding-store.test.ts`
- Modify: `tests/integration/place-frontier.test.ts`
- Create: `tests/integration/onboarding-composition.test.ts`
- Create: `tests/integration/onboarding-transport.test.ts`
- Modify: `tests/integration/place-frontier-transport.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6 and the existing finite Place Frontier NDJSON stream.
- Produces: browser endpoints used by Task 8.

```ts
// src/app/api/onboarding/route-contract.ts
export const MAX_ONBOARDING_REQUEST_BODY_BYTES = 131_072;

export async function readBoundedOnboardingJson(
  request: Request,
  signal: AbortSignal,
): Promise<unknown>;
```

`readBoundedOnboardingJson` requires `application/json`, reads the request stream incrementally,
increments the UTF-8 byte count before retaining a chunk, aborts at
`MAX_ONBOARDING_REQUEST_BODY_BYTES + 1`, and calls `JSON.parse` only after the bounded body is
complete. It never includes body text in errors or logs. Both routes must call it before their exact
command reconstructor; no route may use `request.json()`.

`POST /api/onboarding/message` accepts a bounded structured session plus one user message and
requires the exact `onboarding-message-command@1` DTO; it returns the guarded updated session.
`POST /api/onboarding/continue` requires exact `onboarding-continue-command@1` and returns either finite JSON
`{kind:"blocked", session, issues, followUpQuestion}` or the existing finite Frontier NDJSON stream
in the same POST. The browser does not issue a second `/api/place-frontier` request.

`OnboardingCompletionPort` additionally exposes the narrow read-only capability
`replayCommitted({completionCommandId, confirmed, versions}): Promise<OnboardingReceipt | undefined>`.
After exact command reconstruction, `completeOnboarding` runs the deterministic questionnaire review.
When that review has no blockers it confirms the timestamp-free values and calls `replayCommitted` before
the model review. An absent receipt continues through the one model review and normal `commitOrReplay`;
an exact durable receipt skips the model and proceeds directly to its fixed Frontier run; a changed value
or version conflicts. This lookup performs no clock read, materialization or write. It is not an in-memory
cache, a derived-ID shortcut or an automatic retry. Deterministic blockers still take the ordinary review
path and cannot reveal or launch an older receipt.

`prepareFromOnboardingReceipt` loads the verified confirmation by the receipt's exact snapshot pair,
rechecks receipt/profile/preference/provenance/version/digest bindings, and prepares only
`receipt.frontierRunId` at `receipt.confirmedAt`. First-writer-wins insert-or-load fixes one ranking
for that run; exact concurrent/repeated preparation loads the winner, while any changed binding fails
integrity. The SQLite store owns a receipt-specific `insertOrLoadRanking` and optional verified ranking/
shortlist reads; historical `appendRanking` keeps its exact-conflict behavior. Receipt ranking uses the
closed `rankPlacesForVerifiedPreferences` branch and exact `preference-profile@2.countryCriteria`; it never
reads V1-only `criteria` or any city preference.

A sealed terminal run is presentation-only replay and makes zero onboarding-model,
`CountryVerifierPort.check`, official-source research or writer calls. The already approved read-only
`CountryVerifierPort.present` semantic replay remains mandatory for every persisted marker so a re-signed
schema-valid whole-grid reorder is still rejected. Completed NDJSON replay reconstructs a protocol-valid
sequence from the verified Ranking and Shortlist: `ranking_sealed`, the initial activations, each persisted
completion plus any red replacement activation, then `frontier_completed`; it emits no invented progress.
Historical direct `/api/place-frontier` requests and `@1` stream bytes remain unchanged.

Composition obtains the already preflighted process-local adapter through
`getCodexCliModelAdapter`, wraps it once with `createCodexOnboardingModel`, injects the onboarding
store and V2-capable Frontier, and exports the two use cases. The composition root supplies distinct
`crypto.randomUUID()` callbacks for participant IDs, assistant message IDs and completion command
IDs; a transport test proves that none is reused across those roles. Routes only delegate; they never
construct a model, run preflight, read auth, or retry.

- [ ] **Step 1: Write RED composition/transport tests.** Cover one runtime instance, exact command schemas/keys, closed JSON, an exact 131,072-byte body accepted, 131,073 bytes rejected before `JSON.parse`/command reconstruction/model calls, chunked overflow, the exact session count/UTF-8 limits from Task 2, abort, blocked response, same-POST NDJSON handoff, verified receipt/snapshot/version binding, fixed run/time, concurrent exact preparation, V2 dispatch, exact durable command replay with zero model review, completed replay with zero `verifier.check`/research/writes and required semantic `verifier.present`, a protocol-valid reconstructed event sequence, zero duplicate browser launch, historical route bytes, and no raw request/error content. Add store REDs proving read-only command replay, receipt-specific first-writer-wins ranking convergence and unchanged historical `appendRanking` conflicts.
- [ ] **Step 2: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/integration/onboarding-composition.test.ts tests/integration/onboarding-transport.test.ts tests/integration/place-frontier-transport.test.ts`; expect only the new routes/composition/handoff seams to fail, extract the shared response and wire them, then re-run it.
- [ ] **Step 3: Run static gates and commit.** Run `pnpm run typecheck`, `pnpm exec eslint src/app/api/onboarding/route-contract.ts src/app/api/onboarding/message/route.ts src/app/api/onboarding/continue/route.ts src/app/api/place-frontier/stream-response.ts src/app/api/place-frontier/route.ts src/application/onboarding-contracts.ts src/application/onboarding.ts src/application/place-frontier.ts src/infrastructure/place-frontier-composition.ts src/infrastructure/composition-root.ts src/infrastructure/sqlite/onboarding-store.ts src/infrastructure/sqlite/place-frontier-store.ts tests/integration/onboarding.test.ts tests/integration/onboarding-store.test.ts tests/integration/place-frontier.test.ts tests/integration/onboarding-composition.test.ts tests/integration/onboarding-transport.test.ts tests/integration/place-frontier-transport.test.ts`, and `git diff --check`.

```bash
git add src/app/api/onboarding/route-contract.ts \
  src/app/api/onboarding/message/route.ts src/app/api/onboarding/continue/route.ts \
  src/app/api/place-frontier/stream-response.ts src/app/api/place-frontier/route.ts \
  src/application/onboarding-contracts.ts src/application/onboarding.ts \
  src/application/place-frontier.ts src/infrastructure/place-frontier-composition.ts \
  src/infrastructure/composition-root.ts src/infrastructure/sqlite/onboarding-store.ts \
  src/infrastructure/sqlite/place-frontier-store.ts tests/integration/onboarding.test.ts \
  tests/integration/onboarding-store.test.ts tests/integration/place-frontier.test.ts \
  tests/integration/onboarding-composition.test.ts tests/integration/onboarding-transport.test.ts \
  tests/integration/place-frontier-transport.test.ts
git commit -m "feat: launch frontier from onboarding"
```

---

### Task 8: Deliver the questionnaire/chat workspace as the default route

**Files:**
- Create: `src/experience/components/OnboardingStart.tsx`
- Create: `src/experience/components/OnboardingQuestionnaire.tsx`
- Create: `src/experience/components/OnboardingChat.tsx`
- Modify: `src/application/onboarding.ts`
- Modify: `src/experience/components/ProductShell.tsx`
- Modify: `src/experience/components/WorkspaceGlobe.tsx`
- Modify: `src/experience/research-map/contracts.ts`
- Modify: `src/experience/research-map/ResearchGlobeCanvas.tsx`
- Modify: `src/experience/research-map/ResearchGlobe.module.css`
- Modify: `src/experience/place-frontier-stream.ts`
- Modify: `src/experience/run-url.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `evals/onboarding-journey-timing.ts`
- Create: `evals/fixtures/onboarding/canonical-journey.json`
- Create: `tests/integration/onboarding-experience.test.tsx`
- Create: `tests/integration/onboarding-journey-timing-contract.test.ts`
- Modify: `tests/integration/onboarding.test.ts`
- Modify: `tests/integration/onboarding-composition.test.ts`
- Modify: `tests/integration/onboarding-transport.test.ts`
- Modify: `tests/integration/product-shell.test.tsx`
- Modify: `tests/integration/research-globe-canvas.test.tsx`
- Modify: `tests/integration/visual-system.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 7 routes and Task 1 draft types.
- Produces: the first working local product checkpoint.

```ts
// evals/onboarding-journey-timing.ts
export const ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS = 35_000;

export interface OnboardingJourneyTimingArtifact {
  readonly schemaVersion: "onboarding-journey-timing@1";
  readonly fixtureVersion: "onboarding-canonical-journey@1";
  readonly fixtureDigest: string;
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly elapsedMs: number;
  readonly limitMs: 35_000;
  readonly acceptedFrontierHandoff: true;
  readonly modelInvocationCount: 2;
  readonly rawPromptStored: false;
  readonly rawOutputStored: false;
  readonly transcriptStored: false;
  readonly artifactDigest: string;
}

export interface OnboardingCanonicalJourneyFixture {
  readonly schemaVersion: "onboarding-canonical-journey@1";
  readonly ids: {
    readonly initialParticipantId: string;
    readonly companionParticipantId: string;
    readonly initialCompletionCommandId: string;
    readonly assistantMessageId: string;
    readonly extractedCompletionCommandId: string;
  };
  readonly messages: readonly [{
    readonly messageId: string;
    readonly role: "user";
    readonly text: string;
  }];
}

export async function runOnboardingJourneyTimingForTest(input: {
  readonly artifactPath: string;
  readonly fixtureBytes: Uint8Array;
  readonly runCanonicalJourney: () => Promise<{
    readonly acceptedFrontierHandoff: boolean;
    readonly modelInvocationCount: number;
  }>;
  readonly monotonicNowMs: () => number;
}): Promise<OnboardingJourneyTimingArtifact>;
```

Desktop is one `2/3 + 1/3` screen: questionnaire above chat in one left scroll workspace, slow
unmarked globe on the right. Mobile puts a compact globe above the form/chat and pins the latest
question shortcut. Initial composer is focused in the first viewport; the form expands after the
first message. Reduced motion stops rotation. The start copy states that questionnaire content is
sent to OpenAI through the installed Codex CLI under the owner's existing personal ChatGPT/Codex
login; it neither requests an API key nor claims that model processing is local.

The exact disclosure is: `Содержимое анкеты передаётся в OpenAI через установленный Codex CLI с
вашим текущим личным входом ChatGPT/Codex. API-ключ не нужен; обработка моделью не является
локальной.` The server final-review follow-up is exactly `Заполните выделенные поля.` and the UI
renders that returned text verbatim as a UI-only assistant item; it never inserts the item into the
server-owned session message array.

Neutral globe state is a separate closed presentation branch. Existing routed globe projections
keep their required origin and exact bytes. The neutral branch has no origin, marker, label, route,
aircraft or verdict, uses the same lazily loaded WebGL canvas, and enables slow idle rotation only
when reduced motion is false. An explicitly supplied neutral globe remains visible when
`ProductShell` is in setup mode without synthesizing a pending context/status bar. Desktop owns one
left scroll container and a pinned right globe; mobile preserves DOM order globe, latest-question
shortcut, questionnaire, chat.

The routed `WorkspaceGlobePresentation` stays unchanged and origin-required. A separate
`NeutralWorkspaceGlobePresentation` joins it only at the `ProductShell`/`WorkspaceGlobe` input
union; only Canvas receives optional origin plus idle-rotation props. Neutral performs zero airliner
GLB loads, and its readiness/fallback never depends on `planeTemplate`; routed loading and lifecycle
stay unchanged. Only a request with `flow`, `run` and `profile` all absent renders
`OnboardingStart`. Known flow branches, bare legacy `?run=...`, and legacy fallback/error branches
remain byte- and behavior-compatible.

The field component renders yellow `!` only for unresolved model-overwrite state and exposes
`Подтвердить`/`Вернуть`. Yellow never disables Continue. Blocked review focuses the first invalid
field and appends the server follow-up. Service failure preserves state and shows an ordinary error
with no retry control. Successful adoption is ordered exactly: validate the NDJSON response and
identity headers, create the finite stream handoff, install
`?flow=place-frontier&run=<runId>`, then perform one discriminated `editing -> frontier` React state
transition that drops session, composer, issues, errors and UI-only follow-ups before the first
stream read. If URL installation fails, cancel the unowned handoff and preserve the editing state.
`PlaceFrontierJourney` then adopts the same stream. A later Frontier stream failure remains inside
that Journey and never reconstructs onboarding. The browser performs zero automatic or launch
requests to `/api/place-frontier`; an explicit later user-triggered retry inside the existing
Frontier experience remains its existing separate action.

Transcript and raw input remain ephemeral in local session/process memory across React and local
Node request handling. Only the current message plus the normalized questionnaire projection reaches
Codex/OpenAI. Transcript, raw manual input, source spans and the completion command never enter
durable state, logs, telemetry or eval artifacts. No `localStorage`, `sessionStorage`, IndexedDB,
Cache API, server session, analytics, crash payload, or journey-history write may contain them. The
UI performs exactly one message request per message action and one Continue request per Continue
action; it never auto-repeats either request. Model/request failures retain editing state and expose
only the ordinary action again; there is no separate retry control. The globe's renderer-load
fallback remains an unrelated visual recovery control.

The timing artifact is bound to the lowercase SHA-256 of the exact tracked fixture bytes. Elapsed
time is `ceil(end - start)` from a monotonic clock; only exactly one extraction plus one final review
(`modelInvocationCount === 2`) may pass. The real run uses a fresh in-memory SQLite database so a
durable replay cannot shorten the gate. It derives handoff acceptance through the production strict
response opener and single-use handoff, bound to the launched receipt/prepared identities; no CLI
argument, fixture field, environment variable or callback assertion can claim acceptance. The
timing runner stops at an inert accepted Frontier envelope and must not invoke `runPlaceFrontier`,
official research or a browser.

`artifactDigest` is SHA-256 over canonical JSON of every artifact field except itself. The writer
removes a stale target before work and, only on success, writes one final-LF canonical artifact via a
same-directory `wx`/`0600` temporary file, `fsync`, close and atomic rename. Any fixture, clock,
timing, handoff, model or write failure leaves no passing target and emits only the fixed public error
`onboarding_journey_timing_failed` without caught text. The pure injected callback remains a
fake-test seam; production acceptance is computed internally.

The tracked fixture parser accepts exactly the closed `OnboardingCanonicalJourneyFixture` above:
one dense ordered user-message tuple describing the canonical self-plus-spouse case, exact keys,
canonical version, six pairwise-distinct UUIDs, valid UTF-8 and bounded nonempty text. Extra/missing
keys, extra/sparse messages, duplicate or invalid
UUIDs and malformed/non-UTF-8 bytes fail before any model call. Production always reads that fixed
tracked file; there is no fixture CLI override, stdin fixture or environment substitution.

- [ ] **Step 1: Write RED component tests.** Cover initial/expanded desktop, exact OpenAI/Codex disclosure, ephemeral process-memory-only state, initial command UUID, stability without authoritative change, one rotation after manual/model/provenance change, manual edits, ordinary model-origin replacement, yellow only for manual overwrite, Confirm/Revert, nonblocking yellow, exact Russian blocked server follow-up without retry UI, one request per ordinary action, state preservation before failed handoff, validated stream adoption followed by immediate purge before the first stream read, later stream failure without resurrection, zero automatic `/api/place-frontier` launch request, neutral globe with zero GLB load, one desktop scroll container, mobile order, keyboard/dialog semantics, reactive reduced motion, exact empty-query default onboarding, and unchanged known-flow/bare-run legacy routing.
- [ ] **Step 2: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/integration/onboarding-experience.test.tsx tests/integration/product-shell.test.tsx tests/integration/research-globe-canvas.test.tsx tests/integration/visual-system.test.ts`; expect the onboarding components and neutral globe seam to be absent, implement them, and re-run it.
- [ ] **Step 3: Write the timing-gate RED contract.** With an injected monotonic clock and fake journey, require exact count `2` and `35_000` ms to pass; `35_000.0001` (ceiled to `35_001`), clock rollback/non-finite values, any other count or an unaccepted handoff fails without a passing artifact. Pin the exact closed keys, fixture/digest bindings, stale-target removal, `0600` atomic final-LF write, fixed content-free failure, no retry and zero prompt/output/transcript content.
- [ ] **Step 4: Run timing RED.** Run `pnpm exec vitest run tests/integration/onboarding-journey-timing-contract.test.ts`; expect the eval module to be absent.
- [ ] **Step 5: Implement and run fake GREEN.** Add `"eval:onboarding-journey-timing": "node --import tsx evals/onboarding-journey-timing.ts"`. The real script uses only the closed `onboarding-canonical-journey@1` fixture, starts its monotonic timer immediately before the first extraction call, and stops when the production strict opener/single-use handoff accepts an inert Frontier envelope constructed from the exact launched receipt/prepared identities. It never calls `runPlaceFrontier` and writes only the closed artifact. Re-run the timing contract test.
- [ ] **Step 6: Obtain explicit authorization for the prepared-Mac OpenAI calls, then run the timing gate.** Run `pnpm run eval:onboarding-journey-timing -- --artifact data/evals/onboarding-journey-timing.json`; require an accepted handoff and `elapsedMs <= 35_000`. Missing authorization, model/runtime failure, an unobserved handoff, or `35_001+` ms writes no passing artifact and blocks completion.
- [ ] **Step 7: Run `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.**
- [ ] **Step 8: Commit.**

```bash
git add src/experience/components/OnboardingStart.tsx \
  src/experience/components/OnboardingQuestionnaire.tsx \
  src/experience/components/OnboardingChat.tsx src/application/onboarding.ts \
  src/experience/components/ProductShell.tsx src/experience/components/WorkspaceGlobe.tsx \
  src/experience/research-map/contracts.ts \
  src/experience/research-map/ResearchGlobeCanvas.tsx \
  src/experience/research-map/ResearchGlobe.module.css \
  src/experience/place-frontier-stream.ts src/experience/run-url.ts \
  src/app/page.tsx src/app/globals.css \
  evals/onboarding-journey-timing.ts \
  evals/fixtures/onboarding/canonical-journey.json \
  tests/integration/onboarding-experience.test.tsx \
  tests/integration/onboarding-journey-timing-contract.test.ts package.json \
  tests/integration/onboarding.test.ts tests/integration/onboarding-composition.test.ts \
  tests/integration/onboarding-transport.test.ts tests/integration/product-shell.test.tsx \
  tests/integration/research-globe-canvas.test.tsx tests/integration/visual-system.test.ts
git commit -m "feat: deliver conversational onboarding"
```

---

### Task 9: Bind correction and confirmed city preferences after City Frontier exists

**Prerequisite:** approved VS-4A City Knowledge/Core/Delivery plans are complete through terminal City Selection.

**Files:**
- Create: `src/application/onboarding-correction.ts`
- Create: `src/app/api/onboarding/correction/route.ts`
- Modify: `src/decision/city-criteria.ts`
- Modify: `src/application/city-frontier.ts`
- Modify: `src/infrastructure/sqlite/city-criteria-store.ts`
- Modify: `src/infrastructure/city-frontier-composition.ts`
- Modify: `src/infrastructure/composition-root.ts`
- Modify: `src/experience/components/OnboardingStart.tsx`
- Modify: `src/experience/components/CityFrontierStart.tsx`
- Modify: `src/app/page.tsx`
- Create: `tests/integration/onboarding-correction.test.ts`
- Modify: `tests/domain/city-criteria.test.ts`
- Modify: `tests/integration/city-frontier.test.ts`
- Modify: `tests/integration/city-frontier-store.test.ts`
- Modify: `tests/integration/city-frontier-experience.test.tsx`
- Modify: `tests/integration/onboarding-experience.test.tsx`

**Interfaces:**
- Consumes: verified onboarding receipt/profile/preference/provenance and selected installed country package.
- Produces: one exact correction read model and automatic City Criteria mapping without a second confirmation screen.

```ts
export interface OnboardingCorrectionReadModel {
  readonly schemaVersion: "onboarding-correction-read@1";
  readonly sourceRevisionId: string;
  readonly focusedFieldId: CityPreferenceTargetFieldId;
  readonly draft: OnboardingDraft;
  readonly provenance: QuestionnaireProvenance;
}

export interface OnboardingCorrectionReadPorts {
  readonly resolutions: {
    requireResolvedCountryShortlistForCity(
      revisionId: string,
    ): Promise<ResolvedCountryShortlistSnapshot>;
  };
  readonly confirmations: OnboardingConfirmationReadPort;
}

export interface OnboardingCorrectionCommand {
  readonly schemaVersion: "onboarding-correction-command@1";
  readonly sourceRevisionId: string;
  readonly focusedFieldId: CityPreferenceTargetFieldId;
  readonly session: OnboardingSessionState;
}

export type CityPreferenceMappingResult =
  | {
      readonly kind: "mapped";
      readonly draft: readonly [
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
      ];
    }
  | {
      readonly kind: "mismatch";
      readonly focusedFieldId: CityPreferenceTargetFieldId;
    };

export type OnboardingCorrectionResult =
  | {
      readonly kind: "blocked";
      readonly session: OnboardingSessionState;
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
      readonly followUpQuestion: string;
    }
  | {
      readonly kind: "mapping_mismatch";
      readonly session: OnboardingSessionState;
      readonly focusedFieldId: CityPreferenceTargetFieldId;
    }
  | {
      readonly kind: "launched";
      readonly sourceRevisionId: string;
      readonly receipt: OnboardingReceipt;
      readonly cityCriteria: CityCriteriaSnapshot;
      readonly cityFrontier: CityFrontierReadModel;
    };

export interface OnboardingCorrectionPorts extends OnboardingCorrectionReadPorts {
  readonly model: OnboardingModelPort;
  readonly completion: OnboardingCompletionPort;
  readonly mapping: {
    mapConfirmedPreferences(input: {
      readonly resolved: ResolvedCountryShortlistSnapshot;
      readonly confirmed: ConfirmedOnboardingValues;
    }): CityPreferenceMappingResult;
  };
  readonly criteria: {
    commitOrReplay(input: {
      readonly sourceRevisionId: string;
      readonly completionCommandId: string;
      readonly receipt: OnboardingReceipt;
      readonly draft: readonly [
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
      ];
    }): Promise<CityCriteriaSnapshot>;
  };
  readonly frontier: {
    startFromOnboardingCorrection(input: {
      readonly sourceRevisionId: string;
      readonly receipt: OnboardingReceipt;
      readonly criteria: CityCriteriaSnapshot;
    }, signal: AbortSignal): Promise<CityFrontierReadModel>;
  };
}

export function loadOnboardingCorrectionVerified(input: {
  readonly sourceRevisionId: string;
  readonly fieldId: CityPreferenceTargetFieldId;
}, ports: OnboardingCorrectionReadPorts): Promise<OnboardingCorrectionReadModel>;

export function reconstructOnboardingCorrectionCommand(
  value: unknown,
): OnboardingCorrectionCommand;

export function requireOnlyFocusedCorrectionDelta(input: {
  readonly authoritativeDraft: OnboardingDraft;
  readonly authoritativeProvenance: QuestionnaireProvenance;
  readonly submittedSession: OnboardingSessionState;
  readonly focusedFieldId: CityPreferenceTargetFieldId;
}): void;

export function completeOnboardingCorrection(
  command: OnboardingCorrectionCommand,
  ports: OnboardingCorrectionPorts,
  signal: AbortSignal,
): Promise<OnboardingCorrectionResult>;
```

Correction reconstruction and submission both verify the resolved revision and its exact onboarding
snapshot pair. The read use case reconstructs the editable draft and durable provenance from that receipt binding;
it never marks prior model/manual values as fresh manual input. The installed country mapping must
resolve all four city criteria exactly; mismatch returns the user to the specific onboarding field
and makes zero City Frontier write/call. Success persists City Criteria and starts City Frontier
without asking again.

`completeOnboardingCorrection` reconstructs the exact bounded command, calls
`loadOnboardingCorrectionVerified` for the same `sourceRevisionId` and `focusedFieldId`, and
rehydrates the authoritative original before any model, completion, mapping, Criteria or Frontier
call. `requireOnlyFocusedCorrectionDelta` exact-compares canonical field order, roster and descriptor
bindings plus every non-focused field's applicability, normalized typed value and provenance
(origin, overwrite state, old/new values and reason); every non-focused `rawInput` must remain the
authoritative rehydrated `null`. Only the exact `focusedFieldId` may differ; messages and the fresh completion command remain session-only and cannot authorize a
second field change. Any other delta or provenance/binding drift fails closed with zero calls to the
model, completion, mapping, Criteria and Frontier ports. Only after this gate does the use case perform the same one-call
model review plus deterministic corroboration as ordinary Continue and compute timestamp-free
confirmed values. It calls `mapConfirmedPreferences` before any completion, Criteria, or Frontier
write. A mismatch returns the closed `mapping_mismatch` branch with the exact `focusedFieldId` and
zero calls to those three write ports. A mapped result commits/replays a new immutable onboarding
receipt under the session's completion command, persists/replays Criteria, then starts Frontier.
Before the Frontier call it requires `cityCriteria.profileSnapshotId === receipt.profileId` and
`cityCriteria.preferenceProfileSnapshotId === receipt.preferenceProfileId`; the Frontier result is
therefore bound to both the new confirmation and the original `sourceRevisionId`, which is copied
unchanged into the launched result. `GET /api/onboarding/correction` delegates only to
`loadOnboardingCorrectionVerified`; `POST /api/onboarding/correction` accepts only the exact
`onboarding-correction-command@1` including the closed city-target `focusedFieldId`, applies the same pre-parse body limit as Task 7, and delegates only
to `completeOnboardingCorrection`. There is no update
of the old receipt and no route back through Country Frontier.

The correction loader first verifies the resolved-country revision, then loads the onboarding
confirmation by its exact profile/preference bindings, rechecks receipt digest and versions, and
calls `rehydrateOnboardingDraft`. Its browser read model exposes no receipt/run/command/digest,
message, transcript, raw input, span, prompt, or model output. `OnboardingStart` creates a fresh empty
transcript and fresh completion command, focuses only the requested city target, and a successful
correction creates a new immutable confirmation rather than mutating or rebinding the old receipt.

- [ ] **Step 1: Write RED correction and mapping tests.** Cover exact command reconstruction and session limits; correction POST acceptance at 131,072 bytes and pre-parse rejection at 131,073 bytes with zero port calls; resolved-revision → exact snapshot-pair binding; receipt/provenance/version reconstruction; exact target-only focused field; fresh frozen browser-safe keys; empty transcript/fresh command; a parameterized tamper matrix for every non-focused raw/normalized value, applicability, origin, overwrite/provenance value/reason, roster and descriptor binding, each rejected before model/completion/mapping/Criteria/Frontier calls; focused-field-only delta acceptance; historical/non-onboarding rejection; blocked review; immutable old receipt; new confirmation; all four mapping values; mismatch result with exact `focusedFieldId` and zero completion/Criteria/Frontier writes; Criteria/receipt ID mismatch before Frontier; exact `sourceRevisionId` success binding; retry replay; and no Country Frontier call or second confirmation screen.
- [ ] **Step 2: Run RED, implement, and run GREEN.** Run `pnpm exec vitest run tests/integration/onboarding-correction.test.ts tests/domain/city-criteria.test.ts tests/integration/city-frontier.test.ts tests/integration/city-frontier-store.test.ts tests/integration/city-frontier-experience.test.tsx tests/integration/onboarding-experience.test.tsx`; expect only the correction/mapping seams to fail, implement them, and re-run it.
- [ ] **Step 3: Run full gates and commit.** Run `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.

```bash
git add src/application/onboarding-correction.ts src/app/api/onboarding/correction/route.ts \
  src/decision/city-criteria.ts src/application/city-frontier.ts \
  src/infrastructure/sqlite/city-criteria-store.ts \
  src/infrastructure/city-frontier-composition.ts src/infrastructure/composition-root.ts \
  src/experience/components/OnboardingStart.tsx \
  src/experience/components/CityFrontierStart.tsx src/app/page.tsx \
  tests/integration/onboarding-correction.test.ts tests/domain/city-criteria.test.ts \
  tests/integration/city-frontier.test.ts tests/integration/city-frontier-store.test.ts \
  tests/integration/city-frontier-experience.test.tsx \
  tests/integration/onboarding-experience.test.tsx
git commit -m "feat: bind onboarding to city criteria"
```

## Completion Gate

Onboarding is complete when the authorized real Codex extraction/review eval passes and the reviewed
prepared-Mac `onboarding-journey-timing@1` artifact records an accepted Frontier handoff in no more
than `35_000` ms; `/` shows the approved
questionnaire/chat/globe layout; manual edits and reversible yellow overwrite work; unusable required
values block on server review; one successful Continue atomically stores only structured `@2`
snapshots/provenance and enters V2-capable Country Frontier in the same action; transcript/raw model
content is purged; replay makes zero Codex calls; and the eventual resolved-country mapping persists
all four City Criteria without a second confirmation screen.
