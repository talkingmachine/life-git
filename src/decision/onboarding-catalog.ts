export const COUNTRY_PREFERENCE_IDS = Object.freeze([
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
] as const);

export const CITY_PREFERENCE_IDS = Object.freeze([
  "safety",
  "long_term_rent",
  "urban_transit",
  "fixed_broadband",
] as const);

export const ONBOARDING_BASE_FIELD_IDS = Object.freeze([
  "current_location",
  "move_horizon",
  "moving_party",
  "participants",
  "savings",
] as const);

export const PARTICIPANT_LEAF_IDS = Object.freeze([
  "citizenships",
  "passport",
  "current_work",
  "remote_continuation",
  "monthly_income",
  "education",
  "relevant_experience_years",
] as const);

export const PARTICIPANT_RELATIONSHIPS = Object.freeze([
  "self",
  "spouse",
  "minor_child",
  "other_family",
] as const);

export const MOVE_HORIZONS = Object.freeze([
  "within_3_months",
  "3_to_6_months",
  "6_to_12_months",
  "more_than_12_months",
] as const);

export const MOVING_PARTY_VALUES = Object.freeze(["alone", "with_companions"] as const);

export const WORK_STATUSES = Object.freeze([
  "not_working",
  "employment",
  "self_employment",
  "contract_service",
  "other",
] as const);

export const REMOTE_CONTINUATION_VALUES = Object.freeze(["yes", "no"] as const);
export const INCOME_BASES = Object.freeze(["net", "gross"] as const);
export const EDUCATION_LEVELS = Object.freeze(["none", "secondary", "vocational", "higher"] as const);
export const PREFERENCE_MODES = Object.freeze(["required", "weighted"] as const);
export const PREFERENCE_IMPORTANCES = Object.freeze([1, 2, 3, 4, 5] as const);
export const PREFERENCE_PARTS = Object.freeze(["mode", "importance", "target"] as const);
export const COUNTRY_PREFERENCE_TARGET_VALUES = Object.freeze(["required_true", "maximize"] as const);

export const QUESTIONNAIRE_ISSUE_CODES = Object.freeze([
  "required_empty",
  "invalid_value",
  "placeholder_value",
  "party_mismatch",
  "work_mismatch",
  "range_mismatch",
] as const);

export type CountryPreferenceId = (typeof COUNTRY_PREFERENCE_IDS)[number];
export type UniversalCityPreferenceId = (typeof CITY_PREFERENCE_IDS)[number];
export type PreferencePart = (typeof PREFERENCE_PARTS)[number];
export type ParticipantLeafId = (typeof PARTICIPANT_LEAF_IDS)[number];
export type ParticipantDescriptor = "self" | `companion.${number}`;

export type CanonicalDecimal = string;
export type CanonicalDay = string;
export type IsoCountryCode = string;
export type IsoCurrencyCode = string;

export interface CurrentLocationValue {
  readonly countryCode: IsoCountryCode;
  readonly city: string;
}

export type MoveHorizonValue = (typeof MOVE_HORIZONS)[number];
export type MovingPartyValue = (typeof MOVING_PARTY_VALUES)[number];
export type ParticipantRelationship = (typeof PARTICIPANT_RELATIONSHIPS)[number];
export type PassportValue = "absent" | { readonly validUntil: CanonicalDay };

export interface CurrentWorkValue {
  readonly status: (typeof WORK_STATUSES)[number];
  readonly occupation?: string;
}

export type RemoteContinuationValue = (typeof REMOTE_CONTINUATION_VALUES)[number];

export interface MonthlyIncomeValue {
  readonly amount: CanonicalDecimal;
  readonly currency: IsoCurrencyCode;
  readonly basis: (typeof INCOME_BASES)[number];
}

export interface SavingsValue {
  readonly min: CanonicalDecimal;
  readonly max: CanonicalDecimal;
  readonly currency: IsoCurrencyCode;
}

export interface EducationValue {
  readonly level: (typeof EDUCATION_LEVELS)[number];
  readonly field?: string;
}

export type PreferenceMode = (typeof PREFERENCE_MODES)[number];
export type PreferenceImportance = (typeof PREFERENCE_IMPORTANCES)[number];

export type OnboardingBaseFieldId = (typeof ONBOARDING_BASE_FIELD_IDS)[number];
export type CountryPreferenceFieldId =
  `country_preferences.${CountryPreferenceId}.${PreferencePart}`;
export type CityPreferenceFieldId =
  `city_preferences.${UniversalCityPreferenceId}.${PreferencePart}`;
export type CityPreferenceTargetFieldId =
  `city_preferences.${UniversalCityPreferenceId}.target`;
export type ParticipantProposalFieldId =
  `participants.${ParticipantDescriptor}.${ParticipantLeafId}`;
export type OnboardingModelFieldId =
  | OnboardingBaseFieldId
  | ParticipantProposalFieldId
  | CountryPreferenceFieldId
  | CityPreferenceFieldId;

export type QuestionnaireIssueCode = (typeof QUESTIONNAIRE_ISSUE_CODES)[number];

export interface ParticipantRosterProposal {
  readonly descriptor: ParticipantDescriptor;
  readonly relationship: ParticipantRelationship;
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
  | LocalFieldProposal<`participants.${ParticipantDescriptor}.current_work`, CurrentWorkValue>
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.remote_continuation`,
      RemoteContinuationValue
    >
  | LocalFieldProposal<
      `participants.${ParticipantDescriptor}.monthly_income`,
      MonthlyIncomeValue
    >
  | LocalFieldProposal<`participants.${ParticipantDescriptor}.education`, EducationValue>
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
      (typeof COUNTRY_PREFERENCE_TARGET_VALUES)[number]
    >
  | LocalFieldProposal<`city_preferences.${UniversalCityPreferenceId}.mode`, PreferenceMode>
  | LocalFieldProposal<
      `city_preferences.${UniversalCityPreferenceId}.importance`,
      PreferenceImportance
    >
  | LocalFieldProposal<CityPreferenceTargetFieldId, string>;

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
