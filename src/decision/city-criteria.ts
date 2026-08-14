import type { CityDecisionIntegrity } from "./city-integrity";
import type { PreferenceProfileSnapshot } from "./preference-profile";
import type { RelocationProfileSnapshot } from "./relocation-profile";

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
export function deriveCityCriteriaDraft(_profile: RelocationProfileSnapshot, preferences: PreferenceProfileSnapshot, defaults: InstalledCityCriteriaDefaults, evaluators: CityCriterionEvaluatorRegistry): CityCriteriaSnapshot["criteria"] {
  if (!record(defaults) || defaults.schemaVersion !== "city-criteria-defaults@1" || typeof defaults.mappingVersion !== "string") throw new Error("invalid_city_defaults");
  const criteria = normalizeCriteria(defaults.criteria, evaluators).map((criterion) => ({ ...criterion }));
  const safety = preferences.criteria.find(({ id }) => id === "personal_safety");
  const infrastructure = preferences.criteria.find(({ id }) => id === "infrastructure");
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
export function reconstructCityCriteria(snapshot: CityCriteriaSnapshot, evaluators: CityCriterionEvaluatorRegistry): CityCriteriaProjection {
  if (!record(snapshot) || !exact(snapshot, ["schemaVersion", "id", "profileSnapshotId", "preferenceProfileSnapshotId", "criteria", "rulesVersion", "confirmedAt"]) || snapshot.schemaVersion !== RULES_VERSION || snapshot.rulesVersion !== RULES_VERSION || typeof snapshot.id !== "string" || snapshot.id.length === 0 || typeof snapshot.profileSnapshotId !== "string" || snapshot.profileSnapshotId.length === 0 || typeof snapshot.preferenceProfileSnapshotId !== "string" || snapshot.preferenceProfileSnapshotId.length === 0 || !instant(snapshot.confirmedAt)) throw new Error("integrity_mismatch");
  try { const criteria = normalizeCriteria(snapshot.criteria, evaluators); if (JSON.stringify(criteria) !== JSON.stringify(snapshot.criteria)) throw new Error(); return freeze({ profileSnapshotId: snapshot.profileSnapshotId, preferenceProfileSnapshotId: snapshot.preferenceProfileSnapshotId, criteria, rulesVersion: RULES_VERSION, confirmedAt: snapshot.confirmedAt }); } catch { throw new Error("integrity_mismatch"); }
}
