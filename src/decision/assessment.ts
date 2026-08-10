import Decimal from "decimal.js";

import type {
  Assessment,
  AssessmentReason,
  ClaimId,
  Evidence,
  ProfileSnapshot,
  RouteConditions,
  SourceId,
} from "../research/contracts";

const requiredResourcesAll = new Decimal("408000");

export const LEGACY_ASSESSMENT_RULES_VERSION = "vs1-assessment@1";
export const CURRENT_ASSESSMENT_RULES_VERSION = "vs1-assessment@2";
export type AssessmentRulesVersion =
  | typeof LEGACY_ASSESSMENT_RULES_VERSION
  | typeof CURRENT_ASSESSMENT_RULES_VERSION;

export function isSupportedAssessmentRulesVersion(value: string): value is AssessmentRulesVersion {
  return value === LEGACY_ASSESSMENT_RULES_VERSION || value === CURRENT_ASSESSMENT_RULES_VERSION;
}

function reason(evidence: Evidence, code: string, claimId: ClaimId, sourceId: SourceId): AssessmentReason {
  const blockerKind = evidence.sourceBlockers[sourceId];
  return { code, claimId, sourceId, ...(blockerKind === undefined ? {} : { blockerKind }) };
}

function hasVerifiedOfficialClaim(evidence: Evidence, claimId: ClaimId): boolean {
  const claim = evidence.claims[claimId];
  return claim?.source === "official" && claim.status === "verified";
}

function yellow(evidence: Evidence, code: string, claimId: ClaimId, sourceId: SourceId): Assessment {
  return { marker: "yellow", reasons: [reason(evidence, code, claimId, sourceId)] };
}

function profileConditionYellow(
  version: AssessmentRulesVersion,
  evidence: Evidence,
  code: string,
  legacyClaimId: ClaimId,
  legacySourceId: SourceId,
): Assessment {
  return version === LEGACY_ASSESSMENT_RULES_VERSION
    ? yellow(evidence, code, legacyClaimId, legacySourceId)
    : { marker: "yellow", reasons: [{ code }] };
}

function assessRouteAtVersion(
  version: AssessmentRulesVersion,
  profile: ProfileSnapshot,
  evidence: Evidence,
  routeConditions: RouteConditions,
): Assessment {
  if (evidence.foreignContractVerified !== "verified" || !hasVerifiedOfficialClaim(evidence, "al-law-79-art-68-contract")) {
    return yellow(evidence, "foreign_contract_not_verified", "al-law-79-art-68-contract", "al-law-79");
  }

  if (evidence.availableResourcesVerified !== "verified") {
    return yellow(evidence, "available_resources_rule_unavailable", "al-decision-858-facts-1", "al-decision-858");
  }

  if (evidence.lawfulStayVerified !== "verified") {
    return yellow(evidence, "lawful_stay_not_verified", "al-law-79-art-68-contract", "al-law-79");
  }

  if (evidence.stagedFamilyPlanVerified !== "verified") {
    return yellow(evidence, "staged_family_plan_not_verified", "al-law-79-art-68-spouse", "al-law-79");
  }

  if (evidence.cbrRateVerified !== "verified") {
    return yellow(evidence, "cbr_rate_not_verified", "cbr-eur-facts-1", "cbr-eur");
  }

  if (evidence.boaRateVerified !== "verified") {
    return yellow(evidence, "boa_rate_not_verified", "boa-eur-facts-1", "boa-eur");
  }

  if (!hasVerifiedOfficialClaim(evidence, "al-tirana-residence")) {
    return yellow(evidence, "tirana_claim_not_verified", "al-tirana-residence", "tirana-urban-lines");
  }

  if (profile.profile.companionBasis === "family" && !hasVerifiedOfficialClaim(evidence, "al-law-79-art-68-spouse")) {
    return yellow(evidence, "spouse_claim_not_verified", "al-law-79-art-68-spouse", "al-law-79");
  }

  if (profile.profile.incomeBasis === "albanian_employer_only") {
    return { marker: "red", reasons: [reason(evidence, "albanian_employer_only", "al-law-79-art-68-contract", "al-law-79")] };
  }

  if (new Decimal(profile.profile.availableResourcesAll).lessThan(requiredResourcesAll)) {
    return yellow(evidence, "available_resources_below_threshold", "al-decision-858-facts-1", "al-decision-858");
  }

  if (profile.profile.companionBasis === "independent" || profile.profile.companionBasis === "unknown") {
    return yellow(evidence, "companion_basis_not_researched_in_vs1", "al-law-79-art-68-contract", "al-law-79");
  }

  if (profile.profile.companionBasis === "family" && profile.profile.relationship !== "spouse") {
    return yellow(evidence, "relationship_not_verified_in_vs1", "al-law-79-art-68-spouse", "al-law-79");
  }

  if (!routeConditions.housingProvided) {
    return yellow(evidence, "housing_not_confirmed", "al-tirana-residence", "tirana-urban-lines");
  }

  if (!profile.profile.conditions.incomeContinues12Months) {
    return profileConditionYellow(
      version,
      evidence,
      "income_continuation_not_confirmed",
      "al-law-79-art-68-contract",
      "al-law-79",
    );
  }

  if (!profile.profile.conditions.lawfulStayPrerequisiteAccepted) {
    return profileConditionYellow(
      version,
      evidence,
      "lawful_stay_prerequisite_not_accepted",
      "al-law-79-art-68-contract",
      "al-law-79",
    );
  }

  if (
    profile.profile.companionBasis === "family" &&
    profile.profile.relationship === "spouse" &&
    !profile.profile.conditions.stagedSpouseRouteAccepted
  ) {
    return profileConditionYellow(
      version,
      evidence,
      "staged_spouse_route_not_accepted",
      "al-law-79-art-68-spouse",
      "al-law-79",
    );
  }

  return { marker: "green", reasons: [] };
}

export function assessRoute(
  profile: ProfileSnapshot,
  evidence: Evidence,
  routeConditions: RouteConditions,
): Assessment {
  return assessRouteAtVersion(CURRENT_ASSESSMENT_RULES_VERSION, profile, evidence, routeConditions);
}

export function assessRouteForVersion(
  version: string,
  profile: ProfileSnapshot,
  evidence: Evidence,
  routeConditions: RouteConditions,
): Assessment {
  if (!isSupportedAssessmentRulesVersion(version)) throw new Error("unsupported_assessment_rules");
  return assessRouteAtVersion(version, profile, evidence, routeConditions);
}
