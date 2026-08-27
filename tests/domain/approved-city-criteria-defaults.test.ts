import { describe, expect, test } from "vitest";

import {
  APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY,
  resolveApprovedCityCriteriaDefaults,
  type ApprovedCityCriteriaDefaultsRegistry,
  type ApprovedCityCriteriaPackageDefinition,
} from "../../src/decision/approved-city-criteria-defaults";
import type { InstalledCityCriteriaDefaults } from "../../src/decision/city-criteria";

const DEFINITION: ApprovedCityCriteriaPackageDefinition = {
  countryCode: "ZZ",
  packageId: "synthetic-city-package",
  packageSchemaVersion: "synthetic-city-package@1",
  evidenceRulesVersion: "synthetic-city-evidence@1",
};

const DEFAULTS: InstalledCityCriteriaDefaults = {
  schemaVersion: "city-criteria-defaults@1",
  mappingVersion: "synthetic-city-defaults@1",
  criteria: [
    { criterionId: "safety", definitionId: "safety@1", target: "2", mode: "required", importance: 1 },
    { criterionId: "long_term_rent", definitionId: "rent@1", target: "900", mode: "weighted", importance: 2 },
    { criterionId: "urban_transit", definitionId: "transit@1", target: "0.7", mode: "weighted", importance: 3 },
    { criterionId: "fixed_broadband", definitionId: "broadband@1", target: "100", mode: "weighted", importance: 4 },
  ],
};

function registry(): ApprovedCityCriteriaDefaultsRegistry {
  return {
    schemaVersion: "approved-city-criteria-defaults-registry@1",
    byMappingVersion: {
      [DEFAULTS.mappingVersion]: {
        mappingVersion: DEFAULTS.mappingVersion,
        approvedFor: DEFINITION,
        defaults: DEFAULTS,
      },
    },
  };
}

describe("approved city criteria defaults", () => {
  test("selects one closed compiled entry by the independently supplied package definition", () => {
    // Break caught: selecting by a caller/manifest mapping version or returning compiled aliases.
    const borrowed = structuredClone(registry());
    const result = resolveApprovedCityCriteriaDefaults(structuredClone(DEFINITION), borrowed);

    expect(result).toEqual(DEFAULTS);
    expect(result).not.toBe(borrowed.byMappingVersion[DEFAULTS.mappingVersion]!.defaults);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.criteria[0])).toBe(true);
    expect(Object.isFrozen(borrowed)).toBe(false);
  });

  test("rejects hybrid, duplicate, malformed, hostile, and unsupported compiled selections", () => {
    // Break caught: accepting registry/map drift or invoking package-definition accessors.
    const original = registry();
    const duplicate: ApprovedCityCriteriaDefaultsRegistry = {
      ...original,
      byMappingVersion: {
        ...original.byMappingVersion,
        "synthetic-city-defaults@2": {
          ...original.byMappingVersion[DEFAULTS.mappingVersion]!,
          mappingVersion: "synthetic-city-defaults@2",
          defaults: { ...DEFAULTS, mappingVersion: "synthetic-city-defaults@2" },
        },
      },
    };
    const malformed: unknown[] = [
      { ...registry(), unexpected: true },
      { ...registry(), schemaVersion: "wrong@1" },
      { ...registry(), byMappingVersion: { wrong: registry().byMappingVersion[DEFAULTS.mappingVersion] } },
      { ...registry(), byMappingVersion: {
        [DEFAULTS.mappingVersion]: {
          ...registry().byMappingVersion[DEFAULTS.mappingVersion],
          unexpected: true,
        },
      } },
      { ...registry(), byMappingVersion: {
        [DEFAULTS.mappingVersion]: {
          ...registry().byMappingVersion[DEFAULTS.mappingVersion],
          approvedFor: { ...DEFINITION, countryCode: "invalid", unexpected: true },
        },
      } },
      { ...registry(), byMappingVersion: {
        [DEFAULTS.mappingVersion]: {
          ...registry().byMappingVersion[DEFAULTS.mappingVersion],
          defaults: { ...DEFAULTS, criteria: [...DEFAULTS.criteria].reverse() },
        },
      } },
      { ...registry(), byMappingVersion: {
        [DEFAULTS.mappingVersion]: {
          ...registry().byMappingVersion[DEFAULTS.mappingVersion],
          defaults: {
            ...DEFAULTS,
            criteria: DEFAULTS.criteria.map((criterion, index) => index === 0
              ? { ...criterion, unexpected: true }
              : criterion),
          },
        },
      } },
      duplicate,
      Object.assign(structuredClone(registry()), { [Symbol("extra")]: true }),
      Object.assign(Object.create({}), structuredClone(registry())),
      { ...registry(), byMappingVersion: Object.assign(
        { ...registry().byMappingVersion },
        { [Symbol("extra")]: true },
      ) },
      { ...registry(), byMappingVersion: Object.assign(
        Object.create({}),
        registry().byMappingVersion,
      ) },
      { ...registry(), byMappingVersion: {
        ...registry().byMappingVersion,
        "unrelated-defaults@1": {
          mappingVersion: "unrelated-defaults@1",
          approvedFor: { ...DEFINITION, packageId: "unrelated-package" },
          defaults: {
            ...DEFAULTS,
            mappingVersion: "unrelated-defaults@1",
            criteria: [...DEFAULTS.criteria].reverse(),
          },
        },
      } },
    ];
    const accessor = structuredClone(registry());
    Object.defineProperty(accessor.byMappingVersion[DEFAULTS.mappingVersion]!.approvedFor, "packageId", {
      enumerable: true,
      get() {
        throw new Error("package_getter_invoked");
      },
    });
    malformed.push(accessor);
    const accessorMap = structuredClone(registry());
    Object.defineProperty(accessorMap, "byMappingVersion", {
      enumerable: true,
      get() {
        throw new Error("mapping_registry_getter_invoked");
      },
    });
    malformed.push(accessorMap);

    for (const value of malformed) {
      expect(() => resolveApprovedCityCriteriaDefaults(DEFINITION, value as ApprovedCityCriteriaDefaultsRegistry))
        .toThrow("integrity_mismatch");
    }
    expect(() => resolveApprovedCityCriteriaDefaults(
      { ...DEFINITION, packageId: "unsupported" },
      registry(),
    )).toThrow("city_package_behavior_unavailable");
    const accessorDefinition = { ...DEFINITION };
    Object.defineProperty(accessorDefinition, "packageId", {
      enumerable: true,
      get() {
        throw new Error("trusted_definition_getter_invoked");
      },
    });
    expect(() => resolveApprovedCityCriteriaDefaults(accessorDefinition, registry()))
      .toThrow("integrity_mismatch");
  });

  test("keeps the current production registry closed and without a ready Slovenia entry", () => {
    // Break caught: fabricating approved Slovenia defaults before official package publication.
    expect(APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY).toEqual({
      schemaVersion: "approved-city-criteria-defaults-registry@1",
      byMappingVersion: {},
    });
    expect(Object.isFrozen(APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY)).toBe(true);
    expect(Object.isFrozen(APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY.byMappingVersion)).toBe(true);
    expect(() => resolveApprovedCityCriteriaDefaults({
      countryCode: "SI",
      packageId: "si-cities",
      packageSchemaVersion: "si-cities@1",
      evidenceRulesVersion: "si-city-evidence@1",
    }, APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY)).toThrow("city_package_behavior_unavailable");
  });
});
