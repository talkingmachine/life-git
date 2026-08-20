import { describe, expect, it } from "vitest";

import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  parseLocalExtractionOutput,
  parseLocalReviewOutput,
} from "../../src/decision/onboarding-model-output";

const messageId = "message-1";
const sourceSpan = { start: 0, end: 12 };

function extraction(proposals: unknown[], nextQuestion = "Where would you like to move?") {
  return {
    schemaVersion: "onboarding-model-output@1",
    proposals,
    nextQuestion,
  };
}

function proposal(fieldId: string, typedValue: unknown) {
  return { fieldId, typedValue, messageId, sourceSpan };
}

function expectExtractionRejected(value: unknown) {
  expect(() => parseLocalExtractionOutput(value)).toThrow(TypeError);
}

describe("onboarding model output", () => {
  it("defines the exact country and city preference criterion vocabularies in order", () => {
    expect(COUNTRY_PREFERENCE_IDS).toEqual([
      "outside_cis",
      "europe",
      "personal_safety",
      "infrastructure",
      "peace_and_stability",
    ]);
    expect(CITY_PREFERENCE_IDS).toEqual([
      "safety",
      "long_term_rent",
      "urban_transit",
      "fixed_broadband",
    ]);
  });

  it("accepts every base and participant proposal value form, including explicit zero", () => {
    const value = extraction([
      proposal("current_location", { countryCode: "RU", city: "Moscow" }),
      proposal("move_horizon", "within_3_months"),
      proposal("moving_party", "with_companions"),
      proposal("participants", [
        { descriptor: "self", relationship: "self" },
        { descriptor: "companion.0", relationship: "spouse" },
      ]),
      proposal("savings", { min: "0.5", max: "12000.50", currency: "EUR" }),
      proposal("participants.self.citizenships", ["RU", "RS"]),
      proposal("participants.self.passport", { validUntil: "2030-02-28" }),
      proposal("participants.companion.0.passport", "absent"),
      proposal("participants.self.current_work", {
        status: "employment",
        occupation: "Engineer",
      }),
      proposal("participants.self.remote_continuation", "yes"),
      proposal("participants.self.monthly_income", {
        amount: "0",
        currency: "USD",
        basis: "net",
      }),
      proposal("participants.self.education", { level: "higher", field: "Physics" }),
      proposal("participants.self.relevant_experience_years", 0),
    ]);

    expect(parseLocalExtractionOutput(value)).toEqual(value);
  });

  it("accepts every preference part and exact value grammar", () => {
    const value = extraction([
      proposal("country_preferences.outside_cis.mode", "required"),
      proposal("country_preferences.europe.importance", 1),
      proposal("country_preferences.personal_safety.importance", 5),
      proposal("country_preferences.infrastructure.target", "maximize"),
      proposal("country_preferences.peace_and_stability.target", "required_true"),
      proposal("city_preferences.safety.mode", "weighted"),
      proposal("city_preferences.long_term_rent.importance", 3),
      proposal("city_preferences.urban_transit.target", "Use trams"),
      proposal("city_preferences.fixed_broadband.target", "1 Gbit/s"),
    ]);

    expect(parseLocalExtractionOutput(value)).toEqual(value);
  });

  it("accepts a review containing every closed issue code", () => {
    const value = {
      schemaVersion: "onboarding-review-output@1",
      issues: [
        { fieldId: "current_location", reasonCode: "required_empty" },
        { fieldId: "move_horizon", reasonCode: "invalid_value" },
        { fieldId: "moving_party", reasonCode: "placeholder_value" },
        { fieldId: "participants", reasonCode: "party_mismatch" },
        { fieldId: "participants.self.current_work", reasonCode: "work_mismatch" },
        { fieldId: "savings", reasonCode: "range_mismatch" },
      ],
    };

    expect(parseLocalReviewOutput(value)).toEqual(value);
  });

  it("rejects unknown field identifiers, parts, issue codes, and internal participant IDs", () => {
    expectExtractionRejected(extraction([proposal("unknown", "value")]));
    expectExtractionRejected(extraction([proposal("country_preferences.europe.weight", 3)]));
    expectExtractionRejected(extraction([proposal("participants.participant-7.passport", "absent")]));
    expect(() =>
      parseLocalReviewOutput({
        schemaVersion: "onboarding-review-output@1",
        issues: [{ fieldId: "current_location", reasonCode: "unknown" }],
      }),
    ).toThrow(TypeError);
  });

  it("rejects non-canonical decimals, invalid ISO codes or days, and invalid numbers", () => {
    for (const invalidProposal of [
      proposal("savings", { min: "01", max: "2", currency: "EUR" }),
      proposal("savings", { min: "-1", max: "2", currency: "EUR" }),
      proposal("savings", { min: "1", max: "2", currency: "EURO" }),
      proposal("current_location", { countryCode: "rus", city: "Moscow" }),
      proposal("participants.self.passport", { validUntil: "2030-02-30" }),
      proposal("participants.self.relevant_experience_years", -1),
      proposal("participants.self.relevant_experience_years", Number.NaN),
    ]) {
      expectExtractionRejected(extraction([invalidProposal]));
    }
  });

  it("rejects ambiguous text values and malformed exact object shapes", () => {
    expectExtractionRejected(extraction([proposal("current_location", { countryCode: "RU", city: "не знаю" })]));
    expectExtractionRejected(extraction([proposal("city_preferences.safety.target", " ")]));
    expectExtractionRejected(extraction([proposal("participants.self.current_work", { status: "employment", extra: true })]));
    expectExtractionRejected({ ...extraction([]), unexpected: true });
    expectExtractionRejected(extraction([], ""));
    expect(() =>
      parseLocalReviewOutput({
        schemaVersion: "onboarding-review-output@1",
        issues: [],
        extra: true,
      }),
    ).toThrow(TypeError);
  });

  it("rejects sparse, duplicate, non-dense, and malformed arrays and spans", () => {
    const sparse = [proposal("move_horizon", "within_3_months")] as unknown[];
    sparse[2] = proposal("moving_party", "alone");
    expectExtractionRejected(extraction(sparse));
    expectExtractionRejected(extraction([
      proposal("participants", [
        { descriptor: "self", relationship: "self" },
        { descriptor: "companion.1", relationship: "spouse" },
      ]),
    ]));
    expectExtractionRejected(extraction([
      proposal("participants", [
        { descriptor: "self", relationship: "self" },
        { descriptor: "companion.0", relationship: "spouse" },
        { descriptor: "companion.0", relationship: "other_family" },
      ]),
    ]));
    expectExtractionRejected(extraction([
      { ...proposal("move_horizon", "within_3_months"), sourceSpan: { start: 3.5, end: 4 } },
    ]));
  });
});
