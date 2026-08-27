import { types } from "node:util";

import { CITY_CRITERION_IDS } from "../decision/city-criteria";
import {
  CITY_CATALOG_MEMBER_LIMIT,
  type CityDecisionIntegrity,
} from "../decision/city-integrity";
import type { AdministrativeCapturedArtifact } from "../research/contracts";
import {
  buildInstalledPackageArtifactSetClaim,
  type InstalledCityPackageArtifactSlot,
  type InstalledCityPackageJsonArtifactBinding,
  type InstalledCityPackageJsonArtifactRole,
  type SealCityPackageAdministrativeEvidenceInput,
  type SealedCityPackageAdministrativeEvidence,
  type CityPackageAdministrativeEvidenceClaim,
} from "../research/city-package-artifact-set";
import {
  sealEvidencePlan,
  type EvidenceIntegrity,
  type EvidenceWriteStore,
  type SealedEvidence,
} from "../research/research-plan";

export type {
  SealCityPackageAdministrativeEvidenceInput,
  SealedCityPackageAdministrativeEvidence,
} from "../research/city-package-artifact-set";

const FIXED_SOURCE_ORDER = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/;
const TEXT_ENCODER = new TextEncoder();

interface CanonicalMaterial {
  readonly slot: InstalledCityPackageArtifactSlot;
  readonly role: InstalledCityPackageJsonArtifactRole;
  readonly sha256: string;
  readonly bytes: Uint8Array;
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
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) {
      integrityMismatch();
    }
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
        if (actualNames.length !== expectedNames.length ||
          actualNames.some((name, index) => name !== expectedNames[index])) integrityMismatch();
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

function validKey(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, [
    "countryCode",
    "packageId",
    "packageSchemaVersion",
    "catalogRevisionId",
    "evidenceRulesVersion",
  ]) && typeof value.countryCode === "string" && /^[A-Z]{2}$/.test(value.countryCode) &&
    canonicalIdentifier(value.packageId) && canonicalIdentifier(value.packageSchemaVersion) &&
    canonicalIdentifier(value.catalogRevisionId) &&
    canonicalIdentifier(value.evidenceRulesVersion);
}

function snapshotInput(
  input: SealCityPackageAdministrativeEvidenceInput,
): SealCityPackageAdministrativeEvidenceInput {
  const owned = ownedJsonSnapshot(input);
  if (!isRecord(owned) || !exactKeys(owned, [
    "key",
    "installedAt",
    "catalogMemberIds",
    "fixedPlansByCityId",
    "safetySourcePlan",
    "officialAuthorityDirectory",
    "criteriaDefaults",
    "criterionDefinitions",
  ]) || !validKey(owned.key) || !canonicalInstant(owned.installedAt) ||
    !Array.isArray(owned.catalogMemberIds) || owned.catalogMemberIds.length < 1 ||
    owned.catalogMemberIds.length > CITY_CATALOG_MEMBER_LIMIT ||
    !owned.catalogMemberIds.every(canonicalIdentifier) || !isRecord(owned.fixedPlansByCityId) ||
    !exactKeys(owned.fixedPlansByCityId, owned.catalogMemberIds)) integrityMismatch();
  for (let index = 0; index < owned.catalogMemberIds.length; index += 1) {
    const cityId = owned.catalogMemberIds[index]!;
    if (index > 0 && owned.catalogMemberIds[index - 1]! >= cityId) integrityMismatch();
    const tuple = owned.fixedPlansByCityId[cityId];
    if (!Array.isArray(tuple) || tuple.length !== FIXED_SOURCE_ORDER.length) integrityMismatch();
    for (let sourceIndex = 0; sourceIndex < FIXED_SOURCE_ORDER.length; sourceIndex += 1) {
      const plan = tuple[sourceIndex];
      if (!isRecord(plan) || plan.cityId !== cityId ||
        plan.sourceId !== FIXED_SOURCE_ORDER[sourceIndex]) integrityMismatch();
    }
  }
  if (!Array.isArray(owned.criterionDefinitions) ||
    owned.criterionDefinitions.length !== CITY_CRITERION_IDS.length ||
    !owned.criterionDefinitions.every((definition, index) =>
      isRecord(definition) && definition.criterionId === CITY_CRITERION_IDS[index])) {
    integrityMismatch();
  }
  return owned as unknown as SealCityPackageAdministrativeEvidenceInput;
}

function integrityViews(integrity: EvidenceIntegrity): {
  readonly full: EvidenceIntegrity;
  readonly decision: CityDecisionIntegrity;
} {
  if (integrity === null || typeof integrity !== "object") integrityMismatch();
  const canonical = integrity.canonical;
  const hash = integrity.hash;
  const sign = integrity.sign;
  if (typeof canonical !== "function" || typeof hash !== "function" ||
    typeof sign !== "function") integrityMismatch();
  const full: EvidenceIntegrity = Object.freeze({
    canonical(value: unknown): string {
      return Reflect.apply(canonical, full, [value]) as string;
    },
    hash(canonicalText: string): string {
      return Reflect.apply(hash, full, [canonicalText]) as string;
    },
    sign(canonicalText: string): string {
      return Reflect.apply(sign, full, [canonicalText]) as string;
    },
  });
  const decision: CityDecisionIntegrity = Object.freeze({
    canonical(value: unknown): string {
      return Reflect.apply(canonical, decision, [value]) as string;
    },
    hash(canonicalText: string): string {
      return Reflect.apply(hash, decision, [canonicalText]) as string;
    },
  });
  return Object.freeze({ full, decision });
}

function orderedMaterialInputs(input: SealCityPackageAdministrativeEvidenceInput): readonly {
  readonly slot: InstalledCityPackageArtifactSlot;
  readonly role: InstalledCityPackageJsonArtifactRole;
  readonly value: unknown;
}[] {
  return [
    ...input.catalogMemberIds.flatMap((cityId) =>
      input.fixedPlansByCityId[cityId]!.map((plan, sourceIndex) => ({
        slot: { kind: "fixed_plan" as const, cityId, sourceId: FIXED_SOURCE_ORDER[sourceIndex]! },
        role: "installed_city_fixed_source_plan" as const,
        value: plan,
      }))),
    {
      slot: { kind: "safety_source_plan" },
      role: "installed_city_safety_source_plan",
      value: input.safetySourcePlan,
    },
    {
      slot: { kind: "official_authority_directory" },
      role: "installed_city_official_authority_directory",
      value: input.officialAuthorityDirectory,
    },
    {
      slot: { kind: "criteria_defaults" },
      role: "installed_city_criteria_defaults",
      value: input.criteriaDefaults,
    },
    {
      slot: { kind: "criterion_definitions" },
      role: "installed_city_criterion_definitions",
      value: input.criterionDefinitions,
    },
  ];
}

function canonicalMaterials(
  input: SealCityPackageAdministrativeEvidenceInput,
  integrity: EvidenceIntegrity,
): readonly CanonicalMaterial[] {
  return orderedMaterialInputs(input).map(({ slot, role, value }) => {
    const canonicalText = integrity.canonical(value);
    if (typeof canonicalText !== "string") integrityMismatch();
    const sha256 = integrity.hash(canonicalText);
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) integrityMismatch();
    return {
      slot: { ...slot },
      role,
      sha256,
      bytes: TEXT_ENCODER.encode(canonicalText),
    };
  });
}

function artifactCopy(
  artifact: AdministrativeCapturedArtifact<"city-package-installation">,
): AdministrativeCapturedArtifact<"city-package-installation"> {
  return {
    artifactId: artifact.artifactId,
    runId: artifact.runId,
    sourceId: "city-package-installation",
    role: artifact.role,
    mediaType: artifact.mediaType,
    sha256: artifact.sha256,
    bytes: new Uint8Array(artifact.bytes),
    origin: "administrative",
    producer: artifact.producer,
    createdAt: artifact.createdAt,
  };
}

function sealedCopy(
  sealed: SealedEvidence<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >,
): SealedEvidence<
  "city-package-installation",
  CityPackageAdministrativeEvidenceClaim,
  "administrative"
> {
  return ownedJsonSnapshot(sealed);
}

export async function sealCityPackageAdministrativeEvidence(
  input: SealCityPackageAdministrativeEvidenceInput,
  ports: {
    readonly store: EvidenceWriteStore<
      "city-package-installation",
      CityPackageAdministrativeEvidenceClaim,
      "administrative"
    >;
    readonly integrity: EvidenceIntegrity;
  },
): Promise<SealedCityPackageAdministrativeEvidence> {
  const ownedInput = snapshotInput(input);
  const store = ports.store;
  const { full: fullIntegrity, decision: decisionIntegrity } = integrityViews(ports.integrity);
  const materials = canonicalMaterials(ownedInput, fullIntegrity);
  const built = buildInstalledPackageArtifactSetClaim({
    key: ownedInput.key,
    installedAt: ownedInput.installedAt,
    orderedMaterials: materials.map((material, artifactOrdinal) => ({
      artifactOrdinal,
      slot: material.slot,
      role: material.role,
      sha256: material.sha256,
    })),
  }, decisionIntegrity);
  const stableArtifacts = built.orderedArtifacts.map((material) => ({
    artifactId: material.artifactId,
    runId: built.installRunId,
    sourceId: "city-package-installation" as const,
    role: material.role,
    mediaType: "application/json" as const,
    sha256: material.sha256,
    bytes: new Uint8Array(materials[material.artifactOrdinal]!.bytes),
    origin: "administrative" as const,
    producer: "install-city-package@1",
    createdAt: ownedInput.installedAt,
  }));
  const sealed = await sealEvidencePlan<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >({
    id: built.evidenceId,
    assessmentDate: ownedInput.installedAt.slice(0, 10),
    entries: [{
      sourceId: "city-package-installation",
      origin: "administrative",
      artifacts: stableArtifacts.map(artifactCopy),
      coverage: "verified",
      claims: [built.claim],
    }],
    sourceIds: ["city-package-installation"],
    parserVersions: {
      "city-package-installation": "city-package-administrative-json@1",
    },
    rulesVersion: "city-package-administrative-evidence@1",
  }, fullIntegrity);

  for (const artifact of stableArtifacts) await store.appendArtifact(artifactCopy(artifact));
  const returnedEvidence = sealedCopy(sealed);
  await store.seal(structuredClone(sealed));
  const returnedArtifacts = Object.freeze(stableArtifacts.map((artifact) =>
    Object.freeze(artifactCopy(artifact))));
  const bindings = Object.freeze(built.orderedArtifacts.map((artifact) =>
    Object.freeze({
      evidenceSnapshotId: built.evidenceId,
      artifactId: artifact.artifactId,
      artifactOrdinal: artifact.artifactOrdinal,
      runId: built.installRunId,
      sourceId: "city-package-installation" as const,
      role: artifact.role,
      mediaType: "application/json" as const,
      sha256: artifact.sha256,
    } satisfies InstalledCityPackageJsonArtifactBinding<InstalledCityPackageJsonArtifactRole>)));
  return Object.freeze({
    installRunId: built.installRunId,
    evidenceId: built.evidenceId,
    evidence: returnedEvidence,
    artifacts: returnedArtifacts,
    bindings,
  });
}
