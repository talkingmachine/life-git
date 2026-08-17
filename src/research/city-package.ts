import { SLOVENIA_CITY_PACKAGE_DEFINITION } from "./slovenia-city-plan";
import type { SloveniaCityFactSourceId } from "./city-evidence";

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

export function assertCityPackageReady(candidate: CityResearchPackageCandidate): never {
  void candidate;
  throw new Error("city_package_not_ready");
}
