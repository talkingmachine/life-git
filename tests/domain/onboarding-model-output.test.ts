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

  it.each([
    ["AU", "XOF"],
    ["AX", "BOV"],
    ["AQ", "CHE"],
    ["US", "XCG"],
  ])("accepts assigned country and currency code %s / %s", (countryCode, currency) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("current_location", { countryCode, city: "Harbor" }),
      proposal("savings", { min: "0", max: "1", currency }),
    ]))).toBeDefined();
  });

  it.each([
    proposal("current_location", { countryCode: "ZZ", city: "Nowhere" }),
    proposal("savings", { min: "0", max: "1", currency: "ZZZ" }),
  ])("rejects shaped but unassigned ISO proposal %#", (invalidProposal) => {
    expectExtractionRejected(extraction([invalidProposal]));
  });

  it.each([
    "within_3_months",
    "3_to_6_months",
    "6_to_12_months",
    "more_than_12_months",
  ])("accepts move horizon %s", (moveHorizon) => {
    expect(parseLocalExtractionOutput(extraction([proposal("move_horizon", moveHorizon)]))).toBeDefined();
  });

  it.each(["alone", "with_companions"])("accepts moving party %s", (movingParty) => {
    expect(parseLocalExtractionOutput(extraction([proposal("moving_party", movingParty)]))).toBeDefined();
  });

  it.each(["spouse", "minor_child", "other_family"])("accepts companion relationship %s", (relationship) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("participants", [
        { descriptor: "self", relationship: "self" },
        { descriptor: "companion.0", relationship },
      ]),
    ]))).toBeDefined();
  });

  it.each(["not_working", "employment", "self_employment", "contract_service", "other"])(
    "accepts work status %s with and without optional occupation",
    (status) => {
      expect(parseLocalExtractionOutput(extraction([
        proposal("participants.self.current_work", { status }),
      ]))).toBeDefined();
      expect(parseLocalExtractionOutput(extraction([
        proposal("participants.self.current_work", { status, occupation: "Writer" }),
      ]))).toBeDefined();
    },
  );

  it.each(["yes", "no"])("accepts remote continuation %s", (continuation) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("participants.self.remote_continuation", continuation),
    ]))).toBeDefined();
  });

  it.each(["net", "gross"])("accepts income basis %s", (basis) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("participants.self.monthly_income", { amount: "1", currency: "USD", basis }),
    ]))).toBeDefined();
  });

  it.each(["none", "secondary", "vocational", "higher"])(
    "accepts education level %s with and without optional field",
    (level) => {
      expect(parseLocalExtractionOutput(extraction([
        proposal("participants.self.education", { level }),
      ]))).toBeDefined();
      expect(parseLocalExtractionOutput(extraction([
        proposal("participants.self.education", { level, field: "Mathematics" }),
      ]))).toBeDefined();
    },
  );

  it.each(["absent", { validUntil: "0096-02-29" }, { validUntil: "0100-02-28" }])(
    "accepts passport value %#",
    (passport) => {
      expect(parseLocalExtractionOutput(extraction([
        proposal("participants.self.passport", passport),
      ]))).toBeDefined();
    },
  );

  it.each(["required", "weighted"])("accepts each preference mode %s for country and city", (mode) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("country_preferences.europe.mode", mode),
      proposal("city_preferences.safety.mode", mode),
    ]))).toBeDefined();
  });

  it.each([1, 2, 3, 4, 5])("accepts preference importance %i for country and city", (importance) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("country_preferences.europe.importance", importance),
      proposal("city_preferences.safety.importance", importance),
    ]))).toBeDefined();
  });

  it.each(["required_true", "maximize"])("accepts country target %s", (target) => {
    expect(parseLocalExtractionOutput(extraction([
      proposal("country_preferences.europe.target", target),
    ]))).toBeDefined();
  });

  it("accepts every country and city field identifier", () => {
    const countryProposals = COUNTRY_PREFERENCE_IDS.flatMap((criterion) => [
      proposal(`country_preferences.${criterion}.mode`, "weighted"),
      proposal(`country_preferences.${criterion}.importance`, 3),
      proposal(`country_preferences.${criterion}.target`, "maximize"),
    ]);
    const cityProposals = CITY_PREFERENCE_IDS.flatMap((criterion) => [
      proposal(`city_preferences.${criterion}.mode`, "weighted"),
      proposal(`city_preferences.${criterion}.importance`, 3),
      proposal(`city_preferences.${criterion}.target`, "Fast internet"),
    ]);

    expect(parseLocalExtractionOutput(extraction([...countryProposals, ...cityProposals]))).toBeDefined();
  });

  it("enforces text and array bounds at their inclusive limits", () => {
    const rosterAtLimit = [
      { descriptor: "self", relationship: "self" },
      ...Array.from({ length: 99 }, (_, index) => ({
        descriptor: `companion.${index}`,
        relationship: "other_family",
      })),
    ];
    expect(parseLocalExtractionOutput(extraction([
      proposal("current_location", { countryCode: "RU", city: "x".repeat(1_000) }),
      proposal("participants", rosterAtLimit),
    ], "q".repeat(1_000)))).toBeDefined();

    expectExtractionRejected(extraction([
      proposal("current_location", { countryCode: "RU", city: "x".repeat(1_001) }),
    ]));
    expectExtractionRejected(extraction([], "q".repeat(1_001)));
    expectExtractionRejected(extraction([
      { ...proposal("move_horizon", "within_3_months"), messageId: "m".repeat(201) },
    ]));
    expectExtractionRejected(extraction([
      proposal("participants", [
        ...rosterAtLimit,
        { descriptor: "companion.99", relationship: "other_family" },
      ]),
    ]));
  });

  it("rejects duplicate fields and missing or extra nested keys", () => {
    expectExtractionRejected(extraction([
      proposal("move_horizon", "within_3_months"),
      proposal("move_horizon", "3_to_6_months"),
    ]));
    expectExtractionRejected(extraction([
      proposal("participants.self.citizenships", ["RU", "RU"]),
    ]));
    expectExtractionRejected(extraction([
      proposal("current_location", { countryCode: "RU" }),
    ]));
    expectExtractionRejected(extraction([
      proposal("savings", { min: "0", max: "1", currency: "EUR", extra: true }),
    ]));
    expectExtractionRejected(extraction([
      proposal("participants.self.passport", {}),
    ]));
    expectExtractionRejected(extraction([
      proposal("participants", [{ descriptor: "self" }]),
    ]));
    expect(() => parseLocalReviewOutput({
      schemaVersion: "onboarding-review-output@1",
      issues: [
        { fieldId: "current_location", reasonCode: "required_empty" },
        { fieldId: "current_location", reasonCode: "invalid_value" },
      ],
    })).toThrow(TypeError);
  });

  it.each([
    { start: -1, end: 0 },
    { start: 1.5, end: 2 },
    { start: 2, end: 1 },
    { start: Number.NaN, end: 2 },
    { start: 0 },
    { start: 0, end: 1, extra: true },
  ])("rejects malformed span %#", (invalidSpan) => {
    expectExtractionRejected(extraction([
      { ...proposal("move_horizon", "within_3_months"), sourceSpan: invalidSpan },
    ]));
  });

  it("rejects sparse and decorated arrays", () => {
    const sparseCitizenships = ["RU"] as unknown[];
    sparseCitizenships[2] = "RS";
    const decoratedIssues = [{ fieldId: "current_location", reasonCode: "required_empty" }];
    Object.assign(decoratedIssues, { extra: true });

    expectExtractionRejected(extraction([
      proposal("participants.self.citizenships", sparseCitizenships),
    ]));
    expect(() => parseLocalReviewOutput({
      schemaVersion: "onboarding-review-output@1",
      issues: decoratedIssues,
    })).toThrow(TypeError);
  });

  it("rejects JSON own __proto__, accessors, symbols, and custom prototypes without invoking getters", () => {
    const locationWithProto = JSON.parse('{"countryCode":"RU","city":"Moscow","__proto__":{}}');
    const locationWithGetter = Object.defineProperty({ countryCode: "RU" }, "city", {
      enumerable: true,
      get: () => {
        throw new Error("getter was invoked");
      },
    });
    const locationWithSymbol = { countryCode: "RU", city: "Moscow", [Symbol("extra")]: true };
    const inheritedLocation = Object.assign(Object.create({ inherited: true }), {
      countryCode: "RU",
      city: "Moscow",
    });

    for (const location of [locationWithProto, locationWithGetter, locationWithSymbol, inheritedLocation]) {
      expectExtractionRejected(extraction([proposal("current_location", location)]));
    }
  });

  it.each(["2030-01-00", "0100-02-29", "0099-02-29", "2023-02-29"])("rejects non-leap canonical day %s", (validUntil) => {
    expectExtractionRejected(extraction([
      proposal("participants.self.passport", { validUntil }),
    ]));
  });
});
