import type { CityUnknownReason } from "../decision/city-criteria";
import type { CitySafetyQuantity } from "../decision/city-safety";

export interface CitySafetyQueryAttempt {
  readonly index: number;
  readonly queryId: string;
  readonly queryTemplateVersion: "slovenia-municipal-safety-query@1";
  readonly providerId: string;
  readonly query: string;
  readonly searchedAt: string;
  readonly outcome:
    | { readonly kind: "completed"; readonly returnedUrls: readonly string[] }
    | { readonly kind: "unavailable"; readonly reason: CitySafetySearchUnavailableReason };
}

export type CitySafetySearchUnavailableReason =
  | "provider_unavailable"
  | "search_provider_unconfigured";

export type CitySafetyCandidateOrigin =
  | {
      readonly kind: "previous";
      readonly priorSourcePlanId: string;
      readonly priorEvidenceSnapshotId: string;
    }
  | { readonly kind: "configured"; readonly configuredRouteIndex: number }
  | { readonly kind: "search"; readonly queryId: string };

export interface CitySafetyPreviousAcceptedReference {
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly sourcePlanId: string;
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly publisherId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly referenceYear: number;
  readonly evidenceSnapshotId: string;
}

export type CitySafetyArtifactReference =
  | {
      readonly role: "municipal_source";
      readonly documentRole: "navigation" | "terminal_claim";
      readonly artifactId: string;
      readonly artifactSha256: string;
      readonly sourceSha256: string;
      readonly locator: string;
    }
  | {
      readonly role: "surs_denominator";
      readonly artifactId: string;
      readonly artifactSha256: string;
      readonly sourceSha256: string;
      readonly locator: string;
    };

export interface CitySafetyDenominatorReference {
  readonly publisherId: string;
  readonly municipalityCode: string;
  readonly referenceDate: string;
  readonly population: string;
  readonly artifactId: string;
  readonly mediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: boolean;
}

export interface CitySafetyConflictBasis {
  readonly referenceYear: number;
  readonly quantities: readonly [CitySafetyQuantity, CitySafetyQuantity];
  readonly denominator: CitySafetyDenominatorReference;
}

export interface CitySafetyOfficialChainEdge {
  readonly kind: "http_redirect" | "confirmed_document_link";
  readonly fromUrl: string;
  readonly toUrl: string;
}

export interface CitySafetyOfficialFailureTrace {
  readonly captureKind:
    | "timeout"
    | "rate_limited"
    | "server_error"
    | "http_error"
    | "wrong_media_type"
    | "too_large"
    | "navigation_mismatch";
  readonly responseStatus?: number;
  readonly responseUrl?: string;
  readonly mediaType?: string;
  readonly rejectedTarget?: {
    readonly kind: "untrusted_target" | "redirect_loop" | "hop_limit";
    readonly url: string;
  };
}

export interface CitySafetyOfficialInspectionTrace {
  readonly initialUrl: string;
  readonly edges: readonly CitySafetyOfficialChainEdge[];
  readonly lastTrustedUrl?: string;
  readonly officialHops: number;
  readonly failure?: CitySafetyOfficialFailureTrace;
}

export interface CitySafetyUsableCandidateAttempt {
  readonly index: number;
  readonly origin: CitySafetyCandidateOrigin;
  readonly canonicalUrl: string;
  readonly publisherId: string;
  readonly dataAuthorityId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly mediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: boolean;
  readonly artifactRefs: readonly CitySafetyArtifactReference[];
  readonly disposition: "usable";
  readonly referenceYear: number;
  readonly periodDisposition: "preferred" | "fallback";
  readonly quantity: CitySafetyQuantity;
  readonly denominator: CitySafetyDenominatorReference;
}

export type CitySafetyCandidateRejectionReason =
  | "http_not_found"
  | "transport_unavailable"
  | "authority_untrusted"
  | "stale"
  | "scope_mismatch"
  | "definition_mismatch"
  | "missing_numerator"
  | "denominator_missing"
  | "denominator_zero"
  | "denominator_period_mismatch"
  | "denominator_scope_mismatch"
  | "wrong_media_type"
  | "too_large"
  | "untrusted_redirect"
  | "retention_unapproved"
  | "conflict";

export interface CitySafetyRejectedCandidateAttempt {
  readonly index: number;
  readonly origin: CitySafetyCandidateOrigin;
  readonly canonicalUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly reviewedOfficial?: {
    readonly publisherId: string;
    readonly dataAuthorityId: string;
    readonly publisherNavigationUrl: string;
    readonly resolvedEvidenceUrl?: string;
    readonly referenceYear?: number;
  };
  readonly mediaType?: string;
  readonly retentionPolicyId?: string;
  readonly transientRawDeleted?: boolean;
  readonly artifactRefs: readonly CitySafetyArtifactReference[];
  readonly disposition: "rejected";
  readonly reason: CitySafetyCandidateRejectionReason;
  readonly conflictBasis?: CitySafetyConflictBasis;
}

export type CitySafetyCandidateAttempt =
  | CitySafetyUsableCandidateAttempt
  | CitySafetyRejectedCandidateAttempt;

export interface CitySafetyAttemptLedger {
  readonly schemaVersion: "city-safety-attempt-ledger@1";
  readonly catalogRevisionId: string;
  readonly authorityDirectoryId: string;
  readonly sourcePlanId: string;
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly assessmentAt: string;
  readonly definitionId: "si-municipal-police-offences-per-100000@1";
  readonly freshnessPolicyVersion: "municipal-annual-july-boundary@1";
  readonly discoveryRulesVersion: "city-safety-discovery@1";
  readonly queries: readonly CitySafetyQueryAttempt[];
  readonly candidates: readonly CitySafetyCandidateAttempt[];
  readonly counters: {
    readonly queries: number;
    readonly candidates: number;
    readonly maxOfficialHops: number;
  };
  readonly result:
    | {
        readonly kind: "verified";
        readonly quantity: CitySafetyQuantity;
        readonly referenceYear: number;
        readonly acceptedCandidateIndex: number;
      }
    | { readonly kind: "unknown"; readonly reason: CityUnknownReason };
  readonly completedAt: string;
}

export type CitySafetyRetainedRejectionBasis =
  | {
      readonly kind: "stale";
      readonly referenceYear: number;
      readonly quantity: CitySafetyQuantity;
      readonly denominator: CitySafetyDenominatorReference;
    }
  | {
      readonly kind: "scope_mismatch";
      readonly observedMunicipalityCodes: readonly string[];
      readonly referenceYear?: number;
      readonly offenceCount?: CitySafetyQuantity["offenceCount"];
    }
  | {
      readonly kind: "definition_mismatch";
      readonly observedDefinitionId: string;
      readonly referenceYear?: number;
      readonly offenceCount?: CitySafetyQuantity["offenceCount"];
    }
  | { readonly kind: "missing_numerator"; readonly referenceYear?: number }
  | {
      readonly kind: "denominator_missing";
      readonly referenceYear: number;
      readonly offenceCount: CitySafetyQuantity["offenceCount"];
    }
  | {
      readonly kind:
        | "denominator_zero"
        | "denominator_period_mismatch"
        | "denominator_scope_mismatch";
      readonly referenceYear: number;
      readonly offenceCount: CitySafetyQuantity["offenceCount"];
      readonly observedDenominator: CitySafetyDenominatorReference;
    }
  | { readonly kind: "conflict"; readonly conflictBasis: CitySafetyConflictBasis };

export type CitySafetyRetainedInspectionOutcome =
  | {
      readonly kind: "usable";
      readonly referenceYear: number;
      readonly quantity: CitySafetyQuantity;
      readonly denominator: CitySafetyDenominatorReference;
    }
  | { readonly kind: "rejected"; readonly basis: CitySafetyRetainedRejectionBasis };

export interface CitySafetyRetainedInspectionProjection {
  readonly schemaVersion: "city-safety-retained-inspection@1";
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly publisherId: string;
  readonly dataAuthorityId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly outcome: CitySafetyRetainedInspectionOutcome;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}

export interface CitySafetyRetainedNavigationProjection {
  readonly schemaVersion: "city-safety-retained-navigation@1";
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly publisherId: string;
  readonly publisherNavigationUrl: string;
  readonly resolvedNavigationUrl: string;
  readonly officialTrace: CitySafetyOfficialInspectionTrace;
  readonly confirmedDocumentUrl: string;
  readonly documentLocatorPolicyId: string;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}

export interface CitySafetyRetainedDenominatorProjection {
  readonly schemaVersion: "city-safety-retained-denominator@1";
  readonly publisherId: string;
  readonly municipalityCode: string;
  readonly referenceDate: string;
  readonly population: string;
  readonly sourceSha256: string;
  readonly sourceLocator: string;
  readonly sourceMediaType: string;
  readonly retentionPolicyId: string;
  readonly transientRawDeleted: true;
}
