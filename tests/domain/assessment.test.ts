import { expect, test } from "vitest";

import { assessRoute } from "../../src/decision/assessment";
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
};

function profileFor(overrides: Partial<ProfileDraft> = {}) {
  return confirmProfile(
    {
      currency: "ALL",
      availableResourcesAll: "408000",
      futureIncomeAll: "125000",
      incomeBasis: "foreign_contract",
      companionBasis: "none",
      relationship: "none",
      ...overrides,
    },
    clock,
  );
}

test("marks the researched no-companion and source-verified spouse routes green", () => {
  const completeProfile = profileFor();
  const spouseProfile = profileFor({ companionBasis: "family", relationship: "spouse" });

  expect(assessRoute(completeProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("green");
  expect(assessRoute(spouseProfile, verifiedEvidence, { housingProvided: true }).marker).toBe("green");
});

test("keeps false housing, missing claim, unresearched basis, and unverified relationships yellow", () => {
  const completeProfile = profileFor();
  const unknownBasisProfile = profileFor({ companionBasis: "unknown", relationship: "none" });
  const otherFamilyProfile = profileFor({ companionBasis: "family", relationship: "other_family" });
  const futureIncomeOnlyProfile = profileFor({ availableResourcesAll: "0", futureIncomeAll: "999999999.99" });
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
