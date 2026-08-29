import type { CityFrontierReadModel } from "./city-frontier-contracts";
import type { CitySourceBindingCursorV1, CitySourceBindingKeyV1, CitySourceBindingRevisionV1, CitySourceReplacementInput, CitySourceVersionV1, OfficialSourceRecoveryAttemptV1 } from "./city-source-recovery-contracts";

export type { CitySourceReplacementInput } from "./city-source-recovery-contracts";

export type PublicFactSourceV1 = Readonly<{ schemaVersion: "public-fact-source@1"; factKey: string; status: "green" | "red" | "yellow"; publisherName: string | null; sourceUrl: string | null; checkedAt: string | null }>;
export type EffectiveCitySourceBinding = Readonly<{ bindingKey: CitySourceBindingKeyV1; cursor: CitySourceBindingCursorV1; sourceVersion: CitySourceVersionV1 | null; revision: CitySourceBindingRevisionV1 | null }>;
export interface CitySourceRecoveryStorePort { loadEffectiveVerified(bindingKey: CitySourceBindingKeyV1): EffectiveCitySourceBinding; appendYellowAttempt(attempt: OfficialSourceRecoveryAttemptV1): OfficialSourceRecoveryAttemptV1; appendReplacement(input: CitySourceReplacementInput, expectedCursor: CitySourceBindingCursorV1): CitySourceBindingRevisionV1; loadHistoryVerified(bindingKey: CitySourceBindingKeyV1): readonly CitySourceBindingRevisionV1[]; loadOwnerAuditVerified(bindingKey: CitySourceBindingKeyV1): readonly OfficialSourceRecoveryAttemptV1[]; }
export type CitySourceInstalledAuthority = Readonly<{ bindingKey: CitySourceBindingKeyV1; sourceVersion: CitySourceVersionV1 }>;
export interface CitySourceInstalledAuthorityPort { loadVerified(bindingKey: CitySourceBindingKeyV1): CitySourceInstalledAuthority | undefined; }
export interface CitySourceTruthPublicationAuthorityPort { requireVerified(input: Readonly<{ bindingKey: CitySourceBindingKeyV1; sourceVersion: CitySourceVersionV1; revision: CitySourceBindingRevisionV1 }>): void; }
export type CitySourceRecoveryOutcome = Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "advanced"; readModel: CityFrontierReadModel }> | Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "yellow"; source: PublicFactSourceV1 }>;

/** Inward boundary: continuation participants share exactly one synchronous transaction. */
export interface CityContinuationUnitOfWorkPort {
  run<T>(operation: () => T): T;
}
