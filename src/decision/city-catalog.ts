import {
  CITY_CATALOG_MEMBER_LIMIT,
  CITY_CATALOG_RULES_VERSION,
  LEGACY_CITY_CATALOG_RULES_VERSION,
  type CityDecisionIntegrity,
} from "./city-integrity";

export {
  CITY_CATALOG_MEMBER_LIMIT,
  CITY_CATALOG_RULES_VERSION,
  LEGACY_CITY_CATALOG_RULES_VERSION,
} from "./city-integrity";

export type CityCapitalRole = "national" | "regional";
export type CityCatalogInclusionReason =
  // Historical @1-only reasons.
  | "population_threshold"
  | "top_ten_fill"
  // Shared capital reasons.
  | "national_capital"
  | "regional_capital"
  // Current @2-only fill reason.
  | "population_fill";

export class CityCatalogNeedsContextError extends Error {
  readonly code = "mandatory_capitals_exceed_limit";
  readonly mandatoryCapitalCount: number;
  readonly memberLimit = CITY_CATALOG_MEMBER_LIMIT;

  constructor(mandatoryCapitalCount: number) {
    super("mandatory_capitals_exceed_limit");
    this.name = "CityCatalogNeedsContextError";
    this.mandatoryCapitalCount = mandatoryCapitalCount;
  }
}

export interface CityRegistryEntry {
  readonly cityId: string;
  readonly countryCode: string;
  readonly officialName: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly administrativeType: string;
  readonly administrativeTerritory: string;
  readonly capitalRoles: readonly CityCapitalRole[];
  readonly evidenceReferenceIds: readonly string[];
}

export interface CityCatalogCandidateBasis {
  readonly cityId: string;
  readonly comparablePopulation:
    | { readonly kind: "verified"; readonly value: string; readonly referencePeriod: string }
    | { readonly kind: "unknown"; readonly reason: "not_found" | "not_comparable" };
}

export interface CityRegistryRevision {
  readonly schemaVersion: "city-registry@1";
  readonly id: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceSnapshotId: string;
  readonly entries: readonly CityRegistryEntry[];
  readonly createdAt: string;
}

export interface CityCatalogMember {
  readonly cityId: string;
  readonly inclusionReasons: readonly CityCatalogInclusionReason[];
}

export interface CityCatalogRevision {
  readonly schemaVersion: "city-catalog@1";
  readonly id: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly registryRevisionId: string;
  readonly evidenceSnapshotId: string;
  readonly populationDefinition: {
    readonly definitionId: string;
    readonly geoScope: string;
    readonly unit: "people";
  };
  readonly candidateBasis: readonly CityCatalogCandidateBasis[];
  readonly members: readonly CityCatalogMember[];
  readonly coverage:
    | { readonly status: "complete" }
    | { readonly status: "incomplete"; readonly reasons: readonly ("missing_population" | "official_universe_partial")[] };
  readonly rulesVersion: "city-catalog@1" | "city-catalog@2";
  readonly createdAt: string;
}

export interface BuildCityRegistryInput {
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly countryCode: string;
  readonly evidenceSnapshotId: string;
  readonly entries: readonly CityRegistryEntry[];
  readonly createdAt: string;
}

export interface BuildCityCatalogInput {
  readonly registry: CityRegistryRevision;
  readonly evidenceSnapshotId: string;
  readonly populationDefinition: CityCatalogRevision["populationDefinition"];
  readonly candidateBasis: readonly CityCatalogCandidateBasis[];
  readonly coverage: CityCatalogRevision["coverage"];
  readonly createdAt: string;
}

export interface ReconstructCityCatalogInput {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
}

export interface CityCatalogProjection {
  readonly registry: CityRegistryRevision;
  readonly catalog: CityCatalogRevision;
}

const POPULATION_THRESHOLD = 20_000n;
const TOP_TEN_SIZE = 10;
const CAPITAL_ROLE_ORDER: readonly CityCapitalRole[] = ["national", "regional"];
const INCLUSION_REASON_ORDER: readonly CityCatalogInclusionReason[] = [
  "population_threshold",
  "national_capital",
  "regional_capital",
  "top_ten_fill",
  "population_fill",
];
const CURRENT_INCLUSION_REASON_ORDER: readonly CityCatalogInclusionReason[] = [
  "national_capital",
  "regional_capital",
  "population_fill",
];

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCanonicalInstant(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function descriptorSafeFrozenCopy<T>(borrowed: T): T {
  const active = new Set<object>();

  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      integrityMismatch();
    }

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) integrityMismatch();
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0) {
        integrityMismatch();
      }
      const length = lengthDescriptor.value;
      if (Object.getOwnPropertyNames(value).length !== length + 1) integrityMismatch();

      active.add(value);
      try {
        const owned: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            integrityMismatch();
          }
          owned.push(copy(descriptor.value));
        }
        return Object.freeze(owned);
      } finally {
        active.delete(value);
      }
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
    active.add(value);
    try {
      const entries = Object.getOwnPropertyNames(value).map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          integrityMismatch();
        }
        return [key, copy(descriptor.value)] as const;
      });
      return Object.freeze(Object.fromEntries(entries));
    } finally {
      active.delete(value);
    }
  };

  return copy(borrowed) as T;
}

function ordinalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cityOrder(left: { readonly cityId: string }, right: { readonly cityId: string }): number {
  return ordinalOrder(left.cityId, right.cityId);
}

function assertStringSet(values: unknown, permitted: readonly string[]): asserts values is readonly string[] {
  if (!Array.isArray(values) || !values.every(isNonEmptyString) ||
    new Set(values).size !== values.length || !values.every((value) => permitted.includes(value))) {
    throw new Error("invalid_registry_entry");
  }
}

function normalizeEntry(value: unknown, countryCode: string): CityRegistryEntry {
  if (!isRecord(value) || !hasExactKeys(value, [
    "cityId", "countryCode", "officialName", "coordinate", "administrativeType",
    "administrativeTerritory", "capitalRoles", "evidenceReferenceIds",
  ]) || !isNonEmptyString(value.cityId) || value.countryCode !== countryCode ||
    !isNonEmptyString(value.officialName) || !isNonEmptyString(value.administrativeType) ||
    !isNonEmptyString(value.administrativeTerritory) || !isRecord(value.coordinate) ||
    !hasExactKeys(value.coordinate, ["lat", "lng"]) || !isFiniteNumber(value.coordinate.lat) ||
    !isFiniteNumber(value.coordinate.lng) || value.coordinate.lat < -90 || value.coordinate.lat > 90 ||
    value.coordinate.lng < -180 || value.coordinate.lng > 180) {
    throw new Error("invalid_registry_entry");
  }
  const coordinate: CityRegistryEntry["coordinate"] = {
    lat: value.coordinate.lat as number,
    lng: value.coordinate.lng as number,
  };
  const capitalRoles = value.capitalRoles;
  const evidenceReferenceIds = value.evidenceReferenceIds;
  assertStringSet(capitalRoles, CAPITAL_ROLE_ORDER);
  if (!Array.isArray(evidenceReferenceIds) || evidenceReferenceIds.length === 0 ||
    !evidenceReferenceIds.every(isNonEmptyString) ||
    new Set(evidenceReferenceIds).size !== evidenceReferenceIds.length) {
    throw new Error("invalid_registry_entry");
  }
  return {
    cityId: value.cityId,
    countryCode,
    officialName: value.officialName,
    coordinate: { lat: coordinate.lat, lng: coordinate.lng },
    administrativeType: value.administrativeType,
    administrativeTerritory: value.administrativeTerritory,
    capitalRoles: CAPITAL_ROLE_ORDER.filter((role) => capitalRoles.includes(role)),
    evidenceReferenceIds: [...evidenceReferenceIds].sort(),
  };
}

function normalizeRegistryInput(value: unknown): Omit<CityRegistryRevision, "id" | "schemaVersion"> {
  if (!isRecord(value) || !hasExactKeys(value, [
    "packageId", "packageSchemaVersion", "countryCode", "evidenceSnapshotId", "entries", "createdAt",
  ]) || !isNonEmptyString(value.packageId) || !isNonEmptyString(value.packageSchemaVersion) ||
    !isNonEmptyString(value.countryCode) || !isNonEmptyString(value.evidenceSnapshotId) ||
    !isCanonicalInstant(value.createdAt) || !Array.isArray(value.entries)) {
    throw new Error("invalid_registry_input");
  }
  const packageId = value.packageId as string;
  const packageSchemaVersion = value.packageSchemaVersion as string;
  const countryCode = value.countryCode as string;
  const evidenceSnapshotId = value.evidenceSnapshotId as string;
  const rawEntries = value.entries as readonly unknown[];
  const createdAt = value.createdAt as string;
  const entries = rawEntries.map((entry) => normalizeEntry(entry, countryCode)).sort(cityOrder);
  if (new Set(entries.map(({ cityId }) => cityId)).size !== entries.length) {
    throw new Error("invalid_registry_entry");
  }
  return {
    packageId,
    packageSchemaVersion,
    countryCode,
    evidenceSnapshotId,
    entries,
    createdAt,
  };
}

function registryPayload(registry: Omit<CityRegistryRevision, "id">): Omit<CityRegistryRevision, "id"> {
  return registry;
}

function registryId(payload: Omit<CityRegistryRevision, "id">, integrity: CityDecisionIntegrity): string {
  return `city-registry:${integrity.hash(integrity.canonical(registryPayload(payload)))}`;
}

function decodeRegistry(value: unknown, integrity?: CityDecisionIntegrity): CityRegistryRevision {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schemaVersion", "id", "packageId", "packageSchemaVersion", "countryCode", "evidenceSnapshotId",
    "entries", "createdAt",
  ]) || value.schemaVersion !== "city-registry@1" || !isNonEmptyString(value.id)) integrityMismatch();
  const normalized = normalizeRegistryInput({
    packageId: value.packageId,
    packageSchemaVersion: value.packageSchemaVersion,
    countryCode: value.countryCode,
    evidenceSnapshotId: value.evidenceSnapshotId,
    entries: value.entries,
    createdAt: value.createdAt,
  });
  if (!sameValue(value.entries, normalized.entries)) integrityMismatch();
  const payload: Omit<CityRegistryRevision, "id"> = { schemaVersion: "city-registry@1", ...normalized };
  const registry: CityRegistryRevision = { id: value.id, ...payload };
  if (integrity !== undefined && registry.id !== registryId(payload, integrity)) {
    integrityMismatch();
  }
  return immutableCopy(registry);
}

function normalizePopulation(value: unknown): CityCatalogCandidateBasis["comparablePopulation"] {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) throw new Error("invalid_candidate_basis");
  if (value.kind === "verified" && hasExactKeys(value, ["kind", "value", "referencePeriod"]) &&
    typeof value.value === "string" && /^(?:0|[1-9]\d*)$/.test(value.value) &&
    isNonEmptyString(value.referencePeriod)) {
    return { kind: "verified", value: value.value, referencePeriod: value.referencePeriod };
  }
  if (value.kind === "unknown" && hasExactKeys(value, ["kind", "reason"]) &&
    (value.reason === "not_found" || value.reason === "not_comparable")) {
    return { kind: "unknown", reason: value.reason };
  }
  throw new Error("invalid_candidate_basis");
}

function normalizeCandidateBasis(
  value: unknown,
  registry: CityRegistryRevision,
): readonly CityCatalogCandidateBasis[] {
  if (!Array.isArray(value)) throw new Error("invalid_candidate_basis");
  const allowedIds = new Set(registry.entries.map(({ cityId }) => cityId));
  const candidates = value.map((candidate) => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["cityId", "comparablePopulation"]) ||
      !isNonEmptyString(candidate.cityId) || !allowedIds.has(candidate.cityId)) {
      throw new Error("invalid_candidate_basis");
    }
    return { cityId: candidate.cityId, comparablePopulation: normalizePopulation(candidate.comparablePopulation) };
  }).sort(cityOrder);
  if (candidates.length !== registry.entries.length ||
    new Set(candidates.map(({ cityId }) => cityId)).size !== candidates.length ||
    candidates.some(({ cityId }, index) => cityId !== registry.entries[index]?.cityId)) {
    throw new Error("invalid_candidate_basis");
  }
  if (new Set(candidates.flatMap(({ comparablePopulation }) =>
    comparablePopulation.kind === "verified" ? [comparablePopulation.referencePeriod] : [])).size > 1) {
    throw new Error("invalid_candidate_basis");
  }
  return candidates;
}

function normalizePopulationDefinition(value: unknown): CityCatalogRevision["populationDefinition"] {
  if (!isRecord(value) || !hasExactKeys(value, ["definitionId", "geoScope", "unit"]) ||
    !isNonEmptyString(value.definitionId) || !isNonEmptyString(value.geoScope) || value.unit !== "people") {
    throw new Error("invalid_population_definition");
  }
  return { definitionId: value.definitionId, geoScope: value.geoScope, unit: "people" };
}

function normalizeCoverage(
  value: unknown,
  candidates: readonly CityCatalogCandidateBasis[],
): CityCatalogRevision["coverage"] {
  const hasUnknownPopulation = candidates.some(({ comparablePopulation }) =>
    comparablePopulation.kind === "unknown");
  if (!isRecord(value) || !isNonEmptyString(value.status)) throw new Error("invalid_catalog_coverage");
  if (value.status === "complete" && hasExactKeys(value, ["status"]) && !hasUnknownPopulation) {
    return { status: "complete" };
  }
  if (value.status !== "incomplete" || !hasExactKeys(value, ["status", "reasons"]) ||
    !Array.isArray(value.reasons) || value.reasons.length === 0 ||
    new Set(value.reasons).size !== value.reasons.length ||
    !value.reasons.every((reason) => reason === "missing_population" || reason === "official_universe_partial") ||
    value.reasons.includes("missing_population") !== hasUnknownPopulation) {
    throw new Error("invalid_catalog_coverage");
  }
  const reasons = value.reasons as readonly ("missing_population" | "official_universe_partial")[];
  return {
    status: "incomplete",
    reasons: (["missing_population", "official_universe_partial"] as const)
      .filter((reason) => reasons.includes(reason)),
  };
}

function populationOf(candidate: CityCatalogCandidateBasis): bigint | undefined {
  return candidate.comparablePopulation.kind === "verified"
    ? BigInt(candidate.comparablePopulation.value)
    : undefined;
}

function calculateLegacyMembers(
  registry: CityRegistryRevision,
  candidates: readonly CityCatalogCandidateBasis[],
): readonly CityCatalogMember[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.cityId, candidate]));
  const memberReasons = new Map<string, Set<CityCatalogInclusionReason>>();
  for (const entry of registry.entries) {
    const candidate = candidatesById.get(entry.cityId)!;
    const reasons = new Set<CityCatalogInclusionReason>();
    if ((populationOf(candidate) ?? -1n) >= POPULATION_THRESHOLD) reasons.add("population_threshold");
    if (entry.capitalRoles.includes("national")) reasons.add("national_capital");
    if (entry.capitalRoles.includes("regional")) reasons.add("regional_capital");
    if (reasons.size > 0) memberReasons.set(entry.cityId, reasons);
  }
  const remaining = [...candidates]
    .filter(({ cityId, comparablePopulation }) =>
      !memberReasons.has(cityId) && comparablePopulation.kind === "verified")
    .sort((left, right) => {
      const populationDifference = populationOf(right)! > populationOf(left)!
        ? 1
        : populationOf(right)! < populationOf(left)! ? -1 : 0;
      return populationDifference || cityOrder(left, right);
    });
  for (const candidate of remaining.slice(0, Math.max(0, TOP_TEN_SIZE - memberReasons.size))) {
    memberReasons.set(candidate.cityId, new Set(["top_ten_fill"]));
  }
  return [...memberReasons.entries()]
    .map(([cityId, reasons]) => ({
      cityId,
      inclusionReasons: INCLUSION_REASON_ORDER.filter((reason) => reasons.has(reason)),
    }))
    .sort(cityOrder);
}

function calculateCurrentMembers(
  registry: CityRegistryRevision,
  candidates: readonly CityCatalogCandidateBasis[],
): readonly CityCatalogMember[] {
  const mandatoryReasons = new Map<string, Set<CityCatalogInclusionReason>>();
  for (const entry of registry.entries) {
    const reasons = new Set<CityCatalogInclusionReason>();
    if (entry.capitalRoles.includes("national")) reasons.add("national_capital");
    if (entry.capitalRoles.includes("regional")) reasons.add("regional_capital");
    if (reasons.size > 0) mandatoryReasons.set(entry.cityId, reasons);
  }
  if (mandatoryReasons.size > CITY_CATALOG_MEMBER_LIMIT) {
    throw new CityCatalogNeedsContextError(mandatoryReasons.size);
  }
  const populationFill = [...candidates]
    .filter(({ cityId, comparablePopulation }) =>
      !mandatoryReasons.has(cityId) && comparablePopulation.kind === "verified")
    .sort((left, right) => {
      const populationDifference = populationOf(right)! > populationOf(left)!
        ? 1
        : populationOf(right)! < populationOf(left)! ? -1 : 0;
      return populationDifference || cityOrder(left, right);
    })
    .slice(0, CITY_CATALOG_MEMBER_LIMIT - mandatoryReasons.size);
  for (const { cityId } of populationFill) {
    mandatoryReasons.set(cityId, new Set(["population_fill"]));
  }
  return [...mandatoryReasons.entries()]
    .map(([cityId, reasons]) => ({
      cityId,
      inclusionReasons: CURRENT_INCLUSION_REASON_ORDER.filter((reason) => reasons.has(reason)),
    }))
    .sort(cityOrder);
}

function calculateMembers(
  rulesVersion: CityCatalogRevision["rulesVersion"],
  registry: CityRegistryRevision,
  candidates: readonly CityCatalogCandidateBasis[],
): readonly CityCatalogMember[] {
  if (rulesVersion === LEGACY_CITY_CATALOG_RULES_VERSION) {
    return calculateLegacyMembers(registry, candidates);
  }
  if (rulesVersion === CITY_CATALOG_RULES_VERSION) {
    return calculateCurrentMembers(registry, candidates);
  }
  integrityMismatch();
}

function catalogPayload(catalog: Omit<CityCatalogRevision, "id">): Omit<CityCatalogRevision, "id"> {
  return catalog;
}

function catalogId(payload: Omit<CityCatalogRevision, "id">, integrity: CityDecisionIntegrity): string {
  return `city-catalog:${integrity.hash(integrity.canonical(catalogPayload(payload)))}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => ordinalOrder(left, right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function buildCatalog(
  input: unknown,
  integrity?: CityDecisionIntegrity,
  rulesVersion: CityCatalogRevision["rulesVersion"] = CITY_CATALOG_RULES_VERSION,
): CityCatalogRevision {
  if (!isRecord(input) || !hasExactKeys(input, [
    "registry", "evidenceSnapshotId", "populationDefinition", "candidateBasis", "coverage", "createdAt",
  ]) || !isNonEmptyString(input.evidenceSnapshotId) || !isCanonicalInstant(input.createdAt)) {
    throw new Error("invalid_catalog_input");
  }
  const registry = decodeRegistry(input.registry, integrity);
  const candidateBasis = normalizeCandidateBasis(input.candidateBasis, registry);
  const populationDefinition = normalizePopulationDefinition(input.populationDefinition);
  const coverage = normalizeCoverage(input.coverage, candidateBasis);
  const catalogWithoutId: Omit<CityCatalogRevision, "id"> = {
    schemaVersion: "city-catalog@1",
    packageId: registry.packageId,
    packageSchemaVersion: registry.packageSchemaVersion,
    countryCode: registry.countryCode,
    registryRevisionId: registry.id,
    evidenceSnapshotId: input.evidenceSnapshotId,
    populationDefinition,
    candidateBasis,
    members: calculateMembers(rulesVersion, registry, candidateBasis),
    coverage,
    rulesVersion,
    createdAt: input.createdAt,
  };
  return integrity === undefined
    ? ({ id: "", ...catalogWithoutId } as CityCatalogRevision)
    : immutableCopy({ id: catalogId(catalogWithoutId, integrity), ...catalogWithoutId });
}

export function buildCityRegistryRevision(
  input: BuildCityRegistryInput,
  integrity: CityDecisionIntegrity,
): CityRegistryRevision {
  const normalized = normalizeRegistryInput(input);
  const payload: Omit<CityRegistryRevision, "id"> = { schemaVersion: "city-registry@1", ...normalized };
  return immutableCopy({ id: registryId(payload, integrity), ...payload });
}

export function buildCityCatalogRevision(
  input: BuildCityCatalogInput,
  integrity: CityDecisionIntegrity,
): CityCatalogRevision {
  return buildCatalog(input, integrity);
}

export function reconstructCityCatalog(input: ReconstructCityCatalogInput): CityCatalogProjection {
  if (!isRecord(input) || !hasExactKeys(input, ["registry", "catalog"])) integrityMismatch();
  let registry: CityRegistryRevision;
  try {
    registry = decodeRegistry(input.registry);
  } catch {
    integrityMismatch();
  }
  const catalog = input.catalog;
  if (!isRecord(catalog) || !hasExactKeys(catalog, [
    "schemaVersion", "id", "packageId", "packageSchemaVersion", "countryCode", "registryRevisionId",
    "evidenceSnapshotId", "populationDefinition", "candidateBasis", "members", "coverage", "rulesVersion",
    "createdAt",
  ]) || catalog.schemaVersion !== "city-catalog@1" ||
    (catalog.rulesVersion !== LEGACY_CITY_CATALOG_RULES_VERSION &&
      catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) ||
    !isNonEmptyString(catalog.id) || catalog.registryRevisionId !== registry.id ||
    catalog.packageId !== registry.packageId || catalog.packageSchemaVersion !== registry.packageSchemaVersion ||
    catalog.countryCode !== registry.countryCode) integrityMismatch();
  let reconstructed: CityCatalogRevision;
  try {
    reconstructed = buildCatalog({
      registry,
      evidenceSnapshotId: catalog.evidenceSnapshotId,
      populationDefinition: catalog.populationDefinition,
      candidateBasis: catalog.candidateBasis,
      coverage: catalog.coverage,
      createdAt: catalog.createdAt,
    }, undefined, catalog.rulesVersion);
  } catch {
    integrityMismatch();
  }
  if (!sameValue(reconstructed.candidateBasis, catalog.candidateBasis) ||
    !sameValue(reconstructed.members, catalog.members) || !sameValue(reconstructed.coverage, catalog.coverage)) {
    integrityMismatch();
  }
  return immutableCopy({ registry, catalog: catalog as CityCatalogRevision });
}

export function reconstructVerifiedCityCatalog(
  input: ReconstructCityCatalogInput,
  integrity: CityDecisionIntegrity,
): CityCatalogProjection {
  try {
    const ownedInput = descriptorSafeFrozenCopy(input);
    if (!isRecord(ownedInput) || !hasExactKeys(ownedInput, ["registry", "catalog"]) ||
      integrity === null || typeof integrity !== "object" || typeof integrity.canonical !== "function" ||
      typeof integrity.hash !== "function") integrityMismatch();
    const registry = decodeRegistry(ownedInput.registry, integrity);
    const suppliedCatalog = ownedInput.catalog;
    if (!isRecord(suppliedCatalog) || !hasExactKeys(suppliedCatalog, [
      "schemaVersion", "id", "packageId", "packageSchemaVersion", "countryCode",
      "registryRevisionId", "evidenceSnapshotId", "populationDefinition", "candidateBasis",
      "members", "coverage", "rulesVersion", "createdAt",
    ]) || suppliedCatalog.schemaVersion !== "city-catalog@1" ||
      (suppliedCatalog.rulesVersion !== LEGACY_CITY_CATALOG_RULES_VERSION &&
        suppliedCatalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) ||
      suppliedCatalog.registryRevisionId !== registry.id ||
      suppliedCatalog.packageId !== registry.packageId ||
      suppliedCatalog.packageSchemaVersion !== registry.packageSchemaVersion ||
      suppliedCatalog.countryCode !== registry.countryCode) integrityMismatch();
    const reconstructed = buildCatalog({
      registry,
      evidenceSnapshotId: suppliedCatalog.evidenceSnapshotId,
      populationDefinition: suppliedCatalog.populationDefinition,
      candidateBasis: suppliedCatalog.candidateBasis,
      coverage: suppliedCatalog.coverage,
      createdAt: suppliedCatalog.createdAt,
    }, integrity, suppliedCatalog.rulesVersion);
    if (integrity.canonical(reconstructed) !== integrity.canonical(suppliedCatalog)) {
      integrityMismatch();
    }
    return immutableCopy({ registry, catalog: reconstructed });
  } catch {
    integrityMismatch();
  }
}
