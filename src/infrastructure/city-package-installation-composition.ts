import { types } from "node:util";

import type Database from "better-sqlite3";

import {
  installCityPackage,
  type CityPackageAvailabilityResolver,
  type InstallCityPackageInput,
} from "../application/install-city-package";
import type { ApprovedCityCriteriaDefaultsRegistry } from
  "../decision/approved-city-criteria-defaults";
import type { InstalledCityResearchPackage } from "../research/city-package";
import { createEvidenceIntegrity } from "./integrity";
import {
  InstalledCityPackages,
  type InstalledCityPackageBehaviorRegistry,
} from "./sources/installed-city-packages";
import { SqliteCityCatalogStore } from "./sqlite/city-catalog-store";
import { SqliteCityPackageManifestStore } from "./sqlite/city-package-manifest-store";
import { SqliteAdministrativeEvidenceStore } from "./sqlite/evidence-store";

const OPTION_KEYS = [
  "database",
  "hmacKey",
  "resolveAvailability",
  "approvedDefaults",
  "behaviors",
] as const;

export interface CityPackageInstallationCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly resolveAvailability: CityPackageAvailabilityResolver;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly behaviors: InstalledCityPackageBehaviorRegistry;
}

export interface CityPackageInstallationComposition {
  readonly installCityPackage: (
    input: InstallCityPackageInput,
  ) => Promise<InstalledCityResearchPackage>;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactOptions(borrowed: unknown): Readonly<Record<string, unknown>> {
  if (borrowed === null || typeof borrowed !== "object" || types.isProxy(borrowed)) mismatch();
  const prototype = Object.getPrototypeOf(borrowed);
  if (prototype !== Object.prototype && prototype !== null) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol") || keys.length !== OPTION_KEYS.length ||
    !OPTION_KEYS.every((key) => Object.hasOwn(descriptors, key))) mismatch();
  return Object.freeze(Object.fromEntries(OPTION_KEYS.map((key) => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
    return [key, descriptor.value];
  })));
}

function snapshotCode<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) mismatch();
      return value;
    }
    if (typeof value === "function") {
      if (types.isProxy(value)) mismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) mismatch();
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (prototype !== Array.prototype) mismatch();
        const length = value.length;
        const expectedNames = [
          ...Array.from({ length }, (_unused, index) => String(index)),
          "length",
        ].sort();
        if (Object.keys(descriptors).sort().some((name, index) => name !== expectedNames[index]) ||
          Object.keys(descriptors).length !== expectedNames.length) mismatch();
        return value.map((_item, index) => {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            return mismatch();
          }
          return visit(descriptor.value);
        });
      }
      if (prototype !== Object.prototype && prototype !== null) mismatch();
      const entries = Object.entries(descriptors).map(([key, descriptor]) => {
        if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        return [key, visit(descriptor.value)] as const;
      });
      return Object.fromEntries(entries);
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

export function createCityPackageInstallationComposition(
  borrowedOptions: CityPackageInstallationCompositionOptions,
): Readonly<CityPackageInstallationComposition> {
  const options = exactOptions(borrowedOptions);
  const database = options.database as Database.Database;
  const hmacKey = options.hmacKey;
  const resolveAvailability = options.resolveAvailability;
  if (database === null || typeof database !== "object" || typeof hmacKey !== "string" ||
    hmacKey.length === 0 || typeof resolveAvailability !== "function" ||
    types.isProxy(resolveAvailability)) mismatch();
  const approvedDefaults = snapshotCode(
    options.approvedDefaults as ApprovedCityCriteriaDefaultsRegistry,
  );
  const behaviors = snapshotCode(
    options.behaviors as InstalledCityPackageBehaviorRegistry,
  );
  const integrity = createEvidenceIntegrity(hmacKey);
  const catalog = new SqliteCityCatalogStore(database, integrity);
  const administrativeEvidence = new SqliteAdministrativeEvidenceStore(database, integrity);
  const manifests = new SqliteCityPackageManifestStore(
    database,
    integrity,
    approvedDefaults,
    behaviors,
  );
  const installedPackages = new InstalledCityPackages(manifests);
  const install = (input: InstallCityPackageInput): Promise<InstalledCityResearchPackage> =>
    installCityPackage(input, {
      resolveAvailability: resolveAvailability as CityPackageAvailabilityResolver,
      catalog,
      administrativeEvidence,
      manifests,
      installedPackages,
      approvedDefaults,
      integrity,
    });
  return Object.freeze({ installCityPackage: install });
}
