import { types } from "node:util";

import type { CityDecisionIntegrity } from "./city-integrity";
import type {
  PreferenceProfileSnapshot,
  PreferenceProfileV2Snapshot,
} from "./preference-profile";
import type {
  RelocationProfileSnapshot,
  RelocationProfileV2Snapshot,
} from "./relocation-profile";

export const CITY_CRITERION_IDS = ["safety", "long_term_rent", "urban_transit", "fixed_broadband"] as const;
export type CityCriterionId = typeof CITY_CRITERION_IDS[number];
export type CityCriterionMode = "required" | "weighted";
export type CityImportance = 1 | 2 | 3 | 4 | 5;
export type CityUnknownReason = "not_found" | "stale" | "conflict" | "not_comparable" | "source_unavailable";
export type CityRankingUnknownReason = CityUnknownReason | "no_knowledge_revision";
export type CityVerifiedFactBasis =
  | { readonly kind: "canonical_scalar"; readonly value: string }
  | { readonly kind: "municipal_safety"; readonly quantity: import("./city-safety").CitySafetyQuantity };

export interface CityCriterionDraft { readonly criterionId: CityCriterionId; readonly definitionId: string; readonly mode: CityCriterionMode; readonly importance: CityImportance; readonly target: string; }
export interface CityCriterionDefinition { readonly criterionId: CityCriterionId; readonly definitionId: string; readonly direction: "at_least" | "at_most"; readonly unit: string; readonly denominator: string; readonly compatibleGeoScopes: readonly string[]; readonly freshnessPolicyVersion: string; readonly evaluatorVersion: string; }
export interface CityRankingFactInput { readonly criterionId: CityCriterionId; readonly definitionId: string; readonly geoScope: string; readonly referencePeriod: string | null; readonly freshnessBasis: string; readonly unit: string; readonly denominator: string; readonly outcome: { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis } | { readonly kind: "unknown"; readonly reason: CityUnknownReason }; }
export interface CityCriterionEvaluationInput { readonly criterion: CityCriterionDraft; readonly fact: CityRankingFactInput; readonly assessmentAt: string; }
export interface CityCriterionEvaluation { readonly state: "verified" | "unknown"; readonly factor: string; readonly targetComparison: "matches" | "does_not_match" | "unknown"; readonly unknownReason?: CityUnknownReason; }
export interface CityCriterionEvaluator { readonly definition: CityCriterionDefinition; canonicalizeTarget(target: unknown): string; evaluate(input: CityCriterionEvaluationInput): CityCriterionEvaluation; }
export type CityCriterionEvaluatorRegistry = Readonly<Record<CityCriterionId, CityCriterionEvaluator>>;
export interface CityCriteriaSnapshot { readonly schemaVersion: "city-criteria@1"; readonly id: string; readonly profileSnapshotId: string; readonly preferenceProfileSnapshotId: string; readonly criteria: readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft]; readonly rulesVersion: "city-criteria@1"; readonly confirmedAt: string; }
export type CityCriteriaProjection = Pick<CityCriteriaSnapshot, "profileSnapshotId" | "preferenceProfileSnapshotId" | "criteria" | "rulesVersion" | "confirmedAt">;
export interface InstalledCityCriteriaDefaults { readonly schemaVersion: "city-criteria-defaults@1"; readonly mappingVersion: string; readonly criteria: readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft]; }
export type InstalledCityCriterionDefinitionTuple = readonly [
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
];

const RULES_VERSION = "city-criteria@1" as const;
function freeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function instant(value: unknown): value is string { try { return typeof value === "string" && new Date(value).toISOString() === value; } catch { return false; } }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: object, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]); }
function criterionIndex(id: CityCriterionId): number { return CITY_CRITERION_IDS.indexOf(id); }
function validateDraft(value: unknown, evaluators: CityCriterionEvaluatorRegistry): CityCriterionDraft {
  if (!record(value) || !exact(value, ["criterionId", "definitionId", "mode", "importance", "target"]) || !CITY_CRITERION_IDS.includes(value.criterionId as CityCriterionId) || typeof value.definitionId !== "string" || typeof value.target !== "string" || (value.mode !== "required" && value.mode !== "weighted") || ![1, 2, 3, 4, 5].includes(value.importance as number)) throw new Error("invalid_city_criterion");
  const criterionId = value.criterionId as CityCriterionId;
  const evaluator = evaluators[criterionId];
  if (value.definitionId !== evaluator.definition.definitionId) throw new Error("invalid_city_criterion");
  const target = evaluator.canonicalizeTarget(value.target);
  if (target !== value.target) throw new Error("invalid_city_criterion");
  return { criterionId, definitionId: value.definitionId, mode: value.mode, importance: value.importance as CityImportance, target };
}
function normalizeCriteria(value: unknown, evaluators: CityCriterionEvaluatorRegistry): CityCriteriaSnapshot["criteria"] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("invalid_city_criteria");
  const criteria = value.map((item) => validateDraft(item, evaluators)).sort((left, right) => criterionIndex(left.criterionId) - criterionIndex(right.criterionId));
  if (new Set(criteria.map(({ criterionId }) => criterionId)).size !== 4) throw new Error("invalid_city_criteria");
  return criteria as unknown as CityCriteriaSnapshot["criteria"];
}
function sameCriteria(
  left: CityCriteriaSnapshot["criteria"],
  right: CityCriteriaSnapshot["criteria"],
): boolean {
  return left.length === right.length && left.every((criterion, index) => {
    const candidate = right[index];
    return candidate !== undefined && criterion.criterionId === candidate.criterionId &&
      criterion.definitionId === candidate.definitionId && criterion.mode === candidate.mode &&
      criterion.importance === candidate.importance && criterion.target === candidate.target;
  });
}
function v2CityPreferences(value: PreferenceProfileV2Snapshot): PreferenceProfileV2Snapshot["cityCriteria"] {
  if (!record(value) || !exact(value, [
    "schemaVersion", "id", "confirmedAt", "countryCriteria", "cityCriteria",
  ]) || value.schemaVersion !== "preference-profile@2" ||
    !Array.isArray(value.cityCriteria) || value.cityCriteria.length !== CITY_CRITERION_IDS.length ||
    Object.getOwnPropertyNames(value.cityCriteria).length !== CITY_CRITERION_IDS.length + 1) {
    throw new Error("integrity_mismatch");
  }
  for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
    const preference = value.cityCriteria[index];
    if (!record(preference) || !exact(preference, ["id", "mode", "importance", "target"]) ||
      preference.id !== CITY_CRITERION_IDS[index] ||
      (preference.mode !== "required" && preference.mode !== "weighted") ||
      ![1, 2, 3, 4, 5].includes(preference.importance as number) ||
      typeof preference.target !== "string") {
      throw new Error("integrity_mismatch");
    }
  }
  return value.cityCriteria;
}

export function deriveCityCriteriaDraft(
  profile: RelocationProfileSnapshot,
  preferences: PreferenceProfileSnapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaSnapshot["criteria"];
export function deriveCityCriteriaDraft(
  profile: RelocationProfileV2Snapshot,
  preferences: PreferenceProfileV2Snapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaSnapshot["criteria"];
export function deriveCityCriteriaDraft(
  profile: RelocationProfileSnapshot | RelocationProfileV2Snapshot,
  preferences: PreferenceProfileSnapshot | PreferenceProfileV2Snapshot,
  defaults: InstalledCityCriteriaDefaults,
  evaluators: CityCriterionEvaluatorRegistry,
): CityCriteriaSnapshot["criteria"] {
  if (!record(profile) || !record(preferences) ||
    (profile.schemaVersion === "relocation-profile@1" &&
      preferences.schemaVersion !== "preference-profile@1") ||
    (profile.schemaVersion === "relocation-profile@2" &&
      preferences.schemaVersion !== "preference-profile@2") ||
    (profile.schemaVersion !== "relocation-profile@1" &&
      profile.schemaVersion !== "relocation-profile@2")) {
    throw new Error("integrity_mismatch");
  }
  const v2Controls = preferences.schemaVersion === "preference-profile@2"
    ? v2CityPreferences(preferences)
    : undefined;
  if (!record(defaults) || defaults.schemaVersion !== "city-criteria-defaults@1" || typeof defaults.mappingVersion !== "string") throw new Error("invalid_city_defaults");
  const criteria = normalizeCriteria(defaults.criteria, evaluators).map((criterion) => ({ ...criterion }));
  if (v2Controls !== undefined) {
    for (let index = 0; index < criteria.length; index += 1) {
      criteria[index]!.mode = v2Controls[index]!.mode;
      criteria[index]!.importance = v2Controls[index]!.importance;
    }
    return freeze(criteria as unknown as CityCriteriaSnapshot["criteria"]);
  }
  const v1Preferences = preferences as PreferenceProfileSnapshot;
  const safety = v1Preferences.criteria.find(({ id }) => id === "personal_safety");
  const infrastructure = v1Preferences.criteria.find(({ id }) => id === "infrastructure");
  for (const criterion of criteria) {
    const preference = criterion.criterionId === "safety" ? safety : ["urban_transit", "fixed_broadband"].includes(criterion.criterionId) ? infrastructure : undefined;
    if (preference !== undefined) { criterion.mode = preference.mode; criterion.importance = preference.importance; }
  }
  return freeze(criteria as unknown as CityCriteriaSnapshot["criteria"]);
}
export function confirmCityCriteria(input: { readonly draft: unknown; readonly profileSnapshotId: string; readonly preferenceProfileSnapshotId: string; readonly confirmedAt: string; }, evaluators: CityCriterionEvaluatorRegistry, integrity: CityDecisionIntegrity): CityCriteriaSnapshot {
  if (!record(input) || !exact(input, ["draft", "profileSnapshotId", "preferenceProfileSnapshotId", "confirmedAt"]) || typeof input.profileSnapshotId !== "string" || input.profileSnapshotId.length === 0 || typeof input.preferenceProfileSnapshotId !== "string" || input.preferenceProfileSnapshotId.length === 0 || !instant(input.confirmedAt)) throw new Error("invalid_city_criteria");
  const criteria = normalizeCriteria(input.draft, evaluators);
  const payload = { schemaVersion: RULES_VERSION, profileSnapshotId: input.profileSnapshotId, preferenceProfileSnapshotId: input.preferenceProfileSnapshotId, criteria, rulesVersion: RULES_VERSION, confirmedAt: input.confirmedAt };
  return freeze({ id: `city-criteria:${integrity.hash(integrity.canonical(payload))}`, ...payload });
}

type StructuralRecord = Record<string, unknown>;

interface StructuralIntegrity {
  readonly canonical: (value: unknown) => string;
  readonly hash: (canonicalText: string) => string;
}

const STRUCTURAL_DIGEST = /^[0-9a-f]{64}$/;
const STRUCTURAL_SNAPSHOT_KEYS = [
  "schemaVersion",
  "id",
  "profileSnapshotId",
  "preferenceProfileSnapshotId",
  "criteria",
  "rulesVersion",
  "confirmedAt",
] as const;

function structuralMismatch(): never {
  throw new Error("integrity_mismatch");
}

function structuralBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error("integrity_mismatch");
  }
}

function ownStructuralGraph<T>(borrowed: T): T {
  const seen = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || seen.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
      structuralMismatch();
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) structuralMismatch();
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (length === undefined || !("value" in length) ||
        !Number.isSafeInteger(length.value) || length.value < 0 ||
        Object.getOwnPropertyNames(value).length !== length.value + 1) {
        structuralMismatch();
      }
      const copy: unknown[] = [];
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          structuralMismatch();
        }
        copy.push(visit(descriptor.value));
      }
      return copy;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) structuralMismatch();
    const copy: StructuralRecord = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "__proto__") structuralMismatch();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        structuralMismatch();
      }
      copy[key] = visit(descriptor.value);
    }
    return copy;
  };
  return visit(borrowed) as T;
}

function exactStructuralRecord(value: unknown, keys: readonly string[]): StructuralRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) {
    structuralMismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    structuralMismatch();
  }
  return value as StructuralRecord;
}

function structuralText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) structuralMismatch();
}

function structuralInstant(value: unknown): asserts value is string {
  if (typeof value !== "string") structuralMismatch();
  try {
    if (new Date(value).toISOString() !== value) structuralMismatch();
  } catch {
    structuralMismatch();
  }
}

function parseStructuralSnapshot(value: unknown): CityCriteriaSnapshot {
  const snapshot = exactStructuralRecord(value, STRUCTURAL_SNAPSHOT_KEYS);
  if (snapshot.schemaVersion !== "city-criteria@1" ||
    snapshot.rulesVersion !== "city-criteria@1" ||
    typeof snapshot.id !== "string" ||
    !/^city-criteria:[0-9a-f]{64}$/.test(snapshot.id)) {
    structuralMismatch();
  }
  structuralText(snapshot.profileSnapshotId);
  structuralText(snapshot.preferenceProfileSnapshotId);
  if (snapshot.profileSnapshotId === snapshot.preferenceProfileSnapshotId) structuralMismatch();
  structuralInstant(snapshot.confirmedAt);
  if (!Array.isArray(snapshot.criteria) ||
    snapshot.criteria.length !== CITY_CRITERION_IDS.length ||
    Object.getPrototypeOf(snapshot.criteria) !== Array.prototype) {
    structuralMismatch();
  }
  for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
    const criterion = exactStructuralRecord(snapshot.criteria[index], [
      "criterionId", "definitionId", "mode", "importance", "target",
    ]);
    if (criterion.criterionId !== CITY_CRITERION_IDS[index]) structuralMismatch();
    structuralText(criterion.definitionId);
    if (criterion.mode !== "required" && criterion.mode !== "weighted") structuralMismatch();
    if (![1, 2, 3, 4, 5].includes(criterion.importance as number)) structuralMismatch();
    structuralText(criterion.target);
  }
  return snapshot as unknown as CityCriteriaSnapshot;
}

function captureStructuralIntegrity(value: CityDecisionIntegrity): StructuralIntegrity {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.getOwnPropertyNames(value).length !== 2) {
    structuralMismatch();
  }
  const canonical = Object.getOwnPropertyDescriptor(value, "canonical");
  const hash = Object.getOwnPropertyDescriptor(value, "hash");
  if (canonical === undefined || !("value" in canonical) || !canonical.enumerable ||
    typeof canonical.value !== "function" || types.isProxy(canonical.value) ||
    hash === undefined || !("value" in hash) || !hash.enumerable ||
    typeof hash.value !== "function" || types.isProxy(hash.value)) {
    structuralMismatch();
  }
  return Object.freeze({
    canonical: canonical.value as (value: unknown) => string,
    hash: hash.value as (canonicalText: string) => string,
  });
}

function freezeStructural<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) structuralMismatch();
    freezeStructural(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function reconstructCityCriteriaSnapshot(
  snapshot: unknown,
  integrity: CityDecisionIntegrity,
): CityCriteriaSnapshot {
  return structuralBoundary(() => {
    const capturedIntegrity = captureStructuralIntegrity(integrity);
    const owned = parseStructuralSnapshot(ownStructuralGraph(snapshot));
    const { id: _id, ...payload } = owned;
    void _id;
    const canonical = Reflect.apply(
      capturedIntegrity.canonical,
      Object.freeze({ capability: "canonical" }),
      [freezeStructural(payload)],
    ) as unknown;
    if (typeof canonical !== "string") structuralMismatch();
    const digest = Reflect.apply(
      capturedIntegrity.hash,
      Object.freeze({ capability: "hash" }),
      [canonical],
    ) as unknown;
    if (typeof digest !== "string" || !STRUCTURAL_DIGEST.test(digest) ||
      owned.id !== `city-criteria:${digest}`) {
      structuralMismatch();
    }
    return freezeStructural(owned);
  });
}
export function reconstructCityCriteria(snapshot: CityCriteriaSnapshot, evaluators: CityCriterionEvaluatorRegistry): CityCriteriaProjection {
  if (!record(snapshot) || !exact(snapshot, ["schemaVersion", "id", "profileSnapshotId", "preferenceProfileSnapshotId", "criteria", "rulesVersion", "confirmedAt"]) || snapshot.schemaVersion !== RULES_VERSION || snapshot.rulesVersion !== RULES_VERSION || typeof snapshot.id !== "string" || snapshot.id.length === 0 || typeof snapshot.profileSnapshotId !== "string" || snapshot.profileSnapshotId.length === 0 || typeof snapshot.preferenceProfileSnapshotId !== "string" || snapshot.preferenceProfileSnapshotId.length === 0 || !instant(snapshot.confirmedAt)) throw new Error("integrity_mismatch");
  try { const criteria = normalizeCriteria(snapshot.criteria, evaluators); if (!sameCriteria(criteria, snapshot.criteria)) throw new Error(); return freeze({ profileSnapshotId: snapshot.profileSnapshotId, preferenceProfileSnapshotId: snapshot.preferenceProfileSnapshotId, criteria, rulesVersion: RULES_VERSION, confirmedAt: snapshot.confirmedAt }); } catch { throw new Error("integrity_mismatch"); }
}

const INSTALLED_DEFINITION_KEYS = [
  "criterionId", "definitionId", "direction", "unit", "denominator", "compatibleGeoScopes",
  "freshnessPolicyVersion", "evaluatorVersion",
] as const;
const INSTALLED_DEFAULT_KEYS = [
  "criterionId", "definitionId", "mode", "importance", "target",
] as const;

function installedMismatch(): never {
  throw new Error("integrity_mismatch");
}

function installedPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function installedOwnSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "function") {
      if (types.isProxy(value)) installedMismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) installedMismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) installedMismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) ||
          length.value < 0 || Object.getOwnPropertyNames(value).length !== length.value + 1) {
          installedMismatch();
        }
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            installedMismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (!installedPlainRecord(value)) installedMismatch();
      const copy: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") installedMismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          installedMismatch();
        }
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function installedExactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!installedPlainRecord(value) || !sameStringOrder(
    Object.getOwnPropertyNames(value).sort(),
    [...keys].sort(),
  )) installedMismatch();
  return value;
}

function installedDenseArray(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== length || Object.getOwnPropertyNames(value).length !== length + 1) {
    installedMismatch();
  }
  return value;
}

function installedText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f]/.test(value)) installedMismatch();
  return value;
}

function installedIdentifier(value: unknown): string {
  const text = installedText(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(text)) installedMismatch();
  return text;
}

function installedDefinition(value: unknown, index: number): CityCriterionDefinition {
  const definition = installedExactRecord(value, INSTALLED_DEFINITION_KEYS);
  const criterionId = definition.criterionId;
  if (criterionId !== CITY_CRITERION_IDS[index] ||
    (definition.direction !== "at_least" && definition.direction !== "at_most")) {
    installedMismatch();
  }
  const scopesValue = definition.compatibleGeoScopes;
  if (!Array.isArray(scopesValue)) installedMismatch();
  const scopes = installedDenseArray(scopesValue, scopesValue.length).map(installedText);
  if (scopes.length === 0 || new Set(scopes).size !== scopes.length) installedMismatch();
  return {
    criterionId: criterionId as CityCriterionId,
    definitionId: installedIdentifier(definition.definitionId),
    direction: definition.direction,
    unit: installedText(definition.unit),
    denominator: installedText(definition.denominator),
    compatibleGeoScopes: scopes,
    freshnessPolicyVersion: installedIdentifier(definition.freshnessPolicyVersion),
    evaluatorVersion: installedIdentifier(definition.evaluatorVersion),
  };
}

function installedDefinitionTuple(value: unknown): InstalledCityCriterionDefinitionTuple {
  const tuple = installedDenseArray(value, CITY_CRITERION_IDS.length);
  return tuple.map((definition, index) => installedDefinition(definition, index)) as unknown as
    InstalledCityCriterionDefinitionTuple;
}

function installedExpectedMap(value: unknown): Readonly<Record<CityCriterionId, string>> {
  const map = installedExactRecord(value, CITY_CRITERION_IDS);
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
    criterionId,
    installedIdentifier(map[criterionId]),
  ])) as Readonly<Record<CityCriterionId, string>>;
}

function installedSameDefinition(
  left: CityCriterionDefinition,
  right: CityCriterionDefinition,
): boolean {
  return left.criterionId === right.criterionId && left.definitionId === right.definitionId &&
    left.direction === right.direction && left.unit === right.unit &&
    left.denominator === right.denominator &&
    sameStringOrder(left.compatibleGeoScopes, right.compatibleGeoScopes) &&
    left.freshnessPolicyVersion === right.freshnessPolicyVersion &&
    left.evaluatorVersion === right.evaluatorVersion;
}

export function reconstructInstalledCityCriterionDefinitions(
  value: unknown,
  expectedDefinitionIds: Readonly<Record<CityCriterionId, string>>,
  expectedEvaluatorVersionIds: Readonly<Record<CityCriterionId, string>>,
): InstalledCityCriterionDefinitionTuple {
  try {
    const definitions = reconstructInstalledCityCriterionDefinitionsStructure(
      value,
      expectedDefinitionIds,
    );
    const evaluatorVersionIds = installedExpectedMap(installedOwnSnapshot(expectedEvaluatorVersionIds));
    for (const definition of definitions) {
      if (definition.evaluatorVersion !== evaluatorVersionIds[definition.criterionId]) {
        installedMismatch();
      }
    }
    return freeze(definitions);
  } catch {
    installedMismatch();
  }
}

export function reconstructInstalledCityCriterionDefinitionsStructure(
  value: unknown,
  expectedDefinitionIds: Readonly<Record<CityCriterionId, string>>,
): InstalledCityCriterionDefinitionTuple {
  try {
    const definitionIds = installedExpectedMap(installedOwnSnapshot(expectedDefinitionIds));
    const definitions = installedDefinitionTuple(installedOwnSnapshot(value));
    for (const definition of definitions) {
      if (definition.definitionId !== definitionIds[definition.criterionId]) installedMismatch();
    }
    return freeze(definitions);
  } catch {
    installedMismatch();
  }
}

function installedDefaults(value: unknown): InstalledCityCriteriaDefaults {
  const defaults = installedExactRecord(value, ["schemaVersion", "mappingVersion", "criteria"]);
  if (defaults.schemaVersion !== "city-criteria-defaults@1") installedMismatch();
  const criteria = installedDenseArray(defaults.criteria, CITY_CRITERION_IDS.length).map((item, index) => {
    const criterion = installedExactRecord(item, INSTALLED_DEFAULT_KEYS);
    if (criterion.criterionId !== CITY_CRITERION_IDS[index] ||
      (criterion.mode !== "required" && criterion.mode !== "weighted") ||
      ![1, 2, 3, 4, 5].includes(criterion.importance as number)) installedMismatch();
    return {
      criterionId: criterion.criterionId,
      definitionId: installedIdentifier(criterion.definitionId),
      mode: criterion.mode,
      importance: criterion.importance as CityImportance,
      target: installedText(criterion.target),
    };
  }) as unknown as InstalledCityCriteriaDefaults["criteria"];
  return {
    schemaVersion: "city-criteria-defaults@1",
    mappingVersion: installedIdentifier(defaults.mappingVersion),
    criteria,
  };
}

interface InstalledEvaluatorView {
  readonly definition: CityCriterionDefinition;
  readonly canonicalizeTarget: (target: unknown) => string;
}

function installedEvaluators(value: unknown): Readonly<Record<CityCriterionId, InstalledEvaluatorView>> {
  const registry = installedExactRecord(value, CITY_CRITERION_IDS);
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId, index) => {
    const evaluator = installedExactRecord(
      registry[criterionId],
      ["definition", "canonicalizeTarget", "evaluate"],
    );
    if (typeof evaluator.canonicalizeTarget !== "function" || typeof evaluator.evaluate !== "function") {
      installedMismatch();
    }
    return [criterionId, {
      definition: installedDefinition(evaluator.definition, index),
      canonicalizeTarget: evaluator.canonicalizeTarget as (target: unknown) => string,
    }];
  })) as Readonly<Record<CityCriterionId, InstalledEvaluatorView>>;
}

export function reconstructInstalledCityCriteriaDefaults(
  value: unknown,
  expectedMappingVersion: string,
  definitions: InstalledCityCriterionDefinitionTuple,
  evaluators: CityCriterionEvaluatorRegistry,
): InstalledCityCriteriaDefaults {
  try {
    const ownedDefaults = installedDefaults(installedOwnSnapshot(value));
    const mappingVersion = installedIdentifier(expectedMappingVersion);
    const ownedDefinitions = installedDefinitionTuple(installedOwnSnapshot(definitions));
    const ownedEvaluators = installedEvaluators(installedOwnSnapshot(evaluators));
    if (ownedDefaults.mappingVersion !== mappingVersion) installedMismatch();
    for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
      const criterionId = CITY_CRITERION_IDS[index];
      const definition = ownedDefinitions[index];
      const evaluator = ownedEvaluators[criterionId];
      const criterion = ownedDefaults.criteria[index];
      if (criterion.definitionId !== definition.definitionId ||
        !installedSameDefinition(evaluator.definition, definition)) installedMismatch();
    }
    for (let index = 0; index < CITY_CRITERION_IDS.length; index += 1) {
      const criterionId = CITY_CRITERION_IDS[index];
      const target = ownedDefaults.criteria[index].target;
      if (ownedEvaluators[criterionId].canonicalizeTarget(target) !== target) installedMismatch();
    }
    return freeze(ownedDefaults);
  } catch {
    installedMismatch();
  }
}
