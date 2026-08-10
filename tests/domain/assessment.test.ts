import { expect, test } from "vitest";

import {
  assessRoute,
  assessRouteForVersion,
  CURRENT_ASSESSMENT_RULES_VERSION,
} from "../../src/decision/assessment";
import { confirmProfile, type ProfileDraft } from "../../src/decision/profile";
import type { Evidence } from "../../src/research/contracts";

const clock = () => new Date("2026-08-07T12:00:00.000Z");

const verifiedEvidence: Evidence = {
  claims: {
    "al-law-79-art-68-contract": { source: "official", status: "verified" },
    "al-law-79-art-68-spouse": { source: "official", status: "verified" },
    "al-tirana-residence": { source: "official", status: "verified" },
  },
  foreignContractVerified: "verified",
  availableResourcesVerified: "verified",
  lawfulStayVerified: "verified",
  stagedFamilyPlanVerified: "verified",
  cbrRateVerified: "verified",
  boaRateVerified: "verified",
  sourceBlockers: {},
};

function profileFor(overrides: Partial<ProfileDraft> = {}) {
  return confirmProfile(
    {
      availableResourcesAll: "408000",
      monthlyIncome: { amount: "210000", currency: "RUB" },
      incomeBasis: "foreign_contract",
      companionBasis: "none",
      relationship: "none",
      conditions: {
        incomeContinues12Months: true,
        lawfulStayPrerequisiteAccepted: true,
        stagedSpouseRouteAccepted: false,
      },
      ...overrides,
    },
    clock,
  );
}

test("marks the researched no-companion and source-verified spouse routes green", () => {
  const completeProfile = profileFor();
  const spouseProfile = profileFor({
    companionBasis: "family",
    relationship: "spouse",
    conditions: {
      incomeContinues12Months: true,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: true,
    },
  });

  expect(assessRoute(completeProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("green");
  expect(assessRoute(spouseProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("green");
});

test("keeps unconfirmed scenario conditions yellow without fabricating official lineage", () => {
  expect(assessRoute(profileFor({
    conditions: {
      incomeContinues12Months: false,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: false,
    },
  }), verifiedEvidence, { housingProvided: true }).reasons[0])
    .toEqual({ code: "income_continuation_not_confirmed" });
  expect(assessRoute(profileFor({
    conditions: {
      incomeContinues12Months: true,
      lawfulStayPrerequisiteAccepted: false,
      stagedSpouseRouteAccepted: false,
    },
  }), verifiedEvidence, { housingProvided: true }).reasons[0])
    .toEqual({ code: "lawful_stay_prerequisite_not_accepted" });
  expect(assessRoute(profileFor({
    conditions: {
      incomeContinues12Months: true,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: false,
    },
  }), verifiedEvidence, { housingProvided: true }).marker).toBe("green");
  expect(assessRoute(profileFor({
    companionBasis: "family",
    relationship: "spouse",
    conditions: {
      incomeContinues12Months: true,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: false,
    },
  }), verifiedEvidence, { housingProvided: true }).reasons[0])
    .toEqual({ code: "staged_spouse_route_not_accepted" });
});

test("keeps the sealed v1 condition reason reproducible while v2 removes fabricated lineage", () => {
  const profile = profileFor({
    conditions: {
      incomeContinues12Months: false,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: false,
    },
  });

  expect(assessRouteForVersion(
    "vs1-assessment@1",
    profile,
    verifiedEvidence,
    { housingProvided: true },
  ).reasons[0]).toEqual({
    code: "income_continuation_not_confirmed",
    claimId: "al-law-79-art-68-contract",
    sourceId: "al-law-79",
  });
  expect(CURRENT_ASSESSMENT_RULES_VERSION).toBe("vs1-assessment@2");
  expect(assessRouteForVersion(
    CURRENT_ASSESSMENT_RULES_VERSION,
    profile,
    verifiedEvidence,
    { housingProvided: true },
  ).reasons[0]).toEqual({ code: "income_continuation_not_confirmed" });
  expect(() => assessRouteForVersion(
    "vs1-assessment@unsupported",
    profile,
    verifiedEvidence,
    { housingProvided: true },
  )).toThrow("unsupported_assessment_rules");
});

test("keeps false housing, missing claim, unresearched basis, and unverified relationships yellow", () => {
  const completeProfile = profileFor();
  const unknownBasisProfile = profileFor({ companionBasis: "unknown", relationship: "none" });
  const otherFamilyProfile = profileFor({ companionBasis: "family", relationship: "other_family" });
  const futureIncomeOnlyProfile = profileFor({
    availableResourcesAll: "0",
    monthlyIncome: { amount: "999999999.99", currency: "RUB" },
  });
  const withoutTiranaClaim: Evidence = { ...verifiedEvidence, claims: { ...verifiedEvidence.claims, "al-tirana-residence": { source: "official", status: "missing" } } };

  expect(assessRoute(completeProfile, verifiedEvidence, { housingProvided: false }).marker).toBe("yellow");
  expect(assessRoute(completeProfile, withoutTiranaClaim, { housingProvided: true }).marker).toBe("yellow");
  expect(assessRoute(unknownBasisProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("yellow");
  expect(assessRoute(otherFamilyProfile, verifiedEvidence, { housingProvided: true }).reasons[0].code).toBe("relationship_not_verified_in_vs1");
  expect(assessRoute(futureIncomeOnlyProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("yellow");
});

test.each([
  ["stale", "foreignContractVerified"],
  ["conflicting", "availableResourcesVerified"],
  ["invalid", "lawfulStayVerified"],
] as const)("keeps %s critical evidence yellow", (status, field) => {
  const completeProfile = profileFor();
  const nonVerifiedEvidence: Evidence = { ...verifiedEvidence, [field]: status };

  expect(assessRoute(completeProfile, nonVerifiedEvidence, { housingProvided: true }).marker).toBe("yellow");
});

test("marks only a verified official hard mismatch red and ignores a non-family assertion", () => {
  const albanianEmployerProfile = profileFor({ incomeBasis: "albanian_employer_only" });
  const nonFamilyProfile = profileFor({ companionBasis: "family", relationship: "non_family" });

  expect(assessRoute(albanianEmployerProfile, verifiedEvidence, { housingProvided: true }).reasons[0].claimId).toBe("al-law-79-art-68-contract");
  expect(assessRoute(albanianEmployerProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("red");
  expect(assessRoute(nonFamilyProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("yellow");
});

test("binds each reason to its exact source and separates a verified threshold mismatch", () => {
  const belowThreshold = assessRoute(
    profileFor({ availableResourcesAll: "407999" }),
    verifiedEvidence,
    { housingProvided: true },
  );
  const unavailableResources = assessRoute(profileFor(), {
    ...verifiedEvidence,
    availableResourcesVerified: "invalid",
    sourceBlockers: { "al-decision-858": "semantic_mismatch" },
  }, { housingProvided: true });
  const unavailableLaw = assessRoute(profileFor(), {
    ...verifiedEvidence,
    lawfulStayVerified: "missing",
    sourceBlockers: { "al-law-79": "timeout" },
  }, { housingProvided: true });
  const unavailableTransit = assessRoute(profileFor(), {
    ...verifiedEvidence,
    claims: {
      ...verifiedEvidence.claims,
      "al-tirana-residence": { source: "official", status: "missing" },
    },
    sourceBlockers: { "tirana-urban-lines": "server_error" },
  }, { housingProvided: true });

  expect(belowThreshold.reasons[0]).toEqual({
    code: "available_resources_below_threshold",
    claimId: "al-decision-858-facts-1",
    sourceId: "al-decision-858",
  });
  expect(unavailableResources.reasons[0]).toEqual({
    code: "available_resources_rule_unavailable",
    claimId: "al-decision-858-facts-1",
    sourceId: "al-decision-858",
    blockerKind: "semantic_mismatch",
  });
  expect(unavailableLaw.reasons[0]).toMatchObject({
    code: "lawful_stay_not_verified",
    sourceId: "al-law-79",
    blockerKind: "timeout",
  });
  expect(unavailableTransit.reasons[0]).toMatchObject({
    code: "tirana_claim_not_verified",
    sourceId: "tirana-urban-lines",
    blockerKind: "server_error",
  });
});

test.each([
  ["cbr-eur", "cbrRateVerified", "cbr_rate_not_verified"],
  ["boa-eur", "boaRateVerified", "boa_rate_not_verified"],
] as const)("keeps a %s outage terminal yellow with exact lineage", (sourceId, field, code) => {
  const assessment = assessRoute(profileFor(), {
    ...verifiedEvidence,
    [field]: "missing",
    sourceBlockers: { [sourceId]: "server_error" },
  }, { housingProvided: true });

  expect(assessment).toEqual({
    marker: "yellow",
    reasons: [{
      code,
      claimId: `${sourceId}-facts-1`,
      sourceId,
      blockerKind: "server_error",
    }],
  });
  expect(assessRoute(profileFor({ incomeBasis: "albanian_employer_only" }), {
    ...verifiedEvidence,
    [field]: "missing",
    sourceBlockers: { [sourceId]: "server_error" },
  }, { housingProvided: true }).marker).toBe("yellow");
  expect(assessRoute(profileFor({
    availableResourcesAll: "0",
    incomeBasis: "albanian_employer_only",
  }), {
    ...verifiedEvidence,
    [field]: "missing",
    sourceBlockers: { [sourceId]: "server_error" },
  }, { housingProvided: true }).reasons[0].code).toBe(code);
});
