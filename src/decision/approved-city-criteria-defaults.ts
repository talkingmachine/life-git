import {
  CITY_CRITERION_IDS,
  type CityImportance,
  type InstalledCityCriteriaDefaults,
} from "./city-criteria";

export interface ApprovedCityCriteriaPackageDefinition {
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly evidenceRulesVersion: string;
}

export interface ApprovedCityCriteriaDefaultsEntry {
  readonly mappingVersion: string;
  readonly approvedFor: ApprovedCityCriteriaPackageDefinition;
  readonly defaults: InstalledCityCriteriaDefaults;
}

export interface ApprovedCityCriteriaDefaultsRegistry {
  readonly schemaVersion: "approved-city-criteria-defaults-registry@1";
  readonly byMappingVersion: Readonly<Record<string, ApprovedCityCriteriaDefaultsEntry>>;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function unavailable(): never {
  throw new Error("city_package_behavior_unavailable");
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) ||
          length.value < 0 || Object.getOwnPropertyNames(value).length !== length.value + 1) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (!plainRecord(value)) mismatch();
      const copy: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value) || !sameStrings(
    Object.getOwnPropertyNames(value).sort(),
    [...keys].sort(),
  )) mismatch();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function countryCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) mismatch();
  return value;
}

function definition(value: unknown): ApprovedCityCriteriaPackageDefinition {
  const record = exact(
    value,
    ["countryCode", "packageId", "packageSchemaVersion", "evidenceRulesVersion"],
  );
  return {
    countryCode: countryCode(record.countryCode),
    packageId: identifier(record.packageId),
    packageSchemaVersion: identifier(record.packageSchemaVersion),
    evidenceRulesVersion: identifier(record.evidenceRulesVersion),
  };
}

function defaults(value: unknown): InstalledCityCriteriaDefaults {
  const record = exact(value, ["schemaVersion", "mappingVersion", "criteria"]);
  if (record.schemaVersion !== "city-criteria-defaults@1" || !Array.isArray(record.criteria) ||
    Object.getPrototypeOf(record.criteria) !== Array.prototype ||
    record.criteria.length !== CITY_CRITERION_IDS.length ||
    Object.getOwnPropertyNames(record.criteria).length !== CITY_CRITERION_IDS.length + 1) mismatch();
  const criteria = record.criteria.map((value, index) => {
    const criterion = exact(value, ["criterionId", "definitionId", "mode", "importance", "target"]);
    if (criterion.criterionId !== CITY_CRITERION_IDS[index] ||
      (criterion.mode !== "required" && criterion.mode !== "weighted") ||
      ![1, 2, 3, 4, 5].includes(criterion.importance as number)) mismatch();
    return {
      criterionId: criterion.criterionId,
      definitionId: identifier(criterion.definitionId),
      mode: criterion.mode,
      importance: criterion.importance as CityImportance,
      target: identifier(criterion.target),
    };
  }) as unknown as InstalledCityCriteriaDefaults["criteria"];
  return {
    schemaVersion: "city-criteria-defaults@1",
    mappingVersion: identifier(record.mappingVersion),
    criteria,
  };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function sameDefinition(
  left: ApprovedCityCriteriaPackageDefinition,
  right: ApprovedCityCriteriaPackageDefinition,
): boolean {
  return left.countryCode === right.countryCode && left.packageId === right.packageId &&
    left.packageSchemaVersion === right.packageSchemaVersion &&
    left.evidenceRulesVersion === right.evidenceRulesVersion;
}

export const APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY: ApprovedCityCriteriaDefaultsRegistry =
  freeze({
    schemaVersion: "approved-city-criteria-defaults-registry@1",
    byMappingVersion: {},
  });

export function resolveApprovedCityCriteriaDefaults(
  installedDefinition: ApprovedCityCriteriaPackageDefinition,
  borrowedRegistry: ApprovedCityCriteriaDefaultsRegistry,
): InstalledCityCriteriaDefaults {
  try {
    const selectedDefinition = definition(snapshot(installedDefinition));
    const registry = exact(snapshot(borrowedRegistry), ["schemaVersion", "byMappingVersion"]);
    if (registry.schemaVersion !== "approved-city-criteria-defaults-registry@1") mismatch();
    const byMappingVersion = registry.byMappingVersion;
    if (!plainRecord(byMappingVersion)) mismatch();
    const matches: InstalledCityCriteriaDefaults[] = [];
    for (const mappingVersion of Object.getOwnPropertyNames(byMappingVersion)) {
      identifier(mappingVersion);
      const entry = exact(
        byMappingVersion[mappingVersion],
        ["mappingVersion", "approvedFor", "defaults"],
      );
      const entryMappingVersion = identifier(entry.mappingVersion);
      const entryDefinition = definition(entry.approvedFor);
      const entryDefaults = defaults(entry.defaults);
      if (entryMappingVersion !== mappingVersion || entryDefaults.mappingVersion !== mappingVersion) mismatch();
      if (sameDefinition(selectedDefinition, entryDefinition)) matches.push(entryDefaults);
    }
    if (matches.length > 1) mismatch();
    if (matches.length === 0) unavailable();
    return freeze(matches[0]);
  } catch (error) {
    if (error instanceof Error && error.message === "city_package_behavior_unavailable") throw error;
    mismatch();
  }
}
