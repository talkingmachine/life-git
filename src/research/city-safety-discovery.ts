import type { CityUnknownReason } from "../decision/city-criteria";
import type {
  CitySafetyCandidateAttempt,
  CitySafetyQueryAttempt,
  CitySafetyUsableCandidateAttempt,
} from "./city-safety-evidence";

const SOURCE_UNAVAILABLE_REASONS = new Set([
  "transport_unavailable",
  "wrong_media_type",
  "too_large",
  "retention_unapproved",
]);
const NOT_COMPARABLE_REASONS = new Set([
  "scope_mismatch",
  "definition_mismatch",
  "missing_numerator",
  "denominator_missing",
  "denominator_zero",
  "denominator_period_mismatch",
  "denominator_scope_mismatch",
]);

export function canonicalizeCitySafetyCandidateUrl(value: string): string {
  try {
    if (typeof value !== "string" || value.trim() !== value) throw new Error();
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      throw new Error();
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    throw new Error("invalid_city_safety_candidate_url");
  }
}

function quantitiesDiffer(
  left: CitySafetyUsableCandidateAttempt,
  right: CitySafetyUsableCandidateAttempt,
): boolean {
  return left.referenceYear === right.referenceYear &&
    (left.quantity.offenceCount !== right.quantity.offenceCount ||
      left.quantity.population !== right.quantity.population);
}

function hasFallbackConflict(attempts: readonly CitySafetyCandidateAttempt[]): boolean {
  const usable = attempts.filter((attempt): attempt is CitySafetyUsableCandidateAttempt =>
    attempt.disposition === "usable" && attempt.periodDisposition === "fallback");
  return usable.some((attempt, index) =>
    usable.slice(index + 1).some((other) => quantitiesDiffer(attempt, other)));
}

export function chooseCitySafetyUnknownReason(
  attempts: readonly CitySafetyCandidateAttempt[],
  queries: readonly CitySafetyQueryAttempt[],
): CityUnknownReason {
  const rejectedReasons = attempts
    .filter((attempt) => attempt.disposition === "rejected")
    .map(({ reason }) => reason);
  if (rejectedReasons.includes("conflict") || hasFallbackConflict(attempts)) return "conflict";
  if (rejectedReasons.some((reason) => SOURCE_UNAVAILABLE_REASONS.has(reason)) ||
    queries.some(({ outcome }) => outcome.kind === "unavailable")) return "source_unavailable";
  if (rejectedReasons.includes("stale")) return "stale";
  if (rejectedReasons.some((reason) => NOT_COMPARABLE_REASONS.has(reason))) return "not_comparable";
  return "not_found";
}
