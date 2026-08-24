import { types } from "node:util";

import type {
  CityCatalogRevision,
  CityRegistryRevision,
} from "../decision/city-catalog";
import type {
  CityCriterionEvaluatorRegistry,
  CityCriterionId,
  InstalledCityCriteriaDefaults,
  InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type {
  CityFixedSourcePeriodValidator,
  CityFixedSourcePlan,
  CityFixedValueValidator,
  SloveniaCityFixedCriterionId,
  SloveniaCityFixedSourceId,
} from "./city-evidence";
import type {
  InstalledCityPackageJsonArtifactBinding,
} from "./city-package-artifact-set";
import { SLOVENIA_CITY_PACKAGE_DEFINITION } from "./slovenia-city-plan";
import type { SloveniaCityFactSourceId } from "./city-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "./city-safety-source-plan";

export type CityPackageReadinessIssue =
  | "catalog_v2_projection_unsealed"
  | "registry_coordinates_unsealed"
  | "per_member_source_plan_artifacts_unsealed"
  | "criteria_policy_unapproved";

export interface CityResearchPackageDefinition {
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceRulesVersion: string;
  readonly sourceIds: readonly SloveniaCityFactSourceId[];
}

export interface InstalledCityPackageExactKey {
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly catalogRevisionId: string;
  readonly evidenceRulesVersion: string;
}

export interface CityResearchPackageCandidate {
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: {
    readonly status: "not_ready";
    readonly issues: readonly CityPackageReadinessIssue[];
  };
}

export interface CityResearchPackageReadyCandidate {
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: {
    readonly status: "ready";
    readonly issues: readonly [];
  };
}

export type CityResearchPackageAvailability =
  | CityResearchPackageCandidate
  | CityResearchPackageReadyCandidate;

export interface InstalledCityFixedPlanManifestBinding<
  S extends SloveniaCityFixedSourceId,
> {
  readonly sourceId: S;
  readonly cityId: string;
  readonly planId: string;
  readonly criterionId: SloveniaCityFixedCriterionId<S>;
  readonly definitionId: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly freshnessPolicyVersion: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly planArtifact: InstalledCityPackageJsonArtifactBinding<
    "installed_city_fixed_source_plan"
  >;
}

export interface InstalledCityPackageManifestPayload {
  readonly schemaVersion: "installed-city-package-manifest@1";
  readonly key: InstalledCityPackageExactKey;
  readonly definition: CityResearchPackageDefinition;
  readonly sourceContractStatus: "bounded_verified_or_unknown";
  readonly readiness: { readonly status: "ready"; readonly issues: readonly [] };
  readonly catalogRoot: {
    readonly registryRevisionId: string;
    readonly catalogRevisionId: string;
  };
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    InstalledCityFixedPlanManifestBinding<"si-city-long-term-rent">,
    InstalledCityFixedPlanManifestBinding<"si-city-urban-transit">,
    InstalledCityFixedPlanManifestBinding<"si-city-fixed-broadband">,
  ]>>;
  readonly safety: {
    readonly sourcePlanId: string;
    readonly sourcePlanSchemaVersion: "city-safety-source-plan@1";
    readonly authorityDirectoryId: string;
    readonly queryTemplateVersion: string;
    readonly definitionId: string;
    readonly freshnessPolicyVersion: string;
    readonly discoveryRulesVersion: string;
    readonly sourcePlanArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_safety_source_plan"
    >;
    readonly authorityDirectoryArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_official_authority_directory"
    >;
  };
  readonly criteria: {
    readonly defaultsMappingVersion: string;
    readonly definitionIds: Readonly<Record<CityCriterionId, string>>;
    readonly evaluatorRegistryVersionId: string;
    readonly evaluatorVersionIds: Readonly<Record<CityCriterionId, string>>;
    readonly defaultsArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_criteria_defaults"
    >;
    readonly definitionsArtifact: InstalledCityPackageJsonArtifactBinding<
      "installed_city_criterion_definitions"
    >;
  };
  readonly valueValidatorVersionId: string;
  readonly sourcePeriodValidatorVersionId: string;
  readonly predecessorManifestId: string | null;
  readonly installedAt: string;
}

export interface InstalledCityPackageManifest extends InstalledCityPackageManifestPayload {
  readonly id: string;
  readonly payloadHash: string;
  readonly hmac: string;
}

export interface InstalledCityResearchPackage extends CityResearchPackageReadyCandidate {
  readonly installedPackageManifest: {
    readonly id: string;
    readonly key: InstalledCityPackageExactKey;
  };
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly evaluatorRegistry: CityCriterionEvaluatorRegistry;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

const READINESS_ISSUES = [
  "catalog_v2_projection_unsealed",
  "registry_coordinates_unsealed",
  "per_member_source_plan_artifacts_unsealed",
  "criteria_policy_unapproved",
] as const satisfies readonly CityPackageReadinessIssue[];

function createSloveniaCandidate(): CityResearchPackageCandidate {
  const definition = Object.freeze({
    ...SLOVENIA_CITY_PACKAGE_DEFINITION,
    sourceIds: Object.freeze([...SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds]),
  });
  const readiness = Object.freeze({
    status: "not_ready" as const,
    issues: Object.freeze([...READINESS_ISSUES]),
  });

  return Object.freeze({
    definition,
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness,
  });
}

export function getCityResearchPackageCandidate(
  countryCode: string,
): CityResearchPackageCandidate | undefined {
  return countryCode === "SI" ? createSloveniaCandidate() : undefined;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function snapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) mismatch();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        const expectedNames = [
          ...Array.from({ length: value.length }, (_unused, index) => String(index)),
          "length",
        ].sort();
        const actualNames = Object.getOwnPropertyNames(value).sort();
        if (Object.getPrototypeOf(value) !== Array.prototype ||
          actualNames.length !== expectedNames.length ||
          actualNames.some((name, index) => name !== expectedNames[index])) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) mismatch();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable || key === "__proto__") mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateDefinition(value: unknown): value is CityResearchPackageDefinition {
  return exact(value, [
    "packageId", "packageSchemaVersion", "countryCode", "evidenceRulesVersion", "sourceIds",
  ]) && identifier(value.packageId) && identifier(value.packageSchemaVersion) &&
    typeof value.countryCode === "string" && /^[A-Z]{2}$/.test(value.countryCode) &&
    identifier(value.evidenceRulesVersion) && Array.isArray(value.sourceIds) &&
    value.sourceIds.length === SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds.length &&
    value.sourceIds.every((sourceId, index) =>
      sourceId === SLOVENIA_CITY_PACKAGE_DEFINITION.sourceIds[index]);
}

export function getCityResearchPackageAvailability(
  countryCode: string,
): CityResearchPackageAvailability | undefined {
  return getCityResearchPackageCandidate(countryCode);
}

export function assertCityPackageReady(
  borrowed: CityResearchPackageAvailability,
): CityResearchPackageReadyCandidate {
  const candidate = snapshot(borrowed);
  if (!exact(candidate, ["definition", "sourceContractStatus", "readiness"]) ||
    !validateDefinition(candidate.definition) ||
    candidate.sourceContractStatus !== "bounded_verified_or_unknown" ||
    !exact(candidate.readiness, ["status", "issues"]) ||
    !Array.isArray(candidate.readiness.issues)) mismatch();
  if (candidate.readiness.status === "not_ready") {
    if (candidate.readiness.issues.length !== READINESS_ISSUES.length ||
      !candidate.readiness.issues.every((issue, index) => issue === READINESS_ISSUES[index])) {
      mismatch();
    }
    throw new Error("city_package_not_ready");
  }
  if (candidate.readiness.status !== "ready" || candidate.readiness.issues.length !== 0) mismatch();
  return deepFreeze(candidate as unknown as CityResearchPackageReadyCandidate);
}
