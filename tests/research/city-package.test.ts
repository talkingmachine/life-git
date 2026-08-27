import { describe, expect, expectTypeOf, test } from "vitest";

import {
  assertCityPackageReady,
  getCityResearchPackageAvailability,
  getCityResearchPackageCandidate,
  type CityResearchPackageAvailability,
  type CityResearchPackageCandidate,
  type CityResearchPackageReadyCandidate,
  type InstalledCityPackageManifest,
  type InstalledCityPackageManifestPayload,
  type InstalledCityResearchPackage,
} from "../../src/research/city-package";
import {
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
} from "../../src/research/city-evidence";
import {
  SLOVENIA_CITY_FACT_VERSIONS,
  SLOVENIA_CITY_PACKAGE_DEFINITION,
} from "../../src/research/slovenia-city-plan";

const EXPECTED_ISSUES = [
  "catalog_v2_projection_unsealed",
  "registry_coordinates_unsealed",
  "per_member_source_plan_artifacts_unsealed",
  "criteria_policy_unapproved",
] as const;

describe("Slovenia city research package candidate", () => {
  test("exposes only the exact bounded candidate contract in fact-source order", () => {
    // Break caught: candidate metadata is promoted, reordered, or silently treated as installed.
    expect(SLOVENIA_CITY_PACKAGE_DEFINITION).toEqual({
      packageId: "si-city-package",
      packageSchemaVersion: "si-city-package@1",
      countryCode: "SI",
      evidenceRulesVersion: "si-city-evidence@1",
      sourceIds: [
        "si-city-safety",
        "si-city-long-term-rent",
        "si-city-urban-transit",
        "si-city-fixed-broadband",
      ],
    });
    expect(SLOVENIA_CITY_FACT_VERSIONS).toEqual({
      "si-city-safety": {
        parserVersion: "si-city-safety-terminal@1",
        rulesVersion: "city-safety-discovery@1",
      },
      "si-city-long-term-rent": {
        parserVersion: "si-city-long-term-rent-feasibility@1",
        rulesVersion: "si-city-long-term-rent-source@1",
      },
      "si-city-urban-transit": {
        parserVersion: "si-city-urban-transit-feasibility@1",
        rulesVersion: "si-city-urban-transit-source@1",
      },
      "si-city-fixed-broadband": {
        parserVersion: "si-city-fixed-broadband-feasibility@1",
        rulesVersion: "si-city-fixed-broadband-source@1",
      },
    });

    expect(getCityResearchPackageCandidate("SI")).toEqual({
      definition: SLOVENIA_CITY_PACKAGE_DEFINITION,
      sourceContractStatus: "bounded_verified_or_unknown",
      readiness: { status: "not_ready", issues: EXPECTED_ISSUES },
    });
  });

  test("returns fresh deeply frozen candidates without aliasing frozen metadata constants", () => {
    // Break caught: callers can mutate a shared candidate/source list.
    const first = getCityResearchPackageCandidate("SI")!;
    const second = getCityResearchPackageCandidate("SI")!;

    expect(first).not.toBe(second);
    expect(first.definition).not.toBe(SLOVENIA_CITY_PACKAGE_DEFINITION);
    expect(first.definition.sourceIds).not.toBe(SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds);
    expect(first.definition.sourceIds).not.toBe(second.definition.sourceIds);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.definition)).toBe(true);
    expect(Object.isFrozen(first.definition.sourceIds)).toBe(true);
    expect(Object.isFrozen(first.readiness)).toBe(true);
    expect(Object.isFrozen(first.readiness.issues)).toBe(true);
  });

  test("rejects runtime metadata mutation and preserves exact future candidates", () => {
    // Break caught: one importer rewrites exported package/version metadata for later consumers.
    const mutableSourceIds = SLOVENIA_CITY_FACT_SOURCE_IDS as unknown as string[];
    const mutableDefinition = SLOVENIA_CITY_PACKAGE_DEFINITION as unknown as {
      packageId: string;
      sourceIds: string[];
    };
    const mutableVersions = SLOVENIA_CITY_FACT_VERSIONS as unknown as Record<
      string,
      { parserVersion: string; rulesVersion: string }
    >;
    const originalSourceId = mutableSourceIds[0]!;
    const originalPackageId = mutableDefinition.packageId;
    const originalParserVersion = mutableVersions["si-city-safety"]!.parserVersion;
    const mutationRejected = [false, false, false];
    let observedCandidate: ReturnType<typeof getCityResearchPackageCandidate>;
    let observedSafetyParserVersion: string | undefined;

    try {
      try {
        mutableSourceIds[0] = "si-city-forged";
      } catch {
        mutationRejected[0] = true;
      }
      try {
        mutableDefinition.packageId = "forged-package";
      } catch {
        mutationRejected[1] = true;
      }
      try {
        mutableVersions["si-city-safety"]!.parserVersion = "forged-parser@1";
      } catch {
        mutationRejected[2] = true;
      }
      observedCandidate = getCityResearchPackageCandidate("SI");
      observedSafetyParserVersion = SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion;
    } finally {
      if (!Object.isFrozen(mutableSourceIds)) mutableSourceIds[0] = originalSourceId;
      if (!Object.isFrozen(mutableDefinition)) mutableDefinition.packageId = originalPackageId;
      if (!Object.isFrozen(mutableVersions["si-city-safety"]!)) {
        mutableVersions["si-city-safety"]!.parserVersion = originalParserVersion;
      }
    }

    expect(mutationRejected).toEqual([true, true, true]);
    expect(Object.isFrozen(SLOVENIA_CITY_FACT_SOURCE_IDS)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_CITY_PACKAGE_DEFINITION)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds)).toBe(true);
    expect(SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds)
      .not.toBe(SLOVENIA_CITY_FACT_SOURCE_IDS);
    expect(Object.isFrozen(SLOVENIA_CITY_FACT_VERSIONS)).toBe(true);
    expect(Object.values(SLOVENIA_CITY_FACT_VERSIONS).every(Object.isFrozen)).toBe(true);
    expect(observedCandidate).toEqual({
      definition: {
        packageId: "si-city-package",
        packageSchemaVersion: "si-city-package@1",
        countryCode: "SI",
        evidenceRulesVersion: "si-city-evidence@1",
        sourceIds: [
          "si-city-safety",
          "si-city-long-term-rent",
          "si-city-urban-transit",
          "si-city-fixed-broadband",
        ],
      },
      sourceContractStatus: "bounded_verified_or_unknown",
      readiness: { status: "not_ready", issues: EXPECTED_ISSUES },
    });
    expect(observedSafetyParserVersion).toBe("si-city-safety-terminal@1");
  });

  test.each(["FR", "si", " SI ", ""])("has no package for unsupported country %j", (countryCode) => {
    // Break caught: normalization or fallback invents an installed package for another identifier.
    expect(getCityResearchPackageCandidate(countryCode)).toBeUndefined();
  });

  test("fails closed while every declared readiness issue remains open", () => {
    // Break caught: a candidate-only definition is accepted as an installable package.
    const candidate = getCityResearchPackageCandidate("SI")!;
    expect(() => assertCityPackageReady(candidate)).toThrow("city_package_not_ready");
  });

  test("keeps production SI not-ready while accepting a closed synthetic ready candidate", () => {
    // Break caught: Task 4 either fabricates production readiness or cannot express test-only readiness.
    const current = getCityResearchPackageAvailability("SI");
    expect(current).toEqual(getCityResearchPackageCandidate("SI"));
    expect(current?.readiness).toEqual({ status: "not_ready", issues: EXPECTED_ISSUES });

    const ready: CityResearchPackageReadyCandidate = {
      definition: {
        packageId: "synthetic-city-package",
        packageSchemaVersion: "synthetic-city-package@1",
        countryCode: "ZZ",
        evidenceRulesVersion: "synthetic-city-evidence@1",
        sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS],
      },
      sourceContractStatus: "bounded_verified_or_unknown",
      readiness: { status: "ready", issues: [] },
    };
    const result = assertCityPackageReady(ready);

    expect(result).toEqual(ready);
    expect(result).not.toBe(ready);
    expect(result.definition).not.toBe(ready.definition);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.definition.sourceIds)).toBe(true);
    expectTypeOf<CityResearchPackageAvailability>().toMatchTypeOf<
      CityResearchPackageReadyCandidate | CityResearchPackageCandidate
    >();
  });

  test("rejects malformed and hostile ready candidates without invoking accessors", () => {
    // Break caught: a ready discriminant bypasses exact package-definition and source-order validation.
    const ready = (): CityResearchPackageReadyCandidate => ({
      definition: {
        packageId: "synthetic-city-package",
        packageSchemaVersion: "synthetic-city-package@1",
        countryCode: "ZZ",
        evidenceRulesVersion: "synthetic-city-evidence@1",
        sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS],
      },
      sourceContractStatus: "bounded_verified_or_unknown",
      readiness: { status: "ready", issues: [] },
    });
    const malformed: unknown[] = [
      { ...ready(), extra: true },
      { ...ready(), readiness: { status: "ready", issues: ["criteria_policy_unapproved"] } },
      { ...ready(), readiness: { status: "ready" } },
      { ...ready(), definition: { ...ready().definition, countryCode: "zz" } },
      { ...ready(), definition: { ...ready().definition, packageId: " bad " } },
      { ...ready(), definition: { ...ready().definition, sourceIds: [] } },
      { ...ready(), definition: {
        ...ready().definition,
        sourceIds: [...SLOVENIA_CITY_FACT_SOURCE_IDS].reverse(),
      } },
      { ...ready(), definition: {
        ...ready().definition,
        sourceIds: [
          SLOVENIA_CITY_FACT_SOURCE_IDS[0],
          SLOVENIA_CITY_FACT_SOURCE_IDS[0],
          ...SLOVENIA_CITY_FACT_SOURCE_IDS.slice(2),
        ],
      } },
      Object.assign(ready(), { [Symbol("extra")]: true }),
      Object.assign(Object.create({}), ready()),
      { ...ready(), definition: Object.assign(Object.create({}), ready().definition) },
      { ...ready(), definition: { ...ready().definition, sourceIds: (() => {
        const sparse = new Array(SLOVENIA_CITY_FACT_SOURCE_IDS.length);
        sparse[0] = SLOVENIA_CITY_FACT_SOURCE_IDS[0];
        return sparse;
      })() } },
      { ...ready(), definition: { ...ready().definition, sourceIds: (() => {
        const sparse = [...SLOVENIA_CITY_FACT_SOURCE_IDS] as string[] & { extra?: string };
        delete sparse[1];
        sparse.extra = "compensating-own-name";
        return sparse;
      })() } },
    ];
    let getterCalls = 0;
    const accessor = ready();
    Object.defineProperty(accessor.definition, "packageId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "synthetic-city-package";
      },
    });
    malformed.push(accessor);

    for (const value of malformed) {
      expect(() => assertCityPackageReady(value as CityResearchPackageAvailability))
        .toThrow("integrity_mismatch");
    }
    expect(getterCalls).toBe(0);
    expect(getCityResearchPackageAvailability("ZZ")).toBeUndefined();
  });

  test("keeps manifest and installed-package serialization types inward and closed", () => {
    // Break caught: the signed payload loses one of its thirteen fields or embeds executable behavior.
    expectTypeOf<keyof InstalledCityPackageManifestPayload>().toEqualTypeOf<
      | "schemaVersion"
      | "key"
      | "definition"
      | "sourceContractStatus"
      | "readiness"
      | "catalogRoot"
      | "fixedPlansByCityId"
      | "safety"
      | "criteria"
      | "valueValidatorVersionId"
      | "sourcePeriodValidatorVersionId"
      | "predecessorManifestId"
      | "installedAt"
    >();
    expectTypeOf<InstalledCityPackageManifest>().toMatchTypeOf<
      InstalledCityPackageManifestPayload & {
        readonly id: string;
        readonly payloadHash: string;
        readonly hmac: string;
      }
    >();
    expectTypeOf<InstalledCityResearchPackage["installedPackageManifest"]>().toEqualTypeOf<{
      readonly id: string;
      readonly key: import("../../src/research/city-package").InstalledCityPackageExactKey;
    }>();
  });

  test("exports no installation, evaluator, target, defaults, or normalizer surface", async () => {
    // Break caught: Task 6 guesses policy or introduces a production installation path.
    const packageModule = await import("../../src/research/city-package");
    const planModule = await import("../../src/research/slovenia-city-plan");
    expect(Object.keys({ ...packageModule, ...planModule }).join(" ")).not.toMatch(
      /installed|registry|factory|defaults|normalizer|evaluator|target/i,
    );
  });
});
