import { describe, expect, expectTypeOf, test } from "vitest";

import {
  CITY_CRITERION_IDS,
  confirmCityCriteria,
  deriveCityCriteriaDraft,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitions,
  reconstructInstalledCityCriterionDefinitionsStructure,
  reconstructCityCriteria,
  reconstructCityCriteriaSnapshot,
  type CityCriteriaSnapshot,
  type CityCriterionDraft,
  type CityCriterionDefinition,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import {
  materializePreferenceProfileV2,
  type PreferenceProfileV2Snapshot,
} from "../../src/decision/preference-profile";
import {
  materializeRelocationProfileV2,
  type RelocationProfileSnapshot,
  type RelocationProfileV2Snapshot,
} from "../../src/decision/relocation-profile";
import {
  createCityDecisionIntegrityView,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";

const INTEGRITY: CityDecisionIntegrity = { canonical: JSON.stringify, hash: (value) => `hash:${value}` };
const STRUCTURAL_INTEGRITY = createCityDecisionIntegrityView(
  createEvidenceIntegrity("task-13-city-criteria-structural-key"),
);
const definitions = {
  safety: { definitionId: "safety@1", direction: "at_most" as const, unit: "rate", denominator: "people" },
  long_term_rent: { definitionId: "rent@1", direction: "at_most" as const, unit: "eur", denominator: "month" },
  urban_transit: { definitionId: "transit@1", direction: "at_least" as const, unit: "share", denominator: "people" },
  fixed_broadband: { definitionId: "broadband@1", direction: "at_least" as const, unit: "mbps", denominator: "connection" },
} as const;

const evaluators: CityCriterionEvaluatorRegistry = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
  const definition = definitions[criterionId];
  return [criterionId, {
    definition: { criterionId, ...definition, compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: "synthetic-freshness@1", evaluatorVersion: `synthetic-${criterionId}@1` },
    canonicalizeTarget: (target: unknown) => {
      if (typeof target !== "string" || !/^\d+(?:\.\d+)?$/.test(target)) throw new Error("invalid_target");
      return target.replace(/(?:\.0+|(?<=\.\d*?)0+)$/, "");
    },
    evaluate: () => ({ state: "verified" as const, factor: "1", targetComparison: "matches" as const }),
  }];
})) as unknown as CityCriterionEvaluatorRegistry;

const defaults: InstalledCityCriteriaDefaults = {
  schemaVersion: "city-criteria-defaults@1",
  mappingVersion: "synthetic-mapping@1",
  criteria: [
    { criterionId: "safety", definitionId: "safety@1", mode: "required", importance: 1, target: "2" },
    { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 2, target: "900" },
    { criterionId: "urban_transit", definitionId: "transit@1", mode: "weighted", importance: 2, target: "0.7" },
    { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "weighted", importance: 2, target: "100" },
  ],
};

const installedDefinitions = CITY_CRITERION_IDS.map((criterionId) => ({
  ...evaluators[criterionId].definition,
  compatibleGeoScopes: [...evaluators[criterionId].definition.compatibleGeoScopes],
})) as unknown as InstalledCityCriterionDefinitionTuple;
const expectedDefinitionIds = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
  criterionId,
  evaluators[criterionId].definition.definitionId,
])) as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>;
const expectedEvaluatorVersionIds = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
  criterionId,
  evaluators[criterionId].definition.evaluatorVersion,
])) as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>;

const profile: RelocationProfileSnapshot = {
  schemaVersion: "relocation-profile@1",
  id: "profile",
  confirmedAt: "2026-01-01T00:00:00.000Z",
  profile: {},
} as unknown as RelocationProfileSnapshot;
const preferences = { schemaVersion: "preference-profile@1" as const, id: "preferences", confirmedAt: "2026-01-01T00:00:00.000Z", criteria: [
  { id: "personal_safety" as const, mode: "weighted" as const, importance: 3 as const, target: "maximize" as const },
  { id: "infrastructure" as const, mode: "required" as const, importance: 4 as const, target: "required_true" as const },
  { id: "europe" as const, mode: "weighted" as const, importance: 5 as const, target: "maximize" as const },
] };

const profileV2 = materializeRelocationProfileV2({
  confirmedAt: "2026-08-22T10:00:00.000Z",
  profile: {
    schemaVersion: "relocation-profile@2",
    profile: {
      currentLocation: { countryCode: "RU", city: "Moscow" },
      moveHorizon: "within_3_months",
      movingParty: "alone",
      participants: [{
        participantId: "00000000-0000-4000-8000-000000000001",
        relationship: "self",
        citizenships: ["RU"],
        passport: { validUntil: "2030-01-01" },
        currentWork: { applicability: "required", value: { status: "employment", occupation: "Engineer" } },
        remoteContinuation: { applicability: "required", value: "yes" },
        monthlyIncome: { applicability: "required", value: { amount: "200000", currency: "RUB", basis: "net" } },
        education: { applicability: "required", value: { level: "higher", field: "Physics" } },
        relevantExperienceYears: { applicability: "required", value: 6 },
      }],
      savings: { min: "10000", max: "20000", currency: "EUR" },
    },
  },
});

const preferencesV2 = materializePreferenceProfileV2({
  confirmedAt: "2026-08-22T10:00:00.000Z",
  preferences: {
    schemaVersion: "preference-profile@2",
    countryCriteria: [
      { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
      { id: "europe", mode: "weighted", importance: 4, target: "maximize" },
      { id: "personal_safety", mode: "weighted", importance: 3, target: "maximize" },
      { id: "infrastructure", mode: "weighted", importance: 2, target: "maximize" },
      { id: "peace_and_stability", mode: "required", importance: 5, target: "required_true" },
    ],
    cityCriteria: [
      { id: "safety", mode: "weighted", importance: 2, target: "free-form unsafe evaluator text" },
      { id: "long_term_rent", mode: "required", importance: 5, target: "under any user amount" },
      { id: "urban_transit", mode: "required", importance: 4, target: "near metro" },
      { id: "fixed_broadband", mode: "weighted", importance: 3, target: "1 Tbps" },
    ],
  },
});

function expectRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      expectRecursivelyFrozen(descriptor.value, seen);
    }
  }
}

function structuralSnapshot(
  criteria: CityCriteriaSnapshot["criteria"] = defaults.criteria,
): CityCriteriaSnapshot {
  const payload = {
    schemaVersion: "city-criteria@1" as const,
    profileSnapshotId: "profile:confirmed",
    preferenceProfileSnapshotId: "preference-profile:confirmed",
    criteria: structuredClone(criteria),
    rulesVersion: "city-criteria@1" as const,
    confirmedAt: "2026-08-14T00:00:00.000Z",
  };
  return {
    id: `city-criteria:${STRUCTURAL_INTEGRITY.hash(
      STRUCTURAL_INTEGRITY.canonical(payload),
    )}`,
    ...payload,
  };
}

function rehashStructuralSnapshot(value: CityCriteriaSnapshot): CityCriteriaSnapshot {
  const { id: _id, ...payload } = value;
  void _id;
  return {
    id: `city-criteria:${STRUCTURAL_INTEGRITY.hash(
      STRUCTURAL_INTEGRITY.canonical(payload),
    )}`,
    ...payload,
  };
}

function rehashUnknownSnapshot(value: Record<string, unknown>): unknown {
  const { id: _id, ...payload } = value;
  void _id;
  return {
    id: `city-criteria:${STRUCTURAL_INTEGRITY.hash(
      STRUCTURAL_INTEGRITY.canonical(payload),
    )}`,
    ...payload,
  };
}

describe("city criteria policy", () => {
  test("structurally reconstructs installed definitions without executable behavior", () => {
    // Break caught: making Application supply compiled evaluators just to validate sealed data.
    const borrowed = structuredClone(installedDefinitions);
    const withUnapprovedCompiledVersions = borrowed.map((definition) => ({
      ...definition,
      evaluatorVersion: `${definition.criterionId}-structural-only@9`,
    })) as unknown as InstalledCityCriterionDefinitionTuple;
    const result = reconstructInstalledCityCriterionDefinitionsStructure(
      withUnapprovedCompiledVersions,
      Object.fromEntries([...CITY_CRITERION_IDS].reverse().map((criterionId) => [
        criterionId,
        expectedDefinitionIds[criterionId],
      ])) as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
    );

    expect(result).toEqual(withUnapprovedCompiledVersions);
    expect(result).not.toBe(withUnapprovedCompiledVersions);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].compatibleGeoScopes)).toBe(true);
    expect(Object.isFrozen(withUnapprovedCompiledVersions[0])).toBe(false);
  });

  test("owns and exact-closes expected definition ids before reading definitions", () => {
    // Break caught: a hostile expected map triggering or observing reads from the borrowed tuple.
    let expectedBoundaryCalls = 0;
    const expectedMapMutations: unknown[] = [
      { ...expectedDefinitionIds, extra: "extra-definition@1" },
      Object.fromEntries(CITY_CRITERION_IDS.slice(1).map((criterionId) => [
        criterionId,
        expectedDefinitionIds[criterionId],
      ])),
      { ...expectedDefinitionIds, safety: expectedDefinitionIds.long_term_rent },
      { ...expectedDefinitionIds, safety: " invalid-definition" },
      Object.assign({ ...expectedDefinitionIds }, { [Symbol("extra")]: true }),
      Object.assign(Object.create({ inherited: true }), expectedDefinitionIds),
      new Proxy({ ...expectedDefinitionIds }, {
        ownKeys() {
          expectedBoundaryCalls += 1;
          throw new Error("expected_map_proxy_trap_invoked");
        },
        getOwnPropertyDescriptor() {
          expectedBoundaryCalls += 1;
          throw new Error("expected_map_proxy_trap_invoked");
        },
      }),
    ];
    const accessorExpectedIds = { ...expectedDefinitionIds };
    Object.defineProperty(accessorExpectedIds, "safety", {
      enumerable: true,
      get() {
        expectedBoundaryCalls += 1;
        throw new Error("expected_map_getter_invoked");
      },
    });
    expectedMapMutations.push(accessorExpectedIds);

    for (const expectedMap of expectedMapMutations) {
      let definitionReads = 0;
      const guardedDefinitions = structuredClone(installedDefinitions) as unknown as unknown[];
      Object.defineProperty(guardedDefinitions[0] as object, "definitionId", {
        enumerable: true,
        get() {
          definitionReads += 1;
          return expectedDefinitionIds.safety;
        },
      });

      expect(() => reconstructInstalledCityCriterionDefinitionsStructure(
        guardedDefinitions,
        expectedMap as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
      )).toThrow("integrity_mismatch");
      expect(definitionReads).toBe(0);
      expect(expectedBoundaryCalls).toBe(0);
    }
  });

  test("rejects hostile structural definition graphs and keeps full evaluator binding", () => {
    // Break caught: structural validation accepting reordered/open data or weakening Task 4 binding.
    let tupleBoundaryCalls = 0;
    let executableCalls = 0;
    const executableVersion = new Proxy(function invalidExecutableVersion() {
      executableCalls += 1;
      return "invalid";
    }, {
      apply() {
        executableCalls += 1;
        return "invalid";
      },
    });
    const mutations: unknown[] = [
      [...installedDefinitions].reverse(),
      installedDefinitions.slice(0, 3),
      [...installedDefinitions, installedDefinitions[0]],
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, extra: undefined }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, definitionId: "wrong-definition@1" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, criterionId: "unknown" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, direction: "sideways" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, unit: "bad\nunit" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, denominator: "" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, compatibleGeoScopes: [] }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, compatibleGeoScopes: ["municipality", "municipality"] }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, freshnessPolicyVersion: " invalid" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, evaluatorVersion: " invalid" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, evaluatorVersion: executableVersion }
        : definition),
      Object.assign([...installedDefinitions], { [Symbol("extra")]: true }),
      new Proxy([...installedDefinitions], {
        ownKeys() {
          tupleBoundaryCalls += 1;
          throw new Error("definition_proxy_trap_invoked");
        },
        getOwnPropertyDescriptor() {
          tupleBoundaryCalls += 1;
          throw new Error("definition_proxy_trap_invoked");
        },
      }),
    ];
    const customPrototype = [...installedDefinitions];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    mutations.push(customPrototype);
    const sparse = [...installedDefinitions] as unknown[];
    delete sparse[2];
    mutations.push(sparse);
    const cyclic = structuredClone(installedDefinitions) as unknown as Array<Record<string, unknown>>;
    cyclic[0]!.cycle = cyclic;
    mutations.push(cyclic);
    const missingDefinitionField = structuredClone(installedDefinitions) as unknown as
      Array<Record<string, unknown>>;
    delete missingDefinitionField[0]!.denominator;
    mutations.push(missingDefinitionField);
    const customDefinition = structuredClone(installedDefinitions) as unknown as
      Array<Record<string, unknown>>;
    Object.setPrototypeOf(customDefinition[0], { inherited: true });
    mutations.push(customDefinition);
    const customScopes = structuredClone(installedDefinitions) as unknown as
      Array<CityCriterionDefinition>;
    Object.setPrototypeOf(
      customScopes[0]!.compatibleGeoScopes,
      Object.create(Array.prototype),
    );
    mutations.push(customScopes);
    const accessor = structuredClone(installedDefinitions) as unknown as Array<Record<string, unknown>>;
    Object.defineProperty(accessor[0], "unit", {
      enumerable: true,
      get() {
        tupleBoundaryCalls += 1;
        throw new Error("definition_getter_invoked");
      },
    });
    mutations.push(accessor);
    const proxyScopes = structuredClone(installedDefinitions) as unknown as
      Array<CityCriterionDefinition>;
    (proxyScopes[0] as unknown as { compatibleGeoScopes: readonly string[] }).compatibleGeoScopes =
      new Proxy(["municipality"], {
        ownKeys() {
          tupleBoundaryCalls += 1;
          throw new Error("scope_proxy_trap_invoked");
        },
      });
    mutations.push(proxyScopes);
    const accessorScopes = structuredClone(installedDefinitions) as unknown as
      Array<CityCriterionDefinition>;
    Object.defineProperty(accessorScopes[0]!.compatibleGeoScopes, "0", {
      enumerable: true,
      get() {
        tupleBoundaryCalls += 1;
        throw new Error("scope_getter_invoked");
      },
    });
    mutations.push(accessorScopes);
    const callableScopes = structuredClone(installedDefinitions) as unknown as
      Array<CityCriterionDefinition>;
    const hostileScopes = function hostileScopes() {};
    Object.defineProperty(hostileScopes, "length", {
      configurable: true,
      get() {
        tupleBoundaryCalls += 1;
        throw new Error("callable_scope_length_getter_invoked");
      },
    });
    (callableScopes[0] as unknown as { compatibleGeoScopes: unknown }).compatibleGeoScopes =
      hostileScopes;
    mutations.push(callableScopes);

    for (const mutation of mutations) {
      expect(() => reconstructInstalledCityCriterionDefinitionsStructure(
        mutation,
        expectedDefinitionIds,
      )).toThrow("integrity_mismatch");
      expect(tupleBoundaryCalls).toBe(0);
      expect(executableCalls).toBe(0);
    }

    const compiledDrift = installedDefinitions.map((definition, index) => index === 3
      ? { ...definition, evaluatorVersion: "compiled-drift@1" }
      : definition);
    expect(reconstructInstalledCityCriterionDefinitionsStructure(
      compiledDrift,
      expectedDefinitionIds,
    )).toEqual(compiledDrift);
    expect(() => reconstructInstalledCityCriterionDefinitions(
      compiledDrift,
      expectedDefinitionIds,
      expectedEvaluatorVersionIds,
    )).toThrow("integrity_mismatch");
  });

  test("reconstructs the installed definition tuple and canonical defaults without aliases", () => {
    // Break caught: trusting installed order/version bindings or returning mutable package values.
    const borrowedDefinitions = structuredClone(installedDefinitions);
    const borrowedDefaults = structuredClone(defaults);
    const definitionsResult = reconstructInstalledCityCriterionDefinitions(
      borrowedDefinitions,
      expectedDefinitionIds,
      expectedEvaluatorVersionIds,
    );
    const defaultsResult = reconstructInstalledCityCriteriaDefaults(
      borrowedDefaults,
      defaults.mappingVersion,
      definitionsResult,
      evaluators,
    );

    expect(definitionsResult).toEqual(installedDefinitions);
    expect(defaultsResult).toEqual(defaults);
    expect(definitionsResult).not.toBe(borrowedDefinitions);
    expect(defaultsResult).not.toBe(borrowedDefaults);
    expect(Object.isFrozen(definitionsResult)).toBe(true);
    expect(Object.isFrozen(definitionsResult[0].compatibleGeoScopes)).toBe(true);
    expect(Object.isFrozen(defaultsResult)).toBe(true);
    expect(Object.isFrozen(defaultsResult.criteria[0])).toBe(true);
    expect(Object.isFrozen(borrowedDefinitions[0])).toBe(false);
    expect(Object.isFrozen(borrowedDefaults.criteria[0])).toBe(false);
  });

  test("rejects malformed installed definitions and defaults before evaluator callbacks", () => {
    // Break caught: sorting hostile package data or invoking accessors/evaluators before closure.
    let evaluatorCalls = 0;
    const guardedEvaluators = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
      criterionId,
      {
        ...evaluators[criterionId],
        canonicalizeTarget: (target: unknown) => {
          evaluatorCalls += 1;
          return evaluators[criterionId].canonicalizeTarget(target);
        },
      },
    ])) as unknown as CityCriterionEvaluatorRegistry;
    const validDefinitions = reconstructInstalledCityCriterionDefinitions(
      installedDefinitions,
      expectedDefinitionIds,
      expectedEvaluatorVersionIds,
    );
    const definitionMutations: unknown[] = [
      [...installedDefinitions].reverse(),
      [...installedDefinitions, installedDefinitions[0]],
      installedDefinitions.slice(0, 3),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, unexpected: true }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, evaluatorVersion: "wrong@1" }
        : definition),
      installedDefinitions.map((definition, index) => index === 0
        ? { ...definition, compatibleGeoScopes: Object.assign(["municipality"], { [Symbol("extra")]: true }) }
        : definition),
      Object.assign([...installedDefinitions], { [Symbol("extra")]: true }),
    ];
    const customDefinitionTuple = [...installedDefinitions];
    Object.setPrototypeOf(customDefinitionTuple, Object.create(Array.prototype));
    definitionMutations.push(customDefinitionTuple);
    const sparseDefinitions = [...installedDefinitions] as unknown[];
    delete sparseDefinitions[1];
    definitionMutations.push(sparseDefinitions);
    const accessorDefinition = structuredClone(installedDefinitions) as unknown as unknown[];
    Object.defineProperty(accessorDefinition[0] as object, "definitionId", {
      enumerable: true,
      get() {
        throw new Error("definition_getter_invoked");
      },
    });
    definitionMutations.push(accessorDefinition);
    const sparseScopes = structuredClone(installedDefinitions) as unknown as CityCriterionDefinition[];
    delete (sparseScopes[0]!.compatibleGeoScopes as unknown as unknown[])[0];
    definitionMutations.push(sparseScopes);
    const accessorScopes = structuredClone(installedDefinitions) as unknown as CityCriterionDefinition[];
    Object.defineProperty(accessorScopes[0]!.compatibleGeoScopes, "0", {
      enumerable: true,
      get() {
        throw new Error("scope_getter_invoked");
      },
    });
    definitionMutations.push(accessorScopes);

    for (const mutation of definitionMutations) {
      expect(() => reconstructInstalledCityCriterionDefinitions(
        mutation,
        expectedDefinitionIds,
        expectedEvaluatorVersionIds,
      )).toThrow("integrity_mismatch");
    }
    const hostileExpectedMaps: readonly [unknown, unknown][] = [
      [Object.assign({ ...expectedDefinitionIds }, { [Symbol("extra")]: true }), expectedEvaluatorVersionIds],
      [Object.assign(Object.create({}), expectedDefinitionIds), expectedEvaluatorVersionIds],
      [expectedDefinitionIds, Object.assign({ ...expectedEvaluatorVersionIds }, { extra: "extra@1" })],
    ];
    const accessorExpectedIds = { ...expectedDefinitionIds };
    Object.defineProperty(accessorExpectedIds, "safety", {
      enumerable: true,
      get() {
        throw new Error("expected_definition_getter_invoked");
      },
    });
    for (const [definitionIds, evaluatorIds] of [
      ...hostileExpectedMaps,
      [accessorExpectedIds, expectedEvaluatorVersionIds] as const,
    ]) {
      expect(() => reconstructInstalledCityCriterionDefinitions(
        installedDefinitions,
        definitionIds as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
        evaluatorIds as Readonly<Record<(typeof CITY_CRITERION_IDS)[number], string>>,
      )).toThrow("integrity_mismatch");
    }

    const defaultMutations: unknown[] = [
      { ...defaults, criteria: [...defaults.criteria].reverse() },
      { ...defaults, criteria: [...defaults.criteria, defaults.criteria[0]] },
      { ...defaults, criteria: defaults.criteria.slice(0, 3) },
      { ...defaults, mappingVersion: "wrong@1" },
      { ...defaults, unexpected: true },
      { ...defaults, criteria: defaults.criteria.map((criterion, index) => index === 0
        ? { ...criterion, unexpected: true }
        : criterion) },
      Object.assign(structuredClone(defaults), { [Symbol("extra")]: true }),
      Object.assign(Object.create({}), structuredClone(defaults)),
    ];
    const sparseDefaults = structuredClone(defaults);
    delete (sparseDefaults.criteria as unknown as unknown[])[1];
    defaultMutations.push(sparseDefaults);
    const accessorDefaults = structuredClone(defaults);
    Object.defineProperty(accessorDefaults.criteria[0], "target", {
      enumerable: true,
      get() {
        throw new Error("target_getter_invoked");
      },
    });
    defaultMutations.push(accessorDefaults);

    for (const mutation of defaultMutations) {
      evaluatorCalls = 0;
      expect(() => reconstructInstalledCityCriteriaDefaults(
        mutation,
        defaults.mappingVersion,
        validDefinitions,
        guardedEvaluators,
      )).toThrow("integrity_mismatch");
      expect(evaluatorCalls).toBe(0);
    }

    const evaluatorRegistryMutations: unknown[] = [
      Object.fromEntries(CITY_CRITERION_IDS.slice(1).map((criterionId) => [criterionId, evaluators[criterionId]])),
      { ...evaluators, extra: evaluators.safety },
      {
        ...evaluators,
        safety: {
          ...evaluators.safety,
          definition: { ...evaluators.safety.definition, unit: "drifted-unit" },
        },
      },
      {
        ...evaluators,
        fixed_broadband: {
          ...evaluators.fixed_broadband,
          definition: { ...evaluators.fixed_broadband.definition, unit: "drifted-later-unit" },
        },
      },
      {
        ...evaluators,
        fixed_broadband: Object.assign(
          { ...evaluators.fixed_broadband },
          { [Symbol("unexpected")]: true },
        ),
      },
      {
        ...evaluators,
        fixed_broadband: Object.assign(
          Object.create({ inherited: true }),
          evaluators.fixed_broadband,
        ),
      },
    ];
    const accessorRegistry = { ...evaluators };
    Object.defineProperty(accessorRegistry, "safety", {
      enumerable: true,
      get() {
        throw new Error("evaluator_getter_invoked");
      },
    });
    evaluatorRegistryMutations.push(accessorRegistry);
    const laterAccessorRegistry = {
      ...evaluators,
      fixed_broadband: { ...evaluators.fixed_broadband },
    };
    Object.defineProperty(laterAccessorRegistry.fixed_broadband, "definition", {
      enumerable: true,
      get() {
        throw new Error("later_evaluator_getter_invoked");
      },
    });
    evaluatorRegistryMutations.push(laterAccessorRegistry);
    for (const mutation of evaluatorRegistryMutations) {
      evaluatorCalls = 0;
      expect(() => reconstructInstalledCityCriteriaDefaults(
        defaults,
        defaults.mappingVersion,
        validDefinitions,
        mutation as CityCriterionEvaluatorRegistry,
      )).toThrow("integrity_mismatch");
      expect(evaluatorCalls).toBe(0);
    }

    let evaluateCalls = 0;
    const nonEvaluatingRegistry = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
      criterionId,
      {
        ...evaluators[criterionId],
        evaluate: () => {
          evaluateCalls += 1;
          throw new Error("evaluate_must_not_run");
        },
      },
    ])) as unknown as CityCriterionEvaluatorRegistry;
    expect(reconstructInstalledCityCriteriaDefaults(
      defaults,
      defaults.mappingVersion,
      validDefinitions,
      nonEvaluatingRegistry,
    )).toEqual(defaults);
    expect(evaluateCalls).toBe(0);
  });

  test("owns every installed default before the first reentrant evaluator callback", () => {
    // Break caught: later targets changing after an earlier evaluator callback mutates borrowed input.
    const borrowed = structuredClone(defaults);
    const guarded = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId, index) => [
      criterionId,
      {
        ...evaluators[criterionId],
        canonicalizeTarget: (target: unknown) => {
          if (index === 0) {
            (borrowed.criteria as unknown as Array<(typeof borrowed.criteria)[number]>)[1] = {
              ...borrowed.criteria[1],
              target: "999999",
            };
          }
          return evaluators[criterionId].canonicalizeTarget(target);
        },
      },
    ])) as unknown as CityCriterionEvaluatorRegistry;
    const result = reconstructInstalledCityCriteriaDefaults(
      borrowed,
      defaults.mappingVersion,
      installedDefinitions,
      guarded,
    );

    expect(result).toEqual(defaults);
    expect(result.criteria[1].target).toBe("900");
    expect(Object.isFrozen(result.criteria[1])).toBe(true);
  });

  test("owns the complete evaluator registry before the first reentrant canonicalizer", () => {
    // Break caught: reading a later evaluator definition/callback after earlier package code mutates it.
    let originalBroadbandCalls = 0;
    const borrowed = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
      criterionId,
      {
        ...evaluators[criterionId],
        definition: {
          ...evaluators[criterionId].definition,
          compatibleGeoScopes: [...evaluators[criterionId].definition.compatibleGeoScopes],
        },
        canonicalizeTarget: criterionId === "fixed_broadband"
          ? (target: unknown) => {
              originalBroadbandCalls += 1;
              return evaluators.fixed_broadband.canonicalizeTarget(target);
            }
          : evaluators[criterionId].canonicalizeTarget,
      },
    ])) as unknown as CityCriterionEvaluatorRegistry;
    const reentrant = borrowed as unknown as Record<string, CityCriterionEvaluatorRegistry["safety"]>;
    reentrant.safety = {
      ...reentrant.safety,
      canonicalizeTarget(target: unknown) {
        reentrant.fixed_broadband = {
          ...reentrant.fixed_broadband,
          definition: { ...reentrant.fixed_broadband.definition, unit: "mutated" },
          canonicalizeTarget: () => { throw new Error("mutated_callback_must_not_run"); },
        };
        return evaluators.safety.canonicalizeTarget(target);
      },
    };

    const result = reconstructInstalledCityCriteriaDefaults(
      defaults,
      defaults.mappingVersion,
      installedDefinitions,
      borrowed,
    );

    expect(result).toEqual(defaults);
    expect(originalBroadbandCalls).toBe(1);
    expect(result.criteria[3].target).toBe("100");
  });

  test("defines the fixed four-criterion catalog and maps only documented preference controls", () => {
    // Break caught: inventing city targets from preferences or failing to apply safety/infrastructure parity.
    expect(CITY_CRITERION_IDS).toEqual(["safety", "long_term_rent", "urban_transit", "fixed_broadband"]);
    expect(deriveCityCriteriaDraft(profile, preferences, defaults, evaluators)).toEqual([
      { criterionId: "safety", definitionId: "safety@1", mode: "weighted", importance: 3, target: "2" },
      { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 2, target: "900" },
      { criterionId: "urban_transit", definitionId: "transit@1", mode: "required", importance: 4, target: "0.7" },
      { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "required", importance: 4, target: "100" },
    ]);
  });

  test("exposes only the two exact matched profile-version overloads", () => {
    // Break caught: widening the boundary to arbitrary unions lets mixed profile versions reach package code.
    expectTypeOf(deriveCityCriteriaDraft).toBeCallableWith(
      profile,
      preferences,
      defaults,
      evaluators,
    );
    if (false) {
      // @ts-expect-error mixed v1/v2 is intentionally absent from the public overload set
      deriveCityCriteriaDraft(profile, preferencesV2, defaults, evaluators);
      // @ts-expect-error mixed v2/v1 is intentionally absent from the public overload set
      deriveCityCriteriaDraft(profileV2, preferences, defaults, evaluators);
      const broadProfile = undefined as unknown as RelocationProfileV2Snapshot | typeof profile;
      const broadPreference = undefined as unknown as PreferenceProfileV2Snapshot | typeof preferences;
      // @ts-expect-error no broad union overload may bypass the matched-pair boundary
      deriveCityCriteriaDraft(broadProfile, broadPreference, defaults, evaluators);
    }
    expectTypeOf(deriveCityCriteriaDraft).toBeCallableWith(
      profileV2 satisfies RelocationProfileV2Snapshot,
      preferencesV2 satisfies PreferenceProfileV2Snapshot,
      defaults,
      evaluators,
    );
  });

  test("maps v2 city controls one-to-one while retaining installed identifiers and targets", () => {
    // Break caught: treating free-form Profile v2 target text as evaluator or package authority.
    const first = deriveCityCriteriaDraft(profileV2, preferencesV2, defaults, evaluators);
    const second = deriveCityCriteriaDraft(
      structuredClone(profileV2),
      structuredClone(preferencesV2),
      structuredClone(defaults),
      evaluators,
    );
    const expected = [
      { criterionId: "safety", definitionId: "safety@1", mode: "weighted", importance: 2, target: "2" },
      { criterionId: "long_term_rent", definitionId: "rent@1", mode: "required", importance: 5, target: "900" },
      { criterionId: "urban_transit", definitionId: "transit@1", mode: "required", importance: 4, target: "0.7" },
      { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "weighted", importance: 3, target: "100" },
    ];

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expectRecursivelyFrozen(first);
    expectRecursivelyFrozen(second);
    expect(JSON.stringify(first)).not.toContain("free-form unsafe evaluator text");
    expect(JSON.stringify(first)).not.toContain("under any user amount");
    expect(JSON.stringify(first)).not.toContain("near metro");
    expect(JSON.stringify(first)).not.toContain("1 Tbps");
  });

  test("rejects mixed profile versions and tuple identity drift before evaluator callbacks", () => {
    // Break caught: accepting one side of a mismatched pair or mapping a reordered/open v2 tuple.
    let evaluatorCalls = 0;
    const guarded = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
      criterionId,
      {
        ...evaluators[criterionId],
        canonicalizeTarget: () => {
          evaluatorCalls += 1;
          throw new Error("evaluator_must_not_run");
        },
      },
    ])) as unknown as CityCriterionEvaluatorRegistry;
    const reordered = structuredClone(preferencesV2) as unknown as Record<string, unknown>;
    const cityCriteria = reordered.cityCriteria as unknown[];
    reordered.cityCriteria = [cityCriteria[1], cityCriteria[0], cityCriteria[2], cityCriteria[3]];
    const changedId = structuredClone(preferencesV2) as unknown as Record<string, unknown>;
    (changedId.cityCriteria as Array<Record<string, unknown>>)[0]!.id = "long_term_rent";
    const extraRoot = Object.assign(structuredClone(preferencesV2), { extra: true });
    const extraElement = structuredClone(preferencesV2) as unknown as Record<string, unknown>;
    (extraElement.cityCriteria as unknown[]).push(structuredClone(
      (extraElement.cityCriteria as unknown[])[0],
    ));
    const cases: ReadonlyArray<readonly [unknown, unknown]> = [
      [profile, preferencesV2],
      [profileV2, preferences],
      [profileV2, reordered],
      [profileV2, changedId],
      [profileV2, extraRoot],
      [profileV2, extraElement],
    ];

    for (const [candidateProfile, candidatePreferences] of cases) {
      let first: unknown;
      let second: unknown;
      try {
        deriveCityCriteriaDraft(candidateProfile as RelocationProfileV2Snapshot, candidatePreferences as PreferenceProfileV2Snapshot, defaults, guarded);
      } catch (error) {
        first = error;
      }
      try {
        deriveCityCriteriaDraft(candidateProfile as RelocationProfileV2Snapshot, candidatePreferences as PreferenceProfileV2Snapshot, defaults, guarded);
      } catch (error) {
        second = error;
      }
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect(first).not.toBe(second);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
    }
    expect(evaluatorCalls).toBe(0);
  });

  test("seals exactly four canonical criteria and reconstructs only their semantic projection", () => {
    // Break caught: accepting reordered/extra definitions, noncanonical targets, or altered snapshot semantics.
    const draft = deriveCityCriteriaDraft(profile, preferences, defaults, evaluators);
    const first = confirmCityCriteria({ draft: [...draft].reverse(), profileSnapshotId: "profile",
      preferenceProfileSnapshotId: "preferences", confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY);
    const second = confirmCityCriteria({ draft, profileSnapshotId: "profile", preferenceProfileSnapshotId: "preferences",
      confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY);
    expect(first.id).toBe(second.id);
    expect(reconstructCityCriteria(first, evaluators)).toEqual({
      profileSnapshotId: "profile", preferenceProfileSnapshotId: "preferences", criteria: draft,
      rulesVersion: "city-criteria@1", confirmedAt: "2026-08-14T00:00:00.000Z",
    });
    expect(() => confirmCityCriteria({ draft: [...draft, draft[0] as (typeof draft)[number]], profileSnapshotId: "profile",
      preferenceProfileSnapshotId: "preferences", confirmedAt: "2026-08-14T00:00:00.000Z" }, evaluators, INTEGRITY)).toThrow();
    expect(() => reconstructCityCriteria({ ...first, extra: true } as typeof first, evaluators))
      .toThrow("integrity_mismatch");
    expect(() => reconstructCityCriteria({ ...first, criteria: [...first.criteria].reverse() as unknown as typeof first.criteria }, evaluators))
      .toThrow("integrity_mismatch");
    expect(() => reconstructCityCriteria({ ...first, profileSnapshotId: "" }, evaluators)).toThrow("integrity_mismatch");
    expect(() => reconstructCityCriteria({ ...first, confirmedAt: "not-an-instant" }, evaluators)).toThrow("integrity_mismatch");
  });

  test("exposes the exact structural Criteria reconstruction signature beside the semantic API", () => {
    // Break caught: persistence requiring evaluators or replacing the existing semantic boundary.
    expectTypeOf(reconstructCityCriteriaSnapshot).toEqualTypeOf<(
      value: unknown,
      integrity: CityDecisionIntegrity,
    ) => CityCriteriaSnapshot>();
    expectTypeOf(reconstructCityCriteria).toEqualTypeOf<(
      snapshot: CityCriteriaSnapshot,
      evaluators: CityCriterionEvaluatorRegistry,
    ) => import("../../src/decision/city-criteria").CityCriteriaProjection>();
  });

  test("reconstructs the exact content ID into fresh recursively frozen copies", () => {
    // Break caught: trusting the supplied ID, returning aliases, or hashing the ID itself.
    const borrowed = structuralSnapshot();
    const { id: _id, ...payload } = borrowed;
    void _id;

    const first = reconstructCityCriteriaSnapshot(borrowed, STRUCTURAL_INTEGRITY);
    const second = reconstructCityCriteriaSnapshot(borrowed, STRUCTURAL_INTEGRITY);

    expect(first.id).toBe(
      `city-criteria:${STRUCTURAL_INTEGRITY.hash(
        STRUCTURAL_INTEGRITY.canonical(payload),
      )}`,
    );
    expect(first).toEqual(borrowed);
    expect(second).toEqual(first);
    expect(first).not.toBe(borrowed);
    expect(second).not.toBe(first);
    expect(first.criteria).not.toBe(borrowed.criteria);
    expect(second.criteria).not.toBe(first.criteria);
    expect(first.criteria[0]).not.toBe(borrowed.criteria[0]);
    expectRecursivelyFrozen(first);
    expectRecursivelyFrozen(second);
    expect(Object.isFrozen(borrowed)).toBe(false);
  });

  test("feeds structural C bytes directly into H for the content ID", () => {
    // Break caught: calling C but checking the ID against another serializer's digest.
    const clean = { ...structuralSnapshot(), id: `city-criteria:${"b".repeat(64)}` };
    const hashInputs: string[] = [];
    const integrity: CityDecisionIntegrity = {
      canonical: () => "criteria-canonical-sentinel",
      hash(value) {
        hashInputs.push(value);
        return "b".repeat(64);
      },
    };

    expect(reconstructCityCriteriaSnapshot(clean, integrity)).toEqual(clean);
    expect(hashInputs).toEqual(["criteria-canonical-sentinel"]);
  });

  test("keeps structural replay separate from installed evaluator semantics", () => {
    // Break caught: SQLite claiming evaluator compatibility or the semantic API becoming structural.
    const candidate = structuralSnapshot();
    const changed = structuredClone(candidate);
    const changedCriteria = changed.criteria as unknown as CityCriterionDraft[];
    changedCriteria[0] = { ...changedCriteria[0], target: "2.0" };
    const structurallyAuthentic = rehashStructuralSnapshot(changed);

    expect(reconstructCityCriteriaSnapshot(
      structurallyAuthentic,
      STRUCTURAL_INTEGRITY,
    )).toEqual(structurallyAuthentic);
    expect(() => reconstructCityCriteria(structurallyAuthentic, evaluators))
      .toThrow("integrity_mismatch");
  });

  test("rejects a bounded matrix of scalar, tuple, key and content-ID drift", () => {
    // Break caught: open snapshots, loose tuples/scalars, or non-lowerhex content authority.
    const clean = structuralSnapshot();
    const invalidPayloads: readonly Record<string, unknown>[] = [
      { ...clean, extra: true },
      Object.fromEntries(Object.entries(clean).filter(([key]) => key !== "confirmedAt")),
      { ...clean, schemaVersion: "city-criteria@2" },
      { ...clean, rulesVersion: "city-criteria@2" },
      { ...clean, profileSnapshotId: "" },
      { ...clean, preferenceProfileSnapshotId: clean.profileSnapshotId },
      { ...clean, confirmedAt: "2026-08-14" },
      { ...clean, criteria: clean.criteria.slice(0, 3) },
      { ...clean, criteria: [...clean.criteria].reverse() },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 0
          ? { ...criterion, mode: "optional" }
          : criterion),
      },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 1
          ? { ...criterion, importance: 6 }
          : criterion),
      },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 0
          ? { ...criterion, definitionId: "" }
          : criterion),
      },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 3
          ? { ...criterion, target: 7 }
          : criterion),
      },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 2
          ? { ...criterion, extra: true }
          : criterion),
      },
    ];
    const invalidIds: readonly unknown[] = [
      { ...clean, id: "city-criteria:other" },
      { ...clean, id: `city-criteria:${"A".repeat(64)}` },
      { ...clean, id: `other-prefix:${"a".repeat(64)}` },
    ];

    for (const value of invalidPayloads) {
      expect(() => reconstructCityCriteriaSnapshot(
        rehashUnknownSnapshot(value),
        STRUCTURAL_INTEGRITY,
      )).toThrow("integrity_mismatch");
    }
    for (const value of invalidIds) {
      expect(() => reconstructCityCriteriaSnapshot(value, STRUCTURAL_INTEGRITY))
        .toThrow("integrity_mismatch");
    }
  });

  test("owns and exact-closes the complete snapshot before C or H", () => {
    // Break caught: descriptor execution, proxy traps, aliases or inherited keys reaching callbacks.
    let hostileReads = 0;
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() {
        callbackCalls += 1;
        return "never";
      },
      hash() {
        callbackCalls += 1;
        return "0".repeat(64);
      },
    };
    const clean = structuralSnapshot();
    const sparseCriteria = new Array(4);
    sparseCriteria[0] = clean.criteria[0];
    sparseCriteria[1] = clean.criteria[1];
    sparseCriteria[3] = clean.criteria[3];
    const accessor = structuredClone(clean) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "profileSnapshotId", {
      enumerable: true,
      get() {
        hostileReads += 1;
        return "profile:attacker";
      },
    });
    const nestedAccessor = structuredClone(clean);
    Object.defineProperty(nestedAccessor.criteria[0], "target", {
      enumerable: true,
      get() {
        hostileReads += 1;
        return "attacker";
      },
    });
    const nestedSymbol = structuredClone(clean);
    Object.defineProperty(nestedSymbol.criteria[1], Symbol("extra"), {
      enumerable: true,
      value: true,
    });
    const sharedCriterion = structuredClone(clean.criteria[0]);
    const hostile: readonly unknown[] = [
      Object.assign(Object.create({ inherited: true }), clean),
      Object.assign(structuredClone(clean), { [Symbol("extra")]: true }),
      accessor,
      new Proxy(structuredClone(clean), {
        ownKeys() {
          hostileReads += 1;
          throw new Error("snapshot_proxy_trap");
        },
      }),
      { ...clean, criteria: sparseCriteria },
      nestedAccessor,
      nestedSymbol,
      {
        ...clean,
        criteria: [
          sharedCriterion,
          sharedCriterion,
          clean.criteria[2],
          clean.criteria[3],
        ],
      },
      {
        ...clean,
        criteria: clean.criteria.map((criterion, index) => index === 0
          ? Object.assign(Object.create({ inherited: true }), criterion)
          : criterion),
      },
    ];

    for (const value of hostile) {
      expect(() => reconstructCityCriteriaSnapshot(value, integrity))
        .toThrow("integrity_mismatch");
    }
    expect(hostileReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("captures fresh neutral C/H capabilities and a frozen private snapshot", () => {
    // Break caught: late-reading borrowed data/capabilities or invoking C/H with store authority.
    const borrowed = structuralSnapshot();
    const calls: string[] = [];
    const receivers: unknown[] = [];
    const captured: unknown[] = [];
    const base = STRUCTURAL_INTEGRITY;
    const integrity: CityDecisionIntegrity = {
      canonical(this: unknown, value: unknown) {
        calls.push("canonical");
        receivers.push(this);
        captured.push(value);
        (borrowed as unknown as Record<string, unknown>).extra = "attacker";
        (integrity as unknown as Record<string, unknown>).hash = () => "f".repeat(64);
        return Reflect.apply(base.canonical, Object.freeze({ capability: "canonical" }), [value]);
      },
      hash(this: unknown, canonicalText: string) {
        calls.push("hash");
        receivers.push(this);
        return Reflect.apply(base.hash, Object.freeze({ capability: "hash" }), [canonicalText]);
      },
    };

    const result = reconstructCityCriteriaSnapshot(borrowed, integrity);

    expect(result).toEqual(structuralSnapshot());
    expect(calls).toEqual(["canonical", "hash"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toBe(borrowed);
    expectRecursivelyFrozen(captured[0]);
    expect(receivers.map((receiver) =>
      (receiver as { capability: string }).capability)).toEqual(["canonical", "hash"]);
    expect(receivers[0]).not.toBe(receivers[1]);
    for (const receiver of receivers) {
      expect(Object.isFrozen(receiver)).toBe(true);
      expect(Reflect.ownKeys(receiver as object)).toEqual(["capability"]);
    }
  });

  test("rejects hostile integrity roots and callable C/H Proxies before traps", () => {
    // Break caught: reflecting inherited/accessor authority or invoking executable Proxy capabilities.
    let accessorReads = 0;
    let callbackCalls = 0;
    let proxyTraps = 0;
    const validCanonical = (value: unknown) => {
      callbackCalls += 1;
      return STRUCTURAL_INTEGRITY.canonical(value);
    };
    const validHash = (value: string) => {
      callbackCalls += 1;
      return STRUCTURAL_INTEGRITY.hash(value);
    };
    const accessor = { hash: validHash } as Record<string, unknown>;
    Object.defineProperty(accessor, "canonical", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return validCanonical;
      },
    });
    const rootProxy = new Proxy({ canonical: validCanonical, hash: validHash }, {
      ownKeys() {
        proxyTraps += 1;
        throw new Error("integrity_root_proxy_trap");
      },
    });
    const callableHash = new Proxy(validHash, {
      apply(callable, receiver, argumentsList) {
        proxyTraps += 1;
        return Reflect.apply(callable, receiver, argumentsList);
      },
      get(callable, key, receiver) {
        proxyTraps += 1;
        return Reflect.get(callable, key, receiver);
      },
    });
    const callableCanonical = new Proxy(validCanonical, {
      apply(callable, receiver, argumentsList) {
        proxyTraps += 1;
        return Reflect.apply(callable, receiver, argumentsList);
      },
      get(callable, key, receiver) {
        proxyTraps += 1;
        return Reflect.get(callable, key, receiver);
      },
    });
    const symbolRoot = { canonical: validCanonical, hash: validHash } as
      Record<PropertyKey, unknown>;
    symbolRoot[Symbol("extra")] = true;
    const inheritedRoot = Object.assign(
      Object.create({ inherited: true }),
      { canonical: validCanonical, hash: validHash },
    );
    const cases: readonly unknown[] = [
      accessor,
      rootProxy,
      symbolRoot,
      inheritedRoot,
      { canonical: callableCanonical, hash: validHash },
      { canonical: validCanonical, hash: callableHash },
    ];

    for (const candidate of cases) {
      const invoke = () => reconstructCityCriteriaSnapshot(
        structuralSnapshot(),
        candidate as CityDecisionIntegrity,
      );
      let first: unknown;
      let second: unknown;
      try {
        invoke();
      } catch (error) {
        first = error;
      }
      try {
        invoke();
      } catch (error) {
        second = error;
      }
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect(first).not.toBe(second);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
    }
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("normalizes hostile C/H failures and rejects non-lowerhex hashes", () => {
    // Break caught: leaking capability errors or accepting async/non-string/uppercase digests.
    const clean = structuralSnapshot();
    const hostileError = new Error("hostile_integrity_error");
    const capabilities: readonly CityDecisionIntegrity[] = [
      { canonical: () => { throw hostileError; }, hash: STRUCTURAL_INTEGRITY.hash },
      {
        canonical: () => Promise.resolve("async") as unknown as string,
        hash: STRUCTURAL_INTEGRITY.hash,
      },
      { canonical: STRUCTURAL_INTEGRITY.canonical, hash: () => { throw hostileError; } },
      { canonical: STRUCTURAL_INTEGRITY.canonical, hash: () => "A".repeat(64) },
      { canonical: STRUCTURAL_INTEGRITY.canonical, hash: () => "g".repeat(64) },
      { canonical: STRUCTURAL_INTEGRITY.canonical, hash: () => "a".repeat(63) },
    ];

    for (const integrity of capabilities) {
      let first: unknown;
      let second: unknown;
      try {
        reconstructCityCriteriaSnapshot(clean, integrity);
      } catch (error) {
        first = error;
      }
      try {
        reconstructCityCriteriaSnapshot(clean, integrity);
      } catch (error) {
        second = error;
      }
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect(first).not.toBe(second);
      expect(first).not.toBe(hostileError);
      expect(second).not.toBe(hostileError);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
    }
  });
});
