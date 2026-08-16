import type { CityResearchPackageDefinition } from "./city-package";
import {
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  type SloveniaCityFactSourceId,
} from "./city-evidence";

export const SLOVENIA_CITY_PACKAGE_DEFINITION = Object.freeze({
  packageId: "si-city-package",
  packageSchemaVersion: "si-city-package@1",
  countryCode: "SI",
  evidenceRulesVersion: "si-city-evidence@1",
  sourceIds: Object.freeze([...SLOVENIA_CITY_FACT_SOURCE_IDS] as const),
} as const) satisfies CityResearchPackageDefinition;

export const SLOVENIA_CITY_FACT_VERSIONS = Object.freeze({
  "si-city-safety": Object.freeze({
    parserVersion: "si-city-safety-terminal@1",
    rulesVersion: "city-safety-discovery@1",
  }),
  "si-city-long-term-rent": Object.freeze({
    parserVersion: "si-city-long-term-rent-feasibility@1",
    rulesVersion: "si-city-long-term-rent-source@1",
  }),
  "si-city-urban-transit": Object.freeze({
    parserVersion: "si-city-urban-transit-feasibility@1",
    rulesVersion: "si-city-urban-transit-source@1",
  }),
  "si-city-fixed-broadband": Object.freeze({
    parserVersion: "si-city-fixed-broadband-feasibility@1",
    rulesVersion: "si-city-fixed-broadband-source@1",
  }),
} as const) satisfies Readonly<Record<
  SloveniaCityFactSourceId,
  { readonly parserVersion: string; readonly rulesVersion: string }
>>;
