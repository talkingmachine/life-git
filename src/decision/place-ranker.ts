import Decimal from "decimal.js";

import {
  confirmPreferenceProfile,
  type PlaceCriterionId,
  type PreferenceCriterion,
  type PreferenceProfileSnapshot,
} from "./preference-profile";

export type PlaceFactorState =
  | "known"
  | "missing"
  | "stale"
  | "future"
  | "not_comparable";

export interface PlaceFactorProjection {
  readonly criterionId: PlaceCriterionId;
  readonly state: PlaceFactorState;
  readonly match?: string;
  readonly requirementStatus?: "matches" | "does_not_match";
  readonly observationId?: string;
  readonly evaluatorVersion: string;
}

export interface RankablePlace {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly factors: readonly PlaceFactorProjection[];
}

export interface RankedPlace extends RankablePlace {
  readonly rank: number;
  readonly relevance: string;
  readonly coverage: string;
  readonly contributions: readonly {
    readonly criterionId: PlaceCriterionId;
    readonly state: PlaceFactorState;
    readonly effectiveMatch: string;
    readonly weightedContribution: string;
    readonly observationId?: string;
  }[];
}

export interface RequiredMismatch {
  readonly countryCode: string;
  readonly criterionId: PlaceCriterionId;
  readonly observationId: string;
}

export interface PlaceRankingResult {
  readonly ordered: readonly RankedPlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: "place-ranker@1";
}

const ISO_CALENDAR_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const UNKNOWN_STATES = new Set<PlaceFactorState>([
  "missing",
  "stale",
  "future",
  "not_comparable",
]);

interface ScoredPlace {
  readonly place: RankablePlace;
  readonly relevance: Decimal;
  readonly coverage: Decimal;
  readonly contributions: RankedPlace["contributions"];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertAssessmentDate(value: string): void {
  if (!ISO_CALENDAR_DATE.test(value)) throw new Error("invalid_assessment_date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("invalid_assessment_date");
  }
}

function verifiedPreferences(
  preferences: PreferenceProfileSnapshot,
): PreferenceProfileSnapshot {
  if (preferences.schemaVersion !== "preference-profile@1") {
    throw new Error("invalid_preference_profile");
  }

  let confirmed: PreferenceProfileSnapshot;
  try {
    const confirmedAt = new Date(preferences.confirmedAt);
    if (confirmedAt.toISOString() !== preferences.confirmedAt) {
      throw new Error("invalid confirmedAt");
    }
    confirmed = confirmPreferenceProfile(
      { criteria: preferences.criteria },
      () => confirmedAt,
    );
  } catch {
    throw new Error("invalid_preference_profile");
  }
  if (confirmed.id !== preferences.id) throw new Error("invalid_preference_profile");
  return confirmed;
}

function assertFactorState(state: PlaceFactorState): void {
  if (state !== "known" && !UNKNOWN_STATES.has(state)) {
    throw new Error("invalid_factor_state");
  }
}

function knownMatch(factor: PlaceFactorProjection): Decimal {
  if (typeof factor.match !== "string") throw new Error("known_match_missing");

  let match: Decimal;
  try {
    match = new Decimal(factor.match);
  } catch {
    throw new Error("invalid_known_match");
  }
  if (!match.isFinite() || match.lessThan(-1) || match.greaterThan(1)) {
    throw new Error("invalid_known_match");
  }
  return match;
}

function validateFactor(
  factor: PlaceFactorProjection,
  criterion: PreferenceCriterion,
): Decimal {
  assertFactorState(factor.state);
  if (typeof factor.evaluatorVersion !== "string" || factor.evaluatorVersion.length === 0) {
    throw new Error("evaluator_version_missing");
  }
  if (criterion.mode === "weighted" && factor.requirementStatus !== undefined) {
    throw new Error("weighted_requirement_status_forbidden");
  }
  if (factor.state !== "known") {
    if (
      factor.match !== undefined ||
      factor.requirementStatus !== undefined ||
      factor.observationId !== undefined
    ) throw new Error("unknown_factor_fields_forbidden");
    return new Decimal(-1);
  }
  if (typeof factor.observationId !== "string" || factor.observationId.length === 0) {
    throw new Error("known_observation_missing");
  }
  if (criterion.mode === "required" &&
    factor.requirementStatus !== "matches" &&
    factor.requirementStatus !== "does_not_match") {
    throw new Error("required_status_missing");
  }
  return knownMatch(factor);
}

function factorsByCriterion(
  place: RankablePlace,
  criteria: readonly PreferenceCriterion[],
): ReadonlyMap<PlaceCriterionId, PlaceFactorProjection> {
  if (place.factors.length !== criteria.length) throw new Error("factor_rows_mismatch");
  const allowed = new Set(criteria.map(({ id }) => id));
  const factors = new Map<PlaceCriterionId, PlaceFactorProjection>();
  for (const factor of place.factors) {
    if (!allowed.has(factor.criterionId) || factors.has(factor.criterionId)) {
      throw new Error("factor_rows_mismatch");
    }
    factors.set(factor.criterionId, factor);
  }
  if (factors.size !== criteria.length) throw new Error("factor_rows_mismatch");
  return factors;
}

function clonePlace(place: RankablePlace): RankablePlace {
  return {
    countryCode: place.countryCode,
    label: place.label,
    flag: place.flag,
    coordinate: { ...place.coordinate },
    factors: place.factors.map((factor) => ({ ...factor })),
  };
}

function assertPlaceIdentity(place: RankablePlace): void {
  if (
    place.countryCode.length === 0 ||
    place.label.length === 0 ||
    place.flag.length === 0 ||
    !Number.isFinite(place.coordinate.lat) ||
    place.coordinate.lat < -90 ||
    place.coordinate.lat > 90 ||
    !Number.isFinite(place.coordinate.lng) ||
    place.coordinate.lng < -180 ||
    place.coordinate.lng > 180
  ) throw new Error("invalid_place");
}

function scorePlace(
  place: RankablePlace,
  criteria: readonly PreferenceCriterion[],
  totalImportance: Decimal,
): ScoredPlace | readonly RequiredMismatch[] {
  const factorMap = factorsByCriterion(place, criteria);
  const mismatches: RequiredMismatch[] = [];
  let weightedTotal = new Decimal(0);
  let knownImportance = new Decimal(0);
  const contributions = criteria.map((criterion) => {
    const factor = factorMap.get(criterion.id)!;
    const effectiveMatch = validateFactor(factor, criterion);
    const contribution = effectiveMatch.mul(criterion.importance);
    weightedTotal = weightedTotal.add(contribution);
    if (factor.state === "known") knownImportance = knownImportance.add(criterion.importance);
    if (factor.state === "known" && criterion.mode === "required" &&
      factor.requirementStatus === "does_not_match") {
      mismatches.push({
        countryCode: place.countryCode,
        criterionId: criterion.id,
        observationId: factor.observationId!,
      });
    }
    return {
      criterionId: criterion.id,
      state: factor.state,
      effectiveMatch: effectiveMatch.toString(),
      weightedContribution: contribution.toString(),
      ...(factor.observationId === undefined ? {} : { observationId: factor.observationId }),
    };
  });

  if (mismatches.length > 0) return mismatches;
  return {
    place: clonePlace(place),
    relevance: weightedTotal.div(totalImportance),
    coverage: knownImportance.div(totalImportance),
    contributions,
  };
}

function isMismatchResult(
  result: ScoredPlace | readonly RequiredMismatch[],
): result is readonly RequiredMismatch[] {
  return Array.isArray(result);
}

export function rankPlaces(input: {
  readonly assessmentAt: string;
  readonly preferences: PreferenceProfileSnapshot;
  readonly places: readonly RankablePlace[];
}): PlaceRankingResult {
  assertAssessmentDate(input.assessmentAt);
  const preferences = verifiedPreferences(input.preferences);
  const totalImportance = preferences.criteria.reduce(
    (total, criterion) => total.add(criterion.importance),
    new Decimal(0),
  );
  const scored: ScoredPlace[] = [];
  const excluded: RequiredMismatch[] = [];
  const countryCodes = new Set<string>();

  for (const place of input.places) {
    assertPlaceIdentity(place);
    if (countryCodes.has(place.countryCode)) throw new Error("duplicate_place");
    countryCodes.add(place.countryCode);
    const result = scorePlace(place, preferences.criteria, totalImportance);
    if (isMismatchResult(result)) excluded.push(...result);
    else scored.push(result);
  }

  scored.sort((left, right) =>
    right.relevance.comparedTo(left.relevance) ||
    right.coverage.comparedTo(left.coverage) ||
    left.place.countryCode.localeCompare(right.place.countryCode)
  );
  excluded.sort((left, right) =>
    left.countryCode.localeCompare(right.countryCode) ||
    preferences.criteria.findIndex(({ id }) => id === left.criterionId) -
      preferences.criteria.findIndex(({ id }) => id === right.criterionId)
  );

  return deepFreeze({
    ordered: scored.map(({ place, relevance, coverage, contributions }, index) => ({
      ...place,
      rank: index + 1,
      relevance: relevance.toString(),
      coverage: coverage.toString(),
      contributions,
    })),
    excluded,
    rulesVersion: "place-ranker@1",
  });
}

function sameRankingValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconstructPlaceRanking(input: {
  readonly assessmentAt: string;
  readonly preferences: PreferenceProfileSnapshot;
  readonly ordered: readonly RankedPlace[];
  readonly excludedPlaces: readonly RankablePlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: PlaceRankingResult["rulesVersion"];
}): PlaceRankingResult {
  if (input.rulesVersion !== "place-ranker@1") throw new Error("invalid_ranking_rules");
  if (input.ordered.length === 0 && input.excluded.length === 0) {
    throw new Error("empty_ranking");
  }
  const orderedPlaces = input.ordered.map(({
    countryCode,
    label,
    flag,
    coordinate,
    factors,
  }) => ({ countryCode, label, flag, coordinate, factors }));
  const reconstructed = rankPlaces({
    assessmentAt: input.assessmentAt,
    preferences: input.preferences,
    places: [...orderedPlaces, ...input.excludedPlaces],
  });
  if (
    !sameRankingValue(reconstructed.ordered, input.ordered) ||
    !sameRankingValue(reconstructed.excluded, input.excluded)
  ) {
    throw new Error("invalid_ranking_semantics");
  }
  const excludedCountryCodes = [...new Set(input.excluded.map(({ countryCode }) => countryCode))]
    .sort();
  if (!sameRankingValue(
    input.excludedPlaces.map(({ countryCode }) => countryCode),
    excludedCountryCodes,
  )) throw new Error("invalid_excluded_places");
  return deepFreeze({
    ordered: reconstructed.ordered,
    excluded: input.excluded.map((row) => ({ ...row })),
    rulesVersion: "place-ranker@1",
  });
}
