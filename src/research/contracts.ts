export type CompanionBasis = "none" | "family" | "independent" | "unknown";
export type Relationship = "none" | "spouse" | "non_family" | "other_family";
export type IncomeBasis = "foreign_contract" | "albanian_employer_only";

export interface Profile {
  readonly availableResourcesAll: string;
  readonly monthlyIncome: {
    readonly amount: string;
    readonly currency: "RUB";
  };
  readonly incomeBasis: IncomeBasis;
  readonly companionBasis: CompanionBasis;
  readonly relationship: Relationship;
  readonly conditions: {
    readonly incomeContinues12Months: boolean;
    readonly lawfulStayPrerequisiteAccepted: boolean;
    readonly stagedSpouseRouteAccepted: boolean;
  };
}

export interface ProfileSnapshot {
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: Profile;
}

export type ClaimId =
  | "al-law-79-art-68-contract"
  | "al-law-79-art-68-spouse"
  | "al-tirana-residence"
  | "al-decision-858-facts-1"
  | "cbr-eur-facts-1"
  | "boa-eur-facts-1";

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
  readonly cbrRateVerified: EvidenceStatus;
  readonly boaRateVerified: EvidenceStatus;
  readonly sourceBlockers: Readonly<Partial<Record<SourceId, EvidenceBlockerKind>>>;
}

export interface RouteConditions {
  readonly housingProvided: boolean;
}

export interface AssessmentReason {
  readonly code: string;
  readonly claimId?: ClaimId;
  readonly sourceId?: SourceId;
  readonly blockerKind?: EvidenceBlockerKind;
}

export interface Assessment {
  readonly marker: "green" | "yellow" | "red";
  readonly reasons: readonly AssessmentReason[];
}

export type SourceId =
  | "al-law-79"
  | "al-decision-858"
  | "cbr-eur"
  | "boa-eur"
  | "tirana-urban-lines";

export interface ClaimAnchor {
  readonly artifactId: string;
  readonly locator: string;
  readonly excerptSha256: string;
}

export interface Claim<T, S extends string = SourceId> {
  readonly claimId: string;
  readonly sourceId: S;
  readonly value: T;
  readonly scope: string;
  readonly sourcePeriod: string;
  readonly anchor: ClaimAnchor;
  readonly status: "verified";
}

export type EvidenceBlockerKind =
  | CaptureFailureKind
  | "country_not_installed"
  | "integrity_mismatch"
  | "semantic_mismatch"
  | "stale"
  | "conflict"
  | "deadline";

export interface EvidenceBlocker<S extends string = SourceId> {
  readonly sourceId: S;
  readonly kind: EvidenceBlockerKind;
  readonly navigationUrl: string;
  readonly resolvedUrl?: string;
  readonly artifactIds: readonly string[];
}

export interface EvidenceSnapshot<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly id: string;
  readonly assessmentDate: string;
  readonly artifactIds: readonly string[];
  readonly claims: readonly C[];
  readonly blockers: readonly EvidenceBlocker<S>[];
  readonly coverage: Readonly<Record<S, "verified" | "unavailable">>;
  readonly parserVersions: Readonly<Record<S, string>>;
  readonly rulesVersion: string;
  readonly contextHash?: string;
  readonly manifestHash: string;
  readonly hmac: string;
}

export interface ArtifactBytes {
  readonly artifactId: string;
  readonly role: string;
  readonly url: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface LiveCapturedArtifact<S extends string = SourceId> extends ArtifactBytes {
  readonly runId: string;
  readonly sourceId: S;
  readonly origin: "live";
  readonly capturedAt: string;
  readonly responseStatus: number;
  readonly responseUrl: string;
  readonly request: {
    readonly method: "GET" | "POST";
    readonly url: string;
    readonly bodyMediaType?: "application/json";
    readonly bodySha256?: string;
  };
}

export interface CaptureRequest<S extends string = SourceId> {
  readonly runId: string;
  readonly sourceId: S;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface HttpStepRequest<S extends string = SourceId> {
  readonly runId: string;
  readonly sourceId: S;
  readonly role: string;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyMediaType?: "application/json";
  readonly bodyBytes?: Uint8Array;
  readonly allowedHosts: readonly string[];
  readonly allowedMediaTypes: readonly string[];
}

export type RequestStep<S extends string = SourceId> = (
  request: HttpStepRequest<S>,
  signal: AbortSignal,
) => Promise<LiveCapturedArtifact<S>>;

export interface ParserEntry<S extends string = SourceId> {
  readonly sourceId: S;
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifacts: readonly ArtifactBytes[];
  readonly versionHint?: string;
}

export interface CapturedEntry<S extends string = SourceId> extends ParserEntry<S> {
  readonly artifacts: readonly LiveCapturedArtifact<S>[];
}

export type CaptureFailureKind =
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "http_error"
  | "wrong_media_type"
  | "too_large"
  | "navigation_mismatch";

export type CaptureResult<S extends string = SourceId> =
  | { readonly ok: true; readonly entry: CapturedEntry<S> }
  | {
      readonly ok: false;
      readonly sourceId: S;
      readonly kind: CaptureFailureKind;
      readonly attempts: 1 | 2;
      readonly partialArtifacts: readonly LiveCapturedArtifact<S>[];
    };

export interface OfficialSourcePort<S extends string = SourceId> {
  capture(request: CaptureRequest<S>, requestStep: RequestStep<S>): Promise<CaptureResult<S>>;
}

export type ParseResult<T> =
  | {
      readonly ok: true;
      readonly facts: T;
      readonly sourcePeriod: string;
      readonly anchors: readonly Claim<unknown>["anchor"][];
    }
  | { readonly ok: false; readonly kind: "integrity_mismatch" | "semantic_mismatch" };

export interface Law79Facts {
  readonly digitalWorker: {
    readonly requiresLawfulStay: true;
    readonly initialPermitMaxMonths: 12;
    readonly contractTypes: readonly ["foreign_employment", "foreign_service"];
    readonly accommodation: true;
    readonly insuranceMinMonths: 12;
    readonly criminalRecords: "origin_and_residence";
  };
  readonly family: {
    readonly spouseIsFamilyMember: true;
    readonly sponsorPermitMinMonths: 12;
    readonly renewable: true;
    readonly familyNormallyOutside: true;
    readonly housingInsuranceStableIncome: true;
  };
}

export interface Decision858Facts {
  readonly proof: "self_declaration";
  readonly availableAmount: "408000";
  readonly currency: "ALL";
  readonly scope: "self_and_dependants";
  readonly periodFormula: "not_stated";
  readonly headcountFormula: "not_stated";
  readonly generalRuleExceptionAnchored: true;
}

export type DecimalString = string & { readonly __decimalString: unique symbol };

export interface CbrEurFacts {
  readonly base: "EUR";
  readonly quote: "RUB";
  readonly nominal: "1";
  readonly rate: DecimalString;
  readonly effectiveDate: string;
}

export interface BoaEurFacts {
  readonly base: "EUR";
  readonly quote: "ALL";
  readonly rate: DecimalString;
  readonly effectiveDate: string;
}

export interface TiranaTransitFacts {
  readonly municipalUrbanRoutesMapPublished: true;
  readonly applicationTitle: "Transporti";
  readonly layers: readonly ["Linjat Qytetase", "Stacionet e Linjave Qytetase"];
  readonly checkedAt: string;
}
