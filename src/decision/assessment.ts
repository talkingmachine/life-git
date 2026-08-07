import Decimal from "decimal.js";

import type { Assessment, AssessmentReason, ClaimId, Evidence, ProfileSnapshot, RouteConditions } from "../research/contracts";

const requiredResourcesAll = new Decimal("408000");

function reason(code: string, claimId: ClaimId): AssessmentReason {
  return { code, claimId };
}

function hasVerifiedOfficialClaim(evidence: Evidence, claimId: ClaimId): boolean {
  const claim = evidence.claims[claimId];
  return claim?.source === "official" && claim.status === "verified";
}

function yellow(code: string, claimId: ClaimId): Assessment {
  return { marker: "yellow", reasons: [reason(code, claimId)] };
}

export function assessRoute(profile: ProfileSnapshot, evidence: Evidence, routeConditions: RouteConditions): Assessment {
  if (profile.profile.incomeBasis === "albanian_employer_only" && hasVerifiedOfficialClaim(evidence, "al-law-79-art-68-contract")) {
    return { marker: "red", reasons: [reason("albanian_employer_only", "al-law-79-art-68-contract")] };
  }

  if (profile.profile.companionBasis === "independent" || profile.profile.companionBasis === "unknown") {
    return yellow("companion_basis_not_researched_in_vs1", "al-law-79-art-68-contract");
  }

  if (profile.profile.companionBasis === "family" && profile.profile.relationship !== "spouse") {
    return yellow("relationship_not_verified_in_vs1", "al-law-79-art-68-spouse");
  }

  if (!routeConditions.housingProvided) {
    return yellow("housing_not_confirmed", "al-tirana-residence");
  }

  if (!evidence.foreignContractVerified || !hasVerifiedOfficialClaim(evidence, "al-law-79-art-68-contract")) {
    return yellow("foreign_contract_not_verified", "al-law-79-art-68-contract");
  }

  if (!evidence.availableResourcesVerified || new Decimal(profile.profile.availableResourcesAll).lessThan(requiredResourcesAll)) {
    return yellow("available_resources_not_confirmed", "al-tirana-residence");
  }

  if (!evidence.lawfulStayVerified) {
    return yellow("lawful_stay_not_verified", "al-tirana-residence");
  }

  if (!evidence.stagedFamilyPlanVerified) {
    return yellow("staged_family_plan_not_verified", "al-law-79-art-68-spouse");
  }

  if (!hasVerifiedOfficialClaim(evidence, "al-tirana-residence")) {
    return yellow("tirana_claim_not_verified", "al-tirana-residence");
  }

  if (profile.profile.companionBasis === "family" && !hasVerifiedOfficialClaim(evidence, "al-law-79-art-68-spouse")) {
    return yellow("spouse_claim_not_verified", "al-law-79-art-68-spouse");
  }

  return { marker: "green", reasons: [] };
}
