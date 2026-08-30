import { types } from "node:util";

import type { CityFrontierReadModel, PublicFactSourceV1 } from "./city-frontier-contracts";
import type { CitySourceBindingCursorV1, CitySourceBindingKeyV1, CitySourceBindingRevisionV1, CitySourceReplacementInput, CitySourceVersionV1, OfficialSourceRecoveryAttemptV1 } from "./city-source-recovery-contracts";

export type { CitySourceReplacementInput } from "./city-source-recovery-contracts";

export type { PublicFactSourceV1 } from "./city-frontier-contracts";

function ownPublicRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.getOwnPropertyNames(value).sort();
  const expected = ["checkedAt", "factKey", "publisherName", "schemaVersion", "sourceUrl", "status"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined;
  const copy: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    copy[key] = descriptor.value;
  }
  return copy;
}

/** Strict public boundary: nothing discovered or internal can cross it by accident. */
export function reconstructPublicFactSourceV1(value: unknown): PublicFactSourceV1 {
  if (value !== null && typeof value === "object" && types.isProxy(value)) throw new Error("invalid_public_fact_source");
  const record = ownPublicRecord(value);
  const status = record?.status;
  const factKey = record?.factKey;
  const publisherName = record?.publisherName;
  const sourceUrl = record?.sourceUrl;
  const checkedAt = record?.checkedAt;
  const validIso = typeof checkedAt === "string" && !Number.isNaN(Date.parse(checkedAt)) && new Date(checkedAt).toISOString() === checkedAt;
  const validUrl = typeof sourceUrl === "string" && (() => {
    try { const url = new URL(sourceUrl); return url.protocol === "https:" && url.toString() === sourceUrl; } catch { return false; }
  })();
  if (record?.schemaVersion !== "public-fact-source@1" || typeof factKey !== "string" || factKey.length === 0 ||
    (status !== "green" && status !== "red" && status !== "yellow") ||
    (status === "yellow" && (publisherName !== null || sourceUrl !== null || checkedAt !== null)) ||
    (status !== "yellow" && (typeof publisherName !== "string" || publisherName.length === 0 || !validUrl || !validIso))) {
    throw new Error("invalid_public_fact_source");
  }
  return Object.freeze({ schemaVersion: "public-fact-source@1", factKey,
    status, publisherName: publisherName as string | null, sourceUrl: sourceUrl as string | null,
    checkedAt: checkedAt as string | null });
}
export type EffectiveCitySourceBinding = Readonly<{ bindingKey: CitySourceBindingKeyV1; cursor: CitySourceBindingCursorV1; sourceVersion: CitySourceVersionV1 | null; revision: CitySourceBindingRevisionV1 | null }>;
export type HistoricalCitySourceBinding = Readonly<{ bindingKey: CitySourceBindingKeyV1; revision: CitySourceBindingRevisionV1; sourceVersion: CitySourceVersionV1 }>;
export interface CitySourceRecoveryStorePort { loadEffectiveVerified(bindingKey: CitySourceBindingKeyV1): EffectiveCitySourceBinding; appendYellowAttempt(attempt: OfficialSourceRecoveryAttemptV1): OfficialSourceRecoveryAttemptV1; appendReplacement(input: CitySourceReplacementInput, expectedCursor: CitySourceBindingCursorV1): CitySourceBindingRevisionV1; loadHistoryVerified(bindingKey: CitySourceBindingKeyV1): readonly CitySourceBindingRevisionV1[]; loadRevisionVerified(bindingKey: CitySourceBindingKeyV1, revisionId: string): HistoricalCitySourceBinding; loadOwnerAuditVerified(bindingKey: CitySourceBindingKeyV1): readonly OfficialSourceRecoveryAttemptV1[]; }
export type CitySourceInstalledAuthority = Readonly<{ bindingKey: CitySourceBindingKeyV1; sourceVersion: CitySourceVersionV1 }>;
export interface CitySourceInstalledAuthorityPort { loadVerified(bindingKey: CitySourceBindingKeyV1): CitySourceInstalledAuthority | undefined; }
export interface CitySourceTruthPublicationAuthorityPort { requireVerified(input: Readonly<{ bindingKey: CitySourceBindingKeyV1; sourceVersion: CitySourceVersionV1; revision: CitySourceBindingRevisionV1 }>): void; }
export type CitySourceRecoveryOutcome = Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "advanced"; readModel: CityFrontierReadModel }> | Readonly<{ schemaVersion: "city-source-recovery-outcome@1"; kind: "yellow"; source: PublicFactSourceV1 }>;

/** Inward boundary: continuation participants share exactly one synchronous transaction. */
export interface CityContinuationUnitOfWorkPort {
  run<T>(operation: () => T): T;
}
