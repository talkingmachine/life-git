import {
  reconstructCityCriteria,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityCriterionMode,
  type CityCriteriaSnapshot,
  type CityImportance,
  type CityRankingFactInput,
  type CityRankingUnknownReason,
  type CityVerifiedFactBasis,
} from "./city-criteria";
import { reconstructCityCatalog, type CityCatalogRevision, type CityRegistryRevision } from "./city-catalog";

export type CityKnowledgeRankingProjection =
  | { readonly cityId: string; readonly knowledgeRevisionId: string; readonly facts: readonly [CityRankingFactInput, CityRankingFactInput, CityRankingFactInput, CityRankingFactInput] }
  | { readonly cityId: string; readonly knowledgeRevisionId: null; readonly facts: readonly [] };
export interface CityRequiredMismatch { readonly criterionId: CityCriterionId; readonly definitionId: string; readonly target: string; readonly verifiedBasis: CityVerifiedFactBasis; readonly evaluatorVersion: string; }
export interface CityRankingFactor { readonly criterionId: CityCriterionId; readonly definitionId: string; readonly mode: CityCriterionMode; readonly importance: CityImportance; readonly evaluatorVersion: string; readonly freshnessPolicyVersion: string; readonly state: "verified" | "unknown"; readonly factor: string; readonly weightedContribution: string; readonly targetComparison: "matches" | "does_not_match" | "unknown"; readonly requiredMismatch: boolean; readonly unknownReason?: CityRankingUnknownReason; }
export interface RankedCity { readonly cityId: string; readonly rank: number; readonly score: string; readonly coverage: string; readonly knowledgeRevisionId: string | null; readonly factors: readonly [CityRankingFactor, CityRankingFactor, CityRankingFactor, CityRankingFactor]; }
export interface ScreenedCityExclusion { readonly cityId: string; readonly score: string; readonly coverage: string; readonly knowledgeRevisionId: string | null; readonly requiredMismatches: readonly CityRequiredMismatch[]; readonly factors: readonly [CityRankingFactor, CityRankingFactor, CityRankingFactor, CityRankingFactor]; }
export interface CityRankingResult { readonly ordered: readonly RankedCity[]; readonly screenedExclusions: readonly ScreenedCityExclusion[]; readonly rulesVersion: "city-ranker@1"; }
export interface RankCitiesInput { readonly assessmentAt: string; readonly registry: CityRegistryRevision; readonly catalog: CityCatalogRevision; readonly criteria: CityCriteriaSnapshot; readonly knowledge: readonly CityKnowledgeRankingProjection[]; readonly evaluators: CityCriterionEvaluatorRegistry; }
export interface ReconstructCityRankingInput extends RankCitiesInput { readonly ranking: CityRankingResult; }

interface Rational { readonly numerator: bigint; readonly denominator: bigint; }
const ZERO: Rational = { numerator: 0n, denominator: 1n };
const ONE: Rational = { numerator: 1n, denominator: 1n };
const UNKNOWN_REASONS: readonly CityRankingUnknownReason[] = ["not_found", "stale", "conflict", "not_comparable", "source_unavailable"];
function fail(): never { throw new Error("integrity_mismatch"); }
function ordinal(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function freeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function instant(value: string): void { try { if (new Date(value).toISOString() !== value) throw new Error(); } catch { fail(); } }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(ordinal);
  const expected = [...keys].sort(ordinal);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}
function decimal(value: string): Rational {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail();
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 18) fail();
  return { numerator: BigInt(`${whole}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
}
function add(left: Rational, right: Rational): Rational { return { numerator: left.numerator * right.denominator + right.numerator * left.denominator, denominator: left.denominator * right.denominator }; }
function multiply(left: Rational, value: bigint): Rational { return { numerator: left.numerator * value, denominator: left.denominator }; }
function compare(left: Rational, right: Rational): number { const delta = left.numerator * right.denominator - right.numerator * left.denominator; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
function text(value: Rational): string {
  let whole = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;
  const scale = 10n ** 18n;
  let fraction = remainder * scale / value.denominator;
  const discarded = remainder * scale % value.denominator;
  if (discarded * 2n > value.denominator || (discarded * 2n === value.denominator && fraction % 2n === 1n)) fraction += 1n;
  if (fraction === scale) { whole += 1n; fraction = 0n; }
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}
function tuple<T>(values: T[]): readonly [T, T, T, T] { if (values.length !== 4) fail(); return values as unknown as readonly [T, T, T, T]; }

function canonicalDecimal(value: unknown): Rational {
  if (typeof value !== "string") fail();
  const rational = decimal(value);
  if (text(rational) !== value) fail();
  return rational;
}

function validateEvaluator(criterion: CityCriteriaSnapshot["criteria"][number], evaluator: CityCriterionEvaluatorRegistry[CityCriterionId]): void {
  const definition = evaluator.definition;
  if (definition.criterionId !== criterion.criterionId || definition.definitionId !== criterion.definitionId ||
    typeof definition.evaluatorVersion !== "string" || definition.evaluatorVersion.length === 0 ||
    typeof definition.freshnessPolicyVersion !== "string" || definition.freshnessPolicyVersion.length === 0) fail();
}

function validateEvaluation(
  value: unknown,
  fact: CityRankingFactInput,
): { readonly state: "verified" | "unknown"; readonly factor: string; readonly targetComparison: "matches" | "does_not_match" | "unknown"; readonly unknownReason?: CityRankingUnknownReason; readonly rational: Rational } {
  if (!record(value) || (value.state !== "verified" && value.state !== "unknown") || typeof value.factor !== "string") fail();
  const rational = canonicalDecimal(value.factor);
  if (compare(rational, ZERO) < 0 || compare(rational, ONE) > 0) fail();
  if (value.state === "verified") {
    if (!exact(value, ["state", "factor", "targetComparison"]) || (value.targetComparison !== "matches" && value.targetComparison !== "does_not_match")) fail();
    if (fact.outcome.kind === "unknown") fail();
    return { state: "verified", factor: value.factor, targetComparison: value.targetComparison, rational };
  }
  if (!exact(value, ["state", "factor", "targetComparison", "unknownReason"]) || value.factor !== "0" || value.targetComparison !== "unknown" || !UNKNOWN_REASONS.includes(value.unknownReason as CityRankingUnknownReason)) fail();
  if (fact.outcome.kind === "unknown" && value.unknownReason !== fact.outcome.reason) fail();
  return { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: value.unknownReason as CityRankingUnknownReason, rational };
}

function structural(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "number" && Number.isFinite(value)) return `n:${value}`;
  if (Array.isArray(value)) return `[${value.map(structural).join(",")}]`;
  if (!record(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail();
  return `{${Object.keys(value).sort(ordinal).map((key) => `${JSON.stringify(key)}:${structural(value[key])}`).join(",")}}`;
}

interface InternalFactor extends CityRankingFactor {
  readonly rational: Rational;
  readonly mismatch?: CityRequiredMismatch;
}

function evaluateCity(cityId: string, knowledge: CityKnowledgeRankingProjection, input: RankCitiesInput): { readonly cityId: string; readonly knowledgeRevisionId: string | null; readonly factors: readonly [CityRankingFactor, CityRankingFactor, CityRankingFactor, CityRankingFactor]; readonly score: Rational; readonly coverage: Rational; readonly mismatches: readonly CityRequiredMismatch[] } {
  const criteria = reconstructCityCriteria(input.criteria, input.evaluators).criteria;
  if (knowledge.cityId !== cityId) fail();
  const facts = knowledge.knowledgeRevisionId === null ? [] : knowledge.facts;
  if ((knowledge.knowledgeRevisionId === null && facts.length !== 0) || (knowledge.knowledgeRevisionId !== null && (knowledge.knowledgeRevisionId.length === 0 || facts.length !== 4))) fail();
  const factors: InternalFactor[] = criteria.map((criterion, index) => {
    const evaluator = input.evaluators[criterion.criterionId];
    validateEvaluator(criterion, evaluator);
    let evaluation: ReturnType<typeof validateEvaluation> | { readonly state: "unknown"; readonly factor: "0"; readonly targetComparison: "unknown"; readonly unknownReason: "no_knowledge_revision"; readonly rational: Rational };
    let fact: CityRankingFactInput | undefined;
    if (knowledge.knowledgeRevisionId === null) evaluation = { state: "unknown", factor: "0", targetComparison: "unknown", unknownReason: "no_knowledge_revision", rational: ZERO };
    else {
      fact = facts[index];
      if (fact === undefined || fact.criterionId !== criterion.criterionId || fact.definitionId !== criterion.definitionId ||
        fact.freshnessBasis !== evaluator.definition.freshnessPolicyVersion) fail();
      evaluation = validateEvaluation(evaluator.evaluate({ criterion, fact, assessmentAt: input.assessmentAt }), fact);
    }
    const factor = evaluation.rational;
    const requiredMismatch = criterion.mode === "required" && evaluation.state === "verified" && evaluation.targetComparison === "does_not_match";
    return { criterionId: criterion.criterionId, definitionId: criterion.definitionId, mode: criterion.mode, importance: criterion.importance, evaluatorVersion: evaluator.definition.evaluatorVersion, freshnessPolicyVersion: evaluator.definition.freshnessPolicyVersion, state: evaluation.state, factor: text(factor), weightedContribution: text(multiply(factor, BigInt(criterion.importance))), targetComparison: evaluation.targetComparison, requiredMismatch, rational: factor, ...(evaluation.unknownReason === undefined ? {} : { unknownReason: evaluation.unknownReason }), ...(requiredMismatch && fact?.outcome.kind === "verified" ? { mismatch: { criterionId: criterion.criterionId, definitionId: criterion.definitionId, target: criterion.target, verifiedBasis: clone(fact.outcome.basis), evaluatorVersion: evaluator.definition.evaluatorVersion } } : {}) };
  });
  const denominator = BigInt(criteria.reduce((sum, criterion) => sum + criterion.importance, 0));
  const score = factors.reduce((sum, factor) => add(sum, multiply(factor.rational, BigInt(factor.importance))), ZERO);
  const coverage = { numerator: BigInt(factors.filter((factor) => factor.state === "verified").reduce((sum, factor) => sum + factor.importance, 0)), denominator };
  const publicFactors = factors.map((factor) => {
    const publicFactor: Record<string, unknown> = { ...factor };
    delete publicFactor.mismatch;
    delete publicFactor.rational;
    return publicFactor as unknown as CityRankingFactor;
  });
  return { cityId, knowledgeRevisionId: knowledge.knowledgeRevisionId, factors: tuple(publicFactors), score: { numerator: score.numerator, denominator: score.denominator * denominator }, coverage, mismatches: factors.flatMap((factor) => factor.mismatch === undefined ? [] : [factor.mismatch]) };
}

export function rankCities(input: RankCitiesInput): CityRankingResult {
  instant(input.assessmentAt);
  const projection = reconstructCityCatalog({ registry: input.registry, catalog: input.catalog });
  const members = projection.catalog.members.map(({ cityId }) => cityId);
  if (new Set(members).size !== members.length || input.knowledge.length !== members.length) fail();
  const byCity = new Map(input.knowledge.map((entry) => [entry.cityId, entry]));
  if (byCity.size !== members.length || members.some((cityId) => !byCity.has(cityId))) fail();
  const values = members.map((cityId) => evaluateCity(cityId, byCity.get(cityId)!, input));
  const orderedValues = values.filter((value) => value.mismatches.length === 0).sort((left, right) => -compare(left.score, right.score) || -compare(left.coverage, right.coverage) || ordinal(left.cityId, right.cityId));
  const excluded = values.filter((value) => value.mismatches.length > 0).sort((left, right) => ordinal(left.cityId, right.cityId));
  return freeze({ ordered: orderedValues.map((value, index) => ({ cityId: value.cityId, rank: index + 1, score: text(value.score), coverage: text(value.coverage), knowledgeRevisionId: value.knowledgeRevisionId, factors: value.factors })), screenedExclusions: excluded.map((value) => ({ cityId: value.cityId, score: text(value.score), coverage: text(value.coverage), knowledgeRevisionId: value.knowledgeRevisionId, requiredMismatches: value.mismatches, factors: value.factors })), rulesVersion: "city-ranker@1" as const });
}

export function reconstructCityRanking(input: ReconstructCityRankingInput): CityRankingResult {
  const { ranking, ...rankInput } = input;
  const reconstructed = rankCities(rankInput);
  if (structural(reconstructed) !== structural(ranking)) fail();
  return reconstructed;
}
