import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  type CurrentLocationValue,
  type CurrentWorkValue,
  type EducationValue,
  type LocalExtractionResult,
  type LocalReviewResult,
  type MonthlyIncomeValue,
  type OnboardingModelFieldId,
  type ParsedLocalFieldProposal,
  type ParticipantDescriptor,
  type ParticipantRosterProposal,
  type PassportValue,
  type PreferenceImportance,
  type PreferenceMode,
  type QuestionnaireIssueCode,
  type SavingsValue,
} from "./onboarding-catalog";
import { isCanonicalDay, isCanonicalDecimal, isIsoCountryCode, isIsoCurrencyCode } from "./iso-codes";

export { CITY_PREFERENCE_IDS, COUNTRY_PREFERENCE_IDS } from "./onboarding-catalog";
export type * from "./onboarding-catalog";

const MAX_ARRAY_LENGTH = 100;
const MAX_TEXT_LENGTH = 1_000;
const MAX_MESSAGE_ID_LENGTH = 200;
const MAX_QUESTION_LENGTH = 1_000;
const UNKNOWN_TEXT = new Set(["не знаю", "неизвестно", "unknown", "n/a", "na"]);
const ISSUE_CODES = new Set<QuestionnaireIssueCode>([
  "required_empty",
  "invalid_value",
  "placeholder_value",
  "party_mismatch",
  "work_mismatch",
  "range_mismatch",
]);
const MOVE_HORIZONS = new Set(["within_3_months", "3_to_6_months", "6_to_12_months", "more_than_12_months"]);
const MOVING_PARTIES = new Set(["alone", "with_companions"]);
const WORK_STATUSES = new Set(["not_working", "employment", "self_employment", "contract_service", "other"]);
const EDUCATION_LEVELS = new Set(["none", "secondary", "vocational", "higher"]);
const RELATIONSHIPS = new Set(["self", "spouse", "minor_child", "other_family"]);

type JsonRecord = Record<string, unknown>;
type FieldValueParser = (value: unknown) => unknown;

export function parseLocalExtractionOutput(value: unknown): LocalExtractionResult {
  const output = exactRecord(value, ["schemaVersion", "proposals", "nextQuestion"]);
  if (output.schemaVersion !== "onboarding-model-output@1") {
    throw invalidOutput();
  }

  const proposals = denseArray(output.proposals, MAX_ARRAY_LENGTH).map(parseProposal);
  assertUnique(proposals.map(({ fieldId }) => fieldId));

  return {
    schemaVersion: "onboarding-model-output@1",
    proposals,
    nextQuestion: boundedText(output.nextQuestion, MAX_QUESTION_LENGTH),
  };
}

export function parseLocalReviewOutput(value: unknown): LocalReviewResult {
  const output = exactRecord(value, ["schemaVersion", "issues"]);
  if (output.schemaVersion !== "onboarding-review-output@1") {
    throw invalidOutput();
  }

  const issues = denseArray(output.issues, MAX_ARRAY_LENGTH).map(parseIssue);
  assertUnique(issues.map(({ fieldId }) => fieldId));

  return { schemaVersion: "onboarding-review-output@1", issues };
}

function parseProposal(value: unknown): ParsedLocalFieldProposal {
  const proposal = exactRecord(value, ["fieldId", "typedValue", "messageId", "sourceSpan"]);
  const fieldId = parseFieldId(proposal.fieldId);
  const parser = fieldValueParser(fieldId);

  return {
    fieldId,
    typedValue: parser(proposal.typedValue),
    messageId: boundedText(proposal.messageId, MAX_MESSAGE_ID_LENGTH),
    sourceSpan: parseSourceSpan(proposal.sourceSpan),
  } as ParsedLocalFieldProposal;
}

function parseIssue(value: unknown): { fieldId: OnboardingModelFieldId; reasonCode: QuestionnaireIssueCode } {
  const issue = exactRecord(value, ["fieldId", "reasonCode"]);
  const fieldId = parseFieldId(issue.fieldId);
  if (typeof issue.reasonCode !== "string" || !ISSUE_CODES.has(issue.reasonCode as QuestionnaireIssueCode)) {
    throw invalidOutput();
  }

  return { fieldId, reasonCode: issue.reasonCode as QuestionnaireIssueCode };
}

function parseSourceSpan(value: unknown): { start: number; end: number } {
  const span = exactRecord(value, ["start", "end"]);
  if (!isNonNegativeInteger(span.start) || !isNonNegativeInteger(span.end) || span.end < span.start) {
    throw invalidOutput();
  }

  return { start: span.start, end: span.end };
}

function fieldValueParser(fieldId: OnboardingModelFieldId): FieldValueParser {
  if (fieldId === "current_location") return parseCurrentLocation;
  if (fieldId === "move_horizon") return parseMoveHorizon;
  if (fieldId === "moving_party") return parseMovingParty;
  if (fieldId === "participants") return parseParticipants;
  if (fieldId === "savings") return parseSavings;
  if (fieldId.endsWith(".citizenships")) return parseCitizenships;
  if (fieldId.endsWith(".passport")) return parsePassport;
  if (fieldId.endsWith(".current_work")) return parseCurrentWork;
  if (fieldId.endsWith(".remote_continuation")) return parseRemoteContinuation;
  if (fieldId.endsWith(".monthly_income")) return parseMonthlyIncome;
  if (fieldId.endsWith(".education")) return parseEducation;
  if (fieldId.endsWith(".relevant_experience_years")) return parseExperienceYears;
  if (fieldId.endsWith(".mode")) return parsePreferenceMode;
  if (fieldId.endsWith(".importance")) return parsePreferenceImportance;
  if (fieldId.startsWith("country_preferences.")) return parseCountryPreferenceTarget;
  return parseCityPreferenceTarget;
}

function parseFieldId(value: unknown): OnboardingModelFieldId {
  if (typeof value !== "string") {
    throw invalidOutput();
  }
  if (["current_location", "move_horizon", "moving_party", "participants", "savings"].includes(value)) {
    return value as OnboardingModelFieldId;
  }

  const participant = /^participants\.(self|companion\.(?:0|[1-9][0-9]*))\.(citizenships|passport|current_work|remote_continuation|monthly_income|education|relevant_experience_years)$/.exec(value);
  if (participant !== null) return value as OnboardingModelFieldId;

  const countryPreference = /^country_preferences\.([a-z_]+)\.(mode|importance|target)$/.exec(value);
  if (countryPreference !== null && COUNTRY_PREFERENCE_IDS.includes(countryPreference[1] as (typeof COUNTRY_PREFERENCE_IDS)[number])) {
    return value as OnboardingModelFieldId;
  }

  const cityPreference = /^city_preferences\.([a-z_]+)\.(mode|importance|target)$/.exec(value);
  if (cityPreference !== null && CITY_PREFERENCE_IDS.includes(cityPreference[1] as (typeof CITY_PREFERENCE_IDS)[number])) {
    return value as OnboardingModelFieldId;
  }

  throw invalidOutput();
}

function parseCurrentLocation(value: unknown): CurrentLocationValue {
  const location = exactRecord(value, ["countryCode", "city"]);
  if (!isIsoCountryCode(location.countryCode)) throw invalidOutput();
  return { countryCode: location.countryCode, city: boundedText(location.city, MAX_TEXT_LENGTH) };
}

function parseMoveHorizon(value: unknown) {
  if (typeof value !== "string" || !MOVE_HORIZONS.has(value)) throw invalidOutput();
  return value;
}

function parseMovingParty(value: unknown) {
  if (typeof value !== "string" || !MOVING_PARTIES.has(value)) throw invalidOutput();
  return value;
}

function parseParticipants(value: unknown): readonly ParticipantRosterProposal[] {
  const roster = denseArray(value, MAX_ARRAY_LENGTH).map((entry) => {
    const participant = exactRecord(entry, ["descriptor", "relationship"]);
    const descriptor = parseParticipantDescriptor(participant.descriptor);
    if (typeof participant.relationship !== "string" || !RELATIONSHIPS.has(participant.relationship)) {
      throw invalidOutput();
    }
    return { descriptor, relationship: participant.relationship as ParticipantRosterProposal["relationship"] };
  });

  if (roster.length === 0 || roster[0].descriptor !== "self" || roster[0].relationship !== "self") {
    throw invalidOutput();
  }
  if (roster.some(({ descriptor }, index) => descriptor !== (index === 0 ? "self" : `companion.${index - 1}`))) {
    throw invalidOutput();
  }

  return roster;
}

function parseCitizenships(value: unknown): readonly string[] {
  const citizenships = denseArray(value, MAX_ARRAY_LENGTH).map((country) => {
    if (!isIsoCountryCode(country)) throw invalidOutput();
    return country;
  });
  if (citizenships.length === 0) throw invalidOutput();
  assertUnique(citizenships);
  return citizenships;
}

function parsePassport(value: unknown): PassportValue {
  if (value === "absent") return value;
  const passport = exactRecord(value, ["validUntil"]);
  if (!isCanonicalDay(passport.validUntil)) throw invalidOutput();
  return { validUntil: passport.validUntil };
}

function parseCurrentWork(value: unknown): CurrentWorkValue {
  const work = optionalRecord(value, ["status", "occupation"], ["status"]);
  if (typeof work.status !== "string" || !WORK_STATUSES.has(work.status)) throw invalidOutput();
  if ("occupation" in work && work.occupation === undefined) throw invalidOutput();
  const occupation = work.occupation === undefined ? undefined : boundedText(work.occupation, MAX_TEXT_LENGTH);
  return occupation === undefined
    ? { status: work.status as CurrentWorkValue["status"] }
    : { status: work.status as CurrentWorkValue["status"], occupation };
}

function parseRemoteContinuation(value: unknown) {
  if (value !== "yes" && value !== "no") throw invalidOutput();
  return value;
}

function parseMonthlyIncome(value: unknown): MonthlyIncomeValue {
  const income = exactRecord(value, ["amount", "currency", "basis"]);
  if (!isCanonicalDecimal(income.amount) || !isIsoCurrencyCode(income.currency)) throw invalidOutput();
  if (income.basis !== "net" && income.basis !== "gross") throw invalidOutput();
  return { amount: income.amount, currency: income.currency, basis: income.basis };
}

function parseSavings(value: unknown): SavingsValue {
  const savings = exactRecord(value, ["min", "max", "currency"]);
  if (!isCanonicalDecimal(savings.min) || !isCanonicalDecimal(savings.max) || !isIsoCurrencyCode(savings.currency)) {
    throw invalidOutput();
  }
  return { min: savings.min, max: savings.max, currency: savings.currency };
}

function parseEducation(value: unknown): EducationValue {
  const education = optionalRecord(value, ["level", "field"], ["level"]);
  if (typeof education.level !== "string" || !EDUCATION_LEVELS.has(education.level)) throw invalidOutput();
  if ("field" in education && education.field === undefined) throw invalidOutput();
  const field = education.field === undefined ? undefined : boundedText(education.field, MAX_TEXT_LENGTH);
  return field === undefined
    ? { level: education.level as EducationValue["level"] }
    : { level: education.level as EducationValue["level"], field };
}

function parseExperienceYears(value: unknown): number {
  if (!isNonNegativeInteger(value)) throw invalidOutput();
  return value;
}

function parsePreferenceMode(value: unknown): PreferenceMode {
  if (value !== "required" && value !== "weighted") throw invalidOutput();
  return value;
}

function parsePreferenceImportance(value: unknown): PreferenceImportance {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw invalidOutput();
  }
  return value as PreferenceImportance;
}

function parseCountryPreferenceTarget(value: unknown): "required_true" | "maximize" {
  if (value !== "required_true" && value !== "maximize") throw invalidOutput();
  return value;
}

function parseCityPreferenceTarget(value: unknown): string {
  return boundedText(value, MAX_TEXT_LENGTH);
}

function parseParticipantDescriptor(value: unknown): ParticipantDescriptor {
  if (value === "self" || (typeof value === "string" && /^companion\.(?:0|[1-9][0-9]*)$/.test(value))) {
    return value as ParticipantDescriptor;
  }
  throw invalidOutput();
}

function boundedText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) throw invalidOutput();
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  if (value.trim().length === 0 || UNKNOWN_TEXT.has(normalized)) throw invalidOutput();
  return value;
}

function exactRecord(value: unknown, keys: readonly string[]): JsonRecord {
  const record = snapshotRecord(value);
  if (record === null || !hasExactKeys(record, keys)) throw invalidOutput();
  return record;
}

function optionalRecord(value: unknown, keys: readonly string[], requiredKeys: readonly string[]): JsonRecord {
  const record = snapshotRecord(value);
  if (record === null || !hasOnlyKeys(record, keys) || !requiredKeys.every((key) => key in record)) {
    throw invalidOutput();
  }
  return record;
}

function snapshotRecord(value: unknown): JsonRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null) as JsonRecord;
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
  ) {
    throw invalidOutput();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!hasOnlyKeys(descriptors, [...Array.from({ length: value.length }, (_, index) => String(index)), "length"])) {
    throw invalidOutput();
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalidOutput();
    result.push(descriptor.value);
  }
  return result;
}

function hasExactKeys(record: JsonRecord, keys: readonly string[]): boolean {
  return hasOnlyKeys(record, keys) && keys.every((key) => key in record);
}

function hasOnlyKeys(record: object, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.every((key) => keys.includes(key));
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalidOutput();
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalidOutput(): TypeError {
  return new TypeError("Invalid onboarding model output");
}
