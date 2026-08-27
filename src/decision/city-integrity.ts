export const CITY_CATALOG_RULES_VERSION = "city-catalog@1" as const;

export interface CityDecisionIntegrity {
  canonical(value: unknown): string;
  hash(canonicalText: string): string;
}
