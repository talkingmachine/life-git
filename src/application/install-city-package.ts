import { types } from "node:util";

import {
  resolveApprovedCityCriteriaDefaults,
  type ApprovedCityCriteriaDefaultsRegistry,
  type ApprovedCityCriteriaPackageDefinition,
} from "../decision/approved-city-criteria-defaults";
import {
  CITY_CATALOG_RULES_VERSION,
  reconstructCityCatalog,
  reconstructVerifiedCityCatalog,
  type CityCatalogProjection,
} from "../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  reconstructInstalledCityCriterionDefinitionsStructure,
  type CityCriterionDefinition,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import {
  sealCityPackageAdministrativeEvidence,
} from "./seal-administrative-evidence";
import type {
  CityCatalogStorePort,
  InstalledCityPackageLookupPort,
  InstalledCityPackageManifestAppendInput,
  InstalledCityPackageManifestAppendPort,
} from "./city-data-contracts";
import {
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  reconstructCityFixedSourcePlan,
  type CityFixedSourcePeriodValidator,
  type CityFixedValueValidator,
  type SloveniaCityFixedSourceId,
} from "../research/city-evidence";
import {
  assertCityPackageReady,
  type CityResearchPackageAvailability,
  type CityResearchPackageReadyCandidate,
  type InstalledCityPackageExactKey,
  type InstalledCityPackageManifest,
  type InstalledCityPackageManifestPayload,
  type InstalledCityResearchPackage,
} from "../research/city-package";
import type {
  CityPackageAdministrativeEvidenceClaim,
  SealedCityPackageAdministrativeEvidence,
} from "../research/city-package-artifact-set";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type CitySafetySourcePlan,
  type OfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";
import type {
  EvidenceIntegrity,
  EvidenceWriteStore,
} from "../research/research-plan";

const INPUT_KEYS = [
  "countryCode",
  "installedAt",
  "catalogProjection",
  "fixedPlansByCityId",
  "safetySourcePlan",
  "officialAuthorityDirectory",
  "criteriaDefaults",
  "criterionDefinitions",
] as const;
const PORT_KEYS = [
  "resolveAvailability",
  "catalog",
  "administrativeEvidence",
  "manifests",
  "installedPackages",
  "approvedDefaults",
  "integrity",
] as const;
const FIXED_SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

type FixedPlansByCityId = InstalledCityPackageManifestAppendInput["fixedPlansByCityId"];
type AdministrativeEvidenceStore = EvidenceWriteStore<
  "city-package-installation",
  CityPackageAdministrativeEvidenceClaim,
  "administrative"
>;

export interface InstallCityPackageInput {
  readonly countryCode: string;
  readonly installedAt: string;
  readonly catalogProjection: CityCatalogProjection;
  readonly fixedPlansByCityId: FixedPlansByCityId;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
}

export type CityPackageAvailabilityResolver = (
  this: void,
  countryCode: string,
) => CityResearchPackageAvailability | undefined;

export interface InstallCityPackagePorts {
  readonly resolveAvailability: CityPackageAvailabilityResolver;
  readonly catalog: CityCatalogStorePort;
  readonly administrativeEvidence: AdministrativeEvidenceStore;
  readonly manifests: InstalledCityPackageManifestAppendPort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly integrity: EvidenceIntegrity;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function snapshotJson<T>(borrowed: T, frozen: boolean): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) mismatch();
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
        const lengthDescriptor = descriptors.length;
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) mismatch();
        const length = lengthDescriptor.value as number;
        const expectedKeys = [
          ...Array.from({ length }, (_unused, index) => String(index)),
          "length",
        ].sort();
        const actualKeys = Object.keys(descriptors).sort();
        if (!sameStrings(actualKeys, expectedKeys)) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (prototype !== Object.prototype && prototype !== null) mismatch();
      const copy = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        Object.defineProperty(copy, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: visit(descriptor.value),
        });
      }
      return Object.fromEntries(Object.entries(copy));
    } finally {
      active.delete(value);
    }
  };
  const owned = visit(borrowed) as T;
  return frozen ? deepFreeze(owned) : owned;
}

function ownJson<T>(borrowed: T): T {
  return snapshotJson(borrowed, true);
}

function mutableJson<T>(borrowed: T): T {
  return snapshotJson(borrowed, false);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && sameStrings(Object.keys(value).sort(), [...expected].sort());
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function canonicalText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f]/.test(value);
}

function canonicalHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      url.hash === "" && url.toString() === value;
  } catch {
    return false;
  }
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function denseArray(value: unknown, length?: number): value is readonly unknown[] {
  return Array.isArray(value) && (length === undefined || value.length === length) &&
    Object.getPrototypeOf(value) === Array.prototype &&
    Object.getOwnPropertyNames(value).length === value.length + 1;
}

function expectedDefinitionIds(defaults: InstalledCityCriteriaDefaults): Readonly<
  Record<CityCriterionId, string>
> {
  return Object.freeze(Object.fromEntries(defaults.criteria.map((criterion, index) => {
    if (!exactKeys(criterion, ["criterionId", "definitionId", "mode", "importance", "target"]) ||
      criterion.criterionId !== CITY_CRITERION_IDS[index] || !identifier(criterion.definitionId) ||
      (criterion.mode !== "required" && criterion.mode !== "weighted") ||
      ![1, 2, 3, 4, 5].includes(criterion.importance) ||
      typeof criterion.target !== "string" || criterion.target.length === 0) mismatch();
    return [criterion.criterionId, criterion.definitionId];
  })) as Record<CityCriterionId, string>);
}

function assertClosedSafetyShapes(
  directory: OfficialAuthorityDirectory,
  safetyPlan: CitySafetySourcePlan,
): void {
  if (!exactKeys(directory, [
    "schemaVersion", "id", "countryCode", "catalogRevisionId", "requiredPublisherIds",
    "publishers", "municipalities", "rulesVersion",
  ]) || directory.schemaVersion !== "official-authority-directory@1" ||
    !identifier(directory.id) || directory.countryCode !== "SI" ||
    !identifier(directory.catalogRevisionId) ||
    directory.rulesVersion !== "slovenia-official-authorities@1" ||
    !exactKeys(directory.requiredPublisherIds, ["police", "gov", "opsi", "surs"]) ||
    !Object.values(directory.requiredPublisherIds).every(identifier) ||
    !denseArray(directory.publishers) || !directory.publishers.every((publisher) =>
      exactKeys(publisher, [
        "publisherId", "authorityKind", "navigationUrl", "allowedHosts",
        "delegatedDocumentHosts", "allowedMediaTypes", "maxBytes", "redirectPolicyVersion",
        "documentLocatorPolicyId", "retentionPolicyId", "retentionMode",
      ]) && identifier(publisher.publisherId) &&
      ["police", "government", "open_data", "statistics", "municipality"]
        .includes(publisher.authorityKind) && canonicalHttpsUrl(publisher.navigationUrl) &&
      denseArray(publisher.allowedHosts) && publisher.allowedHosts.every(canonicalText) &&
      denseArray(publisher.delegatedDocumentHosts) &&
      publisher.delegatedDocumentHosts.every(canonicalText) &&
      denseArray(publisher.allowedMediaTypes) && publisher.allowedMediaTypes.every(canonicalText) &&
      Number.isSafeInteger(publisher.maxBytes) && publisher.maxBytes > 0 &&
      publisher.redirectPolicyVersion === "official-chain@1" &&
      identifier(publisher.documentLocatorPolicyId) && identifier(publisher.retentionPolicyId) &&
      ["seal_raw_artifact", "seal_hash_locator_then_delete_transient"]
        .includes(publisher.retentionMode)) || !denseArray(directory.municipalities) ||
    !directory.municipalities.every((municipality) => exactKeys(municipality, [
      "cityId", "settlementCode", "municipalityCode", "officialCityNames",
      "officialMunicipalityNames", "publisherId", "officialHost",
    ]) && denseArray(municipality.officialCityNames) &&
      municipality.officialCityNames.every(canonicalText) &&
      denseArray(municipality.officialMunicipalityNames) &&
      municipality.officialMunicipalityNames.every(canonicalText) &&
      identifier(municipality.cityId) && canonicalText(municipality.settlementCode) &&
      canonicalText(municipality.municipalityCode) && identifier(municipality.publisherId) &&
      canonicalText(municipality.officialHost))) mismatch();
  if (!exactKeys(safetyPlan, [
    "schemaVersion", "id", "catalogRevisionId", "authorityDirectoryId", "entries",
    "queryTemplateVersion", "definitionId", "freshnessPolicyVersion", "discoveryRulesVersion",
  ]) || safetyPlan.schemaVersion !== "city-safety-source-plan@1" ||
    !identifier(safetyPlan.id) || !identifier(safetyPlan.catalogRevisionId) ||
    !identifier(safetyPlan.authorityDirectoryId) ||
    safetyPlan.queryTemplateVersion !== "slovenia-municipal-safety-query@1" ||
    safetyPlan.definitionId !== "si-municipal-police-offences-per-100000@1" ||
    safetyPlan.freshnessPolicyVersion !== "municipal-annual-july-boundary@1" ||
    safetyPlan.discoveryRulesVersion !== "city-safety-discovery@1" ||
    !denseArray(safetyPlan.entries) || !safetyPlan.entries.every((entry) =>
    exactKeys(entry, [
      "cityId", "settlementCode", "municipalityCode", "officialCityNames",
      "officialMunicipalityNames", "publisherIds", "configuredRoutes",
    ]) && identifier(entry.cityId) && canonicalText(entry.settlementCode) &&
    canonicalText(entry.municipalityCode) && denseArray(entry.officialCityNames) &&
    entry.officialCityNames.every(canonicalText) && denseArray(entry.officialMunicipalityNames) &&
    entry.officialMunicipalityNames.every(canonicalText) && denseArray(entry.publisherIds) &&
    entry.publisherIds.every(identifier) && denseArray(entry.configuredRoutes) &&
    entry.configuredRoutes.every((route) => exactKeys(
      route,
      Object.hasOwn(route, "resolvedEvidenceUrl")
        ? ["publisherId", "navigationUrl", "resolvedEvidenceUrl"]
        : ["publisherId", "navigationUrl"],
    ) && identifier(route.publisherId) && canonicalHttpsUrl(route.navigationUrl) &&
      (route.resolvedEvidenceUrl === undefined || canonicalHttpsUrl(route.resolvedEvidenceUrl))))) {
    mismatch();
  }
}

function ownInput(borrowed: InstallCityPackageInput): InstallCityPackageInput {
  try {
    const input = ownJson(borrowed);
    if (!exactKeys(input, INPUT_KEYS) || typeof input.countryCode !== "string" ||
      !/^[A-Z]{2}$/.test(input.countryCode) || !canonicalInstant(input.installedAt) ||
      !exactKeys(input.criteriaDefaults, ["schemaVersion", "mappingVersion", "criteria"]) ||
      input.criteriaDefaults.schemaVersion !== "city-criteria-defaults@1" ||
      !identifier(input.criteriaDefaults.mappingVersion) ||
      !denseArray(input.criteriaDefaults.criteria, CITY_CRITERION_IDS.length)) mismatch();
    const catalogProjection = reconstructCityCatalog(input.catalogProjection);
    const definitionIds = expectedDefinitionIds(input.criteriaDefaults);
    const criterionDefinitions = reconstructInstalledCityCriterionDefinitionsStructure(
      input.criterionDefinitions,
      definitionIds,
    );
    const memberIds = catalogProjection.catalog.members.map(({ cityId }) => cityId);
    if (!exactKeys(input.fixedPlansByCityId, memberIds)) mismatch();
    const fixedPlansByCityId = Object.freeze(Object.fromEntries(memberIds.map((cityId) => {
      const tuple = input.fixedPlansByCityId[cityId];
      if (!denseArray(tuple, FIXED_SOURCE_IDS.length)) mismatch();
      return [cityId, Object.freeze(FIXED_SOURCE_IDS.map((sourceId, index) =>
        reconstructCityFixedSourcePlan(tuple[index], sourceId)))];
    })) as unknown as FixedPlansByCityId);
    assertClosedSafetyShapes(input.officialAuthorityDirectory, input.safetySourcePlan);
    return deepFreeze({
      countryCode: input.countryCode,
      installedAt: input.installedAt,
      catalogProjection,
      fixedPlansByCityId,
      safetySourcePlan: input.safetySourcePlan,
      officialAuthorityDirectory: input.officialAuthorityDirectory,
      criteriaDefaults: input.criteriaDefaults,
      criterionDefinitions,
    });
  } catch {
    return mismatch();
  }
}

function exactRootValues(
  borrowed: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (borrowed === null || typeof borrowed !== "object" || types.isProxy(borrowed)) mismatch();
  const prototype = Object.getPrototypeOf(borrowed);
  if (prototype !== Object.prototype && prototype !== null) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol") ||
    !sameStrings(Object.keys(descriptors).sort(), [...expectedKeys].sort())) mismatch();
  return Object.freeze(Object.fromEntries(expectedKeys.map((key) => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
    return [key, descriptor.value];
  })));
}

function callable(value: unknown): (...args: never[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value)) mismatch();
  return value as (...args: never[]) => unknown;
}

interface CapturedMethod {
  readonly fn: (...args: never[]) => unknown;
  readonly receiver: object;
}

function captureMethod(borrowed: unknown, name: string): CapturedMethod {
  if (borrowed === null || typeof borrowed !== "object" || types.isProxy(borrowed)) mismatch();
  let cursor: object | null = borrowed;
  while (cursor !== null && cursor !== Object.prototype) {
    if (types.isProxy(cursor)) mismatch();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) mismatch();
      return Object.freeze({ fn: callable(descriptor.value), receiver: borrowed });
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return mismatch();
}

interface CapturedPorts {
  readonly resolver: (...args: never[]) => unknown;
  readonly catalogAppend: CapturedMethod;
  readonly catalogLoad: CapturedMethod;
  readonly administrativeAppend: CapturedMethod;
  readonly administrativeSeal: CapturedMethod;
  readonly manifestAppend: CapturedMethod;
  readonly packageLookup: CapturedMethod;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly canonical: (...args: never[]) => unknown;
  readonly hash: (...args: never[]) => unknown;
  readonly sign: (...args: never[]) => unknown;
}

function capturePorts(borrowed: InstallCityPackagePorts): CapturedPorts {
  const ports = exactRootValues(borrowed, PORT_KEYS);
  const integrity = exactRootValues(ports.integrity, ["canonical", "hash", "sign"]);
  return Object.freeze({
    resolver: callable(ports.resolveAvailability),
    catalogAppend: captureMethod(ports.catalog, "appendVerified"),
    catalogLoad: captureMethod(ports.catalog, "loadVerified"),
    administrativeAppend: captureMethod(ports.administrativeEvidence, "appendArtifact"),
    administrativeSeal: captureMethod(ports.administrativeEvidence, "seal"),
    manifestAppend: captureMethod(ports.manifests, "appendPrepared"),
    packageLookup: captureMethod(ports.installedPackages, "findExact"),
    approvedDefaults: ownJson(
      ports.approvedDefaults as ApprovedCityCriteriaDefaultsRegistry,
    ),
    canonical: callable(integrity.canonical),
    hash: callable(integrity.hash),
    sign: callable(integrity.sign),
  });
}

function safeErrorCode(error: unknown, allowed: readonly string[]): string | undefined {
  if (error === null || typeof error !== "object" || types.isProxy(error) ||
    Object.getPrototypeOf(error) !== Error.prototype) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  if (descriptor === undefined || !("value" in descriptor) ||
    typeof descriptor.value !== "string" || !allowed.includes(descriptor.value)) return undefined;
  return descriptor.value;
}

function normalizeStageError(error: unknown, allowed: readonly string[] = []): never {
  throw new Error(safeErrorCode(error, allowed) ?? "integrity_mismatch");
}

function integrityViews(captured: CapturedPorts): {
  readonly decision: CityDecisionIntegrity;
  readonly sealing: EvidenceIntegrity;
} {
  const decision: CityDecisionIntegrity = Object.freeze({
    canonical(value: unknown): string {
      try {
        const result = Reflect.apply(captured.canonical, decision, [value]);
        if (typeof result !== "string") mismatch();
        return result;
      } catch {
        return mismatch();
      }
    },
    hash(canonicalText: string): string {
      try {
        const result = Reflect.apply(captured.hash, decision, [canonicalText]);
        if (typeof result !== "string" || !SHA256.test(result)) mismatch();
        return result;
      } catch {
        return mismatch();
      }
    },
  });
  const sealing: EvidenceIntegrity = Object.freeze({
    canonical(value: unknown): string {
      try {
        const result = Reflect.apply(captured.canonical, sealing, [value]);
        if (typeof result !== "string") mismatch();
        return result;
      } catch {
        return mismatch();
      }
    },
    hash(canonicalText: string): string {
      try {
        const result = Reflect.apply(captured.hash, sealing, [canonicalText]);
        if (typeof result !== "string" || !SHA256.test(result)) mismatch();
        return result;
      } catch {
        return mismatch();
      }
    },
    sign(canonicalText: string): string {
      try {
        const result = Reflect.apply(captured.sign, sealing, [canonicalText]);
        if (typeof result !== "string" || !SHA256.test(result)) mismatch();
        return result;
      } catch {
        return mismatch();
      }
    },
  });
  return Object.freeze({ decision, sealing });
}

function resolveReady(
  input: InstallCityPackageInput,
  captured: CapturedPorts,
): CityResearchPackageReadyCandidate {
  let availability: unknown;
  try {
    availability = Reflect.apply(captured.resolver, undefined, [input.countryCode]);
  } catch {
    return mismatch();
  }
  if (availability === undefined) throw new Error("city_package_not_ready");
  try {
    return assertCityPackageReady(availability as CityResearchPackageAvailability);
  } catch (error) {
    throw new Error(safeErrorCode(error, ["city_package_not_ready"]) ?? "integrity_mismatch");
  }
}

function bindReadyIdentity(
  input: InstallCityPackageInput,
  ready: CityResearchPackageReadyCandidate,
): void {
  const { registry, catalog } = input.catalogProjection;
  if (ready.definition.countryCode !== input.countryCode ||
    ready.definition.countryCode !== registry.countryCode ||
    ready.definition.countryCode !== catalog.countryCode ||
    ready.definition.packageId !== registry.packageId ||
    ready.definition.packageId !== catalog.packageId ||
    ready.definition.packageSchemaVersion !== registry.packageSchemaVersion ||
    ready.definition.packageSchemaVersion !== catalog.packageSchemaVersion ||
    !sameStrings(ready.definition.sourceIds, SLOVENIA_CITY_FACT_SOURCE_IDS)) mismatch();
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: CityDecisionIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

function approvedDefinition(
  ready: CityResearchPackageReadyCandidate,
): ApprovedCityCriteriaPackageDefinition {
  return Object.freeze({
    countryCode: ready.definition.countryCode,
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    evidenceRulesVersion: ready.definition.evidenceRulesVersion,
  });
}

function resolveDefaults(
  input: InstallCityPackageInput,
  ready: CityResearchPackageReadyCandidate,
  registry: ApprovedCityCriteriaDefaultsRegistry,
  integrity: CityDecisionIntegrity,
): InstalledCityCriteriaDefaults {
  const entry = registry.byMappingVersion[input.criteriaDefaults.mappingVersion];
  if (entry !== undefined && exactKeys(entry, ["mappingVersion", "approvedFor", "defaults"]) &&
    sameCanonical(entry.defaults, input.criteriaDefaults, integrity) &&
    exactKeys(entry.approvedFor, [
      "countryCode", "packageId", "packageSchemaVersion", "evidenceRulesVersion",
    ]) && !sameCanonical(entry.approvedFor, approvedDefinition(ready), integrity)) mismatch();
  let approved: InstalledCityCriteriaDefaults;
  try {
    approved = resolveApprovedCityCriteriaDefaults(approvedDefinition(ready), registry);
  } catch (error) {
    return normalizeStageError(error, [
      "city_package_behavior_unavailable",
      "integrity_mismatch",
    ]);
  }
  if (!sameCanonical(input.criteriaDefaults, approved, integrity)) mismatch();
  return approved;
}

function reconstructExpectedCatalog(
  input: InstallCityPackageInput,
  ready: CityResearchPackageReadyCandidate,
  integrity: CityDecisionIntegrity,
): CityCatalogProjection {
  const catalog = reconstructVerifiedCityCatalog(input.catalogProjection, integrity);
  if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
    throw new Error("city_catalog_upgrade_required");
  }
  if (catalog.registry.packageId !== ready.definition.packageId ||
    catalog.registry.packageSchemaVersion !== ready.definition.packageSchemaVersion ||
    catalog.registry.countryCode !== ready.definition.countryCode ||
    catalog.catalog.packageId !== ready.definition.packageId ||
    catalog.catalog.packageSchemaVersion !== ready.definition.packageSchemaVersion ||
    catalog.catalog.countryCode !== ready.definition.countryCode ||
    catalog.registry.evidenceSnapshotId !== catalog.catalog.evidenceSnapshotId) mismatch();
  return catalog;
}

function bindFixedPlans(
  borrowed: FixedPlansByCityId,
  catalog: CityCatalogProjection,
  definitions: InstalledCityCriterionDefinitionTuple,
): FixedPlansByCityId {
  const memberIds = catalog.catalog.members.map(({ cityId }) => cityId);
  if (!exactKeys(borrowed, memberIds)) mismatch();
  const definitionsById = Object.fromEntries(definitions.map((definition) => [
    definition.criterionId,
    definition,
  ])) as Readonly<Record<CityCriterionId, CityCriterionDefinition>>;
  return deepFreeze(Object.fromEntries(memberIds.map((cityId) => {
    const tuple = borrowed[cityId];
    if (!denseArray(tuple, FIXED_SOURCE_IDS.length)) mismatch();
    const plans = FIXED_SOURCE_IDS.map((sourceId, sourceIndex) => {
      const plan = reconstructCityFixedSourcePlan(tuple[sourceIndex], sourceId);
      const criterionId = SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[sourceId];
      const definition = definitionsById[criterionId];
      if (plan.cityId !== cityId || plan.criterionId !== criterionId ||
        plan.definitionId !== definition.definitionId ||
        plan.claimContract.scope !== `municipality:${cityId}` ||
        !definition.compatibleGeoScopes.includes(plan.claimContract.geoScope) ||
        plan.claimContract.geoScope !== "municipality" ||
        plan.claimContract.unit !== definition.unit ||
        plan.claimContract.denominator !== definition.denominator ||
        plan.claimContract.freshnessPolicyVersion !== definition.freshnessPolicyVersion) mismatch();
      return plan;
    });
    return [cityId, Object.freeze(plans)];
  })) as unknown as FixedPlansByCityId);
}

function reconstructInstallationData(
  input: InstallCityPackageInput,
  ready: CityResearchPackageReadyCandidate,
  catalog: CityCatalogProjection,
  defaults: InstalledCityCriteriaDefaults,
  integrity: CityDecisionIntegrity,
): {
  readonly definitions: InstalledCityCriterionDefinitionTuple;
  readonly fixedPlans: FixedPlansByCityId;
  readonly directory: OfficialAuthorityDirectory;
  readonly safetyPlan: CitySafetySourcePlan;
} {
  const definitions = reconstructInstalledCityCriterionDefinitionsStructure(
    input.criterionDefinitions,
    expectedDefinitionIds(defaults),
  );
  const fixedPlans = bindFixedPlans(input.fixedPlansByCityId, catalog, definitions);
  const directory = reconstructOfficialAuthorityDirectory(
    input.officialAuthorityDirectory,
    catalog.catalog,
    integrity,
  );
  const safetyPlan = reconstructCitySafetySourcePlan(
    input.safetySourcePlan,
    catalog.catalog,
    directory,
    integrity,
  );
  const safetyDefinition = definitions[0];
  if (safetyPlan.definitionId !== safetyDefinition.definitionId ||
    safetyPlan.freshnessPolicyVersion !== safetyDefinition.freshnessPolicyVersion) mismatch();
  if (ready.definition.evidenceRulesVersion.length === 0) mismatch();
  return Object.freeze({ definitions, fixedPlans, directory, safetyPlan });
}

function invokeStage(method: CapturedMethod, args: readonly unknown[]): unknown {
  try {
    return Reflect.apply(method.fn, method.receiver, args);
  } catch (error) {
    return normalizeStageError(error);
  }
}

function ownCatalogReturn(
  borrowed: unknown,
  expected: CityCatalogProjection,
  integrity: CityDecisionIntegrity,
): CityCatalogProjection {
  const returned = reconstructVerifiedCityCatalog(
    ownJson(borrowed) as CityCatalogProjection,
    integrity,
  );
  if (!sameCanonical(returned, expected, integrity)) mismatch();
  return returned;
}

function appendAndLoadCatalog(
  expected: CityCatalogProjection,
  captured: CapturedPorts,
  integrity: CityDecisionIntegrity,
): CityCatalogProjection {
  const appended = ownCatalogReturn(
    invokeStage(captured.catalogAppend, [expected]),
    expected,
    integrity,
  );
  if (!sameCanonical(appended, expected, integrity)) mismatch();
  return ownCatalogReturn(
    invokeStage(captured.catalogLoad, [expected.catalog.id]),
    expected,
    integrity,
  );
}

function deriveKey(
  ready: CityResearchPackageReadyCandidate,
  expectedCatalogId: string,
): InstalledCityPackageExactKey {
  return deepFreeze({
    countryCode: ready.definition.countryCode,
    packageId: ready.definition.packageId,
    packageSchemaVersion: ready.definition.packageSchemaVersion,
    catalogRevisionId: expectedCatalogId,
    evidenceRulesVersion: ready.definition.evidenceRulesVersion,
  });
}

function administrativeStore(captured: CapturedPorts): AdministrativeEvidenceStore {
  return Object.freeze({
    async appendArtifact(
      artifact: Parameters<AdministrativeEvidenceStore["appendArtifact"]>[0],
    ) {
      try {
        await Reflect.apply(captured.administrativeAppend.fn, captured.administrativeAppend.receiver, [
          artifact,
        ]);
      } catch (error) {
        normalizeStageError(error);
      }
    },
    async seal(evidence: Parameters<AdministrativeEvidenceStore["seal"]>[0]) {
      try {
        await Reflect.apply(captured.administrativeSeal.fn, captured.administrativeSeal.receiver, [
          evidence,
        ]);
      } catch (error) {
        normalizeStageError(error);
      }
    },
  });
}

async function sealAdministrativeEvidence(
  input: InstallCityPackageInput,
  key: InstalledCityPackageExactKey,
  catalog: CityCatalogProjection,
  data: ReturnType<typeof reconstructInstallationData>,
  defaults: InstalledCityCriteriaDefaults,
  captured: CapturedPorts,
  integrity: EvidenceIntegrity,
): Promise<SealedCityPackageAdministrativeEvidence> {
  try {
    return await sealCityPackageAdministrativeEvidence({
      key,
      installedAt: input.installedAt,
      catalogMemberIds: catalog.catalog.members.map(({ cityId }) => cityId),
      fixedPlansByCityId: data.fixedPlans,
      safetySourcePlan: data.safetyPlan,
      officialAuthorityDirectory: data.directory,
      criteriaDefaults: defaults,
      criterionDefinitions: data.definitions,
    }, {
      store: administrativeStore(captured),
      integrity,
    });
  } catch (error) {
    return normalizeStageError(error);
  }
}

const MANIFEST_PAYLOAD_KEYS = [
  "schemaVersion",
  "key",
  "definition",
  "sourceContractStatus",
  "readiness",
  "catalogRoot",
  "fixedPlansByCityId",
  "safety",
  "criteria",
  "valueValidatorVersionId",
  "sourcePeriodValidatorVersionId",
  "predecessorManifestId",
  "installedAt",
] as const;
const MANIFEST_KEYS = [
  ...MANIFEST_PAYLOAD_KEYS,
  "id",
  "payloadHash",
  "hmac",
] as const;

function validExactKey(value: unknown): value is InstalledCityPackageExactKey {
  return exactKeys(value, [
    "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
    "evidenceRulesVersion",
  ]) && typeof value.countryCode === "string" && /^[A-Z]{2}$/.test(value.countryCode) &&
    identifier(value.packageId) && identifier(value.packageSchemaVersion) &&
    identifier(value.catalogRevisionId) && identifier(value.evidenceRulesVersion);
}

function appendManifest(
  prepared: InstalledCityPackageManifestAppendInput,
  captured: CapturedPorts,
): unknown {
  try {
    return Reflect.apply(captured.manifestAppend.fn, captured.manifestAppend.receiver, [prepared]);
  } catch (error) {
    return normalizeStageError(error, [
      "city_package_behavior_unavailable",
      "integrity_mismatch",
    ]);
  }
}

function artifactBindingMatches(
  actual: unknown,
  expected: unknown,
  integrity: CityDecisionIntegrity,
): boolean {
  return sameCanonical(actual, expected, integrity);
}

function validateManifestFixedPlans(
  payload: InstalledCityPackageManifestPayload,
  prepared: InstalledCityPackageManifestAppendInput,
  memberIds: readonly string[],
  integrity: CityDecisionIntegrity,
): void {
  if (!exactKeys(payload.fixedPlansByCityId, memberIds)) mismatch();
  for (let memberIndex = 0; memberIndex < memberIds.length; memberIndex += 1) {
    const cityId = memberIds[memberIndex]!;
    const actualTuple = payload.fixedPlansByCityId[cityId];
    const expectedTuple = prepared.fixedPlansByCityId[cityId];
    if (!denseArray(actualTuple, FIXED_SOURCE_IDS.length) || expectedTuple === undefined) mismatch();
    for (let sourceIndex = 0; sourceIndex < FIXED_SOURCE_IDS.length; sourceIndex += 1) {
      const actual = actualTuple[sourceIndex];
      const expected = expectedTuple[sourceIndex];
      if (!exactKeys(actual, [
        "sourceId", "cityId", "planId", "criterionId", "definitionId", "parserVersion",
        "rulesVersion", "freshnessPolicyVersion", "valuePolicyVersion",
        "sourcePeriodPolicyVersion", "planArtifact",
      ]) || actual.sourceId !== expected.sourceId || actual.cityId !== expected.cityId ||
        actual.planId !== expected.planId || actual.criterionId !== expected.criterionId ||
        actual.definitionId !== expected.definitionId || actual.parserVersion !== expected.parserVersion ||
        actual.rulesVersion !== expected.rulesVersion ||
        actual.freshnessPolicyVersion !== expected.claimContract.freshnessPolicyVersion ||
        !identifier(actual.valuePolicyVersion) || !identifier(actual.sourcePeriodPolicyVersion) ||
        !artifactBindingMatches(
          actual.planArtifact,
          prepared.administrativeEvidence.bindings[memberIndex * FIXED_SOURCE_IDS.length + sourceIndex],
          integrity,
        )) mismatch();
    }
  }
}

function validateManifestSafety(
  payload: InstalledCityPackageManifestPayload,
  prepared: InstalledCityPackageManifestAppendInput,
  singletonOffset: number,
  integrity: CityDecisionIntegrity,
): void {
  const safety = payload.safety;
  const expected = prepared.safetySourcePlan;
  if (!exactKeys(safety, [
    "sourcePlanId", "sourcePlanSchemaVersion", "authorityDirectoryId", "queryTemplateVersion",
    "definitionId", "freshnessPolicyVersion", "discoveryRulesVersion", "sourcePlanArtifact",
    "authorityDirectoryArtifact",
  ]) || safety.sourcePlanId !== expected.id ||
    safety.sourcePlanSchemaVersion !== expected.schemaVersion ||
    safety.authorityDirectoryId !== expected.authorityDirectoryId ||
    safety.queryTemplateVersion !== expected.queryTemplateVersion ||
    safety.definitionId !== expected.definitionId ||
    safety.freshnessPolicyVersion !== expected.freshnessPolicyVersion ||
    safety.discoveryRulesVersion !== expected.discoveryRulesVersion ||
    !artifactBindingMatches(
      safety.sourcePlanArtifact,
      prepared.administrativeEvidence.bindings[singletonOffset],
      integrity,
    ) || !artifactBindingMatches(
      safety.authorityDirectoryArtifact,
      prepared.administrativeEvidence.bindings[singletonOffset + 1],
      integrity,
    )) mismatch();
}

function validateManifestCriteria(
  payload: InstalledCityPackageManifestPayload,
  prepared: InstalledCityPackageManifestAppendInput,
  singletonOffset: number,
  integrity: CityDecisionIntegrity,
): void {
  const criteria = payload.criteria;
  const definitionIds = expectedDefinitionIds(prepared.criteriaDefaults);
  if (!exactKeys(criteria, [
    "defaultsMappingVersion", "definitionIds", "evaluatorRegistryVersionId",
    "evaluatorVersionIds", "defaultsArtifact", "definitionsArtifact",
  ]) || criteria.defaultsMappingVersion !== prepared.criteriaDefaults.mappingVersion ||
    !exactKeys(criteria.definitionIds, CITY_CRITERION_IDS) ||
    !CITY_CRITERION_IDS.every((criterionId) =>
      criteria.definitionIds[criterionId] === definitionIds[criterionId]) ||
    !identifier(criteria.evaluatorRegistryVersionId) ||
    !exactKeys(criteria.evaluatorVersionIds, CITY_CRITERION_IDS) ||
    !CITY_CRITERION_IDS.every((criterionId) =>
      identifier(criteria.evaluatorVersionIds[criterionId])) ||
    !artifactBindingMatches(
      criteria.defaultsArtifact,
      prepared.administrativeEvidence.bindings[singletonOffset + 2],
      integrity,
    ) || !artifactBindingMatches(
      criteria.definitionsArtifact,
      prepared.administrativeEvidence.bindings[singletonOffset + 3],
      integrity,
    )) mismatch();
}

function ownAndVerifyManifest(
  borrowed: unknown,
  prepared: InstalledCityPackageManifestAppendInput,
  derivedKey: InstalledCityPackageExactKey,
  integrity: EvidenceIntegrity,
): InstalledCityPackageManifest {
  const manifest = ownJson(borrowed);
  if (!exactKeys(manifest, MANIFEST_KEYS) || !SHA256.test(String(manifest.payloadHash)) ||
    !SHA256.test(String(manifest.hmac)) || typeof manifest.id !== "string") mismatch();
  const payload = deepFreeze(Object.fromEntries(MANIFEST_PAYLOAD_KEYS.map((key) => [
    key,
    manifest[key],
  ])) as unknown as InstalledCityPackageManifestPayload);
  const canonicalPayload = integrity.canonical(payload);
  const payloadHash = integrity.hash(canonicalPayload);
  if (manifest.payloadHash !== payloadHash ||
    manifest.id !== `installed-city-package-manifest:${payloadHash}`) mismatch();
  const expectedHmac = integrity.sign(canonicalPayload);
  if (manifest.hmac !== expectedHmac) mismatch();

  const memberIds = prepared.catalog.catalog.members.map(({ cityId }) => cityId);
  if (payload.schemaVersion !== "installed-city-package-manifest@1" ||
    !validExactKey(payload.key) || !sameCanonical(payload.key, derivedKey, integrity) ||
    !sameCanonical(payload.definition, prepared.ready.definition, integrity) ||
    payload.sourceContractStatus !== prepared.ready.sourceContractStatus ||
    !sameCanonical(payload.readiness, prepared.ready.readiness, integrity) ||
    !exactKeys(payload.catalogRoot, ["registryRevisionId", "catalogRevisionId"]) ||
    payload.catalogRoot.registryRevisionId !== prepared.catalog.registry.id ||
    payload.catalogRoot.catalogRevisionId !== prepared.catalog.catalog.id ||
    payload.installedAt !== prepared.installedAt ||
    !identifier(payload.valueValidatorVersionId) ||
    !identifier(payload.sourcePeriodValidatorVersionId) ||
    !(payload.predecessorManifestId === null || identifier(payload.predecessorManifestId))) {
    mismatch();
  }
  validateManifestFixedPlans(payload, prepared, memberIds, integrity);
  const singletonOffset = memberIds.length * FIXED_SOURCE_IDS.length;
  validateManifestSafety(payload, prepared, singletonOffset, integrity);
  validateManifestCriteria(payload, prepared, singletonOffset, integrity);
  return deepFreeze({
    ...payload,
    id: manifest.id,
    payloadHash: manifest.payloadHash,
    hmac: manifest.hmac,
  });
}

const INSTALLED_PACKAGE_KEYS = [
  "definition",
  "sourceContractStatus",
  "readiness",
  "installedPackageManifest",
  "registry",
  "catalog",
  "criteriaDefaults",
  "criterionDefinitions",
  "evaluatorRegistry",
  "fixedPlansByCityId",
  "safetySourcePlan",
  "officialAuthorityDirectory",
  "validateValue",
  "validateSourcePeriod",
] as const;

function ownCapability(value: unknown): (...args: never[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Function.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const permitted = new Set(["length", "name", "prototype"]);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!permitted.has(key) || !("value" in descriptor)) mismatch();
  }
  return value as (...args: never[]) => unknown;
}

function ownEvaluatorRegistry(value: unknown): CityCriterionEvaluatorRegistry {
  const registry = exactRootValues(value, CITY_CRITERION_IDS);
  const definitions: CityCriterionDefinition[] = [];
  const evaluators = Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const evaluator = exactRootValues(
      registry[criterionId],
      ["definition", "canonicalizeTarget", "evaluate"],
    );
    const definition = ownJson(evaluator.definition) as CityCriterionDefinition;
    definitions.push(definition);
    const canonicalize = ownCapability(evaluator.canonicalizeTarget);
    const evaluate = ownCapability(evaluator.evaluate);
    const receiver = Object.freeze({ criterionId });
    const canonicalizeTarget = Object.freeze(function canonicalizeTarget(target: unknown): string {
      return Reflect.apply(canonicalize, receiver, [mutableJson(target)]) as string;
    });
    const evaluateOwned = Object.freeze(function evaluateOwned(input: unknown) {
      return Reflect.apply(evaluate, receiver, [mutableJson(input)]);
    });
    return [criterionId, Object.freeze({
      definition,
      canonicalizeTarget,
      evaluate: evaluateOwned,
    })];
  })) as unknown as CityCriterionEvaluatorRegistry;
  const definitionIds = Object.freeze(Object.fromEntries(definitions.map((definition) => [
    definition.criterionId,
    definition.definitionId,
  ])) as Record<CityCriterionId, string>);
  reconstructInstalledCityCriterionDefinitionsStructure(definitions, definitionIds);
  return Object.freeze(evaluators);
}

function ownInstalledPackage(borrowed: unknown): InstalledCityResearchPackage {
  const root = exactRootValues(borrowed, INSTALLED_PACKAGE_KEYS);
  const validateValueFunction = ownCapability(root.validateValue);
  const validateSourcePeriodFunction = ownCapability(root.validateSourcePeriod);
  const valueReceiver = Object.freeze({ capability: "validateValue" });
  const periodReceiver = Object.freeze({ capability: "validateSourcePeriod" });
  const validateValue = Object.freeze(((input) => Reflect.apply(
    validateValueFunction,
    valueReceiver,
    [mutableJson(input)],
  )) as CityFixedValueValidator);
  const validateSourcePeriod = Object.freeze(((input) => Reflect.apply(
    validateSourcePeriodFunction,
    periodReceiver,
    [mutableJson(input)],
  )) as CityFixedSourcePeriodValidator);
  return Object.freeze({
    definition: ownJson(root.definition),
    sourceContractStatus: root.sourceContractStatus,
    readiness: ownJson(root.readiness),
    installedPackageManifest: ownJson(root.installedPackageManifest),
    registry: ownJson(root.registry),
    catalog: ownJson(root.catalog),
    criteriaDefaults: ownJson(root.criteriaDefaults),
    criterionDefinitions: ownJson(root.criterionDefinitions),
    evaluatorRegistry: ownEvaluatorRegistry(root.evaluatorRegistry),
    fixedPlansByCityId: ownJson(root.fixedPlansByCityId),
    safetySourcePlan: ownJson(root.safetySourcePlan),
    officialAuthorityDirectory: ownJson(root.officialAuthorityDirectory),
    validateValue,
    validateSourcePeriod,
  } as InstalledCityResearchPackage);
}

function validateInstalledPackage(
  installed: InstalledCityResearchPackage,
  manifest: InstalledCityPackageManifest,
  prepared: InstalledCityPackageManifestAppendInput,
  derivedKey: InstalledCityPackageExactKey,
  integrity: CityDecisionIntegrity,
): void {
  if (!exactKeys(installed.installedPackageManifest, ["id", "key"]) ||
    installed.installedPackageManifest.id !== manifest.id ||
    !sameCanonical(installed.installedPackageManifest.key, derivedKey, integrity) ||
    !sameCanonical(installed.definition, prepared.ready.definition, integrity) ||
    installed.sourceContractStatus !== prepared.ready.sourceContractStatus ||
    !sameCanonical(installed.readiness, prepared.ready.readiness, integrity) ||
    !sameCanonical(installed.registry, prepared.catalog.registry, integrity) ||
    !sameCanonical(installed.catalog, prepared.catalog.catalog, integrity) ||
    !sameCanonical(installed.criteriaDefaults, prepared.criteriaDefaults, integrity) ||
    !sameCanonical(installed.criterionDefinitions, prepared.criterionDefinitions, integrity) ||
    !sameCanonical(installed.fixedPlansByCityId, prepared.fixedPlansByCityId, integrity) ||
    !sameCanonical(installed.safetySourcePlan, prepared.safetySourcePlan, integrity) ||
    !sameCanonical(
      installed.officialAuthorityDirectory,
      prepared.officialAuthorityDirectory,
      integrity,
    )) mismatch();
  const definitionIds = expectedDefinitionIds(prepared.criteriaDefaults);
  const installedDefinitions = reconstructInstalledCityCriterionDefinitionsStructure(
    installed.criterionDefinitions,
    definitionIds,
  );
  for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
    const criterionId = CITY_CRITERION_IDS[index];
    if (!sameCanonical(
      installed.evaluatorRegistry[criterionId].definition,
      installedDefinitions[index],
      integrity,
    )) mismatch();
  }
}

function lookupExact(
  key: InstalledCityPackageExactKey,
  captured: CapturedPorts,
): unknown {
  try {
    return Reflect.apply(captured.packageLookup.fn, captured.packageLookup.receiver, [key]);
  } catch (error) {
    return normalizeStageError(error);
  }
}

export async function installCityPackage(
  borrowedInput: InstallCityPackageInput,
  borrowedPorts: InstallCityPackagePorts,
): Promise<InstalledCityResearchPackage> {
  const input = ownInput(borrowedInput);
  const captured = capturePorts(borrowedPorts);
  const ready = resolveReady(input, captured);
  bindReadyIdentity(input, ready);
  const { decision: decisionIntegrity, sealing: sealingIntegrity } = integrityViews(captured);
  const expectedCatalog = reconstructExpectedCatalog(input, ready, decisionIntegrity);
  const defaults = resolveDefaults(
    input,
    ready,
    captured.approvedDefaults,
    decisionIntegrity,
  );
  const installationData = reconstructInstallationData(
    input,
    ready,
    expectedCatalog,
    defaults,
    decisionIntegrity,
  );
  const loadedCatalog = appendAndLoadCatalog(expectedCatalog, captured, decisionIntegrity);
  const key = deriveKey(ready, expectedCatalog.catalog.id);
  const administrativeEvidence = await sealAdministrativeEvidence(
    input,
    key,
    expectedCatalog,
    installationData,
    defaults,
    captured,
    sealingIntegrity,
  );
  const prepared = Object.freeze({
    ready,
    catalog: loadedCatalog,
    administrativeEvidence,
    fixedPlansByCityId: installationData.fixedPlans,
    safetySourcePlan: installationData.safetyPlan,
    officialAuthorityDirectory: installationData.directory,
    criteriaDefaults: defaults,
    criterionDefinitions: installationData.definitions,
    installedAt: input.installedAt,
  } satisfies InstalledCityPackageManifestAppendInput);
  const manifest = ownAndVerifyManifest(
    appendManifest(prepared, captured),
    prepared,
    key,
    sealingIntegrity,
  );
  const installed = ownInstalledPackage(lookupExact(key, captured));
  validateInstalledPackage(installed, manifest, prepared, key, decisionIntegrity);
  return installed;
}
