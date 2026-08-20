export const COUNTRY_PREFERENCE_IDS = [
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
] as const;

export const CITY_PREFERENCE_IDS = [
  "safety",
  "long_term_rent",
  "urban_transit",
  "fixed_broadband",
] as const;

export type CountryPreferenceId = (typeof COUNTRY_PREFERENCE_IDS)[number];
export type UniversalCityPreferenceId = (typeof CITY_PREFERENCE_IDS)[number];
export type PreferencePart = "mode" | "importance" | "target";
export type ParticipantLeafId =
  | "citizenships"
  | "passport"
  | "current_work"
  | "remote_continuation"
  | "monthly_income"
  | "education"
  | "relevant_experience_years";
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
  | "within_3_months"
  | "3_to_6_months"
  | "6_to_12_months"
  | "more_than_12_months";
export type MovingPartyValue = "alone" | "with_companions";
export type ParticipantRelationship = "self" | "spouse" | "minor_child" | "other_family";
export type PassportValue = "absent" | { readonly validUntil: CanonicalDay };

export interface CurrentWorkValue {
  readonly status:
    | "not_working"
    | "employment"
    | "self_employment"
    | "contract_service"
    | "other";
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
  | "current_location"
  | "move_horizon"
  | "moving_party"
  | "participants"
  | "savings";
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

export type QuestionnaireIssueCode =
  | "required_empty"
  | "invalid_value"
  | "placeholder_value"
  | "party_mismatch"
  | "work_mismatch"
  | "range_mismatch";

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
      "required_true" | "maximize"
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
