import type {
  CbrEurFacts,
  Claim,
  ClaimAnchor,
  OfficialSourcePort,
} from "./contracts";
import type { ResearchPlan } from "./research-plan";

export type CountryCode = "SI";

export interface CountryRef {
  readonly code: "SI";
  readonly englishName: "Slovenia";
  readonly displayName: "Словения";
  readonly flag: "🇸🇮";
  readonly coordinate: { readonly lat: 46.1512; readonly lng: 14.9955 };
}

export type ClaimKind =
  | "route_basis"
  | "citizenship_applicability"
  | "remote_work_relations"
  | "income"
  | "qualification"
  | "companion_entry"
  | "companion_local_work_access"
  | "duration"
  | "general_statutory_prerequisites";

export interface ClaimValueByKind {
  readonly route_basis: {
    readonly route: "temporary_residence_digital_nomad";
    readonly legalBasis: "ZTuj-2 Article 51a";
    readonly effectiveFrom: "2025-11-21";
  };
  readonly citizenship_applicability: {
    readonly eligibleCategory: "third_country_national";
    readonly explicitNationalityExclusions: readonly string[];
  };
  readonly remote_work_relations: {
    readonly allowedRelations: readonly (
      | "foreign_employer"
      | "own_foreign_business"
      | "foreign_clients"
    )[];
    readonly slovenianLabourMarketWorkIncluded: false;
  };
  readonly income: {
    readonly metric: "latest_official_average_monthly_net_salary";
    readonly multiplier: "2";
    readonly thresholdEur: string;
    readonly period: string;
  };
  readonly qualification: {
    readonly rule: "not_listed_in_authoritative_requirements";
  };
  readonly companion_entry: {
    readonly rule: "immediate_family_reunification_without_waiting_period";
  };
  readonly companion_local_work_access: {
    readonly access: "conditional";
    readonly labourMarketCheck: true;
    readonly informationSheet: true;
  };
  readonly duration: {
    readonly maximumMonths: 12;
    readonly extendable: false;
    readonly reapplyAfterMonths: 6;
  };
  readonly general_statutory_prerequisites: {
    readonly passportBeyondPermitMonths: 3;
    readonly healthInsurance: true;
    readonly article55GroundsApply: true;
  };
}

export type SloveniaSourceId =
  | "si-digital-nomad-route"
  | "si-income-threshold"
  | "si-companion-employment"
  | "cbr-eur";

export interface CountryEvidenceRef {
  readonly sourceId: SloveniaSourceId;
  readonly artifactId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly sourcePeriod: string;
  readonly anchor: ClaimAnchor;
}

export interface VerifiedCountryClaim<K extends ClaimKind = ClaimKind>
  extends Claim<ClaimValueByKind[K], SloveniaSourceId> {
  readonly claimKind: K;
  readonly evidence: readonly CountryEvidenceRef[];
  readonly validatorVersion: string;
}

export type ColdStartEvidenceClaim =
  | VerifiedCountryClaim
  | Claim<CbrEurFacts, "cbr-eur">;

export interface SourceCandidate {
  readonly candidateId: string;
  readonly url: string;
  readonly authorityRoot: string;
  readonly claimKinds: readonly ClaimKind[];
  readonly discoveredFrom: "registry";
}

export type CountrySourceIndexResult =
  | { readonly ok: true; readonly candidates: readonly SourceCandidate[] }
  | {
      readonly ok: false;
      readonly kind: "country_not_installed";
      readonly candidates: readonly [];
    };

export interface CountrySourceIndexPort {
  lookup(countryCode: string): CountrySourceIndexResult;
}

export interface SloveniaResearch {
  readonly plan: ResearchPlan<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly source: OfficialSourcePort<SloveniaSourceId>;
}
