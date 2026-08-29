import type { CityFrontierReadModel } from "./city-frontier-contracts";
import type { CitySourceBindingCursorV1, CitySourceBindingKeyV1, CitySourceBindingRevisionV1, CitySourceVersionV1, OfficialSourceRecoveryAttemptV1 } from "./city-source-recovery-contracts";

export type PublicFactSourceV1 = Readonly<{ schemaVersion: "public-fact-source@1"; factKey: string; status: "green" | "red" | "yellow"; publisherName: string | null; sourceUrl: string | null; checkedAt: string | null }>;
export type EffectiveCitySourceBinding = Readonly<{ bindingKey: CitySourceBindingKeyV1; cursor: CitySourceBindingCursorV1; sourceVersion: CitySourceVersionV1 | null; revision: CitySourceBindingRevisionV1 | null }>;
export interface CitySourceRecoveryStorePort { loadEffectiveVerified(authority: CitySourceInstalledAuthority): EffectiveCitySourceBinding; appendYellowAttempt(attempt: OfficialSourceRecoveryAttemptV1): OfficialSourceRecoveryAttemptV1; appendReplacement(input: CitySourceReplacementInput, expectedCursor: CitySourceBindingCursorV1): CitySourceBindingRevisionV1; loadHistoryVerified(bindingKey: CitySourceBindingKeyV1, authority: CitySourceInstalledAuthority): readonly CitySourceBindingRevisionV1[]; loadOwnerAuditVerified(bindingKey: CitySourceBindingKeyV1, authority: CitySourceInstalledAuthority): readonly OfficialSourceRecoveryAttemptV1[]; }
export type CitySourceInstalledAuthority = Readonly<{ bindingKey: CitySourceBindingKeyV1; installedBindingDigest: string; sourceVersion: CitySourceVersionV1 }>;
export type CitySourceReplacementInput = Readonly<{ commandId: string; sourceVersion: CitySourceVersionV1; revision: CitySourceBindingRevisionV1; attempt: OfficialSourceRecoveryAttemptV1 }>;
export type CitySourceRecoveryOutcome = Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "advanced"; readModel: CityFrontierReadModel }> | Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "yellow"; source: PublicFactSourceV1 }>;

export function projectPublicFactSource(input: { readonly factKey: string; readonly status: "green" | "red" | "yellow"; readonly source?: CitySourceVersionV1; readonly publisherName?: string }): PublicFactSourceV1 {
  const usable = input.status !== "yellow" && input.source !== undefined;
  return Object.freeze({ schemaVersion: "public-fact-source@1", factKey: input.factKey, status: input.status, publisherName: usable ? input.publisherName ?? null : null, sourceUrl: usable ? input.source!.finalUrl : null, checkedAt: usable ? input.source!.capturedAt : null });
}
