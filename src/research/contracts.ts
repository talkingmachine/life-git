export type CompanionBasis = "none" | "family" | "independent" | "unknown";
export type Relationship = "none" | "spouse" | "non_family" | "other_family";
export type IncomeBasis = "foreign_contract" | "albanian_employer_only";

export interface Profile {
  readonly currency: "ALL";
  readonly availableResourcesAll: string;
  readonly futureIncomeAll: string;
  readonly incomeBasis: IncomeBasis;
  readonly companionBasis: CompanionBasis;
  readonly relationship: Relationship;
}

export interface ProfileSnapshot {
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: Profile;
}

export type ClaimId =
  | "al-law-79-art-68-contract"
  | "al-law-79-art-68-spouse"
  | "al-tirana-residence";

export type EvidenceStatus = "verified" | "missing" | "ambiguous" | "stale" | "conflicting" | "invalid";

export interface ClaimEvidence {
  readonly source: "official" | "unverified";
  readonly status: EvidenceStatus;
}

export interface Evidence {
  readonly claims: Readonly<Partial<Record<ClaimId, ClaimEvidence>>>;
  readonly foreignContractVerified: EvidenceStatus;
  readonly availableResourcesVerified: EvidenceStatus;
  readonly lawfulStayVerified: EvidenceStatus;
  readonly stagedFamilyPlanVerified: EvidenceStatus;
}

export interface RouteConditions {
  readonly housingProvided: boolean;
}

export interface AssessmentReason {
  readonly code: string;
  readonly claimId: ClaimId;
}

export interface Assessment {
  readonly marker: "green" | "yellow" | "red";
  readonly reasons: readonly AssessmentReason[];
}
