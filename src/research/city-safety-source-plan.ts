import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";

export type OfficialRetentionMode =
  | "seal_raw_artifact"
  | "seal_hash_locator_then_delete_transient";

export interface OfficialPublisherPolicy {
  readonly publisherId: string;
  readonly authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality";
  readonly navigationUrl: string;
  readonly allowedHosts: readonly string[];
  readonly delegatedDocumentHosts: readonly string[];
  readonly allowedMediaTypes: readonly string[];
  readonly maxBytes: number;
  readonly redirectPolicyVersion: "official-chain@1";
  readonly documentLocatorPolicyId: string;
  readonly retentionPolicyId: string;
  readonly retentionMode: OfficialRetentionMode;
}

export interface OfficialMunicipalityPolicy {
  readonly cityId: string;
  readonly settlementCode: string;
  readonly municipalityCode: string;
  readonly officialCityNames: readonly string[];
  readonly officialMunicipalityNames: readonly string[];
  readonly publisherId: string;
  readonly officialHost: string;
}

export interface OfficialAuthorityDirectory {
  readonly schemaVersion: "official-authority-directory@1";
  readonly id: string;
  readonly countryCode: "SI";
  readonly catalogRevisionId: string;
  readonly requiredPublisherIds: {
    readonly police: string;
    readonly gov: string;
    readonly opsi: string;
    readonly surs: string;
  };
  readonly publishers: readonly OfficialPublisherPolicy[];
  readonly municipalities: readonly OfficialMunicipalityPolicy[];
  readonly rulesVersion: "slovenia-official-authorities@1";
}

export interface CitySafetyConfiguredRoute {
  readonly publisherId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl?: string;
}

export interface CitySafetySourcePlanEntry {
  readonly cityId: string;
  readonly settlementCode: string;
  readonly municipalityCode: string;
  readonly officialCityNames: readonly string[];
  readonly officialMunicipalityNames: readonly string[];
  readonly publisherIds: readonly string[];
  readonly configuredRoutes: readonly CitySafetyConfiguredRoute[];
}

export interface CitySafetySourcePlan {
  readonly schemaVersion: "city-safety-source-plan@1";
  readonly id: string;
  readonly catalogRevisionId: string;
  readonly authorityDirectoryId: string;
  readonly entries: readonly CitySafetySourcePlanEntry[];
  readonly queryTemplateVersion: "slovenia-municipal-safety-query@1";
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly freshnessPolicyVersion: "municipal-annual-july-boundary@1";
  readonly discoveryRulesVersion: "city-safety-discovery@1";
}

const REQUIRED_AUTHORITY_KINDS = {
  police: "police",
  gov: "government",
  opsi: "open_data",
  surs: "statistics",
} as const;

const PUBLISHER_KINDS = new Set<OfficialPublisherPolicy["authorityKind"]>([
  "police", "government", "open_data", "statistics", "municipality",
]);
const RETENTION_MODES = new Set<OfficialRetentionMode>([
  "seal_raw_artifact", "seal_hash_locator_then_delete_transient",
]);
const DIRECTORY_KEYS = [
  "schemaVersion", "countryCode", "catalogRevisionId", "requiredPublisherIds",
  "publishers", "municipalities", "rulesVersion",
] as const;
const PUBLISHER_KEYS = [
  "publisherId", "authorityKind", "navigationUrl", "allowedHosts",
  "delegatedDocumentHosts", "allowedMediaTypes", "maxBytes", "redirectPolicyVersion",
  "documentLocatorPolicyId", "retentionPolicyId", "retentionMode",
] as const;
const MUNICIPALITY_KEYS = [
  "cityId", "settlementCode", "municipalityCode", "officialCityNames",
  "officialMunicipalityNames", "publisherId", "officialHost",
] as const;
const ENTRY_KEYS = [
  "cityId", "settlementCode", "municipalityCode", "officialCityNames",
  "officialMunicipalityNames", "publisherIds", "configuredRoutes",
] as const;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(ordinalOrder);
  const canonicalExpected = [...expected].sort(ordinalOrder);
  return actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index]);
}

function ordinalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIdentifier(value: unknown): value is string {
  return isNonEmptyString(value) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

function isVersionedPolicyId(value: unknown): value is string {
  return isNonEmptyString(value) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*@[1-9][0-9]*$/.test(value);
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

function sameCanonical(left: unknown, right: unknown, integrity: CityDecisionIntegrity): boolean {
  try {
    return integrity.canonical(left) === integrity.canonical(right);
  } catch {
    return false;
  }
}

function normalizeStringSet(
  value: unknown,
  error: string,
  options: { readonly allowEmpty?: boolean; readonly validate?: (item: string) => boolean } = {},
): readonly string[] {
  if (!isDenseArray(value) || (!options.allowEmpty && value.length === 0) ||
    !value.every(isNonEmptyString) || new Set(value).size !== value.length ||
    (options.validate !== undefined && !value.every(options.validate))) throw new Error(error);
  return [...value].sort(ordinalOrder);
}

function normalizeOrderedNames(value: unknown): readonly string[] {
  if (!isDenseArray(value) || value.length === 0 || !value.every((name): name is string =>
    isNonEmptyString(name) && name.trim() === name && !/[\u0000-\u001f\u007f]/.test(name)) ||
    new Set(value).size !== value.length) throw new Error("invalid_official_municipality");
  return [...value];
}

function canonicalHost(value: unknown): value is string {
  if (!isNonEmptyString(value) || value !== value.toLowerCase() || value.includes("*") ||
    value.endsWith(".") || value.includes(":")) return false;
  try {
    const parsed = new URL(`https://${value}/`);
    return parsed.hostname === value && parsed.host === value && parsed.href === `https://${value}/`;
  } catch {
    return false;
  }
}

function containsForbiddenEncoding(value: string): boolean {
  return /%[0-9a-fA-F]{2}/.test(value) && [...value.matchAll(/%([0-9a-fA-F]{2})/g)]
    .some(([, hex]) => {
      const code = Number.parseInt(hex!, 16);
      return code <= 0x1f || code === 0x7f ||
        /^[A-Za-z0-9._~-]$/.test(String.fromCharCode(code));
    });
}

function parseCanonicalHttpsUrl(value: unknown, error: string): URL {
  if (!isNonEmptyString(value) || value.trim() !== value || value.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    containsForbiddenEncoding(value)) throw new Error(error);
  try {
    const parsed = new URL(value);
    const authority = value.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
      parsed.hash !== "" || parsed.port !== "" || authority.includes(":") || authority.includes("@") ||
      parsed.hostname !== parsed.hostname.toLowerCase() || parsed.hostname.includes("*") ||
      parsed.hostname.endsWith(".") || (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) ||
      parsed.href !== value) throw new Error(error);
    return parsed;
  } catch {
    throw new Error(error);
  }
}

function normalizePublisher(value: unknown): OfficialPublisherPolicy {
  if (!isRecord(value) || !hasExactKeys(value, PUBLISHER_KEYS) ||
    !isIdentifier(value.publisherId) || !PUBLISHER_KINDS.has(value.authorityKind as never) ||
    !Number.isSafeInteger(value.maxBytes) || (value.maxBytes as number) <= 0 ||
    value.redirectPolicyVersion !== "official-chain@1" ||
    !isVersionedPolicyId(value.documentLocatorPolicyId) ||
    !isVersionedPolicyId(value.retentionPolicyId) ||
    !RETENTION_MODES.has(value.retentionMode as never)) throw new Error("invalid_official_publisher");

  const navigationUrl = parseCanonicalHttpsUrl(value.navigationUrl, "invalid_official_publisher");
  const allowedHosts = normalizeStringSet(value.allowedHosts, "invalid_official_publisher", {
    validate: canonicalHost,
  });
  const delegatedDocumentHosts = normalizeStringSet(
    value.delegatedDocumentHosts,
    "invalid_official_publisher",
    { allowEmpty: true, validate: canonicalHost },
  );
  const allowedMediaTypes = normalizeStringSet(value.allowedMediaTypes, "invalid_official_publisher", {
    validate: (item) => /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(item),
  });
  if (!allowedHosts.includes(navigationUrl.hostname)) throw new Error("invalid_official_publisher");
  return {
    publisherId: value.publisherId,
    authorityKind: value.authorityKind as OfficialPublisherPolicy["authorityKind"],
    navigationUrl: value.navigationUrl as string,
    allowedHosts,
    delegatedDocumentHosts,
    allowedMediaTypes,
    maxBytes: value.maxBytes as number,
    redirectPolicyVersion: "official-chain@1",
    documentLocatorPolicyId: value.documentLocatorPolicyId,
    retentionPolicyId: value.retentionPolicyId,
    retentionMode: value.retentionMode as OfficialRetentionMode,
  };
}

function normalizeMunicipality(value: unknown): OfficialMunicipalityPolicy {
  if (!isRecord(value) || !hasExactKeys(value, MUNICIPALITY_KEYS) || !isIdentifier(value.cityId) ||
    typeof value.settlementCode !== "string" || !/^[0-9]{6}$/.test(value.settlementCode) ||
    typeof value.municipalityCode !== "string" || !/^[0-9]{3}$/.test(value.municipalityCode) ||
    !value.settlementCode.startsWith(value.municipalityCode) || !isIdentifier(value.publisherId) ||
    !canonicalHost(value.officialHost)) throw new Error("invalid_official_municipality");
  return {
    cityId: value.cityId,
    settlementCode: value.settlementCode,
    municipalityCode: value.municipalityCode,
    officialCityNames: normalizeOrderedNames(value.officialCityNames),
    officialMunicipalityNames: normalizeOrderedNames(value.officialMunicipalityNames),
    publisherId: value.publisherId,
    officialHost: value.officialHost,
  };
}

function normalizeRequiredPublisherIds(value: unknown): OfficialAuthorityDirectory["requiredPublisherIds"] {
  if (!isRecord(value) || !hasExactKeys(value, ["police", "gov", "opsi", "surs"]) ||
    !isIdentifier(value.police) || !isIdentifier(value.gov) || !isIdentifier(value.opsi) ||
    !isIdentifier(value.surs) || new Set([value.police, value.gov, value.opsi, value.surs]).size !== 4) {
    throw new Error("invalid_required_publishers");
  }
  return { police: value.police, gov: value.gov, opsi: value.opsi, surs: value.surs };
}

function normalizeDirectoryPayload(value: unknown): Omit<OfficialAuthorityDirectory, "id"> {
  if (!isRecord(value) || !hasExactKeys(value, DIRECTORY_KEYS) ||
    value.schemaVersion !== "official-authority-directory@1" || value.countryCode !== "SI" ||
    !isNonEmptyString(value.catalogRevisionId) || value.rulesVersion !== "slovenia-official-authorities@1" ||
    !isDenseArray(value.publishers) || !isDenseArray(value.municipalities)) {
    throw new Error("invalid_official_authority_directory");
  }
  const requiredPublisherIds = normalizeRequiredPublisherIds(value.requiredPublisherIds);
  const publishers = value.publishers.map(normalizePublisher)
    .sort((left, right) => ordinalOrder(left.publisherId, right.publisherId));
  const municipalities = value.municipalities.map(normalizeMunicipality)
    .sort((left, right) => ordinalOrder(left.cityId, right.cityId));
  if (publishers.length === 0 || new Set(publishers.map(({ publisherId }) => publisherId)).size !== publishers.length ||
    municipalities.length === 0 || new Set(municipalities.map(({ cityId }) => cityId)).size !== municipalities.length) {
    throw new Error("invalid_official_authority_directory");
  }
  const publishersById = new Map(publishers.map((policy) => [policy.publisherId, policy]));
  for (const [role, expectedKind] of Object.entries(REQUIRED_AUTHORITY_KINDS)) {
    const publisherId = requiredPublisherIds[role as keyof typeof REQUIRED_AUTHORITY_KINDS];
    if (publishersById.get(publisherId)?.authorityKind !== expectedKind) {
      throw new Error("invalid_required_publishers");
    }
  }
  for (const policy of municipalities) {
    const publisherPolicy = publishersById.get(policy.publisherId);
    if (publisherPolicy?.authorityKind !== "municipality" ||
      !publisherPolicy.allowedHosts.includes(policy.officialHost) ||
      new URL(publisherPolicy.navigationUrl).hostname !== policy.officialHost) {
      throw new Error("invalid_official_municipality");
    }
  }
  const referencedPublisherIds = new Set([
    ...Object.values(requiredPublisherIds),
    ...municipalities.map(({ publisherId }) => publisherId),
  ]);
  if (publishers.some(({ publisherId }) => !referencedPublisherIds.has(publisherId)) ||
    referencedPublisherIds.size !== publishers.length) throw new Error("invalid_official_authority_directory");
  return {
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: value.catalogRevisionId,
    requiredPublisherIds,
    publishers,
    municipalities,
    rulesVersion: "slovenia-official-authorities@1",
  };
}

function directoryId(
  payload: Omit<OfficialAuthorityDirectory, "id">,
  integrity: CityDecisionIntegrity,
): string {
  return `official-authority-directory:${integrity.hash(integrity.canonical(payload))}`;
}

function assertCatalogContext(catalog: CityCatalogRevision): readonly string[] {
  if (!isRecord(catalog) || catalog.schemaVersion !== "city-catalog@1" || catalog.countryCode !== "SI" ||
    !isNonEmptyString(catalog.id) || !isDenseArray(catalog.members)) throw new Error("invalid_city_catalog");
  const memberIds = catalog.members.map((member) => {
    if (!isRecord(member) || !hasExactKeys(member, ["cityId", "inclusionReasons"]) ||
      !isIdentifier(member.cityId) || !isDenseArray(member.inclusionReasons)) throw new Error("invalid_city_catalog");
    return member.cityId;
  });
  if (memberIds.length === 0 || new Set(memberIds).size !== memberIds.length ||
    memberIds.some((cityId, index) => index > 0 && ordinalOrder(memberIds[index - 1]!, cityId) >= 0)) {
    throw new Error("invalid_city_catalog");
  }
  return memberIds;
}

function assertDirectoryCatalogBinding(
  directory: OfficialAuthorityDirectory,
  catalog: CityCatalogRevision,
): void {
  const memberIds = assertCatalogContext(catalog);
  if (directory.countryCode !== "SI" || directory.catalogRevisionId !== catalog.id ||
    directory.municipalities.length !== memberIds.length ||
    directory.municipalities.some(({ cityId }, index) => cityId !== memberIds[index])) {
    throw new Error("invalid_official_authority_directory");
  }
}

export function buildOfficialAuthorityDirectory(
  input: Omit<OfficialAuthorityDirectory, "id">,
  integrity: CityDecisionIntegrity,
): OfficialAuthorityDirectory {
  const payload = normalizeDirectoryPayload(input);
  return immutableCopy({ ...payload, id: directoryId(payload, integrity) });
}

export function reconstructOfficialAuthorityDirectory(
  value: unknown,
  catalog: CityCatalogRevision,
  integrity: CityDecisionIntegrity,
): OfficialAuthorityDirectory {
  try {
    if (!isRecord(value) || !hasExactKeys(value, ["id", ...DIRECTORY_KEYS]) || !isNonEmptyString(value.id)) {
      integrityMismatch();
    }
    const payload = normalizeDirectoryPayload(Object.fromEntries(
      DIRECTORY_KEYS.map((key) => [key, value[key]]),
    ));
    const directory = { ...payload, id: value.id };
    if (directory.id !== directoryId(payload, integrity) ||
      !sameCanonical(value, directory, integrity) || !directory.id.startsWith("official-authority-directory:")) {
      integrityMismatch();
    }
    assertDirectoryCatalogBinding(directory, catalog);
    return immutableCopy(directory);
  } catch {
    integrityMismatch();
  }
}

function normalizeRoute(
  value: unknown,
  publishersById: ReadonlyMap<string, OfficialPublisherPolicy>,
  permittedPublisherIds: readonly string[],
): CitySafetyConfiguredRoute {
  if (!isRecord(value) || !hasExactKeys(value,
    value.resolvedEvidenceUrl === undefined
      ? ["publisherId", "navigationUrl"]
      : ["publisherId", "navigationUrl", "resolvedEvidenceUrl"]) ||
    !isIdentifier(value.publisherId) || !permittedPublisherIds.includes(value.publisherId)) {
    throw new Error("invalid_city_safety_route");
  }
  const publisher = publishersById.get(value.publisherId);
  if (publisher === undefined) throw new Error("invalid_city_safety_route");
  const navigationUrl = parseCanonicalHttpsUrl(value.navigationUrl, "invalid_city_safety_route");
  if (!publisher.allowedHosts.includes(navigationUrl.hostname)) throw new Error("invalid_city_safety_route");
  if (value.resolvedEvidenceUrl === undefined) {
    return { publisherId: value.publisherId, navigationUrl: value.navigationUrl as string };
  }
  const resolvedEvidenceUrl = parseCanonicalHttpsUrl(value.resolvedEvidenceUrl, "invalid_city_safety_route");
  if (!publisher.allowedHosts.includes(resolvedEvidenceUrl.hostname) &&
    !publisher.delegatedDocumentHosts.includes(resolvedEvidenceUrl.hostname)) {
    throw new Error("invalid_city_safety_route");
  }
  return {
    publisherId: value.publisherId,
    navigationUrl: value.navigationUrl as string,
    resolvedEvidenceUrl: value.resolvedEvidenceUrl as string,
  };
}

function normalizeEntry(
  value: unknown,
  directory: OfficialAuthorityDirectory,
): CitySafetySourcePlanEntry {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS) || !isIdentifier(value.cityId)) {
    throw new Error("invalid_city_safety_source_entry");
  }
  const municipality = directory.municipalities.find(({ cityId }) => cityId === value.cityId);
  if (municipality === undefined || value.settlementCode !== municipality.settlementCode ||
    value.municipalityCode !== municipality.municipalityCode ||
    !sameOrderedStrings(value.officialCityNames, municipality.officialCityNames) ||
    !sameOrderedStrings(value.officialMunicipalityNames, municipality.officialMunicipalityNames)) {
    throw new Error("invalid_city_safety_source_entry");
  }
  const publishersById = new Map(directory.publishers.map((policy) => [policy.publisherId, policy]));
  const publisherIds = normalizeStringSet(value.publisherIds, "invalid_city_safety_source_entry", {
    validate: (publisherId) => publishersById.has(publisherId),
  });
  const requiredEntryPublisherIds = [
    municipality.publisherId,
    directory.requiredPublisherIds.police,
    directory.requiredPublisherIds.surs,
  ];
  if (!requiredEntryPublisherIds.every((publisherId) => publisherIds.includes(publisherId)) ||
    !isDenseArray(value.configuredRoutes)) throw new Error("invalid_city_safety_source_entry");
  const configuredRoutes = value.configuredRoutes.map((route) =>
    normalizeRoute(route, publishersById, publisherIds));
  const routeKeys = configuredRoutes.map((route) => JSON.stringify(route));
  if (new Set(routeKeys).size !== routeKeys.length) throw new Error("invalid_city_safety_source_entry");
  return {
    cityId: municipality.cityId,
    settlementCode: municipality.settlementCode,
    municipalityCode: municipality.municipalityCode,
    officialCityNames: [...municipality.officialCityNames],
    officialMunicipalityNames: [...municipality.officialMunicipalityNames],
    publisherIds,
    configuredRoutes,
  };
}

function sameOrderedStrings(value: unknown, expected: readonly string[]): boolean {
  return isDenseArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

function normalizeEntries(
  value: unknown,
  catalog: CityCatalogRevision,
  directory: OfficialAuthorityDirectory,
): readonly CitySafetySourcePlanEntry[] {
  if (!isDenseArray(value)) throw new Error("invalid_city_safety_source_plan");
  const entries = value.map((item) => normalizeEntry(item, directory))
    .sort((left, right) => ordinalOrder(left.cityId, right.cityId));
  const memberIds = assertCatalogContext(catalog);
  if (entries.length !== memberIds.length || new Set(entries.map(({ cityId }) => cityId)).size !== entries.length ||
    entries.some(({ cityId }, index) => cityId !== memberIds[index])) {
    throw new Error("invalid_city_safety_source_plan");
  }
  return entries;
}

function planPayload(input: {
  readonly catalog: CityCatalogRevision;
  readonly directory: OfficialAuthorityDirectory;
  readonly entries: readonly CitySafetySourcePlanEntry[];
}): Omit<CitySafetySourcePlan, "id"> {
  return {
    schemaVersion: "city-safety-source-plan@1",
    catalogRevisionId: input.catalog.id,
    authorityDirectoryId: input.directory.id,
    entries: input.entries,
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
  };
}

function sourcePlanId(payload: Omit<CitySafetySourcePlan, "id">, integrity: CityDecisionIntegrity): string {
  return `city-safety-source-plan:${integrity.hash(integrity.canonical(payload))}`;
}

export function buildCitySafetySourcePlan(
  input: {
    readonly catalog: CityCatalogRevision;
    readonly directory: OfficialAuthorityDirectory;
    readonly entries: readonly CitySafetySourcePlanEntry[];
  },
  integrity: CityDecisionIntegrity,
): CitySafetySourcePlan {
  if (!isRecord(input) || !hasExactKeys(input, ["catalog", "directory", "entries"])) {
    throw new Error("invalid_city_safety_source_plan");
  }
  const directory = reconstructOfficialAuthorityDirectory(input.directory, input.catalog, integrity);
  assertDirectoryCatalogBinding(directory, input.catalog);
  const entries = normalizeEntries(input.entries, input.catalog, directory);
  const payload = planPayload({ catalog: input.catalog, directory, entries });
  return immutableCopy({ ...payload, id: sourcePlanId(payload, integrity) });
}

export function reconstructCitySafetySourcePlan(
  value: unknown,
  catalog: CityCatalogRevision,
  directory: OfficialAuthorityDirectory,
  integrity: CityDecisionIntegrity,
): CitySafetySourcePlan {
  try {
    if (!isRecord(value) || !hasExactKeys(value, [
      "schemaVersion", "id", "catalogRevisionId", "authorityDirectoryId", "entries",
      "queryTemplateVersion", "definitionId", "freshnessPolicyVersion", "discoveryRulesVersion",
    ]) || !isNonEmptyString(value.id) || value.schemaVersion !== "city-safety-source-plan@1" ||
      value.queryTemplateVersion !== "slovenia-municipal-safety-query@1" ||
      value.definitionId !== "si-municipal-police-offences-per-100000@1" ||
      value.freshnessPolicyVersion !== "municipal-annual-july-boundary@1" ||
      value.discoveryRulesVersion !== "city-safety-discovery@1") integrityMismatch();
    const trustedDirectory = reconstructOfficialAuthorityDirectory(directory, catalog, integrity);
    if (value.catalogRevisionId !== catalog.id || value.authorityDirectoryId !== trustedDirectory.id) {
      integrityMismatch();
    }
    const entries = normalizeEntries(value.entries, catalog, trustedDirectory);
    const payload = planPayload({ catalog, directory: trustedDirectory, entries });
    const plan = { ...payload, id: value.id };
    if (plan.id !== sourcePlanId(payload, integrity) || !sameCanonical(value, plan, integrity) ||
      !plan.id.startsWith("city-safety-source-plan:")) integrityMismatch();
    return immutableCopy(plan);
  } catch {
    integrityMismatch();
  }
}

function assertCanonicalInstant(value: unknown): asserts value is string {
  try {
    if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error();
  } catch {
    throw new Error("invalid_assessment_at");
  }
}

function escapeQueryPhrase(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

export function buildCitySafetyQueries(
  entry: CitySafetySourcePlanEntry,
  directory: OfficialAuthorityDirectory,
  assessmentAt: string,
  catalog: CityCatalogRevision,
  integrity: CityDecisionIntegrity,
): readonly [string, string, string] {
  assertCanonicalInstant(assessmentAt);
  const trustedDirectory = reconstructOfficialAuthorityDirectory(directory, catalog, integrity);
  const normalizedEntry = normalizeEntry(entry, trustedDirectory);
  if (!sameSimpleValue(normalizedEntry, entry)) throw new Error("invalid_city_safety_source_entry");
  const municipality = trustedDirectory.municipalities.find(({ cityId }) => cityId === entry.cityId)!;
  const assessment = new Date(assessmentAt);
  const preferredYear = assessment.getUTCFullYear() - 1;
  const fallbackQueryYear = assessment.getUTCMonth() < 6 ? preferredYear - 1 : preferredYear;
  const cityName = escapeQueryPhrase(entry.officialCityNames[0]!);
  const municipalityName = escapeQueryPhrase(entry.officialMunicipalityNames[0]!);
  return immutableCopy([
    `site:${municipality.officialHost} "${municipalityName}" policija "kazniva dejanja" ${preferredYear}`,
    `site:policija.si "${municipalityName}" "kazniva dejanja" ${preferredYear}`,
    `"${cityName}" "${municipalityName}" policija poročilo ${fallbackQueryYear}`,
  ]);
}

function sameSimpleValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalSimpleValue(left)) === JSON.stringify(canonicalSimpleValue(right));
}

function canonicalSimpleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSimpleValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => ordinalOrder(left, right))
    .map(([key, item]) => [key, canonicalSimpleValue(item)]));
  return value;
}
