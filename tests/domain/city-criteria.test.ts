import { describe, expect, test } from "vitest";

import {
  CITY_CRITERION_IDS,
  confirmCityCriteria,
  deriveCityCriteriaDraft,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitions,
  reconstructInstalledCityCriterionDefinitionsStructure,
  reconstructCityCriteria,
  type CityCriterionDefinition,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";

const INTEGRITY: CityDecisionIntegrity = { canonical: JSON.stringify, hash: (value) => `hash:${value}` };
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

const profile = { schemaVersion: "relocation-profile@1" as const, id: "profile", confirmedAt: "2026-01-01T00:00:00.000Z", profile: {} } as never;
const preferences = { schemaVersion: "preference-profile@1" as const, id: "preferences", confirmedAt: "2026-01-01T00:00:00.000Z", criteria: [
  { id: "personal_safety" as const, mode: "weighted" as const, importance: 3 as const, target: "maximize" as const },
  { id: "infrastructure" as const, mode: "required" as const, importance: 4 as const, target: "required_true" as const },
  { id: "europe" as const, mode: "weighted" as const, importance: 5 as const, target: "maximize" as const },
] };

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
});
