import Decimal from "decimal.js";

import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  type CityPreferenceFieldId,
  type CountryPreferenceFieldId,
  type CurrentLocationValue,
  type CurrentWorkValue,
  type EducationValue,
  type IsoCountryCode,
  type MonthlyIncomeValue,
  type MoveHorizonValue,
  type MovingPartyValue,
  type OnboardingBaseFieldId,
  type ParticipantLeafId,
  type ParticipantRelationship,
  type PassportValue,
  type PreferenceImportance,
  type PreferenceMode,
  type QuestionnaireIssueCode,
  type RemoteContinuationValue,
  type SavingsValue,
} from "./onboarding-catalog";
import { isCanonicalDay, isCanonicalDecimal, isIsoCountryCode, isIsoCurrencyCode } from "./iso-codes";
import {
  deriveQuestionnaireProvenance,
  reconstructQuestionnaireProvenance,
  type QuestionnaireProvenanceEntry,
  type QuestionnaireProvenance,
} from "./onboarding-provenance";
import {
  materializeRelocationProfileV2,
  reconstructRelocationProfileV2,
  type ParticipantId,
  type RelocationProfileV2Snapshot,
} from "./relocation-profile";
import {
  materializePreferenceProfileV2,
  reconstructPreferenceProfileV2,
  type PreferenceProfileV2Snapshot,
} from "./preference-profile";

export type { ParticipantId } from "./relocation-profile";
export type {
  ApplicableValue,
  RelocationParticipantV2,
  RelocationProfileV2Snapshot,
} from "./relocation-profile";
export type {
  CountryPreferenceCriterionV2,
  CountryPreferenceTupleV2,
  PreferenceProfileV2Snapshot,
  UniversalCityPreferenceCriterionV2,
  UniversalCityPreferenceTupleV2,
} from "./preference-profile";
export { reconstructQuestionnaireProvenance } from "./onboarding-provenance";

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

export interface ConfirmedOnboardingValues {
  readonly schemaVersion: "confirmed-onboarding-values@1";
  readonly profile: Omit<RelocationProfileV2Snapshot, "id" | "confirmedAt">;
  readonly preferences: Omit<PreferenceProfileV2Snapshot, "id" | "confirmedAt">;
  readonly provenance: QuestionnaireProvenance;
}

export type QuestionnaireFieldChange =
  | { readonly kind: "manual_set"; readonly fieldId: OnboardingFieldId; readonly rawInput: unknown }
  | {
      readonly kind: "guarded_model_set";
      readonly fieldId: OnboardingFieldId;
      readonly normalizedValue: OnboardingFieldValue;
    }
  | { readonly kind: "confirm_model_overwrite"; readonly fieldId: OnboardingFieldId }
  | { readonly kind: "revert_model_overwrite"; readonly fieldId: OnboardingFieldId };

const PARTICIPANT_LEAF_IDS = [
  "citizenships",
  "passport",
  "current_work",
  "remote_continuation",
  "monthly_income",
  "education",
  "relevant_experience_years",
] as const satisfies readonly ParticipantLeafId[];
const BASE_FIELD_IDS = [
  "current_location",
  "move_horizon",
  "moving_party",
  "participants",
  "savings",
] as const satisfies readonly OnboardingBaseFieldId[];
const MOVE_HORIZONS = new Set<MoveHorizonValue>([
  "within_3_months",
  "3_to_6_months",
  "6_to_12_months",
  "more_than_12_months",
]);
const WORK_STATUSES = new Set<CurrentWorkValue["status"]>([
  "not_working",
  "employment",
  "self_employment",
  "contract_service",
  "other",
]);
const EDUCATION_LEVELS = new Set<EducationValue["level"]>([
  "none",
  "secondary",
  "vocational",
  "higher",
]);
const RELATIONSHIPS = new Set<ParticipantRelationship>([
  "self",
  "spouse",
  "minor_child",
  "other_family",
]);
const PLACEHOLDERS = new Set(["-", "не знаю", "неизвестно", "unknown", "n/a", "na"]);
const PARTICIPANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PARTICIPANTS = 20;
const MAX_FIELDS = 172;
const MAX_TEXT_LENGTH = 1_000;

interface FieldAddress {
  readonly kind: "base" | "participant" | "country" | "city";
  readonly participantId?: ParticipantId;
  readonly leafId?: ParticipantLeafId;
  readonly preferenceId?: string;
  readonly part?: "mode" | "importance" | "target";
}

export function createOnboardingDraft(nextParticipantId: () => string): OnboardingDraft {
  const participantId = parseParticipantId(nextParticipantId());
  const roster = [{ participantId, relationship: "self" as const }];
  const participants: QuestionnaireFieldState = {
    fieldId: "participants",
    applicability: "required",
    rawInput: null,
    normalizedValue: roster,
    origin: "manual",
    overwrite: null,
  };

  return freezeDraft(canonicalFields(roster, new Map([["participants", participants]])));
}

export function applyQuestionnaireFieldChange(
  draft: OnboardingDraft,
  change: QuestionnaireFieldChange,
): OnboardingDraft {
  const current = reconstructOnboardingDraft(draft);
  const existing = findField(current, change.fieldId);
  let replacement: QuestionnaireFieldState;

  if (change.kind === "manual_set") {
    replacement = applyManualChange(existing, change.rawInput);
  } else if (change.kind === "guarded_model_set") {
    replacement = applyModelChange(existing, change.normalizedValue);
  } else if (change.kind === "confirm_model_overwrite") {
    replacement = confirmOverwrite(existing);
  } else {
    replacement = revertOverwrite(existing);
  }

  const fieldsById = new Map(current.fields.map((field) => [field.fieldId, field]));
  fieldsById.set(change.fieldId, replacement);
  const roster = participantRosterFromField(fieldsById.get("participants"));
  return freezeDraft(canonicalFields(roster, fieldsById));
}

export function reconcileOnboardingApplicability(draft: OnboardingDraft): OnboardingDraft {
  const current = reconstructOnboardingDraft(draft);
  const fieldsById = new Map(current.fields.map((field) => [field.fieldId, field]));
  return freezeDraft(canonicalFields(participantRosterFromField(fieldsById.get("participants")), fieldsById));
}

export function reviewQuestionnaire(draft: OnboardingDraft): QuestionnaireReview {
  const current = reconstructOnboardingDraft(draft);
  const issues: QuestionnaireIssue[] = [];

  for (const field of current.fields) {
    if (field.applicability === "required" && field.normalizedValue === null) {
      issues.push({ fieldId: field.fieldId, reasonCode: missingValueReason(field.rawInput) });
    }
  }

  const movingParty = normalizedValue(current, "moving_party");
  const roster = participantRosterFromField(findField(current, "participants"));
  if (
    (movingParty === "alone" && roster.length !== 1) ||
    (movingParty === "with_companions" && roster.length < 2)
  ) {
    issues.push({ fieldId: "participants", reasonCode: "party_mismatch" });
  }

  const savings = normalizedValue(current, "savings");
  if (isSavingsValue(savings) && new Decimal(savings.min).greaterThan(savings.max)) {
    issues.push({ fieldId: "savings", reasonCode: "range_mismatch" });
  }

  for (const criterionId of COUNTRY_PREFERENCE_IDS) {
    const mode = normalizedValue(current, `country_preferences.${criterionId}.mode`);
    const targetFieldId = `country_preferences.${criterionId}.target` as const;
    const target = normalizedValue(current, targetFieldId);
    if (
      (mode === "required" && target !== null && target !== "required_true") ||
      (mode === "weighted" && target !== null && target !== "maximize")
    ) {
      issues.push({ fieldId: targetFieldId, reasonCode: "invalid_value" });
    }
  }

  const orderedIssues = canonicalIssueOrder(current, issues);
  return orderedIssues.length === 0
    ? deepFreeze({ kind: "ready", issues: [] as const })
    : deepFreeze({
        kind: "blocked",
        issues: orderedIssues as [QuestionnaireIssue, ...QuestionnaireIssue[]],
      });
}

export function confirmOnboardingValues(draft: OnboardingDraft): ConfirmedOnboardingValues {
  const current = reconstructOnboardingDraft(draft);
  const review = reviewQuestionnaire(current);
  if (review.kind === "blocked") throw invalidQuestionnaire();
  const profile = projectRelocationProfile(current);
  const preferences = projectPreferenceProfile(current);
  return deepFreeze({
    schemaVersion: "confirmed-onboarding-values@1",
    profile,
    preferences,
    provenance: deriveQuestionnaireProvenance(current),
  });
}

export function materializeOnboardingSnapshots(input: {
  readonly confirmedAt: string;
  readonly values: ConfirmedOnboardingValues;
}): {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
} {
  const materialization = exactRecord(input, ["confirmedAt", "values"]);
  const values = exactRecord(materialization.values, [
    "schemaVersion",
    "profile",
    "preferences",
    "provenance",
  ]);
  if (values.schemaVersion !== "confirmed-onboarding-values@1") throw invalidQuestionnaire();
  const provenance = reconstructQuestionnaireProvenance(values.provenance);
  const profile = materializeRelocationProfileV2({
    confirmedAt: materialization.confirmedAt as string,
    profile: values.profile as ConfirmedOnboardingValues["profile"],
  });
  const preferences = materializePreferenceProfileV2({
    confirmedAt: materialization.confirmedAt as string,
    preferences: values.preferences as ConfirmedOnboardingValues["preferences"],
  });
  rehydrateOnboardingDraft({ profile, preferences, provenance });
  return deepFreeze({ profile, preferences });
}

export function reconstructOnboardingDraft(value: unknown): OnboardingDraft {
  const draft = exactRecord(value, ["schemaVersion", "fields"]);
  if (draft.schemaVersion !== "onboarding-draft@1") throw invalidQuestionnaire();
  const parsedFields = denseArray(draft.fields, MAX_FIELDS).map(parseFieldState);
  assertUnique(parsedFields.map(({ fieldId }) => fieldId));
  const participants = participantRosterFromField(parsedFields.find(({ fieldId }) => fieldId === "participants"));
  const expectedIds = canonicalFieldIds(participants);
  if (!sameStrings(parsedFields.map(({ fieldId }) => fieldId), expectedIds)) throw invalidQuestionnaire();

  const fieldsById = new Map(parsedFields.map((field) => [field.fieldId, field]));
  const canonical = canonicalFields(participants, fieldsById);
  for (const [index, field] of parsedFields.entries()) {
    if (canonical[index]?.applicability !== field.applicability) throw invalidQuestionnaire();
  }
  return freezeDraft(canonical);
}

export function rehydrateOnboardingDraft(input: {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
}): OnboardingDraft {
  const source = exactRecord(input, ["profile", "preferences", "provenance"]);
  const profile = reconstructRelocationProfileV2(source.profile);
  const preferences = reconstructPreferenceProfileV2(source.preferences);
  if (profile.confirmedAt !== preferences.confirmedAt) throw invalidQuestionnaire();
  const provenance = reconstructQuestionnaireProvenance(source.provenance);
  const snapshotFields = projectSnapshotFields(profile, preferences);
  const expectedFieldIds = [...snapshotFields.keys()];
  if (!sameStrings(provenance.fields.map(({ fieldId }) => fieldId), expectedFieldIds)) {
    throw invalidQuestionnaire();
  }

  const fields = provenance.fields.map((entry) =>
    rehydrateField(entry, snapshotFields.get(entry.fieldId)));
  const draft = reconstructOnboardingDraft({ schemaVersion: "onboarding-draft@1", fields });
  const confirmed = confirmOnboardingValues(draft);
  const expectedProfile = { schemaVersion: profile.schemaVersion, profile: profile.profile };
  const expectedPreferences = {
    schemaVersion: preferences.schemaVersion,
    countryCriteria: preferences.countryCriteria,
    cityCriteria: preferences.cityCriteria,
  };
  if (
    !equalValues(confirmed.profile, expectedProfile) ||
    !equalValues(confirmed.preferences, expectedPreferences) ||
    !equalValues(confirmed.provenance, provenance)
  ) throw invalidQuestionnaire();
  return draft;
}

export function parseOnboardingFieldValueForDecision(
  fieldId: OnboardingFieldId,
  value: unknown,
): OnboardingFieldValue {
  const address = parseFieldId(fieldId);
  if (address.kind === "base") return parseBaseValue(fieldId as OnboardingBaseFieldId, value);
  if (address.kind === "participant") return parseParticipantValue(address.leafId!, value);
  if (address.part === "mode") return parsePreferenceMode(value);
  if (address.part === "importance") return parsePreferenceImportance(value);
  if (address.kind === "country") return parseCountryTarget(value);
  return parseText(value);
}

export function parseOnboardingFieldIdForDecision(value: unknown): OnboardingFieldId {
  if (typeof value !== "string") throw invalidQuestionnaire();
  parseFieldId(value as OnboardingFieldId);
  return value as OnboardingFieldId;
}

export function cloneOnboardingFieldValueForDecision(
  fieldId: OnboardingFieldId,
  value: unknown,
): OnboardingFieldValue {
  return parseOnboardingFieldValueForDecision(fieldId, value);
}

export function assertCanonicalOnboardingFieldOrderForDecision(
  fieldIds: readonly OnboardingFieldId[],
): void {
  if (fieldIds.length < 39 || fieldIds.length > MAX_FIELDS) throw invalidQuestionnaire();
  const participantIds: ParticipantId[] = [];
  let cursor = BASE_FIELD_IDS.length;
  while (cursor < fieldIds.length && fieldIds[cursor]?.startsWith("participants.")) {
    const address = parseFieldId(fieldIds[cursor]!);
    const participantId = address.participantId!;
    participantIds.push(participantId);
    for (const leafId of PARTICIPANT_LEAF_IDS) {
      if (fieldIds[cursor] !== `participants.${participantId}.${leafId}`) throw invalidQuestionnaire();
      cursor += 1;
    }
  }
  if (participantIds.length < 1 || participantIds.length > MAX_PARTICIPANTS) throw invalidQuestionnaire();
  assertUnique(participantIds);
  const expected = [
    ...BASE_FIELD_IDS,
    ...participantIds.flatMap((participantId) =>
      PARTICIPANT_LEAF_IDS.map((leafId) => `participants.${participantId}.${leafId}` as const)),
    ...COUNTRY_PREFERENCE_IDS.flatMap((id) =>
      (["mode", "importance", "target"] as const).map((part) => `country_preferences.${id}.${part}` as const)),
    ...CITY_PREFERENCE_IDS.flatMap((id) =>
      (["mode", "importance", "target"] as const).map((part) => `city_preferences.${id}.${part}` as const)),
  ];
  if (!sameStrings(fieldIds, expected)) throw invalidQuestionnaire();
}

interface SnapshotFieldValue {
  readonly applicability: QuestionnaireApplicability;
  readonly value: OnboardingFieldValue | null;
}

function projectSnapshotFields(
  profile: RelocationProfileV2Snapshot,
  preferences: PreferenceProfileV2Snapshot,
): ReadonlyMap<OnboardingFieldId, SnapshotFieldValue> {
  const roster = profile.profile.participants.map(({ participantId, relationship }) => ({
    participantId,
    relationship,
  }));
  const fields = new Map<OnboardingFieldId, SnapshotFieldValue>();
  fields.set("current_location", requiredSnapshotValue(profile.profile.currentLocation));
  fields.set("move_horizon", requiredSnapshotValue(profile.profile.moveHorizon));
  fields.set("moving_party", requiredSnapshotValue(profile.profile.movingParty));
  fields.set("participants", requiredSnapshotValue(roster));
  fields.set("savings", requiredSnapshotValue(profile.profile.savings));
  for (const participant of profile.profile.participants) {
    const prefix = `participants.${participant.participantId}` as const;
    fields.set(`${prefix}.citizenships`, requiredSnapshotValue(participant.citizenships));
    fields.set(`${prefix}.passport`, requiredSnapshotValue(participant.passport));
    fields.set(`${prefix}.current_work`, snapshotApplicableValue(participant.currentWork));
    fields.set(`${prefix}.remote_continuation`, snapshotApplicableValue(participant.remoteContinuation));
    fields.set(`${prefix}.monthly_income`, snapshotApplicableValue(participant.monthlyIncome));
    fields.set(`${prefix}.education`, snapshotApplicableValue(participant.education));
    fields.set(`${prefix}.relevant_experience_years`, snapshotApplicableValue(participant.relevantExperienceYears));
  }
  for (const criterion of preferences.countryCriteria) {
    const prefix = `country_preferences.${criterion.id}` as const;
    fields.set(`${prefix}.mode`, requiredSnapshotValue(criterion.mode));
    fields.set(`${prefix}.importance`, requiredSnapshotValue(criterion.importance));
    fields.set(`${prefix}.target`, requiredSnapshotValue(criterion.target));
  }
  for (const criterion of preferences.cityCriteria) {
    const prefix = `city_preferences.${criterion.id}` as const;
    fields.set(`${prefix}.mode`, requiredSnapshotValue(criterion.mode));
    fields.set(`${prefix}.importance`, requiredSnapshotValue(criterion.importance));
    fields.set(`${prefix}.target`, requiredSnapshotValue(criterion.target));
  }
  assertCanonicalOnboardingFieldOrderForDecision([...fields.keys()]);
  return fields;
}

function requiredSnapshotValue(value: OnboardingFieldValue): SnapshotFieldValue {
  return { applicability: "required", value };
}

function snapshotApplicableValue(
  value: { readonly applicability: "not_applicable" } | {
    readonly applicability: "required";
    readonly value: OnboardingFieldValue;
  },
): SnapshotFieldValue {
  return value.applicability === "not_applicable"
    ? { applicability: "not_applicable", value: null }
    : { applicability: "required", value: value.value };
}

function rehydrateField(
  provenance: QuestionnaireProvenanceEntry,
  snapshot: SnapshotFieldValue | undefined,
): QuestionnaireFieldState {
  if (snapshot === undefined || snapshot.applicability !== provenance.applicability) {
    throw invalidQuestionnaire();
  }
  if (snapshot.applicability === "not_applicable") {
    if (provenance.reviewState !== "not_applicable") throw invalidQuestionnaire();
    return emptyField(provenance.fieldId, "not_applicable");
  }
  if (snapshot.value === null || provenance.reviewState === "not_applicable") {
    throw invalidQuestionnaire();
  }
  const normalizedValue = parseOnboardingFieldValueForDecision(provenance.fieldId, snapshot.value);
  if (provenance.reviewState === "accepted") {
    return valueField(provenance.fieldId, normalizedValue, provenance.origin, null);
  }
  const expected = provenance.reviewState === "model_overwrite_reverted"
    ? provenance.previousValue
    : provenance.proposedValue;
  if (!equalValues(normalizedValue, expected)) throw invalidQuestionnaire();
  return deepFreeze({
    fieldId: provenance.fieldId,
    applicability: "required",
    rawInput: null,
    normalizedValue,
    origin: provenance.origin,
    overwrite: {
      previousValue: cloneOnboardingFieldValueForDecision(provenance.fieldId, provenance.previousValue),
      proposedValue: cloneOnboardingFieldValueForDecision(provenance.fieldId, provenance.proposedValue),
      reasonCode: "explicit_new_information",
      reviewState: provenance.reviewState,
    },
  }) as QuestionnaireFieldState;
}

function applyManualChange(field: QuestionnaireFieldState, rawInput: unknown): QuestionnaireFieldState {
  if (field.applicability === "not_applicable") return emptyField(field.fieldId, "not_applicable");
  const safeRawInput = cloneRawInput(rawInput);
  if (field.fieldId === "participants") {
    const roster = parseParticipantRoster(rawInput);
    return valueField(field.fieldId, roster, "manual", safeRawInput);
  }
  try {
    const normalizedValue = parseOnboardingFieldValueForDecision(field.fieldId, rawInput);
    return valueField(field.fieldId, normalizedValue, "manual", safeRawInput);
  } catch {
    return emptyField(field.fieldId, "required", safeRawInput);
  }
}

function applyModelChange(
  field: QuestionnaireFieldState,
  proposedInput: OnboardingFieldValue,
): QuestionnaireFieldState {
  if (field.applicability === "not_applicable") throw invalidQuestionnaire();
  const proposedValue = parseOnboardingFieldValueForDecision(field.fieldId, proposedInput);
  if (field.normalizedValue !== null && equalValues(field.normalizedValue, proposedValue)) {
    return cloneField(field);
  }

  if (
    field.overwrite !== null &&
    field.overwrite.reviewState === "model_overwrite_unreviewed"
  ) {
    return deepFreeze({
      fieldId: field.fieldId,
      applicability: "required",
      rawInput: cloneRawInput(field.rawInput),
      normalizedValue: proposedValue,
      origin: "model",
      overwrite: {
        previousValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.overwrite.previousValue),
        proposedValue,
        reasonCode: "explicit_new_information",
        reviewState: "model_overwrite_unreviewed",
      },
    });
  }

  if (field.origin === "manual" && field.normalizedValue !== null) {
    return deepFreeze({
      fieldId: field.fieldId,
      applicability: "required",
      rawInput: cloneRawInput(field.rawInput),
      normalizedValue: proposedValue,
      origin: "model",
      overwrite: {
        previousValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.normalizedValue),
        proposedValue,
        reasonCode: "explicit_new_information",
        reviewState: "model_overwrite_unreviewed",
      },
    });
  }

  return valueField(field.fieldId, proposedValue, "model", null);
}

function confirmOverwrite(field: QuestionnaireFieldState): QuestionnaireFieldState {
  if (
    field.applicability !== "required" ||
    field.normalizedValue === null ||
    field.origin !== "model" ||
    field.overwrite?.reviewState !== "model_overwrite_unreviewed"
  ) throw invalidQuestionnaire();
  return deepFreeze({
    fieldId: field.fieldId,
    applicability: "required" as const,
    rawInput: cloneRawInput(field.rawInput),
    normalizedValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.normalizedValue),
    origin: "model" as const,
    overwrite: { ...field.overwrite, reviewState: "model_overwrite_confirmed" as const },
  });
}

function revertOverwrite(field: QuestionnaireFieldState): QuestionnaireFieldState {
  if (field.overwrite?.reviewState !== "model_overwrite_unreviewed") throw invalidQuestionnaire();
  return deepFreeze({
    fieldId: field.fieldId,
    applicability: "required" as const,
    rawInput: cloneRawInput(field.rawInput),
    normalizedValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.overwrite.previousValue),
    origin: "manual" as const,
    overwrite: { ...field.overwrite, reviewState: "model_overwrite_reverted" as const },
  });
}

function canonicalFields(
  roster: readonly ParticipantRosterValue[],
  fieldsById: ReadonlyMap<string, QuestionnaireFieldState>,
): QuestionnaireFieldState[] {
  return canonicalFieldIds(roster).map((fieldId) => {
    const existing = fieldsById.get(fieldId);
    const applicability = fieldApplicability(fieldId, roster, fieldsById);
    if (applicability === "not_applicable") return emptyField(fieldId, applicability);
    if (existing === undefined) return emptyField(fieldId, applicability);
    if (existing.applicability === "not_applicable") return emptyField(fieldId, applicability);
    return cloneField(existing);
  });
}

function canonicalFieldIds(roster: readonly ParticipantRosterValue[]): OnboardingFieldId[] {
  const ids: OnboardingFieldId[] = [...BASE_FIELD_IDS];
  for (const { participantId } of roster) {
    for (const leafId of PARTICIPANT_LEAF_IDS) ids.push(`participants.${participantId}.${leafId}`);
  }
  for (const criterionId of COUNTRY_PREFERENCE_IDS) {
    ids.push(
      `country_preferences.${criterionId}.mode`,
      `country_preferences.${criterionId}.importance`,
      `country_preferences.${criterionId}.target`,
    );
  }
  for (const criterionId of CITY_PREFERENCE_IDS) {
    ids.push(
      `city_preferences.${criterionId}.mode`,
      `city_preferences.${criterionId}.importance`,
      `city_preferences.${criterionId}.target`,
    );
  }
  return ids;
}

function fieldApplicability(
  fieldId: OnboardingFieldId,
  roster: readonly ParticipantRosterValue[],
  fieldsById: ReadonlyMap<string, QuestionnaireFieldState>,
): QuestionnaireApplicability {
  const address = parseFieldId(fieldId);
  if (address.kind !== "participant") return "required";
  const participant = roster.find(({ participantId }) => participantId === address.participantId);
  if (participant === undefined) throw invalidQuestionnaire();
  if (address.leafId === "citizenships" || address.leafId === "passport") return "required";
  if (participant.relationship === "minor_child") return "not_applicable";
  if (address.leafId !== "remote_continuation") return "required";
  const currentWork = fieldsById.get(`participants.${participant.participantId}.current_work`)
    ?.normalizedValue;
  return isCurrentWorkValue(currentWork) && currentWork.status !== "not_working"
    ? "required"
    : "not_applicable";
}

function parseFieldState(value: unknown): QuestionnaireFieldState {
  const field = exactRecord(value, [
    "fieldId",
    "applicability",
    "rawInput",
    "normalizedValue",
    "origin",
    "overwrite",
  ]);
  const fieldId = parseOnboardingFieldIdForDecision(field.fieldId);
  const rawInput = cloneRawInput(field.rawInput);
  if (field.applicability === "not_applicable") {
    if (rawInput !== null || field.normalizedValue !== null || field.origin !== "empty" || field.overwrite !== null) {
      throw invalidQuestionnaire();
    }
    return emptyField(fieldId, "not_applicable");
  }
  if (field.applicability !== "required") throw invalidQuestionnaire();
  if (field.normalizedValue === null) {
    if (field.origin !== "empty" || field.overwrite !== null) throw invalidQuestionnaire();
    return emptyField(fieldId, "required", rawInput);
  }

  const normalizedValue = parseOnboardingFieldValueForDecision(fieldId, field.normalizedValue);
  if (field.origin !== "manual" && field.origin !== "model") throw invalidQuestionnaire();
  if (field.overwrite === null) return valueField(fieldId, normalizedValue, field.origin, rawInput);
  const overwrite = parseOverwrite(fieldId, field.overwrite);
  if (
    (overwrite.reviewState === "model_overwrite_reverted" && field.origin !== "manual") ||
    (overwrite.reviewState !== "model_overwrite_reverted" && field.origin !== "model")
  ) throw invalidQuestionnaire();
  const expectedValue = overwrite.reviewState === "model_overwrite_reverted"
    ? overwrite.previousValue
    : overwrite.proposedValue;
  if (!equalValues(normalizedValue, expectedValue)) throw invalidQuestionnaire();
  return deepFreeze({
    fieldId,
    applicability: "required",
    rawInput,
    normalizedValue,
    origin: field.origin,
    overwrite,
  }) as QuestionnaireFieldState;
}

function parseOverwrite(fieldId: OnboardingFieldId, value: unknown): QuestionnaireModelOverwrite {
  const overwrite = exactRecord(value, ["previousValue", "proposedValue", "reasonCode", "reviewState"]);
  if (overwrite.reasonCode !== "explicit_new_information") throw invalidQuestionnaire();
  if (
    overwrite.reviewState !== "model_overwrite_unreviewed" &&
    overwrite.reviewState !== "model_overwrite_confirmed" &&
    overwrite.reviewState !== "model_overwrite_reverted"
  ) throw invalidQuestionnaire();
  return deepFreeze({
    previousValue: parseOnboardingFieldValueForDecision(fieldId, overwrite.previousValue),
    proposedValue: parseOnboardingFieldValueForDecision(fieldId, overwrite.proposedValue),
    reasonCode: "explicit_new_information",
    reviewState: overwrite.reviewState,
  });
}

function parseBaseValue(fieldId: OnboardingBaseFieldId, value: unknown): OnboardingFieldValue {
  if (fieldId === "current_location") return parseCurrentLocation(value);
  if (fieldId === "move_horizon") {
    if (typeof value !== "string" || !MOVE_HORIZONS.has(value as MoveHorizonValue)) throw invalidQuestionnaire();
    return value as MoveHorizonValue;
  }
  if (fieldId === "moving_party") {
    if (value !== "alone" && value !== "with_companions") throw invalidQuestionnaire();
    return value;
  }
  if (fieldId === "participants") return parseParticipantRoster(value);
  return parseSavings(value);
}

function parseParticipantValue(leafId: ParticipantLeafId, value: unknown): OnboardingFieldValue {
  if (leafId === "citizenships") return parseCitizenships(value);
  if (leafId === "passport") return parsePassport(value);
  if (leafId === "current_work") return parseCurrentWork(value);
  if (leafId === "remote_continuation") {
    if (value !== "yes" && value !== "no") throw invalidQuestionnaire();
    return value;
  }
  if (leafId === "monthly_income") return parseMonthlyIncome(value);
  if (leafId === "education") return parseEducation(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidQuestionnaire();
  return value;
}

function parseCurrentLocation(value: unknown): CurrentLocationValue {
  const location = exactRecord(value, ["countryCode", "city"]);
  if (!isIsoCountryCode(location.countryCode)) throw invalidQuestionnaire();
  return { countryCode: location.countryCode, city: parseText(location.city) };
}

function parseParticipantRoster(value: unknown): readonly ParticipantRosterValue[] {
  const roster = denseArray(value, MAX_PARTICIPANTS).map((item) => {
    const participant = exactRecord(item, ["participantId", "relationship"]);
    const participantId = parseParticipantId(participant.participantId);
    if (typeof participant.relationship !== "string" || !RELATIONSHIPS.has(participant.relationship as ParticipantRelationship)) {
      throw invalidQuestionnaire();
    }
    return { participantId, relationship: participant.relationship as ParticipantRelationship };
  });
  if (
    roster.length === 0 ||
    roster[0]?.relationship !== "self" ||
    roster.slice(1).some(({ relationship }) => relationship === "self")
  ) throw invalidQuestionnaire();
  assertUnique(roster.map(({ participantId }) => participantId));
  return roster;
}

function parseCitizenships(value: unknown): readonly IsoCountryCode[] {
  const citizenships = denseArray(value, 100).map((country) => {
    if (!isIsoCountryCode(country)) throw invalidQuestionnaire();
    return country;
  });
  if (citizenships.length === 0) throw invalidQuestionnaire();
  assertUnique(citizenships);
  return citizenships;
}

function parsePassport(value: unknown): PassportValue {
  if (value === "absent") return value;
  const passport = exactRecord(value, ["validUntil"]);
  if (!isCanonicalDay(passport.validUntil)) throw invalidQuestionnaire();
  return { validUntil: passport.validUntil };
}

function parseCurrentWork(value: unknown): CurrentWorkValue {
  const work = optionalRecord(value, ["status", "occupation"], ["status"]);
  if (typeof work.status !== "string" || !WORK_STATUSES.has(work.status as CurrentWorkValue["status"])) {
    throw invalidQuestionnaire();
  }
  if (work.occupation === undefined) return { status: work.status as CurrentWorkValue["status"] };
  return { status: work.status as CurrentWorkValue["status"], occupation: parseText(work.occupation) };
}

function parseMonthlyIncome(value: unknown): MonthlyIncomeValue {
  const income = exactRecord(value, ["amount", "currency", "basis"]);
  if (!isCanonicalDecimal(income.amount) || !isIsoCurrencyCode(income.currency)) throw invalidQuestionnaire();
  if (income.basis !== "net" && income.basis !== "gross") throw invalidQuestionnaire();
  return { amount: income.amount, currency: income.currency, basis: income.basis };
}

function parseSavings(value: unknown): SavingsValue {
  const savings = exactRecord(value, ["min", "max", "currency"]);
  if (!isCanonicalDecimal(savings.min) || !isCanonicalDecimal(savings.max) || !isIsoCurrencyCode(savings.currency)) {
    throw invalidQuestionnaire();
  }
  return { min: savings.min, max: savings.max, currency: savings.currency };
}

function parseEducation(value: unknown): EducationValue {
  const education = optionalRecord(value, ["level", "field"], ["level"]);
  if (typeof education.level !== "string" || !EDUCATION_LEVELS.has(education.level as EducationValue["level"])) {
    throw invalidQuestionnaire();
  }
  if (education.level === "none" && education.field !== undefined) throw invalidQuestionnaire();
  if (education.field === undefined) return { level: education.level as EducationValue["level"] };
  return { level: education.level as EducationValue["level"], field: parseText(education.field) };
}

function parsePreferenceMode(value: unknown): PreferenceMode {
  if (value !== "required" && value !== "weighted") throw invalidQuestionnaire();
  return value;
}

function parsePreferenceImportance(value: unknown): PreferenceImportance {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw invalidQuestionnaire();
  }
  return value as PreferenceImportance;
}

function parseCountryTarget(value: unknown): "required_true" | "maximize" {
  if (value !== "required_true" && value !== "maximize") throw invalidQuestionnaire();
  return value;
}

function parseText(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || value.trim().length === 0) {
    throw invalidQuestionnaire();
  }
  if (isPlaceholder(value)) throw invalidQuestionnaire();
  return value;
}

function parseParticipantId(value: unknown): ParticipantId {
  if (typeof value !== "string" || !PARTICIPANT_ID.test(value)) throw invalidQuestionnaire();
  return value;
}

function parseFieldId(fieldId: OnboardingFieldId): FieldAddress {
  if (BASE_FIELD_IDS.includes(fieldId as OnboardingBaseFieldId)) return { kind: "base" };
  const participant = /^participants\.([0-9a-f-]+)\.(citizenships|passport|current_work|remote_continuation|monthly_income|education|relevant_experience_years)$/.exec(fieldId);
  if (participant !== null) {
    return {
      kind: "participant",
      participantId: parseParticipantId(participant[1]),
      leafId: participant[2] as ParticipantLeafId,
    };
  }
  const country = /^country_preferences\.([a-z_]+)\.(mode|importance|target)$/.exec(fieldId);
  if (country !== null && COUNTRY_PREFERENCE_IDS.includes(country[1] as (typeof COUNTRY_PREFERENCE_IDS)[number])) {
    return { kind: "country", preferenceId: country[1], part: country[2] as FieldAddress["part"] };
  }
  const city = /^city_preferences\.([a-z_]+)\.(mode|importance|target)$/.exec(fieldId);
  if (city !== null && CITY_PREFERENCE_IDS.includes(city[1] as (typeof CITY_PREFERENCE_IDS)[number])) {
    return { kind: "city", preferenceId: city[1], part: city[2] as FieldAddress["part"] };
  }
  throw invalidQuestionnaire();
}

function projectRelocationProfile(
  draft: OnboardingDraft,
): Omit<RelocationProfileV2Snapshot, "id" | "confirmedAt"> {
  const roster = participantRosterFromField(findField(draft, "participants"));
  return {
    schemaVersion: "relocation-profile@2",
    profile: {
      currentLocation: requiredValue(draft, "current_location") as CurrentLocationValue,
      moveHorizon: requiredValue(draft, "move_horizon") as MoveHorizonValue,
      movingParty: requiredValue(draft, "moving_party") as MovingPartyValue,
      participants: roster.map(({ participantId, relationship }) => ({
        participantId,
        relationship,
        citizenships: requiredValue(draft, `participants.${participantId}.citizenships`) as readonly IsoCountryCode[],
        passport: requiredValue(draft, `participants.${participantId}.passport`) as PassportValue,
        currentWork: applicableValue(draft, `participants.${participantId}.current_work`) as never,
        remoteContinuation: applicableValue(draft, `participants.${participantId}.remote_continuation`) as never,
        monthlyIncome: applicableValue(draft, `participants.${participantId}.monthly_income`) as never,
        education: applicableValue(draft, `participants.${participantId}.education`) as never,
        relevantExperienceYears: applicableValue(draft, `participants.${participantId}.relevant_experience_years`) as never,
      })) as never,
      savings: requiredValue(draft, "savings") as SavingsValue,
    },
  };
}

function projectPreferenceProfile(
  draft: OnboardingDraft,
): Omit<PreferenceProfileV2Snapshot, "id" | "confirmedAt"> {
  const countryCriteria = COUNTRY_PREFERENCE_IDS.map((id) => ({
    id,
    mode: requiredValue(draft, `country_preferences.${id}.mode`),
    importance: requiredValue(draft, `country_preferences.${id}.importance`),
    target: requiredValue(draft, `country_preferences.${id}.target`),
  }));
  const cityCriteria = CITY_PREFERENCE_IDS.map((id) => ({
    id,
    mode: requiredValue(draft, `city_preferences.${id}.mode`),
    importance: requiredValue(draft, `city_preferences.${id}.importance`),
    target: requiredValue(draft, `city_preferences.${id}.target`),
  }));
  return {
    schemaVersion: "preference-profile@2",
    countryCriteria: countryCriteria as never,
    cityCriteria: cityCriteria as never,
  };
}

function applicableValue(draft: OnboardingDraft, fieldId: OnboardingFieldId) {
  const field = findField(draft, fieldId);
  return field.applicability === "not_applicable"
    ? { applicability: "not_applicable" as const }
    : { applicability: "required" as const, value: requiredValue(draft, fieldId) };
}

function requiredValue(draft: OnboardingDraft, fieldId: OnboardingFieldId): OnboardingFieldValue {
  const value = findField(draft, fieldId).normalizedValue;
  if (value === null) throw invalidQuestionnaire();
  return cloneOnboardingFieldValueForDecision(fieldId, value);
}

function normalizedValue(draft: OnboardingDraft, fieldId: OnboardingFieldId): OnboardingFieldValue | null {
  return findField(draft, fieldId).normalizedValue;
}

function findField(draft: OnboardingDraft, fieldId: OnboardingFieldId): QuestionnaireFieldState {
  const field = draft.fields.find((candidate) => candidate.fieldId === fieldId);
  if (field === undefined) throw invalidQuestionnaire();
  return field;
}

function participantRosterFromField(field: QuestionnaireFieldState | undefined): readonly ParticipantRosterValue[] {
  if (field?.fieldId !== "participants" || field.normalizedValue === null) throw invalidQuestionnaire();
  return parseParticipantRoster(field.normalizedValue);
}

function valueField(
  fieldId: OnboardingFieldId,
  normalizedValue: OnboardingFieldValue,
  origin: "manual" | "model",
  rawInput: unknown | null,
): QuestionnaireFieldState {
  return deepFreeze({
    fieldId,
    applicability: "required" as const,
    rawInput: cloneRawInput(rawInput),
    normalizedValue: parseOnboardingFieldValueForDecision(fieldId, normalizedValue),
    origin,
    overwrite: null,
  });
}

function emptyField(
  fieldId: OnboardingFieldId,
  applicability: QuestionnaireApplicability,
  rawInput: unknown | null = null,
): QuestionnaireFieldState {
  return applicability === "not_applicable"
    ? deepFreeze({
        fieldId,
        applicability,
        rawInput: null,
        normalizedValue: null,
        origin: "empty" as const,
        overwrite: null,
      })
    : deepFreeze({
        fieldId,
        applicability,
        rawInput: cloneRawInput(rawInput),
        normalizedValue: null,
        origin: "empty" as const,
        overwrite: null,
      });
}

function cloneField(field: QuestionnaireFieldState): QuestionnaireFieldState {
  return parseFieldState(field);
}

function freezeDraft(fields: readonly QuestionnaireFieldState[]): OnboardingDraft {
  return deepFreeze({ schemaVersion: "onboarding-draft@1", fields: [...fields] });
}

function missingValueReason(rawInput: unknown | null): QuestionnaireIssueCode {
  if (rawInput === null || (typeof rawInput === "string" && rawInput.trim().length === 0)) {
    return "required_empty";
  }
  return typeof rawInput === "string" && isPlaceholder(rawInput)
    ? "placeholder_value"
    : "invalid_value";
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDERS.has(value.trim().toLocaleLowerCase("ru-RU"));
}

function canonicalIssueOrder(
  draft: OnboardingDraft,
  issues: readonly QuestionnaireIssue[],
): QuestionnaireIssue[] {
  const position = new Map(draft.fields.map(({ fieldId }, index) => [fieldId, index]));
  const unique = new Map<string, QuestionnaireIssue>();
  for (const issue of issues) if (!unique.has(`${issue.fieldId}:${issue.reasonCode}`)) {
    unique.set(`${issue.fieldId}:${issue.reasonCode}`, issue);
  }
  return [...unique.values()].sort((left, right) =>
    position.get(left.fieldId)! - position.get(right.fieldId)! ||
    left.reasonCode.localeCompare(right.reasonCode));
}

function isSavingsValue(value: unknown): value is SavingsValue {
  try {
    parseSavings(value);
    return true;
  } catch {
    return false;
  }
}

function isCurrentWorkValue(value: unknown): value is CurrentWorkValue {
  try {
    parseCurrentWork(value);
    return true;
  } catch {
    return false;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = snapshotRecord(value);
  if (record === null || !hasExactKeys(record, keys)) throw invalidQuestionnaire();
  return record;
}

function optionalRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  const record = snapshotRecord(value);
  if (
    record === null ||
    !Object.keys(record).every((key) => allowedKeys.includes(key)) ||
    !requiredKeys.every((key) => key in record)
  ) throw invalidQuestionnaire();
  return record;
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, maximumLength: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) throw invalidQuestionnaire();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalidQuestionnaire();
    result.push(descriptor.value);
  }
  const expectedPropertyNames = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !expectedPropertyNames.has(key))) throw invalidQuestionnaire();
  return result;
}

function cloneRawInput(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  return cloneJsonValue(value, new WeakSet(), 0);
}

function cloneJsonValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 8) throw invalidQuestionnaire();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null) return null;
  if (typeof value !== "object") throw invalidQuestionnaire();
  if (seen.has(value)) throw invalidQuestionnaire();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return denseArray(value, 100).map((child) => cloneJsonValue(child, seen, depth + 1));
    }
    const record = snapshotRecord(value);
    if (record === null || Object.keys(record).length > 100) throw invalidQuestionnaire();
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [
      key,
      cloneJsonValue(child, seen, depth + 1),
    ]));
  } finally {
    seen.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function equalValues(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => key in record);
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalidQuestionnaire();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidQuestionnaire(): TypeError {
  return new TypeError("Invalid onboarding questionnaire");
}
