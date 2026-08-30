import {
  SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION,
} from "../research/slovenia-demo-city-package";
import { canonicalDecimal } from "./city-criterion-evaluator";
import { createCitySafetyEvaluator } from "./city-safety";
import {
  CITY_CRITERION_IDS,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type InstalledCityCriteriaDefaults,
} from "./city-criteria";
import type {
  ApprovedCityCriteriaDefaultsRegistry,
  ApprovedCityCriteriaPackageDefinition,
} from "./approved-city-criteria-defaults";
import type {
  CityFixedSourcePeriodValidator,
  CityFixedValueValidator,
  SloveniaCityFixedSourceId,
} from "../research/city-evidence";

/** Policy identity only. This module never grants runtime package readiness. */
export function getSloveniaDemoCityPackageDefinition() {
  return Object.freeze({
    ...SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION,
    sourceIds: Object.freeze([...SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION.sourceIds]),
  });
}

function freeze<T>(value: T): T {
  if (value !== null && (typeof value === "object" || typeof value === "function") &&
    !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const policyKey = freeze({
  countryCode: "SI",
  packageId: "si-demo-city-package",
  packageSchemaVersion: "si-demo-city-package@1",
  evidenceRulesVersion: "si-demo-city-evidence@1",
}) satisfies ApprovedCityCriteriaPackageDefinition;

const safety = freeze(createCitySafetyEvaluator({ zeroScoreBoundary: "1000000" }));
type FixedCriterionId = Exclude<CityCriterionId, "safety">;

function boundedUnknownEvaluator(criterionId: FixedCriterionId) {
  return freeze({
    definition: {
      criterionId,
      definitionId: `${criterionId}-definition@1`,
      direction: criterionId === "long_term_rent" ? "at_most" as const : "at_least" as const,
      unit: "canonical-unit",
      denominator: "canonical-denominator",
      compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: "si-demo-bounded-unknown@1",
      evaluatorVersion: `si-demo-${criterionId}-bounded-unknown@1`,
    },
    canonicalizeTarget(target: unknown): string {
      if (target !== "unknown") throw new Error("invalid_target");
      return target;
    },
    evaluate() {
      return {
        state: "unknown" as const,
        factor: "0",
        targetComparison: "unknown" as const,
        unknownReason: "not_comparable" as const,
      };
    },
  });
}

const evaluators = freeze({
  safety,
  long_term_rent: boundedUnknownEvaluator("long_term_rent"),
  urban_transit: boundedUnknownEvaluator("urban_transit"),
  fixed_broadband: boundedUnknownEvaluator("fixed_broadband"),
}) satisfies CityCriterionEvaluatorRegistry;

export const SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS: InstalledCityCriteriaDefaults = freeze({
  schemaVersion: "city-criteria-defaults@1",
  mappingVersion: "si-demo-city-defaults@1",
  criteria: CITY_CRITERION_IDS.map((criterionId, index) => ({
    criterionId,
    definitionId: evaluators[criterionId].definition.definitionId,
    mode: index === 0 ? "required" as const : "weighted" as const,
    importance: 1 as const,
    target: criterionId === "safety" ? "1" : "unknown",
  })) as unknown as InstalledCityCriteriaDefaults["criteria"],
});

export const SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS: ApprovedCityCriteriaDefaultsRegistry =
  freeze({
    schemaVersion: "approved-city-criteria-defaults-registry@1",
    byMappingVersion: {
      [SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS.mappingVersion]: {
        mappingVersion: SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS.mappingVersion,
        approvedFor: policyKey,
        defaults: SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS,
      },
    },
  });

export function getSloveniaDemoCityEvaluatorRegistry(): CityCriterionEvaluatorRegistry {
  return evaluators;
}

const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const VALUE_POLICY_VERSION = "si-demo-bounded-value@1";
const PERIOD_POLICY_VERSION = "si-demo-bounded-period@1";

export const SLOVENIA_DEMO_CITY_FIXED_POLICY_VERSIONS = freeze(Object.fromEntries(
  FIXED_SOURCE_IDS.map((sourceId) => [
  sourceId,
  {
    valuePolicyVersion: VALUE_POLICY_VERSION,
    sourcePeriodPolicyVersion: PERIOD_POLICY_VERSION,
  },
]))) as Readonly<Record<SloveniaCityFixedSourceId, Readonly<{
  valuePolicyVersion: string;
  sourcePeriodPolicyVersion: string;
}>>>;

export const validateSloveniaDemoCityFixedValue: CityFixedValueValidator = (input) => {
  if (input.policyVersion !== VALUE_POLICY_VERSION) throw new Error("integrity_mismatch");
  return canonicalDecimal(input.value);
};

export const validateSloveniaDemoCityFixedSourcePeriod: CityFixedSourcePeriodValidator =
  (input) => {
  if (input.policyVersion !== PERIOD_POLICY_VERSION) throw new Error("integrity_mismatch");
  return "not_comparable";
};

export function getSloveniaDemoCityBehaviorPolicy() {
  return freeze({
    approvedFor: policyKey,
    versionKey: {
      evaluatorRegistryVersionId: "si-demo-city-evaluators@1",
      evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
        criterionId,
        evaluators[criterionId].definition.evaluatorVersion,
      ])) as Readonly<Record<CityCriterionId, string>>,
      valueValidatorVersionId: "si-demo-city-bounded-value@1",
      sourcePeriodValidatorVersionId: "si-demo-city-bounded-period@1",
    },
    fixedPolicyVersionsBySourceId: SLOVENIA_DEMO_CITY_FIXED_POLICY_VERSIONS,
    evaluatorRegistry: evaluators,
    validateValue: validateSloveniaDemoCityFixedValue,
    validateSourcePeriod: validateSloveniaDemoCityFixedSourcePeriod,
  });
}
