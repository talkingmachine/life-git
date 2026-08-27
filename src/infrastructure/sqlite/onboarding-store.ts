import { types } from "node:util";

import type Database from "better-sqlite3";

import type {
  OnboardingCompletionPort,
  OnboardingConfirmationReadPort,
  OnboardingModelVersions,
  OnboardingReceipt,
  VerifiedOnboardingConfirmation,
} from "../../application/onboarding-contracts";
import { reconstructOnboardingModelVersions } from
  "../../application/onboarding-model-versions";
import {
  confirmOnboardingValues,
  materializeOnboardingSnapshots,
  rehydrateOnboardingDraft,
  type ConfirmedOnboardingValues,
} from "../../decision/onboarding-questionnaire";
import { reconstructQuestionnaireProvenance } from "../../decision/onboarding-provenance";
import { reconstructPreferenceProfileV2 } from "../../decision/preference-profile";
import { reconstructRelocationProfileV2 } from "../../decision/relocation-profile";
import {
  canonicalJson,
  hmacSha256,
  secureHexEqual,
  sha256Text,
} from "../integrity";
import {
  insertPreferenceV2Snapshot,
  insertRelocationV2Snapshot,
  loadPreferenceV2SnapshotVerified,
  loadRelocationV2SnapshotVerified,
} from "./profile-store";

export interface OnboardingStore
  extends OnboardingCompletionPort, OnboardingConfirmationReadPort {}

export interface OnboardingConfirmationDigestPayload {
  readonly schemaVersion: "onboarding-confirmation-binding@1";
  readonly receipt: Omit<OnboardingReceipt, "confirmationDigest">;
  readonly profile: VerifiedOnboardingConfirmation["profile"];
  readonly preferences: VerifiedOnboardingConfirmation["preferences"];
  readonly provenance: VerifiedOnboardingConfirmation["provenance"];
  readonly versions: OnboardingModelVersions;
}

interface ConfirmationRow {
  readonly schema_version: string;
  readonly receipt_id: string;
  readonly completion_command_id: string;
  readonly confirmation_digest: string;
  readonly profile_id: string;
  readonly preference_profile_id: string;
  readonly frontier_run_id: string;
  readonly confirmed_at: string;
  readonly provenance_json: string;
  readonly versions_json: string;
}

interface OnboardingStoreOptions {
  readonly clock?: () => Date;
  readonly materialize?: typeof materializeOnboardingSnapshots;
}

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RECEIPT_ID = /^onboarding-receipt:[0-9a-f]{64}$/;
const FRONTIER_RUN_ID = /^onboarding-frontier:[0-9a-f]{64}$/;
const CANONICAL_MILLISECOND_INSTANT = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class SqliteOnboardingStore implements OnboardingStore {
  private readonly clock: () => Date;
  private readonly materialize: typeof materializeOnboardingSnapshots;

  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
    options: OnboardingStoreOptions = {},
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
    this.clock = options.clock ?? (() => new Date());
    this.materialize = options.materialize ?? materializeOnboardingSnapshots;
  }

  async replayCommitted(input: {
    readonly completionCommandId: string;
    readonly confirmed: ConfirmedOnboardingValues;
    readonly versions: OnboardingModelVersions;
  }): Promise<OnboardingReceipt | undefined> {
    const command = snapshotCompletionInput(input);
    const existing = this.loadByDeterministicCommandBindings(command.completionCommandId);
    if (existing === undefined) return undefined;
    const verified = this.verifyRow(existing);
    if (verified.receipt.completionCommandId !== command.completionCommandId) {
      integrityMismatch();
    }
    assertReplayMatches(verified, command.confirmed, command.versions);
    return verified.receipt;
  }

  async commitOrReplay(input: {
    readonly completionCommandId: string;
    readonly confirmed: ConfirmedOnboardingValues;
    readonly versions: OnboardingModelVersions;
  }): Promise<OnboardingReceipt> {
    const command = snapshotCompletionInput(input);
    const commit = this.database.transaction((): OnboardingReceipt => {
      const existing = this.loadByDeterministicCommandBindings(command.completionCommandId);
      if (existing !== undefined) {
        const verified = this.verifyRow(existing);
        if (verified.receipt.completionCommandId !== command.completionCommandId) {
          integrityMismatch();
        }
        assertReplayMatches(verified, command.confirmed, command.versions);
        return verified.receipt;
      }

      const confirmedAt = this.issueConfirmedAt();
      const snapshots = this.materialize({
        confirmedAt,
        values: command.confirmed,
      });
      const profile = reconstructRelocationProfileV2(snapshots.profile);
      const preferences = reconstructPreferenceProfileV2(snapshots.preferences);
      if (profile.confirmedAt !== confirmedAt || preferences.confirmedAt !== confirmedAt) {
        integrityMismatch();
      }
      const provenance = reconstructQuestionnaireProvenance(command.confirmed.provenance);
      const rematerializedConfirmed = confirmOnboardingValues(
        rehydrateOnboardingDraft({ profile, preferences, provenance }),
      );
      if (canonicalJson(rematerializedConfirmed) !== canonicalJson(command.confirmed)) {
        integrityMismatch();
      }
      insertRelocationV2Snapshot(this.database, profile);
      insertPreferenceV2Snapshot(this.database, preferences);

      const unsignedReceipt = deriveUnsignedReceipt({
        completionCommandId: command.completionCommandId,
        profileId: profile.id,
        preferenceProfileId: preferences.id,
        confirmedAt,
      });
      const digestPayload: OnboardingConfirmationDigestPayload = {
        schemaVersion: "onboarding-confirmation-binding@1",
        receipt: unsignedReceipt,
        profile,
        preferences,
        provenance,
        versions: command.versions,
      };
      const confirmationDigest = hmacSha256(canonicalJson(digestPayload), this.hmacKey);
      this.database.prepare(`
        INSERT INTO onboarding_confirmations (
          schema_version, receipt_id, completion_command_id, confirmation_digest,
          profile_id, preference_profile_id, frontier_run_id, confirmed_at,
          provenance_json, versions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        unsignedReceipt.schemaVersion,
        unsignedReceipt.receiptId,
        unsignedReceipt.completionCommandId,
        confirmationDigest,
        unsignedReceipt.profileId,
        unsignedReceipt.preferenceProfileId,
        unsignedReceipt.frontierRunId,
        unsignedReceipt.confirmedAt,
        canonicalJson(provenance),
        canonicalJson(command.versions),
      );

      const stored = this.loadByDeterministicCommandBindings(command.completionCommandId);
      if (stored === undefined) integrityMismatch();
      const verified = this.verifyRow(stored);
      if (verified.receipt.completionCommandId !== command.completionCommandId) {
        integrityMismatch();
      }
      const expected = {
        receipt: { ...unsignedReceipt, confirmationDigest },
        profile,
        preferences,
        provenance,
        versions: command.versions,
      };
      if (canonicalJson(verified) !== canonicalJson(expected)) integrityMismatch();
      return verified.receipt;
    });
    return commit.immediate();
  }

  async loadBySnapshotBindingsVerified(input: {
    readonly profileId: string;
    readonly preferenceProfileId: string;
  }): Promise<VerifiedOnboardingConfirmation> {
    const bindings = exactOwnedRecord(input, ["profileId", "preferenceProfileId"]);
    if (
      typeof bindings.profileId !== "string" ||
      typeof bindings.preferenceProfileId !== "string" ||
      !SHA256.test(bindings.profileId) ||
      !SHA256.test(bindings.preferenceProfileId)
    ) {
      throw invalidCompletion();
    }
    const rows = this.database.prepare(`
      SELECT
        schema_version, receipt_id, completion_command_id, confirmation_digest,
        profile_id, preference_profile_id, frontier_run_id, confirmed_at,
        provenance_json, versions_json
      FROM onboarding_confirmations
      WHERE profile_id = ? AND preference_profile_id = ?
      LIMIT 2
    `).all(bindings.profileId, bindings.preferenceProfileId) as ConfirmationRow[];
    if (rows.length === 0) throw new Error("onboarding_confirmation_not_found");
    if (rows.length !== 1) integrityMismatch();
    return this.verifyRow(rows[0]!);
  }

  private issueConfirmedAt(): string {
    const previousRow = this.database.prepare(`
      SELECT MAX(confirmed_at) AS confirmed_at FROM onboarding_confirmations
    `).get() as { readonly confirmed_at: string | null };
    const previous = previousRow.confirmed_at;
    if (previous !== null && !isCanonicalInstant(previous)) integrityMismatch();

    const observed = this.clock();
    if (!(observed instanceof Date)) throw invalidCompletion();
    const observedMs = observed.getTime();
    if (!Number.isFinite(observedMs)) throw invalidCompletion();
    const previousMs = previous === null
      ? Number.NEGATIVE_INFINITY
      : new Date(previous).getTime();
    const issuedMs = Math.max(observedMs, previousMs + 1);
    const confirmedAt = new Date(issuedMs).toISOString();
    if (!isCanonicalInstant(confirmedAt)) throw invalidCompletion();
    return confirmedAt;
  }

  private loadByDeterministicCommandBindings(
    completionCommandId: string,
  ): ConfirmationRow | undefined {
    const rows = this.database.prepare(`
      SELECT
        schema_version, receipt_id, completion_command_id, confirmation_digest,
        profile_id, preference_profile_id, frontier_run_id, confirmed_at,
        provenance_json, versions_json
      FROM onboarding_confirmations
      WHERE completion_command_id = ? OR receipt_id = ? OR frontier_run_id = ?
      LIMIT 2
    `).all(
      completionCommandId,
      deriveReceiptId(completionCommandId),
      deriveFrontierRunId(completionCommandId),
    ) as ConfirmationRow[];
    if (rows.length > 1) integrityMismatch();
    return rows[0];
  }

  private verifyRow(row: ConfirmationRow): VerifiedOnboardingConfirmation {
    try {
      const receipt = reconstructReceipt(row);
      const profile = loadRelocationV2SnapshotVerified(this.database, receipt.profileId);
      const preferences = loadPreferenceV2SnapshotVerified(
        this.database,
        receipt.preferenceProfileId,
      );
      if (
        profile.confirmedAt !== receipt.confirmedAt ||
        preferences.confirmedAt !== receipt.confirmedAt
      ) integrityMismatch();

      const provenance = reconstructCanonicalJson(
        row.provenance_json,
        reconstructQuestionnaireProvenance,
      );
      const versions = reconstructCanonicalJson(row.versions_json, reconstructVersions);
      rehydrateOnboardingDraft({ profile, preferences, provenance });

      const digestPayload: OnboardingConfirmationDigestPayload = {
        schemaVersion: "onboarding-confirmation-binding@1",
        receipt: receiptWithoutDigest(receipt),
        profile,
        preferences,
        provenance,
        versions,
      };
      const expectedDigest = hmacSha256(canonicalJson(digestPayload), this.hmacKey);
      if (!secureHexEqual(receipt.confirmationDigest, expectedDigest)) integrityMismatch();

      return deepFreeze({ receipt, profile, preferences, provenance, versions });
    } catch {
      integrityMismatch();
    }
  }
}

function snapshotCompletionInput(input: {
  readonly completionCommandId: string;
  readonly confirmed: ConfirmedOnboardingValues;
  readonly versions: OnboardingModelVersions;
}): {
  readonly completionCommandId: string;
  readonly confirmed: ConfirmedOnboardingValues;
  readonly versions: OnboardingModelVersions;
} {
  const owned = descriptorSafeCopy(input);
  const command = exactRecord(owned, ["completionCommandId", "confirmed", "versions"]);
  if (typeof command.completionCommandId !== "string" ||
    !LOWERCASE_UUID.test(command.completionCommandId)) throw invalidCompletion();
  const confirmedRecord = exactRecord(command.confirmed, [
    "schemaVersion",
    "profile",
    "preferences",
    "provenance",
  ]);
  if (confirmedRecord.schemaVersion !== "confirmed-onboarding-values@1") {
    throw invalidCompletion();
  }
  const versions = reconstructVersions(command.versions);
  return deepFreeze({
    completionCommandId: command.completionCommandId,
    confirmed: confirmedRecord as unknown as ConfirmedOnboardingValues,
    versions,
  });
}

function assertReplayMatches(
  stored: VerifiedOnboardingConfirmation,
  confirmed: ConfirmedOnboardingValues,
  versions: OnboardingModelVersions,
): void {
  let normalized: ConfirmedOnboardingValues;
  try {
    const profile = reconstructRelocationProfileV2({
      ...confirmed.profile,
      id: stored.profile.id,
      confirmedAt: stored.receipt.confirmedAt,
    });
    const preferences = reconstructPreferenceProfileV2({
      ...confirmed.preferences,
      id: stored.preferences.id,
      confirmedAt: stored.receipt.confirmedAt,
    });
    const provenance = reconstructQuestionnaireProvenance(confirmed.provenance);
    normalized = confirmOnboardingValues(
      rehydrateOnboardingDraft({ profile, preferences, provenance }),
    );
  } catch {
    throw new Error("onboarding_completion_conflict");
  }
  const storedConfirmed: ConfirmedOnboardingValues = {
    schemaVersion: "confirmed-onboarding-values@1",
    profile: {
      schemaVersion: stored.profile.schemaVersion,
      profile: stored.profile.profile,
    },
    preferences: {
      schemaVersion: stored.preferences.schemaVersion,
      countryCriteria: stored.preferences.countryCriteria,
      cityCriteria: stored.preferences.cityCriteria,
    },
    provenance: stored.provenance,
  };
  if (
    canonicalJson(normalized) !== canonicalJson(confirmed) ||
    canonicalJson(storedConfirmed) !== canonicalJson(confirmed) ||
    canonicalJson(stored.versions) !== canonicalJson(versions)
  ) throw new Error("onboarding_completion_conflict");
}

function deriveUnsignedReceipt(input: {
  readonly completionCommandId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly confirmedAt: string;
}): Omit<OnboardingReceipt, "confirmationDigest"> {
  return deepFreeze({
    schemaVersion: "onboarding-receipt@1" as const,
    receiptId: deriveReceiptId(input.completionCommandId),
    completionCommandId: input.completionCommandId,
    profileId: input.profileId,
    preferenceProfileId: input.preferenceProfileId,
    frontierRunId: deriveFrontierRunId(input.completionCommandId),
    confirmedAt: input.confirmedAt,
  });
}

function deriveReceiptId(completionCommandId: string): string {
  return `onboarding-receipt:${sha256Text(canonicalJson({
    schemaVersion: "onboarding-receipt-id@1",
    completionCommandId,
  }))}`;
}

function deriveFrontierRunId(completionCommandId: string): string {
  return `onboarding-frontier:${sha256Text(canonicalJson({
    schemaVersion: "onboarding-frontier-run-id@1",
    completionCommandId,
  }))}`;
}

function reconstructReceipt(row: ConfirmationRow): OnboardingReceipt {
  if (
    row.schema_version !== "onboarding-receipt@1" ||
    !RECEIPT_ID.test(row.receipt_id) ||
    !LOWERCASE_UUID.test(row.completion_command_id) ||
    !SHA256.test(row.confirmation_digest) ||
    !SHA256.test(row.profile_id) ||
    !SHA256.test(row.preference_profile_id) ||
    row.profile_id === row.preference_profile_id ||
    !FRONTIER_RUN_ID.test(row.frontier_run_id) ||
    !isCanonicalInstant(row.confirmed_at)
  ) integrityMismatch();
  const expected = deriveUnsignedReceipt({
    completionCommandId: row.completion_command_id,
    profileId: row.profile_id,
    preferenceProfileId: row.preference_profile_id,
    confirmedAt: row.confirmed_at,
  });
  if (expected.receiptId !== row.receipt_id || expected.frontierRunId !== row.frontier_run_id) {
    integrityMismatch();
  }
  return deepFreeze({ ...expected, confirmationDigest: row.confirmation_digest });
}

function receiptWithoutDigest(
  receipt: OnboardingReceipt,
): Omit<OnboardingReceipt, "confirmationDigest"> {
  return {
    schemaVersion: receipt.schemaVersion,
    receiptId: receipt.receiptId,
    completionCommandId: receipt.completionCommandId,
    profileId: receipt.profileId,
    preferenceProfileId: receipt.preferenceProfileId,
    frontierRunId: receipt.frontierRunId,
    confirmedAt: receipt.confirmedAt,
  };
}

function reconstructVersions(value: unknown): OnboardingModelVersions {
  try {
    return reconstructOnboardingModelVersions(value);
  } catch {
    throw invalidCompletion();
  }
}

function reconstructCanonicalJson<T>(
  text: string,
  reconstruct: (value: unknown) => T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    integrityMismatch();
  }
  const reconstructed = reconstruct(parsed);
  if (canonicalJson(reconstructed) !== text) integrityMismatch();
  return reconstructed;
}

function exactOwnedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return exactRecord(descriptorSafeCopy(value), keys);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidCompletion();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => key in record)) {
    throw invalidCompletion();
  }
  return record;
}

function descriptorSafeCopy<T>(borrowed: T): T {
  const active = new Set<object>();
  let copiedObjects = 0;

  const copy = (value: unknown, depth = 0): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (types.isProxy(value)) throw invalidCompletion();
    copiedObjects += 1;
    if (
      depth > 64 ||
      copiedObjects > 10_000 ||
      active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw invalidCompletion();
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidCompletion();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor !== undefined && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
        Object.getOwnPropertyNames(value).length !== length + 1) {
        throw invalidCompletion();
      }
      active.add(value);
      try {
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            throw invalidCompletion();
          }
          return copy(descriptor.value, depth + 1);
        });
      } finally {
        active.delete(value);
      }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidCompletion();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    active.add(value);
    try {
      return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
        if (!("value" in descriptor) || !descriptor.enumerable) throw invalidCompletion();
        return [key, copy(descriptor.value, depth + 1)];
      }));
    } finally {
      active.delete(value);
    }
  };

  return copy(borrowed) as T;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_MILLISECOND_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalidCompletion(): TypeError {
  return new TypeError("Invalid onboarding completion");
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}
