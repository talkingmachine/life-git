import { types } from "node:util";

import type {
  CityCriterionDefinition,
  InstalledCityCriteriaDefaults,
} from "../decision/city-criteria";
import {
  CITY_CATALOG_MEMBER_LIMIT,
  type CityDecisionIntegrity,
} from "../decision/city-integrity";
import type {
  AdministrativeCapturedArtifact,
  Claim,
  EvidenceSnapshot,
} from "./contracts";
import type {
  CityFixedSourcePlan,
  SloveniaCityFixedSourceId,
} from "./city-evidence";
import type { InstalledCityPackageExactKey } from "./city-package";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "./city-safety-source-plan";
import type { SealedEvidence } from "./research-plan";

const FIXED_SOURCE_ORDER = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const satisfies readonly SloveniaCityFixedSourceId[];
const SINGLETON_ORDER = [
  ["safety_source_plan", "installed_city_safety_source_plan"],
  ["official_authority_directory", "installed_city_official_authority_directory"],
  ["criteria_defaults", "installed_city_criteria_defaults"],
  ["criterion_definitions", "installed_city_criterion_definitions"],
] as const;
const KEY_FIELDS = [
  "countryCode",
  "packageId",
  "packageSchemaVersion",
  "catalogRevisionId",
  "evidenceRulesVersion",
] as const;
const CLAIM_FIELDS = [
  "claimId",
  "sourceId",
  "value",
  "scope",
  "sourcePeriod",
  "anchor",
  "status",
] as const;
const CLAIM_VALUE_FIELDS = [
  "schemaVersion",
  "key",
  "installRunId",
  "evidenceId",
  "orderedArtifacts",
] as const;
const SHELL_FIELDS = [
  "id",
  "assessmentDate",
  "artifactIds",
  "claims",
  "blockers",
  "coverage",
  "parserVersions",
  "rulesVersion",
  "manifestHash",
  "hmac",
] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;

export type InstalledCityPackageJsonArtifactRole =
  | "installed_city_fixed_source_plan"
  | "installed_city_safety_source_plan"
  | "installed_city_official_authority_directory"
  | "installed_city_criteria_defaults"
  | "installed_city_criterion_definitions";

export type InstalledCityPackageArtifactSlot =
  | {
      readonly kind: "fixed_plan";
      readonly cityId: string;
      readonly sourceId: SloveniaCityFixedSourceId;
    }
  | { readonly kind: "safety_source_plan" }
  | { readonly kind: "official_authority_directory" }
  | { readonly kind: "criteria_defaults" }
  | { readonly kind: "criterion_definitions" };

export interface InstalledPackageArtifactSetMaterial {
  readonly artifactOrdinal: number;
  readonly slot: InstalledCityPackageArtifactSlot;
  readonly role: InstalledCityPackageJsonArtifactRole;
  readonly sha256: string;
}

export interface BuildInstalledPackageArtifactSetClaimInput {
  readonly key: InstalledCityPackageExactKey;
  readonly installedAt: string;
  readonly orderedMaterials: readonly InstalledPackageArtifactSetMaterial[];
}

export interface CityPackageAdministrativeEvidenceClaim {
  readonly claimId: string;
  readonly sourceId: "city-package-installation";
  readonly value: {
    readonly schemaVersion: "installed-city-package-artifact-set@1";
    readonly key: InstalledCityPackageExactKey;
    readonly installRunId: string;
    readonly evidenceId: string;
    readonly orderedArtifacts: readonly {
      readonly artifactOrdinal: number;
      readonly role: InstalledCityPackageJsonArtifactRole;
      readonly artifactId: string;
    }[];
  };
  readonly scope: "city-package-installation";
  readonly sourcePeriod: string;
  readonly anchor: {
    readonly artifactId: string;
    readonly locator: string;
    readonly excerptSha256: string;
  };
  readonly status: "verified";
}

export interface BuiltInstalledPackageArtifactSetClaim {
  readonly installRunId: string;
  readonly evidenceId: string;
  readonly orderedArtifacts: readonly (InstalledPackageArtifactSetMaterial & {
    readonly artifactId: string;
  })[];
  readonly claim: CityPackageAdministrativeEvidenceClaim;
}

export interface AdministrativeEvidenceLoadExpectations {
  readonly evidenceId: string;
  readonly installedAt: string;
  readonly artifactIds: readonly string[];
}

export interface SealCityPackageAdministrativeEvidenceInput {
  readonly key: InstalledCityPackageExactKey;
  readonly installedAt: string;
  readonly catalogMemberIds: readonly string[];
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: readonly [
    CityCriterionDefinition,
    CityCriterionDefinition,
    CityCriterionDefinition,
    CityCriterionDefinition,
  ];
}

export interface InstalledCityPackageJsonArtifactBinding<
  R extends InstalledCityPackageJsonArtifactRole,
> {
  readonly evidenceSnapshotId: string;
  readonly artifactId: string;
  readonly artifactOrdinal: number;
  readonly runId: string;
  readonly sourceId: "city-package-installation";
  readonly role: R;
  readonly mediaType: "application/json";
  readonly sha256: string;
}

export interface SealedCityPackageAdministrativeEvidence {
  readonly installRunId: string;
  readonly evidenceId: string;
  readonly evidence: SealedEvidence<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >;
  readonly artifacts: readonly AdministrativeCapturedArtifact<
    "city-package-installation"
  >[];
  readonly bindings: readonly InstalledCityPackageJsonArtifactBinding<
    InstalledCityPackageJsonArtifactRole
  >[];
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function ownedJsonSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) integrityMismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) integrityMismatch();
    if (active.has(value)) integrityMismatch();
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (prototype !== Array.prototype) integrityMismatch();
        const lengthDescriptor = descriptors.length;
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) integrityMismatch();
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0) integrityMismatch();
        const expectedNames = [
          ...Array.from({ length }, (_, index) => String(index)),
          "length",
        ].sort();
        const actualNames = Object.keys(descriptors).sort();
        if (
          actualNames.length !== expectedNames.length ||
          actualNames.some((name, index) => name !== expectedNames[index])
        ) integrityMismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            integrityMismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) {
          integrityMismatch();
        }
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return deepFreeze(visit(borrowed) as T);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validExactKey(value: unknown): value is InstalledCityPackageExactKey {
  return isRecord(value) && exactKeys(value, KEY_FIELDS) &&
    typeof value.countryCode === "string" && /^[A-Z]{2}$/.test(value.countryCode) &&
    canonicalIdentifier(value.packageId) && canonicalIdentifier(value.packageSchemaVersion) &&
    canonicalIdentifier(value.catalogRevisionId) &&
    canonicalIdentifier(value.evidenceRulesVersion);
}

function validRole(value: unknown): value is InstalledCityPackageJsonArtifactRole {
  return value === "installed_city_fixed_source_plan" ||
    value === "installed_city_safety_source_plan" ||
    value === "installed_city_official_authority_directory" ||
    value === "installed_city_criteria_defaults" ||
    value === "installed_city_criterion_definitions";
}

function validSlot(value: unknown): value is InstalledCityPackageArtifactSlot {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "fixed_plan") {
    return exactKeys(value, ["kind", "cityId", "sourceId"]) &&
      canonicalIdentifier(value.cityId) &&
      FIXED_SOURCE_ORDER.includes(value.sourceId as SloveniaCityFixedSourceId);
  }
  return SINGLETON_ORDER.some(([kind]) => kind === value.kind) && exactKeys(value, ["kind"]);
}

function slotIdentity(slot: InstalledCityPackageArtifactSlot): string {
  return slot.kind === "fixed_plan"
    ? `${slot.kind}:${slot.cityId}:${slot.sourceId}`
    : slot.kind;
}

function validateOrderedMaterials(value: unknown): asserts value is readonly InstalledPackageArtifactSetMaterial[] {
  if (!Array.isArray(value) || value.length < 7 || value.length > 304 ||
    (value.length - 4) % FIXED_SOURCE_ORDER.length !== 0) integrityMismatch();
  const memberCount = (value.length - 4) / FIXED_SOURCE_ORDER.length;
  if (memberCount < 1 || memberCount > CITY_CATALOG_MEMBER_LIMIT) integrityMismatch();
  for (let index = 0; index < value.length; index += 1) {
    const material = value[index];
    if (!isRecord(material) ||
      !exactKeys(material, ["artifactOrdinal", "slot", "role", "sha256"]) ||
      !Number.isSafeInteger(material.artifactOrdinal) || Object.is(material.artifactOrdinal, -0) ||
      material.artifactOrdinal !== index || !validSlot(material.slot) ||
      !validRole(material.role) || typeof material.sha256 !== "string" ||
      !SHA256.test(material.sha256)) integrityMismatch();
  }
  const materials = value as readonly InstalledPackageArtifactSetMaterial[];
  let previousCityId: string | undefined;
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
    const offset = memberIndex * FIXED_SOURCE_ORDER.length;
    const triplet = materials.slice(offset, offset + FIXED_SOURCE_ORDER.length);
    const firstSlot = triplet[0]!.slot;
    if (firstSlot.kind !== "fixed_plan" ||
      (previousCityId !== undefined && previousCityId >= firstSlot.cityId)) integrityMismatch();
    for (let sourceIndex = 0; sourceIndex < FIXED_SOURCE_ORDER.length; sourceIndex += 1) {
      const material = triplet[sourceIndex]!;
      const slot = material.slot;
      if (slot.kind !== "fixed_plan" || slot.cityId !== firstSlot.cityId ||
        slot.sourceId !== FIXED_SOURCE_ORDER[sourceIndex] ||
        material.role !== "installed_city_fixed_source_plan") integrityMismatch();
    }
    previousCityId = firstSlot.cityId;
  }
  for (let singletonIndex = 0; singletonIndex < SINGLETON_ORDER.length; singletonIndex += 1) {
    const material = materials[memberCount * FIXED_SOURCE_ORDER.length + singletonIndex]!;
    const [kind, role] = SINGLETON_ORDER[singletonIndex]!;
    if (material.slot.kind !== kind || material.role !== role) integrityMismatch();
  }
  const slots = materials.map(({ slot }) => slotIdentity(slot));
  if (new Set(slots).size !== slots.length) integrityMismatch();
}

function snapshotBuildInput(value: BuildInstalledPackageArtifactSetClaimInput):
BuildInstalledPackageArtifactSetClaimInput {
  const owned = ownedJsonSnapshot(value);
  if (!isRecord(owned) || !exactKeys(owned, ["key", "installedAt", "orderedMaterials"]) ||
    !validExactKey(owned.key) || !canonicalInstant(owned.installedAt)) integrityMismatch();
  validateOrderedMaterials(owned.orderedMaterials);
  return owned as BuildInstalledPackageArtifactSetClaimInput;
}

function decisionIntegrityView(integrity: CityDecisionIntegrity): CityDecisionIntegrity {
  if (integrity === null || typeof integrity !== "object") integrityMismatch();
  const canonical = integrity.canonical;
  const hash = integrity.hash;
  if (typeof canonical !== "function" || typeof hash !== "function") integrityMismatch();
  const view: CityDecisionIntegrity = Object.freeze({
    canonical(value: unknown): string {
      return Reflect.apply(canonical, view, [value]) as string;
    },
    hash(canonicalText: string): string {
      return Reflect.apply(hash, view, [canonicalText]) as string;
    },
  });
  return view;
}

function buildFromOwnedInput(
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim {
  const installRunPayload = deepFreeze({
    schemaVersion: "city-package-install-run@1",
    key: input.key,
    artifacts: input.orderedMaterials,
  });
  const canonicalRun = integrity.canonical(installRunPayload);
  if (typeof canonicalRun !== "string") integrityMismatch();
  const installRunHash = integrity.hash(canonicalRun);
  if (typeof installRunHash !== "string" || !SHA256.test(installRunHash)) integrityMismatch();
  const installRunId = `city-package-install:${installRunHash}`;
  const evidenceId = `${installRunId}:evidence`;
  const orderedArtifacts = input.orderedMaterials.map((material) => ({
    artifactOrdinal: material.artifactOrdinal,
    slot: { ...material.slot },
    role: material.role,
    sha256: material.sha256,
    artifactId: `${installRunId}:artifact:${String(material.artifactOrdinal).padStart(3, "0")}` +
      `:${material.role}:${material.sha256}`,
  }));
  const claim: CityPackageAdministrativeEvidenceClaim = {
    claimId: `${installRunId}:artifact-set`,
    sourceId: "city-package-installation",
    value: {
      schemaVersion: "installed-city-package-artifact-set@1",
      key: { ...input.key },
      installRunId,
      evidenceId,
      orderedArtifacts: orderedArtifacts.map(({ artifactOrdinal, role, artifactId }) => ({
        artifactOrdinal,
        role,
        artifactId,
      })),
    },
    scope: "city-package-installation",
    sourcePeriod: input.installedAt,
    anchor: {
      artifactId: orderedArtifacts[0]!.artifactId,
      locator: `urn:city-package-installation:${installRunId}`,
      excerptSha256: orderedArtifacts[0]!.sha256,
    },
    status: "verified",
  };
  return deepFreeze({ installRunId, evidenceId, orderedArtifacts, claim });
}

export function buildInstalledPackageArtifactSetClaim(
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim {
  try {
    const ownedInput = snapshotBuildInput(input);
    return buildFromOwnedInput(ownedInput, decisionIntegrityView(integrity));
  } catch {
    return integrityMismatch();
  }
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function isCityPackageAdministrativeEvidenceClaim(
  value: unknown,
): value is CityPackageAdministrativeEvidenceClaim {
  if (!isRecord(value) || !exactKeys(value, CLAIM_FIELDS) ||
    !canonicalIdentifier(value.claimId) || value.sourceId !== "city-package-installation" ||
    value.scope !== "city-package-installation" || !canonicalInstant(value.sourcePeriod) ||
    value.status !== "verified" || !isRecord(value.value) ||
    !exactKeys(value.value, CLAIM_VALUE_FIELDS) ||
    value.value.schemaVersion !== "installed-city-package-artifact-set@1" ||
    !validExactKey(value.value.key) || !canonicalIdentifier(value.value.installRunId) ||
    !canonicalIdentifier(value.value.evidenceId) || !denseArray(value.value.orderedArtifacts) ||
    value.value.orderedArtifacts.length === 0 ||
    !isRecord(value.anchor) ||
    !exactKeys(value.anchor, ["artifactId", "locator", "excerptSha256"]) ||
    !canonicalIdentifier(value.anchor.artifactId) ||
    typeof value.anchor.locator !== "string" || value.anchor.locator.length === 0 ||
    typeof value.anchor.excerptSha256 !== "string" || !SHA256.test(value.anchor.excerptSha256)) {
    return false;
  }
  return value.value.orderedArtifacts.every((item) =>
    isRecord(item) && exactKeys(item, ["artifactOrdinal", "role", "artifactId"]) &&
    Number.isSafeInteger(item.artifactOrdinal) && !Object.is(item.artifactOrdinal, -0) &&
    (item.artifactOrdinal as number) >= 0 && validRole(item.role) &&
    canonicalIdentifier(item.artifactId));
}

export function reconstructInstalledPackageArtifactSetClaim(
  claims: readonly unknown[],
  input: BuildInstalledPackageArtifactSetClaimInput,
  integrity: CityDecisionIntegrity,
): BuiltInstalledPackageArtifactSetClaim {
  try {
    const ownedClaims = ownedJsonSnapshot(claims);
    if (!Array.isArray(ownedClaims) || ownedClaims.length !== 1 ||
      !isCityPackageAdministrativeEvidenceClaim(ownedClaims[0])) integrityMismatch();
    const ownedInput = snapshotBuildInput(input);
    const view = decisionIntegrityView(integrity);
    const expected = buildFromOwnedInput(ownedInput, view);
    const actualCanonical = view.canonical(ownedClaims[0]);
    const expectedCanonical = view.canonical(expected.claim);
    if (typeof actualCanonical !== "string" || typeof expectedCanonical !== "string" ||
      actualCanonical !== expectedCanonical) integrityMismatch();
    return expected;
  } catch {
    return integrityMismatch();
  }
}

function snapshotExpectations(value: AdministrativeEvidenceLoadExpectations):
AdministrativeEvidenceLoadExpectations {
  const owned = ownedJsonSnapshot(value);
  if (!isRecord(owned) || !exactKeys(owned, ["evidenceId", "installedAt", "artifactIds"]) ||
    !canonicalIdentifier(owned.evidenceId) || !canonicalInstant(owned.installedAt) ||
    !Array.isArray(owned.artifactIds) || owned.artifactIds.length < 7 ||
    owned.artifactIds.length > 304 ||
    !owned.artifactIds.every(canonicalIdentifier) ||
    new Set(owned.artifactIds).size !== owned.artifactIds.length) integrityMismatch();
  return owned as AdministrativeEvidenceLoadExpectations;
}

export function reconstructAdministrativeEvidenceShell(
  value: unknown,
  expected: AdministrativeEvidenceLoadExpectations,
): EvidenceSnapshot<
  "city-package-installation",
  Claim<unknown, "city-package-installation">
> {
  try {
    const ownedExpected = snapshotExpectations(expected);
    const owned = ownedJsonSnapshot(value);
    if (!isRecord(owned) || !exactKeys(owned, SHELL_FIELDS) ||
      owned.id !== ownedExpected.evidenceId ||
      owned.assessmentDate !== ownedExpected.installedAt.slice(0, 10) ||
      !Array.isArray(owned.artifactIds) ||
      owned.artifactIds.length !== ownedExpected.artifactIds.length ||
      !owned.artifactIds.every((artifactId, index) =>
        artifactId === ownedExpected.artifactIds[index]) ||
      !Array.isArray(owned.claims) || owned.claims.length !== 1 ||
      !isCityPackageAdministrativeEvidenceClaim(owned.claims[0]) ||
      !Array.isArray(owned.blockers) || owned.blockers.length !== 0 ||
      !isRecord(owned.coverage) ||
      !exactKeys(owned.coverage, ["city-package-installation"]) ||
      owned.coverage["city-package-installation"] !== "verified" ||
      !isRecord(owned.parserVersions) ||
      !exactKeys(owned.parserVersions, ["city-package-installation"]) ||
      owned.parserVersions["city-package-installation"] !==
        "city-package-administrative-json@1" ||
      owned.rulesVersion !== "city-package-administrative-evidence@1" ||
      typeof owned.manifestHash !== "string" || !SHA256.test(owned.manifestHash) ||
      typeof owned.hmac !== "string" || !SHA256.test(owned.hmac)) integrityMismatch();
    return deepFreeze({
      id: owned.id,
      assessmentDate: owned.assessmentDate,
      artifactIds: [...owned.artifactIds],
      claims: [owned.claims[0]],
      blockers: [],
      coverage: { "city-package-installation": "verified" },
      parserVersions: {
        "city-package-installation": "city-package-administrative-json@1",
      },
      rulesVersion: "city-package-administrative-evidence@1",
      manifestHash: owned.manifestHash,
      hmac: owned.hmac,
    });
  } catch {
    return integrityMismatch();
  }
}
