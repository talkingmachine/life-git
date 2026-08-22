import type {
  ClaimKind,
  ClaimValueByKind,
  CountryEvidenceRef,
  SloveniaSourceId,
} from "./cold-start-contracts";
import type { CbrEurFacts, Claim } from "./contracts";

export type ParticipantRequirementScopeV2 =
  | { readonly kind: "applicant" }
  | {
      readonly kind: "companion";
      readonly relationship: "spouse" | "minor_child" | "other_family";
    };

export const SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER = Object.freeze([
  "applicant",
  "companion-spouse",
  "companion-minor_child",
  "companion-other_family",
] as const);

export type SloveniaV2ParticipantScopeToken =
  typeof SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER[number];

export interface CitizenshipApplicabilityV2 {
  readonly classifications: readonly {
    readonly countryCode: string;
    readonly status: "eligible" | "excluded";
  }[];
}

export interface CompanionEntryV2 {
  readonly relationshipClassifications: readonly {
    readonly relationship: "spouse" | "minor_child" | "other_family";
    readonly status: "eligible" | "excluded";
  }[];
}

export interface IncomeRequirementV2 {
  readonly metric: "latest_official_average_monthly_net_salary";
  readonly multiplier: "2";
  readonly thresholdEur: string;
  readonly currency: "EUR";
  readonly basis: "net";
  readonly appliesTo: "applicant";
  readonly period: string;
}

export const SLOVENIA_V2_RESEARCH_SCOPE = "VS-2 Slovenia cold start" as const;

export const SLOVENIA_V2_SOURCE_ORDER = Object.freeze([
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[]);

export const SLOVENIA_V2_PARSER_VERSIONS = Object.freeze({
  "si-digital-nomad-route": "si-route@3",
  "si-income-threshold": "si-income@3",
  "si-companion-employment": "si-companion@3",
  "cbr-eur": "cbr-eur@1",
} as const satisfies Readonly<Record<SloveniaSourceId, string>>);

export const SLOVENIA_V2_EVIDENCE_RULES_VERSION = "vs2-si-evidence@3" as const;

export const SLOVENIA_V2_CLAIM_SOURCE = Object.freeze({
  route_basis: "si-digital-nomad-route",
  citizenship_applicability: "si-digital-nomad-route",
  remote_work_relations: "si-digital-nomad-route",
  income: "si-income-threshold",
  qualification: "si-digital-nomad-route",
  companion_entry: "si-digital-nomad-route",
  companion_local_work_access: "si-companion-employment",
  duration: "si-digital-nomad-route",
  general_statutory_prerequisites: "si-digital-nomad-route",
} as const satisfies Readonly<Record<
  ClaimKind,
  Exclude<SloveniaSourceId, "cbr-eur">
>>);

export const SLOVENIA_V2_CLAIM_VALIDATOR = Object.freeze({
  route_basis: "si-route@3",
  citizenship_applicability: "si-route@3",
  remote_work_relations: "si-route@3",
  income: "si-income@3",
  qualification: "si-route@3",
  companion_entry: "si-route@3",
  companion_local_work_access: "si-companion@3",
  duration: "si-route@3",
  general_statutory_prerequisites: "si-route@3",
} as const satisfies Readonly<Record<ClaimKind, string>>);

export interface ClaimValueByKindV2 {
  readonly route_basis: ClaimValueByKind["route_basis"];
  readonly citizenship_applicability: CitizenshipApplicabilityV2;
  readonly remote_work_relations: ClaimValueByKind["remote_work_relations"];
  readonly income: IncomeRequirementV2;
  readonly qualification: ClaimValueByKind["qualification"];
  readonly companion_entry: CompanionEntryV2;
  readonly companion_local_work_access: ClaimValueByKind["companion_local_work_access"];
  readonly duration: ClaimValueByKind["duration"] & {
    readonly scope: ParticipantRequirementScopeV2;
  };
  readonly general_statutory_prerequisites:
    ClaimValueByKind["general_statutory_prerequisites"] & {
      readonly scope: ParticipantRequirementScopeV2;
    };
}

export function sloveniaV2ParticipantScopeToken(
  scope: ParticipantRequirementScopeV2,
): SloveniaV2ParticipantScopeToken {
  return scope.kind === "applicant" ? "applicant" : `companion-${scope.relationship}`;
}

export function sloveniaV2ClaimScopeToken(
  kind: ClaimKind,
  value: ClaimValueByKindV2[ClaimKind],
): SloveniaV2ParticipantScopeToken | undefined {
  if (kind !== "duration" && kind !== "general_statutory_prerequisites") {
    return undefined;
  }
  return sloveniaV2ParticipantScopeToken(
    (value as ClaimValueByKindV2["duration"]).scope,
  );
}

export function sloveniaV2ClaimId(
  kind: ClaimKind,
  value: ClaimValueByKindV2[ClaimKind],
): string {
  const scope = sloveniaV2ClaimScopeToken(kind, value);
  return `${SLOVENIA_V2_CLAIM_SOURCE[kind]}:${kind}` +
    `${scope === undefined ? "" : `:${scope}`}:${SLOVENIA_V2_CLAIM_VALIDATOR[kind]}`;
}

export function sloveniaV2ClaimIdentity(
  kind: ClaimKind,
  value: ClaimValueByKindV2[ClaimKind],
): string {
  return `${kind}:${sloveniaV2ClaimScopeToken(kind, value) ?? "unscoped"}`;
}

export interface VerifiedCountryClaimV2<K extends ClaimKind = ClaimKind>
  extends Claim<ClaimValueByKindV2[K], SloveniaSourceId> {
  readonly claimKind: K;
  readonly evidence: readonly CountryEvidenceRef[];
  readonly validatorVersion: string;
}

export type ColdStartEvidenceClaimV2 =
  | VerifiedCountryClaimV2
  | Claim<CbrEurFacts, "cbr-eur">;
