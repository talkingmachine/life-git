import {
  assertCanonicalOnboardingFieldOrderForDecision,
  cloneOnboardingFieldValueForDecision,
  parseOnboardingFieldIdForDecision,
  type OnboardingDraft,
  type OnboardingFieldId,
  type OnboardingFieldValue,
} from "./onboarding-questionnaire";

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

const MAX_FIELDS = 172;

export function deriveQuestionnaireProvenance(draft: OnboardingDraft): QuestionnaireProvenance {
  const fields = draft.fields.map((field): QuestionnaireProvenanceEntry => {
    if (field.applicability === "not_applicable") {
      return {
        fieldId: field.fieldId,
        applicability: "not_applicable",
        origin: "empty",
        reviewState: "not_applicable",
      };
    }
    if (field.normalizedValue === null) throw invalidProvenance();
    if (field.overwrite === null) {
      return {
        fieldId: field.fieldId,
        applicability: "required",
        origin: field.origin,
        reviewState: "accepted",
      };
    }
    return {
      fieldId: field.fieldId,
      applicability: "required",
      origin: field.origin,
      reviewState: field.overwrite.reviewState,
      previousValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.overwrite.previousValue),
      proposedValue: cloneOnboardingFieldValueForDecision(field.fieldId, field.overwrite.proposedValue),
      reasonCode: "explicit_new_information",
    } as QuestionnaireProvenanceEntry;
  });
  return deepFreeze({ schemaVersion: "onboarding-provenance@1", fields });
}

export function reconstructQuestionnaireProvenance(value: unknown): QuestionnaireProvenance {
  const provenance = exactRecord(value, ["schemaVersion", "fields"]);
  if (provenance.schemaVersion !== "onboarding-provenance@1") throw invalidProvenance();
  const fields = denseArray(provenance.fields, MAX_FIELDS).map(parseEntry);
  assertUnique(fields.map(({ fieldId }) => fieldId));
  assertCanonicalOnboardingFieldOrderForDecision(fields.map(({ fieldId }) => fieldId));
  return deepFreeze({ schemaVersion: "onboarding-provenance@1", fields });
}

function parseEntry(value: unknown): QuestionnaireProvenanceEntry {
  const record = snapshotRecord(value);
  if (record === null) throw invalidProvenance();
  const fieldId = parseOnboardingFieldIdForDecision(record.fieldId);
  if (record.applicability === "not_applicable") {
    requireExactKeys(record, ["fieldId", "applicability", "origin", "reviewState"]);
    if (record.origin !== "empty" || record.reviewState !== "not_applicable") throw invalidProvenance();
    return { fieldId, applicability: "not_applicable", origin: "empty", reviewState: "not_applicable" };
  }
  if (record.applicability !== "required") throw invalidProvenance();
  if (record.reviewState === "accepted") {
    requireExactKeys(record, ["fieldId", "applicability", "origin", "reviewState"]);
    if (record.origin !== "manual" && record.origin !== "model") throw invalidProvenance();
    return { fieldId, applicability: "required", origin: record.origin, reviewState: "accepted" };
  }
  requireExactKeys(record, [
    "fieldId",
    "applicability",
    "origin",
    "reviewState",
    "previousValue",
    "proposedValue",
    "reasonCode",
  ]);
  if (record.reasonCode !== "explicit_new_information") throw invalidProvenance();
  if (
    record.reviewState !== "model_overwrite_unreviewed" &&
    record.reviewState !== "model_overwrite_confirmed" &&
    record.reviewState !== "model_overwrite_reverted"
  ) throw invalidProvenance();
  const expectedOrigin = record.reviewState === "model_overwrite_reverted" ? "manual" : "model";
  if (record.origin !== expectedOrigin) throw invalidProvenance();
  return {
    fieldId,
    applicability: "required",
    origin: expectedOrigin,
    reviewState: record.reviewState,
    previousValue: cloneOnboardingFieldValueForDecision(fieldId, record.previousValue),
    proposedValue: cloneOnboardingFieldValueForDecision(fieldId, record.proposedValue),
    reasonCode: "explicit_new_information",
  } as QuestionnaireProvenanceEntry;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = snapshotRecord(value);
  if (record === null) throw invalidProvenance();
  requireExactKeys(record, keys);
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
  ) {
    throw invalidProvenance();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalidProvenance();
    result.push(descriptor.value);
  }
  const expectedPropertyNames = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !expectedPropertyNames.has(key))) throw invalidProvenance();
  return result;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => key in record)) throw invalidProvenance();
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalidProvenance();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalidProvenance(): TypeError {
  return new TypeError("Invalid onboarding provenance");
}
