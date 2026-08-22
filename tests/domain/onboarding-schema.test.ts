import { describe, expect, test } from "vitest";

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
  QUESTIONNAIRE_ISSUE_CODES,
  REMOTE_CONTINUATION_VALUES,
  WORK_STATUSES,
} from "../../src/decision/onboarding-catalog";
import {
  OnboardingModelError,
  type OnboardingModelErrorCode,
  type OnboardingModelPort,
  type OnboardingModelVersions,
  type OnboardingRuntimeErrorCode,
} from "../../src/application/onboarding-contracts";
import {
  ONBOARDING_EXTRACTION_SCHEMA,
  ONBOARDING_REVIEW_SCHEMA,
} from "../../src/infrastructure/codex-cli/onboarding-schema";

type Schema = Readonly<Record<string, unknown>>;

function properties(schema: Schema): Readonly<Record<string, Schema>> {
  return schema.properties as Readonly<Record<string, Schema>>;
}

function proposalBranches(): readonly Schema[] {
  const proposals = properties(ONBOARDING_EXTRACTION_SCHEMA).proposals;
  return (proposals.items as Schema).anyOf as readonly Schema[];
}

function issueItem(): Schema {
  const issues = properties(ONBOARDING_REVIEW_SCHEMA).issues;
  return issues.items as Schema;
}

function accepts(schema: Schema, value: unknown): boolean {
  const anyOf = schema.anyOf as readonly Schema[] | undefined;
  if (anyOf !== undefined && !anyOf.some((branch) => accepts(branch, value))) return false;
  const enumValues = schema.enum as readonly unknown[] | undefined;
  if (enumValues !== undefined && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return false;
  }

  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const expectedProperties = properties(schema);
    const required = schema.required as readonly string[];
    if (!required.every((key) => Object.hasOwn(record, key))) return false;
    if (schema.additionalProperties === false &&
      Object.keys(record).some((key) => !Object.hasOwn(expectedProperties, key))) return false;
    return Object.entries(expectedProperties).every(([key, child]) =>
      !Object.hasOwn(record, key) || accepts(child, record[key]));
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      return false;
    }
    return value.every((item) => accepts(schema.items as Schema, item));
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    return typeof schema.pattern !== "string" || new RegExp(schema.pattern).test(value);
  }
  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return false;
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    return typeof schema.maximum !== "number" || value <= schema.maximum;
  }
  return true;
}

function allModelFieldIds(): readonly string[] {
  return [
    ...ONBOARDING_BASE_FIELD_IDS,
    ...PARTICIPANT_LEAF_IDS.map((leafId) => `participants.self.${leafId}`),
    ...COUNTRY_PREFERENCE_IDS.flatMap((id) => [
      `country_preferences.${id}.mode`,
      `country_preferences.${id}.importance`,
      `country_preferences.${id}.target`,
    ]),
    ...CITY_PREFERENCE_IDS.flatMap((id) => [
      `city_preferences.${id}.mode`,
      `city_preferences.${id}.importance`,
      `city_preferences.${id}.target`,
    ]),
  ];
}

function typedValueFor(fieldId: string): unknown {
  if (fieldId === "current_location") return { countryCode: "RU", city: "Moscow" };
  if (fieldId === "move_horizon") return "within_3_months";
  if (fieldId === "moving_party") return "alone";
  if (fieldId === "participants") return [{ descriptor: "self", relationship: "self" }];
  if (fieldId === "savings") return { min: "0", max: "1", currency: "USD" };
  if (fieldId.endsWith(".citizenships")) return ["RU"];
  if (fieldId.endsWith(".passport")) return "absent";
  if (fieldId.endsWith(".current_work")) return { status: "employment" };
  if (fieldId.endsWith(".remote_continuation")) return "yes";
  if (fieldId.endsWith(".monthly_income")) {
    return { amount: "0", currency: "USD", basis: "net" };
  }
  if (fieldId.endsWith(".education")) return { level: "higher" };
  if (fieldId.endsWith(".relevant_experience_years")) return 0;
  if (fieldId.endsWith(".mode")) return "required";
  if (fieldId.endsWith(".importance")) return 1;
  if (fieldId.startsWith("country_preferences.")) return "required_true";
  return "quiet";
}

function extraction(
  fieldId: string,
  typedValue = typedValueFor(fieldId),
): Record<string, unknown> {
  return {
    schemaVersion: "onboarding-model-output@1",
    proposals: [{
      fieldId,
      typedValue,
      messageId: "message-1",
      sourceSpan: { start: 0, end: 1 },
    }],
    nextQuestion: "Что ещё важно?",
  };
}

const STRUCTURED_OUTPUT_KEYWORDS = new Set([
  "type",
  "enum",
  "anyOf",
  "additionalProperties",
  "properties",
  "required",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "items",
  "minimum",
]);

function assertStructuredOutputSubset(schema: Schema): void {
  expect(Object.keys(schema).filter((key) => !STRUCTURED_OUTPUT_KEYWORDS.has(key))).toEqual([]);
  const nestedProperties = schema.properties as Readonly<Record<string, Schema>> | undefined;
  for (const child of Object.values(nestedProperties ?? {})) assertStructuredOutputSubset(child);
  const items = schema.items as Schema | undefined;
  if (items !== undefined) assertStructuredOutputSubset(items);
  for (const branch of (schema.anyOf as readonly Schema[] | undefined) ?? []) {
    assertStructuredOutputSubset(branch);
  }
}

describe("onboarding Codex schemas and contracts", () => {
  test("exports frozen exact schemas with closed roots and typed singleton versions", () => {
    for (const schema of [ONBOARDING_EXTRACTION_SCHEMA, ONBOARDING_REVIEW_SCHEMA]) {
      expect(Object.isFrozen(schema)).toBe(true);
      expect(schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(properties(ONBOARDING_EXTRACTION_SCHEMA).schemaVersion).toEqual({
      type: "string",
      enum: ["onboarding-model-output@1"],
    });
    expect(properties(ONBOARDING_REVIEW_SCHEMA).schemaVersion).toEqual({
      type: "string",
      enum: ["onboarding-review-output@1"],
    });
    expect(Object.isFrozen(proposalBranches())).toBe(true);
    expect((properties(ONBOARDING_EXTRACTION_SCHEMA).proposals.items as Schema).oneOf).toBeUndefined();
  });

  test("uses only the locally proven Structured Outputs keyword subset", () => {
    assertStructuredOutputSubset(ONBOARDING_EXTRACTION_SCHEMA);
    assertStructuredOutputSubset(ONBOARDING_REVIEW_SCHEMA);
  });

  test("covers every closed field family and derives review reasons from the catalog", () => {
    const branches = proposalBranches();
    expect(branches).toHaveLength(18);
    expect(branches.map((branch) => properties(branch).fieldId)).toEqual(expect.arrayContaining([
      { type: "string", enum: ["current_location"] },
      { type: "string", enum: ["move_horizon"] },
      { type: "string", enum: ["moving_party"] },
      { type: "string", enum: ["participants"] },
      { type: "string", enum: ["savings"] },
    ]));

    const reviewProperties = properties(issueItem());
    expect(reviewProperties.reasonCode).toEqual({
      type: "string",
      enum: QUESTIONNAIRE_ISSUE_CODES,
    });
    expect(JSON.stringify(reviewProperties.fieldId)).toContain(COUNTRY_PREFERENCE_IDS[0]);
    expect(JSON.stringify(reviewProperties.fieldId)).toContain(CITY_PREFERENCE_IDS[0]);
  });

  test("accepts every allowlisted field/reason and rejects unknown or mismatched values", () => {
    for (const fieldId of allModelFieldIds()) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, extraction(fieldId)), fieldId).toBe(true);
      expect(accepts(ONBOARDING_REVIEW_SCHEMA, {
        schemaVersion: "onboarding-review-output@1",
        issues: [{ fieldId, reasonCode: "required_empty" }],
      }), fieldId).toBe(true);
    }
    for (const reasonCode of QUESTIONNAIRE_ISSUE_CODES) {
      expect(accepts(ONBOARDING_REVIEW_SCHEMA, {
        schemaVersion: "onboarding-review-output@1",
        issues: [{ fieldId: "current_location", reasonCode }],
      }), reasonCode).toBe(true);
    }
    for (const moveHorizon of MOVE_HORIZONS) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, extraction("move_horizon", moveHorizon))).toBe(true);
    }
    for (const movingParty of MOVING_PARTY_VALUES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, extraction("moving_party", movingParty))).toBe(true);
    }
    for (const relationship of PARTICIPANT_RELATIONSHIPS) {
      const roster = relationship === "self"
        ? [{ descriptor: "self", relationship }]
        : [
            { descriptor: "self", relationship: "self" },
            { descriptor: "companion.0", relationship },
          ];
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, extraction("participants", roster))).toBe(true);
    }
    for (const status of WORK_STATUSES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("participants.self.current_work", { status, occupation: "Engineer" }))).toBe(true);
    }
    for (const continuation of REMOTE_CONTINUATION_VALUES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("participants.self.remote_continuation", continuation))).toBe(true);
    }
    for (const basis of INCOME_BASES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, extraction(
        "participants.self.monthly_income",
        { amount: "1", currency: "USD", basis },
      ))).toBe(true);
    }
    for (const level of EDUCATION_LEVELS) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("participants.self.education", { level, field: "Physics" }))).toBe(true);
    }
    for (const mode of PREFERENCE_MODES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("country_preferences.europe.mode", mode))).toBe(true);
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("city_preferences.safety.mode", mode))).toBe(true);
    }
    for (const importance of PREFERENCE_IMPORTANCES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("country_preferences.europe.importance", importance))).toBe(true);
    }
    for (const target of COUNTRY_PREFERENCE_TARGET_VALUES) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA,
        extraction("country_preferences.europe.target", target))).toBe(true);
    }

    for (const invalid of [
      extraction("invented_field", "anything"),
      extraction("move_horizon", "soon"),
      extraction("participants.self.passport", { validUntil: "tomorrow" }),
      extraction("participants.self.current_work", { status: "employment", extra: true }),
      { ...extraction("moving_party"), extra: true },
      {
        ...extraction("participants"),
        proposals: [{
          fieldId: "participants",
          typedValue: Array.from({ length: 21 }, (_, index) => ({
            descriptor: index === 0 ? "self" : `companion.${index - 1}`,
            relationship: index === 0 ? "self" : "other_family",
          })),
          messageId: "message-1",
          sourceSpan: { start: 0, end: 1 },
        }],
      },
    ]) {
      expect(accepts(ONBOARDING_EXTRACTION_SCHEMA, invalid)).toBe(false);
    }
    for (const invalid of [
      { schemaVersion: "onboarding-review-output@1", issues: [{ fieldId: "invented", reasonCode: "required_empty" }] },
      { schemaVersion: "onboarding-review-output@1", issues: [{ fieldId: "current_location", reasonCode: "invented" }] },
      { schemaVersion: "onboarding-review-output@1", issues: [], extra: true },
    ]) {
      expect(accepts(ONBOARDING_REVIEW_SCHEMA, invalid)).toBe(false);
    }
  });

  test("pins the application-facing model contract without depending on Infrastructure", () => {
    const versions: OnboardingModelVersions = {
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@1",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-model-output@1",
      reviewSchema: "onboarding-review-output@1",
    };
    const model = { versions } as OnboardingModelPort;
    expect(model.versions).toEqual(versions);

    const modelCode: OnboardingModelErrorCode = "onboarding_model_runtime_failed";
    const runtimeCode: OnboardingRuntimeErrorCode = "codex_process_failed";
    const error = new OnboardingModelError(modelCode, runtimeCode);
    expect(error).toMatchObject({
      name: "OnboardingModelError",
      code: modelCode,
      runtimeCode,
      message: modelCode,
    });
    expect(Object.hasOwn(error, "cause")).toBe(false);
  });
});
