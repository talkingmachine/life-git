import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_TARGET_VALUES,
  EDUCATION_LEVELS,
  INCOME_BASES,
  MOVE_HORIZONS,
  MOVING_PARTY_VALUES,
  ONBOARDING_BASE_FIELD_IDS,
  PARTICIPANT_LEAF_IDS,
  PARTICIPANT_RELATIONSHIPS,
  PREFERENCE_IMPORTANCES,
  PREFERENCE_MODES,
  PREFERENCE_PARTS,
  QUESTIONNAIRE_ISSUE_CODES,
  REMOTE_CONTINUATION_VALUES,
  WORK_STATUSES,
  type OnboardingBaseFieldId,
  type ParticipantLeafId,
  type PreferencePart,
} from "../../decision/onboarding-catalog";
import type { JsonObject, JsonValue } from "./owned-json";
import { ONBOARDING_EXTRACTION_WIRE_CODEBOOK } from "./onboarding-extraction-wire";

const COUNTRY_CODE_PATTERN = "^[A-Z]{2}$";
const CURRENCY_CODE_PATTERN = "^[A-Z]{3}$";
const CANONICAL_DECIMAL_PATTERN = "^(?:0(?:\\.[0-9]+)?|[1-9][0-9]*(?:\\.[0-9]+)?)$";
const CANONICAL_DAY_PATTERN = "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$";
const PARTICIPANT_DESCRIPTOR_PATTERN = "^(?:self|companion\\.(?:0|[1-9][0-9]*))$";
const PARTICIPANT_FIELD_PREFIX_PATTERN = "participants\\.(?:self|companion\\.(?:0|[1-9][0-9]*))";

const boundedText = Object.freeze({ type: "string", minLength: 1, maxLength: 1_000 });
const countryCode = Object.freeze({ type: "string", pattern: COUNTRY_CODE_PATTERN });
const currencyCode = Object.freeze({ type: "string", pattern: CURRENCY_CODE_PATTERN });
const canonicalDecimal = Object.freeze({ type: "string", pattern: CANONICAL_DECIMAL_PATTERN });

const wireEvidence = Object.freeze({ type: "string", minLength: 1, maxLength: 8_192 });

const currentLocation = exactObject({
  countryCode,
  city: boundedText,
});

const participantRoster = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  items: exactObject({
    descriptor: { type: "string", pattern: PARTICIPANT_DESCRIPTOR_PATTERN },
    relationship: enumSchema(PARTICIPANT_RELATIONSHIPS),
  }),
};

const savings = exactObject({
  min: canonicalDecimal,
  max: canonicalDecimal,
  currency: currencyCode,
});

const passport = {
  anyOf: [
    enumSchema(["absent"]),
    exactObject({ validUntil: { type: "string", pattern: CANONICAL_DAY_PATTERN } }),
  ],
};

const currentWork = {
  anyOf: [
    exactObject({ status: enumSchema(WORK_STATUSES) }),
    exactObject({
      status: enumSchema(WORK_STATUSES),
      occupation: boundedText,
    }),
  ],
};

const monthlyIncome = exactObject({
  amount: canonicalDecimal,
  currency: currencyCode,
  basis: enumSchema(INCOME_BASES),
});

const education = {
  anyOf: [
    exactObject({ level: enumSchema(EDUCATION_LEVELS) }),
    exactObject({
      level: enumSchema(EDUCATION_LEVELS),
      field: boundedText,
    }),
  ],
};

const countryPreferenceFieldIds = COUNTRY_PREFERENCE_IDS.flatMap((preferenceId) =>
  PREFERENCE_PARTS.map((part) => `country_preferences.${preferenceId}.${part}`));
const cityPreferenceFieldIds = CITY_PREFERENCE_IDS.flatMap((preferenceId) =>
  PREFERENCE_PARTS.map((part) => `city_preferences.${preferenceId}.${part}`));

const baseValueSchemas: Readonly<Record<OnboardingBaseFieldId, JsonObject>> = {
  current_location: currentLocation,
  move_horizon: enumSchema(MOVE_HORIZONS),
  moving_party: enumSchema(MOVING_PARTY_VALUES),
  participants: participantRoster,
  savings,
};

const participantValueSchemas: Readonly<Record<ParticipantLeafId, JsonObject>> = {
  citizenships: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: countryCode,
  },
  passport,
  current_work: currentWork,
  remote_continuation: enumSchema(REMOTE_CONTINUATION_VALUES),
  monthly_income: monthlyIncome,
  education,
  relevant_experience_years: { type: "integer", minimum: 0 },
};

const countryPreferenceValueSchemas: Readonly<Record<PreferencePart, JsonObject>> = {
  mode: enumSchema(PREFERENCE_MODES),
  importance: enumSchema(PREFERENCE_IMPORTANCES),
  target: enumSchema(COUNTRY_PREFERENCE_TARGET_VALUES),
};

const cityPreferenceValueSchemas: Readonly<Record<PreferencePart, JsonObject>> = {
  mode: enumSchema(PREFERENCE_MODES),
  importance: enumSchema(PREFERENCE_IMPORTANCES),
  target: boundedText,
};

const extractionProposalSchemas = [
  ...ONBOARDING_BASE_FIELD_IDS.map((fieldId) =>
    proposalSchema(wireAddressSchema((candidate) => candidate === fieldId), baseValueSchemas[fieldId])),
  ...PARTICIPANT_LEAF_IDS.map((leafId) =>
    proposalSchema(
      wireAddressSchema((candidate) =>
        candidate.startsWith("participants.") && candidate.endsWith(`.${leafId}`)),
      participantValueSchemas[leafId],
    )),
  ...PREFERENCE_PARTS.map((part) => proposalSchema(
    wireAddressSchema((candidate) =>
      candidate.startsWith("country_preferences.") && candidate.endsWith(`.${part}`)),
    countryPreferenceValueSchemas[part],
  )),
  ...PREFERENCE_PARTS.map((part) => proposalSchema(
    wireAddressSchema((candidate) =>
      candidate.startsWith("city_preferences.") && candidate.endsWith(`.${part}`)),
    cityPreferenceValueSchemas[part],
  )),
];

export const ONBOARDING_EXTRACTION_SCHEMA = deepFreeze(exactObject({
  schemaVersion: enumSchema(["onboarding-extraction-wire@3"]),
  proposals: {
    type: "array",
    maxItems: 100,
    items: { anyOf: extractionProposalSchemas },
  },
  nextQuestion: { type: "string", minLength: 1, maxLength: 1_000 },
}));

const reviewFieldId = {
  anyOf: [
    enumSchema([
      ...ONBOARDING_BASE_FIELD_IDS,
      ...countryPreferenceFieldIds,
      ...cityPreferenceFieldIds,
    ]),
    {
      type: "string",
      pattern: `^${PARTICIPANT_FIELD_PREFIX_PATTERN}\\.(?:${PARTICIPANT_LEAF_IDS.join("|")})$`,
    },
  ],
};

export const ONBOARDING_REVIEW_SCHEMA = deepFreeze(exactObject({
  schemaVersion: enumSchema(["onboarding-review-output@1"]),
  issues: {
    type: "array",
    maxItems: 100,
    items: exactObject({
      fieldId: reviewFieldId,
      reasonCode: enumSchema(QUESTIONNAIRE_ISSUE_CODES),
    }),
  },
}));

function proposalSchema(fieldAddress: JsonObject, typedValue: JsonObject): JsonObject {
  return exactObject({ f: fieldAddress, v: typedValue, t: wireEvidence });
}

function wireAddressSchema(predicate: (fieldId: string) => boolean): JsonObject {
  return enumSchema(ONBOARDING_EXTRACTION_WIRE_CODEBOOK
    .filter(({ fieldId }) => predicate(fieldId))
    .map(({ code }) => code));
}

function enumSchema(values: readonly (string | number)[]): JsonObject {
  return {
    type: values.every((value) => typeof value === "number") ? "integer" : "string",
    enum: [...values],
  };
}

function exactObject(properties: Readonly<Record<string, JsonObject>>): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
