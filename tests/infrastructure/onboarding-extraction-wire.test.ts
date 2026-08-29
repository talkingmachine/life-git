import { types } from "node:util";

import { describe, expect, test, vi } from "vitest";

import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
  ONBOARDING_MODEL_VERSIONS_V3,
  ONBOARDING_MODEL_VERSIONS_V4,
  ONBOARDING_MODEL_VERSIONS_V5,
  ONBOARDING_MODEL_VERSIONS_V6,
  ONBOARDING_MODEL_VERSIONS_V7,
  ONBOARDING_MODEL_VERSIONS_V8,
  ONBOARDING_MODEL_VERSIONS_V9,
  reconstructOnboardingModelVersions,
} from "../../src/application/onboarding-model-versions";
import {
  decodeOnboardingExtractionWire,
  ONBOARDING_EXTRACTION_WIRE_ALGEBRA,
  ONBOARDING_EXTRACTION_WIRE_CODEBOOK,
} from "../../src/infrastructure/codex-cli/onboarding-extraction-wire";

const MESSAGE_ID = "20000000-0000-4000-8000-000000000001";

const BASE_FIELDS = [
  "current_location",
  "move_horizon",
  "moving_party",
  "participants",
  "savings",
] as const;
const PARTICIPANT_LEAVES = [
  "citizenships",
  "passport",
  "current_work",
  "remote_continuation",
  "monthly_income",
  "education",
  "relevant_experience_years",
] as const;
const COUNTRY_CRITERIA = [
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
] as const;
const CITY_CRITERIA = [
  "safety",
  "long_term_rent",
  "urban_transit",
  "fixed_broadband",
] as const;
const PREFERENCE_PARTS = ["mode", "importance", "target"] as const;

const EXPECTED_ALGEBRA = [
  "Address algebra (all indices are zero-based ASCII decimal with no leading zeroes; + is string concatenation):",
  "B=[current_location,move_horizon,moving_party,participants,savings];",
  "L=[citizenships,passport,current_work,remote_continuation,monthly_income,education,relevant_experience_years];",
  "K=[outside_cis,europe,personal_safety,infrastructure,peace_and_stability];",
  "C=[safety,long_term_rent,urban_transit,fixed_broadband];",
  "P=[mode,importance,target].",
  "decode(\"b\"+N)=B[N], N=0..4.",
  "participant(0)=\"self\"; participant(D)=\"companion.\"+(D-1), D=1..19.",
  "decode(\"p\"+D+\".\"+J)=\"participants.\"+participant(D)+\".\"+L[J], D=0..19,J=0..6.",
  "decode(\"k\"+I+\".\"+J)=\"country_preferences.\"+K[I]+\".\"+P[J], I=0..4,J=0..2.",
  "decode(\"c\"+I+\".\"+J)=\"city_preferences.\"+C[I]+\".\"+P[J], I=0..3,J=0..2.",
  "No other f is valid.",
].join("\n");

const EXPECTED_CODEBOOK = Object.freeze([
  ...BASE_FIELDS.map((fieldId, index) => ({ code: `b${index}`, fieldId })),
  ...Array.from({ length: 20 }, (_, descriptorIndex) =>
    PARTICIPANT_LEAVES.map((leaf, leafIndex) => ({
      code: `p${descriptorIndex}.${leafIndex}`,
      fieldId: `participants.${descriptorIndex === 0 ? "self" : `companion.${descriptorIndex - 1}`}.${leaf}`,
    }))).flat(),
  ...COUNTRY_CRITERIA.flatMap((criterion, criterionIndex) =>
    PREFERENCE_PARTS.map((part, partIndex) => ({
      code: `k${criterionIndex}.${partIndex}`,
      fieldId: `country_preferences.${criterion}.${part}`,
    }))),
  ...CITY_CRITERIA.flatMap((criterion, criterionIndex) =>
    PREFERENCE_PARTS.map((part, partIndex) => ({
      code: `c${criterionIndex}.${partIndex}`,
      fieldId: `city_preferences.${criterion}.${part}`,
    }))),
]);

function wire(proposals: readonly unknown[]): Record<string, unknown> {
  return {
    schemaVersion: "onboarding-extraction-wire@3",
    proposals,
    nextQuestion: "Что ещё важно?",
  };
}

function proposal(f: string, v: unknown, t = "evidence"): Record<string, unknown> {
  return { f, v, t };
}

function decode(value: unknown, messageId = MESSAGE_ID, messageText = "evidence") {
  return decodeOnboardingExtractionWire({ value, messageId, messageText });
}

function expectInvalid(value: unknown, messageId = MESSAGE_ID, messageText = "evidence"): void {
  expect(() => decode(value, messageId, messageText)).toThrow();
}

function allTypedFamilies(): readonly Record<string, unknown>[] {
  return [
    proposal("b0", { countryCode: "RS", city: "Белград" }, "[e0]"),
    proposal("b1", "within_3_months", "[e1]"),
    proposal("b2", "with_companions", "[e2]"),
    proposal("b3", [
      { descriptor: "self", relationship: "self" },
      { descriptor: "companion.0", relationship: "spouse" },
      ...Array.from({ length: 18 }, (_, index) => ({
        descriptor: `companion.${index + 1}`,
        relationship: "other_family",
      })),
    ], "[e3]"),
    proposal("b4", { min: "1000", max: "2000.50", currency: "USD" }, "[e4]"),
    proposal("p0.0", ["RU", "RS"], "[e5]"),
    proposal("p0.1", { validUntil: "2030-01-31" }, "[e6]"),
    proposal("p0.2", { status: "employment", occupation: "Инженер" }, "[e7]"),
    proposal("p0.3", "yes", "[e8]"),
    proposal("p0.4", { amount: "3000", currency: "USD", basis: "net" }, "[e9]"),
    proposal("p0.5", { level: "higher", field: "Physics" }, "[e10]"),
    proposal("p0.6", 7, "[e11]"),
    proposal("k0.0", "required", "[e12]"),
    proposal("k0.1", 5, "[e13]"),
    proposal("k0.2", "required_true", "[e14]"),
    proposal("c0.0", "weighted", "[e15]"),
    proposal("c0.1", 4, "[e16]"),
    proposal("c0.2", "тихий район", "[e17]"),
  ];
}

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

describe("onboarding extraction wire codebook", () => {
  test("pins the exact generated address algebra and byte length", () => {
    expect(ONBOARDING_EXTRACTION_WIRE_ALGEBRA).toBe(EXPECTED_ALGEBRA);
    expect(new TextEncoder().encode(ONBOARDING_EXTRACTION_WIRE_ALGEBRA)).toHaveLength(785);
  });

  test("pins all 172 injective catalog addresses and their ordinal boundaries", () => {
    expect(ONBOARDING_EXTRACTION_WIRE_CODEBOOK).toEqual(EXPECTED_CODEBOOK);
    expect(ONBOARDING_EXTRACTION_WIRE_CODEBOOK).toHaveLength(172);
    expect(new Set(ONBOARDING_EXTRACTION_WIRE_CODEBOOK.map(({ code }) => code)).size).toBe(172);
    expect(new Set(ONBOARDING_EXTRACTION_WIRE_CODEBOOK.map(({ fieldId }) => fieldId)).size).toBe(172);
    expect(ONBOARDING_EXTRACTION_WIRE_CODEBOOK).toContainEqual({
      code: "p0.0",
      fieldId: "participants.self.citizenships",
    });
    expect(ONBOARDING_EXTRACTION_WIRE_CODEBOOK).toContainEqual({
      code: "p19.6",
      fieldId: "participants.companion.18.relevant_experience_years",
    });
    expect(Object.isFrozen(ONBOARDING_EXTRACTION_WIRE_CODEBOOK)).toBe(true);
    for (const entry of ONBOARDING_EXTRACTION_WIRE_CODEBOOK) expect(Object.isFrozen(entry)).toBe(true);
  });

  const CATALOG_PROBES = [
    ["ONBOARDING_BASE_FIELD_IDS", "current_location_v3_probe", "B=[current_location_v3_probe,", "b0", "current_location_v3_probe"],
    ["PARTICIPANT_LEAF_IDS", "citizenships_v3_probe", "L=[citizenships_v3_probe,", "p0.0", "participants.self.citizenships_v3_probe"],
    ["COUNTRY_PREFERENCE_IDS", "outside_cis_v3_probe", "K=[outside_cis_v3_probe,", "k0.0", "country_preferences.outside_cis_v3_probe.mode"],
    ["CITY_PREFERENCE_IDS", "safety_v3_probe", "C=[safety_v3_probe,", "c0.0", "city_preferences.safety_v3_probe.mode"],
    ["PREFERENCE_PARTS", "mode_v3_probe", "P=[mode_v3_probe,", "k0.0", "country_preferences.outside_cis.mode_v3_probe"],
  ] as const;

  test.each(CATALOG_PROBES)(
    "derives algebra and codebook from perturbed %s without ordinal drift",
    async (exportName, probe, algebraNeedle, code, fieldId) => {
      vi.resetModules();
      vi.doMock("../../src/decision/onboarding-catalog", async (importOriginal) => {
        const actual = await importOriginal<typeof import(
          "../../src/decision/onboarding-catalog"
        )>();
        const original = actual[exportName] as readonly string[];
        return {
          ...actual,
          [exportName]: Object.freeze([probe, ...original.slice(1)]),
        };
      });
      try {
        const generated = await import(
          "../../src/infrastructure/codex-cli/onboarding-extraction-wire"
        );
        expect(generated.ONBOARDING_EXTRACTION_WIRE_ALGEBRA).toContain(algebraNeedle);
        expect(generated.ONBOARDING_EXTRACTION_WIRE_CODEBOOK).toContainEqual({ code, fieldId });
      } finally {
        vi.doUnmock("../../src/decision/onboarding-catalog");
        vi.resetModules();
      }
    },
  );
});

describe("onboarding model version lineage", () => {
  test("retains the historical tuples and pins each supported lineage as a frozen whole", () => {
    expect(ONBOARDING_MODEL_VERSIONS_V1).toEqual({
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@1",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-model-output@1",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V2).toEqual({
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@2",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V3).toEqual({
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@3",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V4).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@4",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V5).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@5",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V6).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@6",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V7).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@7",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V8).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@8",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_MODEL_VERSIONS_V9).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@9",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@3",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V1)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V2)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V3)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V4)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V5)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V6)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V7)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V8)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS_V9)).toBe(true);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V1 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V1);
    expect(reconstructOnboardingModelVersions(Object.assign(
      Object.create(null) as object,
      ONBOARDING_MODEL_VERSIONS_V2,
    ))).toBe(ONBOARDING_MODEL_VERSIONS_V2);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V3 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V3);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V4 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V4);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V5 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V5);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V6 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V6);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V7 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V7);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V8 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V8);
    expect(reconstructOnboardingModelVersions({ ...ONBOARDING_MODEL_VERSIONS_V9 }))
      .toBe(ONBOARDING_MODEL_VERSIONS_V9);
  });

  test("accepts exact whole tuples and rejects every meaningful prompt/schema mismatch", () => {
    const exactTuples = [
      ONBOARDING_MODEL_VERSIONS_V1,
      ONBOARDING_MODEL_VERSIONS_V2,
      ONBOARDING_MODEL_VERSIONS_V3,
      ONBOARDING_MODEL_VERSIONS_V4,
      ONBOARDING_MODEL_VERSIONS_V5,
      ONBOARDING_MODEL_VERSIONS_V6,
      ONBOARDING_MODEL_VERSIONS_V7,
      ONBOARDING_MODEL_VERSIONS_V8,
      ONBOARDING_MODEL_VERSIONS_V9,
    ] as const;

    for (const tuple of exactTuples) {
      expect(reconstructOnboardingModelVersions({ ...tuple })).toBe(tuple);
    }

    for (const hybrid of [
      { ...ONBOARDING_MODEL_VERSIONS_V1, extractionSchema: "onboarding-extraction-wire@2" },
      { ...ONBOARDING_MODEL_VERSIONS_V2, extractionSchema: "onboarding-model-output@1" },
      { ...ONBOARDING_MODEL_VERSIONS_V3, extractionSchema: "onboarding-model-output@1" },
      { ...ONBOARDING_MODEL_VERSIONS_V4, invocation: ONBOARDING_MODEL_VERSIONS_V3.invocation },
      { ...ONBOARDING_MODEL_VERSIONS_V5, reviewPrompt: ONBOARDING_MODEL_VERSIONS_V3.reviewPrompt },
      { ...ONBOARDING_MODEL_VERSIONS_V6, reviewPrompt: ONBOARDING_MODEL_VERSIONS_V3.reviewPrompt },
      { ...ONBOARDING_MODEL_VERSIONS_V7, reviewPrompt: ONBOARDING_MODEL_VERSIONS_V3.reviewPrompt },
      { ...ONBOARDING_MODEL_VERSIONS_V8, reviewPrompt: ONBOARDING_MODEL_VERSIONS_V3.reviewPrompt },
      { ...ONBOARDING_MODEL_VERSIONS_V9, extractionSchema: "onboarding-extraction-wire@2" },
    ]) {
      expect(() => reconstructOnboardingModelVersions(hybrid)).toThrow(TypeError);
    }
  });

  test.each([
    ["V2", ONBOARDING_MODEL_VERSIONS_V2],
    ["V3", ONBOARDING_MODEL_VERSIONS_V3],
  ] as const)(
    "rejects extra, missing, accessor, symbol, non-enumerable, custom-prototype and Proxy tuples for %s",
    (_lineage, versions) => {
      const getter = vi.fn(() => versions.invocation);
      const missing = Object.fromEntries(
        Object.entries(versions).filter(([key]) => key !== "invocation"),
      );
      const accessor = Object.defineProperty({ ...versions }, "invocation", {
        enumerable: true,
        get: getter,
      });
      const symbol = Object.assign({ ...versions }, { [Symbol("hostile")]: true });
      const nonEnumerable = Object.defineProperty({ ...versions }, "invocation", {
        enumerable: false,
      });
      const customPrototype = Object.assign(Object.create({ inherited: true }), versions);
      const trap = vi.fn(() => {
        throw new Error("versions_proxy_trap");
      });
      const proxy = new Proxy({ ...versions }, {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      });
      expect(types.isProxy(proxy)).toBe(true);

      for (const hostile of [
        { ...versions, extra: true },
        missing,
        accessor,
        symbol,
        nonEnumerable,
        customPrototype,
        proxy,
      ]) {
        expect(() => reconstructOnboardingModelVersions(hostile)).toThrow();
      }
      expect(getter).not.toHaveBeenCalled();
      expect(trap).not.toHaveBeenCalled();
    },
  );
});

describe("onboarding extraction wire decoder", () => {
  test("decodes every typed family in order, preserves the full roster, stamps the UUID and deeply freezes", () => {
    const result = decode(wire(allTypedFamilies()), MESSAGE_ID, Array.from({ length: 18 }, (_, index) => `[e${index}]`).join(" "));

    expect(result.schemaVersion).toBe("onboarding-model-output@1");
    expect(result.proposals.map(({ fieldId }) => fieldId)).toEqual([
      "current_location",
      "move_horizon",
      "moving_party",
      "participants",
      "savings",
      "participants.self.citizenships",
      "participants.self.passport",
      "participants.self.current_work",
      "participants.self.remote_continuation",
      "participants.self.monthly_income",
      "participants.self.education",
      "participants.self.relevant_experience_years",
      "country_preferences.outside_cis.mode",
      "country_preferences.outside_cis.importance",
      "country_preferences.outside_cis.target",
      "city_preferences.safety.mode",
      "city_preferences.safety.importance",
      "city_preferences.safety.target",
    ]);
    expect(result.proposals.every(({ messageId }) => messageId === MESSAGE_ID)).toBe(true);
    expect(result.proposals[3]?.typedValue).toEqual((allTypedFamilies()[3] as { v: unknown }).v);
    expect(result.proposals[0]).toEqual({
      fieldId: "current_location",
      typedValue: { countryCode: "RS", city: "Белград" },
      messageId: MESSAGE_ID,
      sourceSpan: { start: 0, end: 4 },
    });
    assertDeepFrozen(result);
  });

  test.each([
    "b00",
    "b5",
    "p00.0",
    "p0.00",
    "p20.0",
    "p0.7",
    "k00.0",
    "k5.0",
    "k0.3",
    "c00.0",
    "c4.0",
    "c0.3",
    "moving_party",
    "participants.self.citizenships",
  ])("rejects the unknown or non-canonical address %s", (fieldAddress) => {
    expectInvalid(wire([proposal(fieldAddress, "alone")]));
  });

  test("rejects duplicate decoded fields without sorting or taking a last value", () => {
    expectInvalid(wire([
      proposal("b2", "alone", "first"),
      proposal("b2", "with_companions", "second"),
    ]), MESSAGE_ID, "first second");
  });

  test.each([
    ["wrong schema", { ...wire([]), schemaVersion: "onboarding-model-output@1" }],
    ["extra root key", { ...wire([]), extra: true }],
    ["missing root key", { schemaVersion: "onboarding-extraction-wire@3", proposals: [] }],
    ["extra proposal key", wire([{ ...proposal("b2", "alone"), extra: true }])],
    ["missing proposal key", wire([{ f: "b2", v: "alone" }])],
    ["old offset wire", wire([{ f: "b2", v: "alone", s: 0, e: 1 }])],
    ["empty evidence", wire([proposal("b2", "alone", "")])],
    ["absent evidence", wire([proposal("b2", "alone", "missing")])],
    ["mismatched typed family", wire([proposal("b0", "alone")])],
    ["invalid roster descriptor order", wire([proposal("b3", [
      { descriptor: "self", relationship: "self" },
      { descriptor: "companion.1", relationship: "spouse" },
    ])])],
    ["placeholder question", { ...wire([]), nextQuestion: "unknown" }],
    ["more than 100 proposals", wire(Array.from({ length: 101 }, (_, index) =>
      proposal(`p${Math.floor(index / 7)}.${index % 7}`, ["RU"], `e${index}`)))],
  ])("rejects %s", (_name, value) => {
    expectInvalid(value);
  });

  test.each([
    "20000000-0000-4000-8000-00000000000A",
    " 20000000-0000-4000-8000-000000000001",
    "message-1",
    "",
  ])("rejects the non-canonical lowercase UUID %j", (messageId) => {
    expectInvalid(wire([]), messageId);
  });

  test("rejects hostile roots, proposals and typed values without invoking accessors or Proxy traps", () => {
    const getter = vi.fn(() => "onboarding-extraction-wire@3");
    const accessorRoot = Object.defineProperty(wire([]), "schemaVersion", {
      enumerable: true,
      get: getter,
    });
    const accessorProposal = Object.defineProperty(proposal("b2", "alone"), "v", {
      enumerable: true,
      get: getter,
    });
    const typedProxy = new Proxy({ countryCode: "RS", city: "Белград" }, {});
    const rootProxy = new Proxy(wire([]), {});
    const customTypedValue = Object.assign(Object.create({ inherited: true }), {
      countryCode: "RS",
      city: "Белград",
    });
    const symbolProposal = Object.assign(proposal("b2", "alone"), { [Symbol("hostile")]: true });
    const nonEnumerableProposal = Object.defineProperty(proposal("b2", "alone"), "v", {
      enumerable: false,
    });

    for (const hostile of [
      accessorRoot,
      wire([accessorProposal]),
      wire([proposal("b0", typedProxy)]),
      rootProxy,
      wire([proposal("b0", customTypedValue)]),
      wire([symbolProposal]),
      wire([nonEnumerableProposal]),
    ]) {
      expectInvalid(hostile);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects cyclic wire, proposal, and typed-value objects", () => {
    const cyclicWire = wire([]);
    cyclicWire.cycle = cyclicWire;
    const cyclicProposal = proposal("b2", "alone");
    cyclicProposal.cycle = cyclicProposal;
    const cyclicTypedValue = {} as Record<string, unknown>;
    cyclicTypedValue.cycle = cyclicTypedValue;

    expectInvalid(cyclicWire);
    expectInvalid(wire([cyclicProposal]));
    expectInvalid(wire([proposal("b0", cyclicTypedValue)]));
  });

  test("rejects throwing Proxy wire, proposal, and typed-value objects without invoking traps", () => {
    const trap = vi.fn(() => { throw new Error("proxy trap must not run"); });
    const wireProxy = new Proxy(wire([]), { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap });
    const proposalProxy = new Proxy(proposal("b2", "alone"), { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap });
    const typedValueProxy = new Proxy({ countryCode: "RS", city: "Белград" }, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap });

    expectInvalid(wireProxy);
    expectInvalid(wire([proposalProxy]));
    expectInvalid(wire([proposal("b0", typedValueProxy)]));
    expect(trap).not.toHaveBeenCalled();
  });

  test("rejects oversized message text and UTF-8 evidence", () => {
    expectInvalid(wire([]), MESSAGE_ID, "a".repeat(8_193));
    expectInvalid(wire([proposal("b2", "alone", "€".repeat(2_731))]));
  });

  test.each([
    ["Cyrillic", "Я живу в Москве", "в Москве", 7, 15],
    ["astral UTF-16", "A😀Б", "😀", 1, 3],
    ["decomposed sequence", "cafe\u0301", "e\u0301", 3, 5],
  ])("derives exact UTF-16 spans for unique %s evidence", (_name, messageText, t, start, end) => {
    const result = decode(wire([proposal("b2", "alone", t)]), MESSAGE_ID, messageText);
    expect(result.proposals[0]).toMatchObject({ sourceSpan: { start, end } });
    expect(messageText.slice(start, end)).toBe(t);
    expect(result.proposals[0]).not.toHaveProperty("t");
  });

  test.each([
    ["ordinary duplicate", "one one", "one"],
    ["overlapping", "banana", "ana"],
    ["visually similar but distinct", "е e", "é"],
  ])("rejects %s non-unique or non-exact evidence", (_name, messageText, t) => {
    expectInvalid(wire([proposal("b2", "alone", t)]), MESSAGE_ID, messageText);
  });
});
