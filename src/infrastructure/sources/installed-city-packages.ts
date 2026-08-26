import { types } from "node:util";

import type {
  CityEvidencePackageReplayPort,
  CityPackageEvidenceReplayContract,
  InstalledCityCatalogReadPort,
  InstalledCityPackageLookupPort,
  VerifiedCityCatalogBundle,
} from "../../application/city-data-contracts";
import type { ApprovedCityCriteriaPackageDefinition } from "../../decision/approved-city-criteria-defaults";
import {
  CITY_CRITERION_IDS,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../decision/city-criteria";
import type {
  CityFixedSourcePeriodValidator,
  CityFixedSourcePlan,
  CityFixedValueValidator,
  SloveniaCityFixedSourceId,
} from "../../research/city-evidence";
import type {
  CityResearchPackageReadyCandidate,
  InstalledCityPackageExactKey,
  InstalledCityPackageManifest,
  InstalledCityResearchPackage,
} from "../../research/city-package";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "../../research/city-safety-source-plan";

const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];

export interface InstalledCityPackageBehaviorVersionKey {
  readonly evaluatorRegistryVersionId: string;
  readonly evaluatorVersionIds: Readonly<Record<CityCriterionId, string>>;
  readonly valueValidatorVersionId: string;
  readonly sourcePeriodValidatorVersionId: string;
}

export interface InstalledCityFixedPolicyVersions {
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
}

export interface InstalledCityPackageBehaviorRegistryEntry {
  readonly approvedFor: ApprovedCityCriteriaPackageDefinition;
  readonly versionKey: InstalledCityPackageBehaviorVersionKey;
  readonly fixedPolicyVersionsBySourceId: Readonly<Record<
    SloveniaCityFixedSourceId,
    InstalledCityFixedPolicyVersions
  >>;
  readonly evaluatorRegistry: CityCriterionEvaluatorRegistry;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface InstalledCityPackageBehaviorRegistry {
  readonly schemaVersion: "installed-city-package-behavior-registry@1";
  readonly entries: readonly InstalledCityPackageBehaviorRegistryEntry[];
}

export interface VerifiedInstalledCityPackageRecord {
  readonly manifest: InstalledCityPackageManifest;
  readonly ready: CityResearchPackageReadyCandidate;
  readonly catalog: VerifiedCityCatalogBundle;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly evaluatorRegistry: CityCriterionEvaluatorRegistry;
  readonly validateValue: CityFixedValueValidator;
  readonly validateSourcePeriod: CityFixedSourcePeriodValidator;
}

export interface VerifiedInstalledCityPackageReadPort {
  loadExactVerified(key: InstalledCityPackageExactKey):
    VerifiedInstalledCityPackageRecord | undefined;
  loadCurrentVerified(countryCode: string): VerifiedInstalledCityPackageRecord | undefined;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function unavailable(): never {
  throw new Error("city_package_behavior_unavailable");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return value;
}

function data<T>(borrowed: T): T {
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
      if (!isRecord(value)) mismatch();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable || key === "__proto__") mismatch();
        if (typeof descriptor.value === "function") mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f]/.test(value)) mismatch();
  return value;
}

function functionValue(value: object, key: string): (...args: never[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) ||
    typeof descriptor.value !== "function" || !descriptor.enumerable) mismatch();
  return descriptor.value as (...args: never[]) => unknown;
}

function sameDefinition(
  left: ApprovedCityCriteriaPackageDefinition,
  right: ApprovedCityCriteriaPackageDefinition,
): boolean {
  return left.countryCode === right.countryCode && left.packageId === right.packageId &&
    left.packageSchemaVersion === right.packageSchemaVersion &&
    left.evidenceRulesVersion === right.evidenceRulesVersion;
}

function selectorDefinition(value: unknown): ApprovedCityCriteriaPackageDefinition {
  const selected = exact(value, [
    "countryCode", "packageId", "packageSchemaVersion", "evidenceRulesVersion",
  ]);
  if (typeof selected.countryCode !== "string" || !/^[A-Z]{2}$/.test(selected.countryCode)) {
    mismatch();
  }
  return freeze({
    countryCode: selected.countryCode,
    packageId: identifier(selected.packageId),
    packageSchemaVersion: identifier(selected.packageSchemaVersion),
    evidenceRulesVersion: identifier(selected.evidenceRulesVersion),
  });
}

function selectorVersion(value: unknown): InstalledCityPackageBehaviorVersionKey {
  const selected = exact(value, [
    "evaluatorRegistryVersionId", "evaluatorVersionIds", "valueValidatorVersionId",
    "sourcePeriodValidatorVersionId",
  ]);
  const evaluatorVersionIds = exact(selected.evaluatorVersionIds, CITY_CRITERION_IDS);
  const versions = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
    criterionId,
    identifier(evaluatorVersionIds[criterionId]),
  ])) as Readonly<Record<CityCriterionId, string>>;
  return freeze({
    evaluatorRegistryVersionId: identifier(selected.evaluatorRegistryVersionId),
    evaluatorVersionIds: versions,
    valueValidatorVersionId: identifier(selected.valueValidatorVersionId),
    sourcePeriodValidatorVersionId: identifier(selected.sourcePeriodValidatorVersionId),
  });
}

function sameVersion(
  left: InstalledCityPackageBehaviorVersionKey,
  right: InstalledCityPackageBehaviorVersionKey,
): boolean {
  return left.evaluatorRegistryVersionId === right.evaluatorRegistryVersionId &&
    left.valueValidatorVersionId === right.valueValidatorVersionId &&
    left.sourcePeriodValidatorVersionId === right.sourcePeriodValidatorVersionId &&
    CITY_CRITERION_IDS.every((id) =>
      left.evaluatorVersionIds[id] === right.evaluatorVersionIds[id]);
}

function ownRegistry(borrowed: InstalledCityPackageBehaviorRegistry): InstalledCityPackageBehaviorRegistry {
  const root = exact(borrowed, ["schemaVersion", "entries"]);
  const borrowedEntries = root.entries;
  const entryNames = Array.isArray(borrowedEntries)
    ? [...Array.from({ length: borrowedEntries.length }, (_unused, index) => String(index)), "length"]
      .sort()
    : [];
  if (root.schemaVersion !== "installed-city-package-behavior-registry@1" ||
    !Array.isArray(borrowedEntries) || types.isProxy(borrowedEntries) ||
    Object.getOwnPropertySymbols(borrowedEntries).length !== 0 ||
    Object.getPrototypeOf(borrowedEntries) !== Array.prototype ||
    Object.getOwnPropertyNames(borrowedEntries).sort().some(
      (name, index) => name !== entryNames[index],
    ) || Object.getOwnPropertyNames(borrowedEntries).length !== entryNames.length) mismatch();
  const entryDescriptors = Object.getOwnPropertyDescriptors(borrowedEntries);
  const entries: InstalledCityPackageBehaviorRegistryEntry[] = [];
  for (let index = 0; index < borrowedEntries.length; index += 1) {
    const itemDescriptor = entryDescriptors[String(index)];
    if (itemDescriptor === undefined || !("value" in itemDescriptor) || !itemDescriptor.enumerable) {
      return mismatch();
    }
    const candidate = itemDescriptor.value;
    const entry = exact(candidate, [
      "approvedFor", "versionKey", "fixedPolicyVersionsBySourceId", "evaluatorRegistry",
      "validateValue", "validateSourcePeriod",
    ]);
    const approvedFor = data(entry.approvedFor) as ApprovedCityCriteriaPackageDefinition;
    exact(approvedFor, ["countryCode", "packageId", "packageSchemaVersion", "evidenceRulesVersion"]);
    if (!/^[A-Z]{2}$/.test(approvedFor.countryCode)) mismatch();
    identifier(approvedFor.packageId);
    identifier(approvedFor.packageSchemaVersion);
    identifier(approvedFor.evidenceRulesVersion);
    const versionKey = data(entry.versionKey) as InstalledCityPackageBehaviorVersionKey;
    exact(versionKey, [
      "evaluatorRegistryVersionId", "evaluatorVersionIds", "valueValidatorVersionId",
      "sourcePeriodValidatorVersionId",
    ]);
    exact(versionKey.evaluatorVersionIds, CITY_CRITERION_IDS);
    identifier(versionKey.evaluatorRegistryVersionId);
    identifier(versionKey.valueValidatorVersionId);
    identifier(versionKey.sourcePeriodValidatorVersionId);
    CITY_CRITERION_IDS.forEach((id) => identifier(versionKey.evaluatorVersionIds[id]));
    const fixedPolicyVersionsBySourceId = data(entry.fixedPolicyVersionsBySourceId) as
      InstalledCityPackageBehaviorRegistryEntry["fixedPolicyVersionsBySourceId"];
    exact(fixedPolicyVersionsBySourceId, FIXED_SOURCE_IDS);
    for (const sourceId of FIXED_SOURCE_IDS) {
      const policy = exact(fixedPolicyVersionsBySourceId[sourceId], [
        "valuePolicyVersion", "sourcePeriodPolicyVersion",
      ]);
      identifier(policy.valuePolicyVersion);
      identifier(policy.sourcePeriodPolicyVersion);
    }
    const borrowedEvaluators = exact(entry.evaluatorRegistry, CITY_CRITERION_IDS);
    const evaluatorRegistry = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
      const borrowedEvaluator = exact(borrowedEvaluators[criterionId], [
        "definition", "canonicalizeTarget", "evaluate",
      ]);
      const definition = freeze(data(borrowedEvaluator.definition));
      const validatedDefinition = exact(definition, [
        "criterionId", "definitionId", "direction", "unit", "denominator",
        "compatibleGeoScopes", "freshnessPolicyVersion", "evaluatorVersion",
      ]);
      const compatibleGeoScopes = validatedDefinition.compatibleGeoScopes;
      if (validatedDefinition.criterionId !== criterionId ||
        identifier(validatedDefinition.definitionId).length === 0 ||
        (validatedDefinition.direction !== "at_least" &&
          validatedDefinition.direction !== "at_most") ||
        text(validatedDefinition.unit).length === 0 ||
        text(validatedDefinition.denominator).length === 0 ||
        !Array.isArray(compatibleGeoScopes) || compatibleGeoScopes.length === 0 ||
        compatibleGeoScopes.some((scope) => text(scope).length === 0) ||
        new Set(compatibleGeoScopes).size !== compatibleGeoScopes.length ||
        identifier(validatedDefinition.freshnessPolicyVersion).length === 0 ||
        validatedDefinition.evaluatorVersion !== versionKey.evaluatorVersionIds[criterionId]) {
        mismatch();
      }
      const canonicalize = functionValue(borrowedEvaluator, "canonicalizeTarget");
      const evaluate = functionValue(borrowedEvaluator, "evaluate");
      const receiver = Object.freeze({ criterionId });
      return [criterionId, Object.freeze({
        definition,
        canonicalizeTarget(target: unknown): string {
          return Reflect.apply(canonicalize, receiver, [data(target)]) as string;
        },
        evaluate(input: unknown) {
          return Reflect.apply(evaluate, receiver, [data(input)]);
        },
      })];
    })) as unknown as CityCriterionEvaluatorRegistry;
    const valueValidator = functionValue(entry, "validateValue");
    const periodValidator = functionValue(entry, "validateSourcePeriod");
    const valueReceiver = Object.freeze({ capability: "validateValue" });
    const periodReceiver = Object.freeze({ capability: "validateSourcePeriod" });
    const validateValue: CityFixedValueValidator = (input) =>
      Reflect.apply(valueValidator, valueReceiver, [data(input)]) as string;
    const validateSourcePeriod: CityFixedSourcePeriodValidator = (input) =>
      Reflect.apply(periodValidator, periodReceiver, [data(input)]) as
        "fresh" | "stale" | "not_comparable";
    entries.push(freeze({
      approvedFor,
      versionKey,
      fixedPolicyVersionsBySourceId,
      evaluatorRegistry: freeze(evaluatorRegistry),
      validateValue,
      validateSourcePeriod,
    }));
  }
  return freeze({
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries,
  });
}

export const INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY: InstalledCityPackageBehaviorRegistry =
  freeze({ schemaVersion: "installed-city-package-behavior-registry@1", entries: [] });

function resolve(
  definition: ApprovedCityCriteriaPackageDefinition,
  borrowedRegistry: InstalledCityPackageBehaviorRegistry,
  version?: InstalledCityPackageBehaviorVersionKey,
): InstalledCityPackageBehaviorRegistryEntry {
  try {
    const selectedDefinition = selectorDefinition(data(definition));
    const selectedVersion = version === undefined ? undefined : selectorVersion(data(version));
    const registry = ownRegistry(borrowedRegistry);
    const matches = registry.entries.filter((entry) =>
      sameDefinition(entry.approvedFor, selectedDefinition) &&
      (selectedVersion === undefined || sameVersion(entry.versionKey, selectedVersion)));
    if (matches.length !== 1) unavailable();
    return ownRegistry({
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [matches[0]!],
    }).entries[0]!;
  } catch (error) {
    if (error instanceof Error && error.message === "city_package_behavior_unavailable") throw error;
    mismatch();
  }
}

export function resolveInstalledCityPackageBehaviorForDefinition(
  definition: ApprovedCityCriteriaPackageDefinition,
  registry: InstalledCityPackageBehaviorRegistry,
): InstalledCityPackageBehaviorRegistryEntry {
  return resolve(definition, registry);
}

export function resolveInstalledCityPackageBehaviorForVersion(
  definition: ApprovedCityCriteriaPackageDefinition,
  versionKey: InstalledCityPackageBehaviorVersionKey,
  registry: InstalledCityPackageBehaviorRegistry,
): InstalledCityPackageBehaviorRegistryEntry {
  return resolve(definition, registry, versionKey);
}

function method<T extends (...args: never[]) => unknown>(value: object, key: string): T {
  if (value === null || typeof value !== "object" || types.isProxy(value)) mismatch();
  let owner: object | null = value;
  while (owner !== null && owner !== Object.prototype) {
    if (types.isProxy(owner)) mismatch();
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") mismatch();
      return descriptor.value as T;
    }
    owner = Object.getPrototypeOf(owner);
  }
  return mismatch();
}

function lookupCountry(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) mismatch();
  return value;
}

function lookupKey(value: unknown): InstalledCityPackageExactKey {
  const key = exact(data(value), [
    "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
    "evidenceRulesVersion",
  ]);
  return freeze({
    countryCode: lookupCountry(key.countryCode),
    packageId: identifier(key.packageId),
    packageSchemaVersion: identifier(key.packageSchemaVersion),
    catalogRevisionId: identifier(key.catalogRevisionId),
    evidenceRulesVersion: identifier(key.evidenceRulesVersion),
  });
}

function sameLookupKey(
  left: InstalledCityPackageExactKey,
  right: InstalledCityPackageExactKey,
): boolean {
  return left.countryCode === right.countryCode &&
    left.packageId === right.packageId &&
    left.packageSchemaVersion === right.packageSchemaVersion &&
    left.catalogRevisionId === right.catalogRevisionId &&
    left.evidenceRulesVersion === right.evidenceRulesVersion;
}

function lookupKeyCacheId(key: InstalledCityPackageExactKey): string {
  return JSON.stringify([
    key.countryCode,
    key.packageId,
    key.packageSchemaVersion,
    key.catalogRevisionId,
    key.evidenceRulesVersion,
  ]);
}

function ownedEvaluatorRegistry(value: unknown): CityCriterionEvaluatorRegistry {
  const registry = exact(value, CITY_CRITERION_IDS);
  return freeze(Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const evaluator = exact(registry[criterionId], ["definition", "canonicalizeTarget", "evaluate"]);
    const canonicalize = functionValue(evaluator, "canonicalizeTarget");
    const evaluate = functionValue(evaluator, "evaluate");
    const receiver = Object.freeze({ criterionId });
    return [criterionId, Object.freeze({
      definition: freeze(data(evaluator.definition)),
      canonicalizeTarget(target: unknown): string {
        return Reflect.apply(canonicalize, receiver, [data(target)]) as string;
      },
      evaluate(input: unknown) {
        return Reflect.apply(evaluate, receiver, [data(input)]);
      },
    })];
  })) as unknown as CityCriterionEvaluatorRegistry);
}

function copyEvaluatorRegistry(
  value: CityCriterionEvaluatorRegistry,
): CityCriterionEvaluatorRegistry {
  const registry = exact(value, CITY_CRITERION_IDS);
  return freeze(Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const evaluator = exact(registry[criterionId], ["definition", "canonicalizeTarget", "evaluate"]);
    return [criterionId, freeze({
      definition: data(evaluator.definition),
      canonicalizeTarget: functionValue(evaluator, "canonicalizeTarget"),
      evaluate: functionValue(evaluator, "evaluate"),
    })];
  })) as unknown as CityCriterionEvaluatorRegistry);
}

function ownRecord(borrowed: VerifiedInstalledCityPackageRecord):
VerifiedInstalledCityPackageRecord {
  const record = exact(borrowed, [
    "manifest", "ready", "catalog", "fixedPlansByCityId", "safetySourcePlan",
    "officialAuthorityDirectory", "criteriaDefaults", "criterionDefinitions",
    "evaluatorRegistry", "validateValue", "validateSourcePeriod",
  ]);
  const validateValueFunction = functionValue(record, "validateValue");
  const validateSourcePeriodFunction = functionValue(record, "validateSourcePeriod");
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const value = (key: string): unknown => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) mismatch();
    return descriptor.value;
  };
  const valueReceiver = Object.freeze({ capability: "validateValue" });
  const periodReceiver = Object.freeze({ capability: "validateSourcePeriod" });
  return freeze({
    manifest: data(value("manifest")),
    ready: data(value("ready")),
    catalog: data(value("catalog")),
    fixedPlansByCityId: data(value("fixedPlansByCityId")),
    safetySourcePlan: data(value("safetySourcePlan")),
    officialAuthorityDirectory: data(value("officialAuthorityDirectory")),
    criteriaDefaults: data(value("criteriaDefaults")),
    criterionDefinitions: data(value("criterionDefinitions")),
    evaluatorRegistry: ownedEvaluatorRegistry(value("evaluatorRegistry")),
    validateValue: ((input) => Reflect.apply(
      validateValueFunction, valueReceiver, [data(input)],
    )) as CityFixedValueValidator,
    validateSourcePeriod: ((input) => Reflect.apply(
      validateSourcePeriodFunction, periodReceiver, [data(input)],
    )) as CityFixedSourcePeriodValidator,
  } as unknown as VerifiedInstalledCityPackageRecord);
}

function packageFrom(borrowed: VerifiedInstalledCityPackageRecord): InstalledCityResearchPackage {
  const record = ownRecord(borrowed);
  const validateValue = record.validateValue;
  const validateSourcePeriod = record.validateSourcePeriod;
  return freeze({
    ...data(record.ready),
    installedPackageManifest: data({ id: record.manifest.id, key: record.manifest.key }),
    registry: data(record.catalog.registry),
    catalog: data(record.catalog.catalog),
    criteriaDefaults: data(record.criteriaDefaults),
    criterionDefinitions: data(record.criterionDefinitions),
    evaluatorRegistry: record.evaluatorRegistry,
    fixedPlansByCityId: data(record.fixedPlansByCityId),
    safetySourcePlan: data(record.safetySourcePlan),
    officialAuthorityDirectory: data(record.officialAuthorityDirectory),
    validateValue: ((input) => validateValue(data(input))) as CityFixedValueValidator,
    validateSourcePeriod: ((input) => validateSourcePeriod(data(input))) as
      CityFixedSourcePeriodValidator,
  });
}

export class InstalledCityPackages implements
  InstalledCityPackageLookupPort,
  CityEvidencePackageReplayPort,
  InstalledCityCatalogReadPort {
  private readonly exact: VerifiedInstalledCityPackageReadPort["loadExactVerified"];
  private readonly current: VerifiedInstalledCityPackageReadPort["loadCurrentVerified"];
  private readonly evaluatorCapabilities = new Map<string, CityCriterionEvaluatorRegistry>();
  private readonly replayValidators = new Map<string, Readonly<{
    validateValue: CityFixedValueValidator;
    validateSourcePeriod: CityFixedSourcePeriodValidator;
  }>>();
  private readonly initializingReplayValidators = new Set<string>();

  constructor(verifiedPackages: VerifiedInstalledCityPackageReadPort) {
    const exact = method<VerifiedInstalledCityPackageReadPort["loadExactVerified"]>(
      verifiedPackages, "loadExactVerified",
    );
    const current = method<VerifiedInstalledCityPackageReadPort["loadCurrentVerified"]>(
      verifiedPackages, "loadCurrentVerified",
    );
    this.exact = (key) => Reflect.apply(exact, verifiedPackages, [key]);
    this.current = (countryCode) => Reflect.apply(
      current, verifiedPackages, [lookupCountry(countryCode)],
    );
  }

  findReady(countryCode: string): InstalledCityResearchPackage | undefined {
    const requested = lookupCountry(countryCode);
    const record = this.current(requested);
    return record === undefined ? undefined : this.researchPackage(record, { countryCode: requested });
  }

  findExact(key: InstalledCityPackageExactKey): InstalledCityResearchPackage | undefined {
    const requested = lookupKey(key);
    const record = this.exact(requested);
    return record === undefined ? undefined : this.researchPackage(record, { key: requested });
  }

  private researchPackage(
    record: VerifiedInstalledCityPackageRecord,
    requested: Readonly<{
      readonly countryCode?: string;
      readonly key?: InstalledCityPackageExactKey;
    }>,
  ): InstalledCityResearchPackage {
    const researchPackage = packageFrom(record);
    const key = lookupKey(researchPackage.installedPackageManifest.key);
    if ((requested.countryCode !== undefined && key.countryCode !== requested.countryCode) ||
      (requested.key !== undefined && !sameLookupKey(key, requested.key))) mismatch();
    const cacheId = lookupKeyCacheId(key);
    let evaluators = this.evaluatorCapabilities.get(cacheId);
    if (evaluators === undefined) {
      evaluators = researchPackage.evaluatorRegistry;
      this.evaluatorCapabilities.set(cacheId, evaluators);
    } else {
      for (const criterionId of CITY_CRITERION_IDS) {
        if (JSON.stringify(evaluators[criterionId].definition) !==
          JSON.stringify(researchPackage.evaluatorRegistry[criterionId].definition)) mismatch();
      }
    }
    return freeze({
      ...researchPackage,
      evaluatorRegistry: copyEvaluatorRegistry(evaluators),
    });
  }

  loadExactReplayContract(
    key: InstalledCityPackageExactKey,
  ): CityPackageEvidenceReplayContract | undefined {
    const requested = lookupKey(key);
    const cacheId = lookupKeyCacheId(requested);
    if (this.initializingReplayValidators.has(cacheId)) mismatch();
    this.initializingReplayValidators.add(cacheId);
    try {
      const borrowed = this.exact(requested);
      if (borrowed === undefined) return undefined;
      const record = ownRecord(borrowed);
      const returnedKey = lookupKey(record.manifest.key);
      if (!sameLookupKey(returnedKey, requested)) mismatch();
      let validators = this.replayValidators.get(cacheId);
      if (validators === undefined) {
        validators = freeze({
          validateValue: record.validateValue,
          validateSourcePeriod: record.validateSourcePeriod,
        });
        this.replayValidators.set(cacheId, validators);
      }
      return freeze({
        installedPackageManifest: data({ id: record.manifest.id, key: returnedKey }),
        definition: data(record.ready.definition),
        catalogProjection: data(record.catalog),
        fixedPlansByCityId: data(record.fixedPlansByCityId),
        safetySourcePlan: data(record.safetySourcePlan),
        officialAuthorityDirectory: data(record.officialAuthorityDirectory),
        validateValue: validators.validateValue,
        validateSourcePeriod: validators.validateSourcePeriod,
      });
    } finally {
      this.initializingReplayValidators.delete(cacheId);
    }
  }

  latestInstalledVerified(countryCode: string): VerifiedCityCatalogBundle | undefined {
    const borrowed = this.current(countryCode);
    return borrowed === undefined ? undefined : freeze(data(ownRecord(borrowed).catalog));
  }
}
