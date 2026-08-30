import type { CityResearchPackageDefinition } from "./city-package";
import { SLOVENIA_CITY_FACT_SOURCE_IDS } from "./city-evidence";

/**
 * This is deliberately not the national Slovenia package.  Its catalog is a
 * local-beta subset and must keep saying so even after it has been installed.
 */
export const SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION = Object.freeze({
  packageId: "si-demo-city-package",
  packageSchemaVersion: "si-demo-city-package@1",
  countryCode: "SI",
  evidenceRulesVersion: "si-demo-city-evidence@1",
  sourceIds: Object.freeze([...SLOVENIA_CITY_FACT_SOURCE_IDS] as const),
} as const) satisfies CityResearchPackageDefinition;

export const SLOVENIA_DEMO_CITY_CATALOG_SCOPE_POLICY =
  "subjective-relocation-demo@1" as const;

export const SLOVENIA_DEMO_CITY_INITIAL_MEMBER_IDS = Object.freeze([
  "ljubljana",
] as const);

export const SLOVENIA_DEMO_CITY_INCOMPLETE_COVERAGE = Object.freeze({
  status: "incomplete" as const,
  reasons: Object.freeze(["official_universe_partial"] as const),
});
