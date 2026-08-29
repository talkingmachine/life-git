import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { LiveCapturedArtifact } from "../research/contracts";
import type {
  CitySafetyAttemptLedger,
  CitySafetyPreviousAcceptedReference,
  CitySafetyRejectedCandidateAttempt,
  CitySafetySearchUnavailableReason,
  CitySafetyUsableCandidateAttempt,
} from "../research/city-safety-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";
import type { OfficialSourceDiscoveryPort } from "./official-source-discovery";

export type CitySafetySearchResponse =
  | {
      readonly kind: "completed";
      readonly providerId: string;
      readonly urls: readonly string[];
    }
  | {
      readonly kind: "unavailable";
      readonly providerId: string;
      readonly reason: CitySafetySearchUnavailableReason;
    };

export interface CitySafetySearchPort {
  search(input: {
    readonly queryId: string;
    readonly query: string;
    readonly resultLimit: number;
    readonly signal: AbortSignal;
  }): Promise<CitySafetySearchResponse>;
}

export type CitySafetyUsableCandidateDetail = Omit<
  CitySafetyUsableCandidateAttempt,
  "index" | "origin" | "canonicalUrl"
>;

export type CitySafetyRejectedCandidateDetail = Omit<
  CitySafetyRejectedCandidateAttempt,
  "index" | "origin" | "canonicalUrl"
>;

export interface CitySafetyCandidateInspectionInput {
  readonly runId: string;
  readonly cityId: string;
  readonly municipalityCode: string;
  readonly candidateUrl: string;
  readonly publisherContext?: {
    readonly publisherId: string;
    readonly publisherNavigationUrl: string;
  };
  readonly officialHopLimit: 2;
  readonly assessmentAt: string;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly signal: AbortSignal;
}

export type CitySafetyCandidateInspection =
  | {
      readonly kind: "usable";
      readonly detail: CitySafetyUsableCandidateDetail;
      readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
    }
  | {
      readonly kind: "rejected";
      readonly detail: CitySafetyRejectedCandidateDetail;
      readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
    };

export interface CitySafetyOfficialDocumentPort {
  inspect(input: CitySafetyCandidateInspectionInput): Promise<CitySafetyCandidateInspection>;
}
export type CitySafetyOfficialDiscoveryResult =
  | Readonly<{ kind: "candidates"; urls: readonly string[] }>
  | Readonly<{ kind: "yellow"; reason: "codex_search_not_performed" | "codex_timeout" | "codex_rate_limited" | "codex_provider_transient" }>;
export interface CitySafetyOfficialDiscoveryPort {
  discover(input: Readonly<{ runId: string; catalog: CityCatalogRevision; integrity: CityDecisionIntegrity; sourcePlan: CitySafetySourcePlan; authorityDirectory: OfficialAuthorityDirectory; cityId: string; failedUrl: string; reason: "unavailable" | "stale" | "empty" | "semantic_drift" | "not_covering_fact"; signal: AbortSignal }>): Promise<CitySafetyOfficialDiscoveryResult>;
}
export type CitySafetyOfficialDiscoveryDependency = Readonly<{ sourceDiscovery: OfficialSourceDiscoveryPort }>;

export interface RunCitySafetyDiscoveryInput {
  readonly runId: string;
  readonly catalog: CityCatalogRevision;
  readonly integrity: CityDecisionIntegrity;
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
  readonly cityId: string;
  readonly assessmentAt: string;
  readonly previousAccepted?: CitySafetyPreviousAcceptedReference;
  readonly recoveryCandidates?: readonly string[];
  readonly signal: AbortSignal;
}

export interface CitySafetyDiscoveryResult {
  readonly ledger: CitySafetyAttemptLedger;
  readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
}
