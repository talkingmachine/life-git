import { types } from "node:util";

import {
  confirmPreferenceProfile,
  reconstructPreferenceProfileV2,
  type PreferenceProfileDraft,
  type PreferenceProfileSnapshot,
  type PreferenceProfileV2Snapshot,
} from "../decision/preference-profile";
import {
  confirmRelocationProfile,
  reconstructRelocationProfileV2,
  type RelocationProfileDraft,
  type RelocationProfileSnapshot,
  type RelocationProfileV2Snapshot,
} from "../decision/relocation-profile";
import { reconstructQuestionnaireProvenance } from
  "../decision/onboarding-provenance";
import { rehydrateOnboardingDraft } from "../decision/onboarding-questionnaire";
export { projectTerminalSummary } from "../decision/place-frontier-summary";
import {
  rankPlaces,
  rankPlacesForVerifiedPreferences,
  type RankedPlace,
  type RankablePlace,
  type RequiredMismatch,
} from "../decision/place-ranker";
import type { EvidenceIntegrity } from "../research/research-plan";
import type {
  ConfirmedOnboardingFrontierPort,
  OnboardingConfirmationReadPort,
  OnboardingModelVersions,
  OnboardingReceipt,
  VerifiedOnboardingConfirmation,
} from "./onboarding-contracts";
import {
  countryVerificationReplayExpectation,
  materializeFrontierMarker,
  type CountryVerificationProgress,
  type CountryVerifierPort,
  type FrontierCountry,
  type FrontierMarker,
} from "./country-verifier";

export { countryCheckRunId } from "./country-verifier";
export type {
  CountryVerificationProgress,
  CountryVerifierPort,
  FrontierCountry,
  FrontierMarker,
} from "./country-verifier";

export interface PlaceFrontierPrepared {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
  readonly contextHash: string;
}

export interface RankingSnapshot {
  readonly schemaVersion: "place-ranking@1";
  readonly id: string;
  readonly runId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly assessmentAt: string;
  readonly contextHash: string;
  readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
  readonly ordered: readonly RankedPlace[];
  readonly excludedPlaces: readonly RankablePlace[];
  readonly excluded: readonly RequiredMismatch[];
  readonly rulesVersion: "place-ranker@1";
  readonly createdAt: string;
}

export interface ShortlistSnapshot {
  readonly schemaVersion: "place-shortlist@1";
  readonly id: string;
  readonly runId: string;
  readonly rankingSnapshotId: string;
  readonly markers: readonly FrontierMarker[];
  readonly rulesVersion: "country-frontier@1";
  readonly createdAt: string;
}

export interface PlaceFrontierReadModel {
  readonly runId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshot: RankingSnapshot;
  readonly shortlistSnapshot: ShortlistSnapshot;
}

export interface PlaceFrontierApplicationPorts {
  readonly onboardingConfirmations?: OnboardingConfirmationReadPort;
  readonly profiles: {
    appendRelocation(snapshot: RelocationProfileSnapshot): Promise<void>;
    loadRelocationVerified(id: string): Promise<RelocationProfileSnapshot>;
    loadRelocationAnyVerified(
      id: string,
    ): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
    appendPreference(snapshot: PreferenceProfileSnapshot): Promise<void>;
    loadPreferenceVerified(id: string): Promise<PreferenceProfileSnapshot>;
    loadPreferenceForRankingVerified(
      id: string,
    ): Promise<PreferenceProfileSnapshot | PreferenceProfileV2Snapshot>;
  };
  readonly rankingInputs: {
    freezeCurrent(): Promise<{
      readonly places: readonly RankablePlace[];
      readonly knowledgeRevisionIds: Readonly<Record<string, string | null>>;
    }>;
  };
  readonly rank: typeof rankPlaces;
  readonly rankVerifiedPreferences?: typeof rankPlacesForVerifiedPreferences;
  readonly store: {
    appendRanking(snapshot: RankingSnapshot): Promise<void>;
    insertOrLoadRanking(snapshot: RankingSnapshot): Promise<RankingSnapshot>;
    appendShortlist(snapshot: ShortlistSnapshot): Promise<void>;
    loadRankingVerified(id: string): Promise<RankingSnapshot>;
    loadRankingVerifiedIfPresent(idOrRunId: string): Promise<RankingSnapshot | undefined>;
    loadShortlistVerified(idOrRunId: string): Promise<ShortlistSnapshot>;
    loadShortlistVerifiedIfPresent(idOrRunId: string): Promise<ShortlistSnapshot | undefined>;
  };
  readonly knowledge: {
    loadVerified(id: string): Promise<{ readonly id: string; readonly countryCode: string }>;
  };
  readonly verifier: CountryVerifierPort;
  readonly integrity: EvidenceIntegrity;
  readonly clock: () => Date;
  readonly nextRunId: () => string;
}

export interface PlaceFrontierApplication {
  preparePlaceFrontier(input:
    | { readonly profile: RelocationProfileDraft; readonly preferences: PreferenceProfileDraft }
    | { readonly profileId: string; readonly preferenceProfileId: string }
  ): Promise<PlaceFrontierPrepared>;
  runPlaceFrontier(
    prepared: PlaceFrontierPrepared,
    emit: (event: PlaceFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<PlaceFrontierReadModel>;
  presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel>;
}

export interface PlaceFrontierShortlistPresentation {
  presentPlaceFrontierByShortlistId(shortlistSnapshotId: string): Promise<PlaceFrontierReadModel>;
}

export interface FrontierEventBase<T extends string, P> {
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly payload: P;
}

export type PlaceFrontierEvent =
  | FrontierEventBase<"ranking_sealed", {
      readonly rankingSnapshotId: string;
      readonly orderedCountryCodes: readonly string[];
      readonly excludedCountryCodes: readonly string[];
    }>
  | FrontierEventBase<"country_activated", {
      readonly country: FrontierCountry;
      readonly rank: number;
    }>
  | FrontierEventBase<"country_progress", {
      readonly countryCode: string;
      readonly stage:
        | "source_discovered"
        | "authority_verified"
        | "artifact_captured"
        | "claim_verified"
        | "dossier_published";
      readonly label: string;
      readonly detail?: string;
      readonly sourceUrl?: string;
    }>
  | FrontierEventBase<"country_completed", { readonly marker: FrontierMarker }>
  | FrontierEventBase<"frontier_completed", { readonly readModel: PlaceFrontierReadModel }>;

type FrontierEventDraft = PlaceFrontierEvent extends infer Event
  ? Event extends PlaceFrontierEvent
    ? Pick<Event, "type" | "payload">
    : never
  : never;

const ONBOARDING_RECEIPT_KEYS = [
  "schemaVersion",
  "receiptId",
  "completionCommandId",
  "confirmationDigest",
  "profileId",
  "preferenceProfileId",
  "frontierRunId",
  "confirmedAt",
] as const;
const VERIFIED_CONFIRMATION_KEYS = [
  "receipt",
  "profile",
  "preferences",
  "provenance",
  "versions",
] as const;
const ONBOARDING_VERSION_KEYS = [
  "invocation",
  "cliVersion",
  "extractionPrompt",
  "reviewPrompt",
  "extractionSchema",
  "reviewSchema",
] as const;
const FIXED_ONBOARDING_VERSIONS: OnboardingModelVersions = Object.freeze({
  invocation: "codex-cli-invocation@1",
  cliVersion: "codex-cli 0.148.0-alpha.15",
  extractionPrompt: "onboarding-extract@1",
  reviewPrompt: "onboarding-review@1",
  extractionSchema: "onboarding-model-output@1",
  reviewSchema: "onboarding-review-output@1",
});
const LOWERCASE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^onboarding-receipt:[a-f0-9]{64}$/;
const FRONTIER_RUN_ID = /^onboarding-frontier:[a-f0-9]{64}$/;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactDescriptorRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) integrityMismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (
    names.length !== keys.length ||
    !keys.every((key) => Object.hasOwn(descriptors, key))
  ) integrityMismatch();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      integrityMismatch();
    }
    result[key] = descriptor.value;
  }
  return result;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalMaxInstant(observed: Date, floor: string): string {
  const observedAt = observed.toISOString();
  return Date.parse(observedAt) < Date.parse(floor) ? floor : observedAt;
}

function reconstructOnboardingReceipt(
  value: unknown,
  integrity: EvidenceIntegrity,
): OnboardingReceipt {
  const receipt = exactDescriptorRecord(value, ONBOARDING_RECEIPT_KEYS);
  if (
    receipt.schemaVersion !== "onboarding-receipt@1" ||
    typeof receipt.receiptId !== "string" || !RECEIPT_ID.test(receipt.receiptId) ||
    typeof receipt.completionCommandId !== "string" ||
    !LOWERCASE_UUID.test(receipt.completionCommandId) ||
    typeof receipt.confirmationDigest !== "string" || !SHA256.test(receipt.confirmationDigest) ||
    typeof receipt.profileId !== "string" || !SHA256.test(receipt.profileId) ||
    typeof receipt.preferenceProfileId !== "string" || !SHA256.test(receipt.preferenceProfileId) ||
    receipt.profileId === receipt.preferenceProfileId ||
    typeof receipt.frontierRunId !== "string" || !FRONTIER_RUN_ID.test(receipt.frontierRunId) ||
    !isCanonicalInstant(receipt.confirmedAt)
  ) integrityMismatch();
  const completionCommandId = receipt.completionCommandId;
  const expectedReceiptId = `onboarding-receipt:${integrity.hash(integrity.canonical({
    schemaVersion: "onboarding-receipt-id@1",
    completionCommandId,
  }))}`;
  const expectedFrontierRunId = `onboarding-frontier:${integrity.hash(integrity.canonical({
    schemaVersion: "onboarding-frontier-run-id@1",
    completionCommandId,
  }))}`;
  if (
    receipt.receiptId !== expectedReceiptId ||
    receipt.frontierRunId !== expectedFrontierRunId
  ) integrityMismatch();
  return deepFreeze({
    schemaVersion: "onboarding-receipt@1",
    receiptId: receipt.receiptId,
    completionCommandId,
    confirmationDigest: receipt.confirmationDigest,
    profileId: receipt.profileId,
    preferenceProfileId: receipt.preferenceProfileId,
    frontierRunId: receipt.frontierRunId,
    confirmedAt: receipt.confirmedAt,
  });
}

function reconstructOnboardingVersions(value: unknown): OnboardingModelVersions {
  const versions = exactDescriptorRecord(value, ONBOARDING_VERSION_KEYS);
  for (const key of ONBOARDING_VERSION_KEYS) {
    if (versions[key] !== FIXED_ONBOARDING_VERSIONS[key]) integrityMismatch();
  }
  return FIXED_ONBOARDING_VERSIONS;
}

function secureSha256Equal(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function verifyOnboardingConfirmation(
  requestedReceipt: OnboardingReceipt,
  value: VerifiedOnboardingConfirmation,
  integrity: EvidenceIntegrity,
): {
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
} {
  try {
    const confirmation = exactDescriptorRecord(value, VERIFIED_CONFIRMATION_KEYS);
    const receipt = reconstructOnboardingReceipt(confirmation.receipt, integrity);
    const profile = reconstructRelocationProfileV2(confirmation.profile);
    const preferences = reconstructPreferenceProfileV2(confirmation.preferences);
    const provenance = reconstructQuestionnaireProvenance(confirmation.provenance);
    const versions = reconstructOnboardingVersions(confirmation.versions);
    rehydrateOnboardingDraft({ profile, preferences, provenance });
    const expectedDigest = integrity.sign(integrity.canonical({
      schemaVersion: "onboarding-confirmation-binding@1",
      receipt: {
        schemaVersion: receipt.schemaVersion,
        receiptId: receipt.receiptId,
        completionCommandId: receipt.completionCommandId,
        profileId: receipt.profileId,
        preferenceProfileId: receipt.preferenceProfileId,
        frontierRunId: receipt.frontierRunId,
        confirmedAt: receipt.confirmedAt,
      },
      profile,
      preferences,
      provenance,
      versions,
    }));
    if (
      !secureSha256Equal(receipt.confirmationDigest, expectedDigest) ||
      integrity.canonical(receipt) !== integrity.canonical(requestedReceipt) ||
      profile.id !== receipt.profileId ||
      preferences.id !== receipt.preferenceProfileId ||
      profile.confirmedAt !== receipt.confirmedAt ||
      preferences.confirmedAt !== receipt.confirmedAt
    ) integrityMismatch();
    return { profile, preferences };
  } catch {
    integrityMismatch();
  }
}

function abort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function frontierCountry(place: RankedPlace): FrontierCountry {
  return {
    countryCode: place.countryCode,
    label: place.label,
    flag: place.flag,
    coordinate: { ...place.coordinate },
  };
}

function frontierContextHash(input: {
  readonly runId: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly assessmentAt: string;
  readonly rankingSnapshotId: string;
}, integrity: EvidenceIntegrity): string {
  return integrity.hash(integrity.canonical(input));
}

function rankingCountryCodes(ranking: RankingSnapshot): readonly string[] {
  return [...new Set([
    ...ranking.ordered.map(({ countryCode }) => countryCode),
    ...ranking.excluded.map(({ countryCode }) => countryCode),
  ])];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index]);
}

async function verifyRankingKnowledge(
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
  verifyOwnership: boolean,
): Promise<void> {
  if (!sameStringSet(Object.keys(ranking.knowledgeRevisionIds), rankingCountryCodes(ranking))) {
    integrityMismatch();
  }
  if (!verifyOwnership) return;
  for (const [countryCode, revisionId] of Object.entries(ranking.knowledgeRevisionIds)) {
    if (revisionId === null) continue;
    const revision = await ports.knowledge.loadVerified(revisionId);
    if (revision.id !== revisionId || revision.countryCode !== countryCode) integrityMismatch();
  }
}

function verifyPrepared(prepared: PlaceFrontierPrepared, ranking: RankingSnapshot): void {
  if (
    ranking.id !== prepared.rankingSnapshotId ||
    ranking.runId !== prepared.runId ||
    ranking.profileSnapshotId !== prepared.profileId ||
    ranking.preferenceProfileSnapshotId !== prepared.preferenceProfileId ||
    ranking.assessmentAt !== prepared.assessmentAt ||
    ranking.contextHash !== prepared.contextHash
  ) integrityMismatch();
}

function receiptPrepared(
  receipt: OnboardingReceipt,
  integrity: EvidenceIntegrity,
): PlaceFrontierPrepared {
  const rankingSnapshotId = `${receipt.frontierRunId}:ranking`;
  return {
    runId: receipt.frontierRunId,
    profileId: receipt.profileId,
    preferenceProfileId: receipt.preferenceProfileId,
    assessmentAt: receipt.confirmedAt,
    rankingSnapshotId,
    contextHash: frontierContextHash({
      runId: receipt.frontierRunId,
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
      assessmentAt: receipt.confirmedAt,
      rankingSnapshotId,
    }, integrity),
  };
}

async function verifiedReceiptPrepared(
  receipt: OnboardingReceipt,
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<PlaceFrontierPrepared> {
  const prepared = receiptPrepared(receipt, ports.integrity);
  verifyPrepared(prepared, ranking);
  await verifyRankingKnowledge(ranking, ports, false);
  return immutableCopy(prepared);
}

function createEventEmitter(
  runId: string,
  emit: (event: PlaceFrontierEvent) => void | Promise<void>,
  clock: () => Date,
): (draft: FrontierEventDraft) => Promise<void> {
  let sequence = 0;
  return async (draft) => {
    await emit(immutableCopy({
      runId,
      sequence: ++sequence,
      occurredAt: clock().toISOString(),
      type: draft.type,
      payload: draft.payload,
    } as PlaceFrontierEvent));
  };
}

function createPersistedEventEmitter(
  runId: string,
  emit: (event: PlaceFrontierEvent) => void | Promise<void>,
): (draft: FrontierEventDraft, occurredAt: string) => Promise<void> {
  let sequence = 0;
  return async (draft, occurredAt) => {
    await emit(immutableCopy({
      runId,
      sequence: ++sequence,
      occurredAt,
      type: draft.type,
      payload: draft.payload,
    } as PlaceFrontierEvent));
  };
}

function progressDraft(
  countryCode: string,
  progress: CountryVerificationProgress,
): FrontierEventDraft {
  return {
    type: "country_progress",
    payload: { countryCode, ...progress },
  };
}

function nonRedCount(markers: readonly FrontierMarker[]): number {
  return markers.filter(({ formalVerdict }) => formalVerdict.marker !== "red").length;
}

function shortlistSnapshot(
  runId: string,
  rankingSnapshotId: string,
  markers: readonly FrontierMarker[],
  createdAt: string,
): ShortlistSnapshot {
  return {
    schemaVersion: "place-shortlist@1",
    id: `${runId}:shortlist`,
    runId,
    rankingSnapshotId,
    markers,
    rulesVersion: "country-frontier@1",
    createdAt,
  };
}

async function verifyMarkerReplay(
  marker: FrontierMarker,
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<void> {
  const replay = await ports.verifier.present({
    parentRunId: ranking.runId,
    countryCode: marker.country.countryCode,
    countryCheckRunId: marker.countryCheckRunId,
    profileId: ranking.profileSnapshotId,
  });
  if (ports.integrity.canonical(replay) !== ports.integrity.canonical(
    countryVerificationReplayExpectation(marker),
  )) integrityMismatch();
}

function completedReadModel(
  ranking: RankingSnapshot,
  shortlist: ShortlistSnapshot,
): PlaceFrontierReadModel {
  return immutableCopy({
    runId: shortlist.runId,
    assessmentAt: ranking.assessmentAt,
    rankingSnapshot: ranking,
    shortlistSnapshot: shortlist,
  });
}

function completedReplayEvents(
  ranking: RankingSnapshot,
  shortlist: ShortlistSnapshot,
  readModel: PlaceFrontierReadModel,
): readonly { readonly draft: FrontierEventDraft; readonly occurredAt: string }[] {
  const events: Array<{ readonly draft: FrontierEventDraft; readonly occurredAt: string }> = [{
    draft: {
      type: "ranking_sealed",
      payload: {
        rankingSnapshotId: ranking.id,
        orderedCountryCodes: ranking.ordered.map(({ countryCode }) => countryCode),
        excludedCountryCodes: [...new Set(
          ranking.excluded.map(({ countryCode }) => countryCode),
        )].sort(),
      },
    },
    occurredAt: ranking.createdAt,
  }];
  const initiallyActivated = ranking.ordered.slice(0, 5);
  for (const place of initiallyActivated) {
    events.push({
      draft: {
        type: "country_activated",
        payload: { country: frontierCountry(place), rank: place.rank },
      },
      occurredAt: ranking.createdAt,
    });
  }
  let activatedCount = initiallyActivated.length;
  let nextIndex = initiallyActivated.length;
  let acceptedCount = 0;
  for (const [index, marker] of shortlist.markers.entries()) {
    if (index >= activatedCount || acceptedCount === 5) integrityMismatch();
    events.push({
      draft: { type: "country_completed", payload: { marker } },
      occurredAt: shortlist.createdAt,
    });
    if (marker.formalVerdict.marker !== "red") acceptedCount += 1;
    if (acceptedCount === 5) {
      if (index !== shortlist.markers.length - 1) integrityMismatch();
      continue;
    }
    if (marker.formalVerdict.marker === "red" && nextIndex < ranking.ordered.length) {
      const replacement = ranking.ordered[nextIndex++]!;
      activatedCount += 1;
      events.push({
        draft: {
          type: "country_activated",
          payload: { country: frontierCountry(replacement), rank: replacement.rank },
        },
        occurredAt: shortlist.createdAt,
      });
    }
  }
  if (acceptedCount !== 5 && shortlist.markers.length !== ranking.ordered.length) {
    integrityMismatch();
  }
  events.push({
    draft: { type: "frontier_completed", payload: { readModel } },
    occurredAt: shortlist.createdAt,
  });
  return events;
}

async function verifyCompletedShortlist(
  ranking: RankingSnapshot,
  shortlist: ShortlistSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<PlaceFrontierReadModel> {
  if (
    ranking.runId !== shortlist.runId ||
    shortlist.rankingSnapshotId !== ranking.id ||
    Date.parse(shortlist.createdAt) < Date.parse(ranking.assessmentAt)
  ) {
    integrityMismatch();
  }
  await verifyRankingKnowledge(ranking, ports, true);
  const readModel = completedReadModel(ranking, shortlist);
  completedReplayEvents(ranking, shortlist, readModel);
  for (const marker of shortlist.markers) await verifyMarkerReplay(marker, ranking, ports);
  return readModel;
}

async function loadBoundProfiles(
  ranking: RankingSnapshot,
  ports: PlaceFrontierApplicationPorts,
): Promise<void> {
  const profile = await ports.profiles.loadRelocationAnyVerified(ranking.profileSnapshotId);
  const preferences = await ports.profiles.loadPreferenceForRankingVerified(
    ranking.preferenceProfileSnapshotId,
  );
  const isV1Pair = profile.schemaVersion === "relocation-profile@1" &&
    preferences.schemaVersion === "preference-profile@1";
  const isV2Pair = profile.schemaVersion === "relocation-profile@2" &&
    preferences.schemaVersion === "preference-profile@2";
  if (
    profile.id !== ranking.profileSnapshotId ||
    preferences.id !== ranking.preferenceProfileSnapshotId ||
    (!isV1Pair && !isV2Pair)
  ) integrityMismatch();
}

export function createPlaceFrontierApplication(
  ports: PlaceFrontierApplicationPorts,
): PlaceFrontierApplication & PlaceFrontierShortlistPresentation & ConfirmedOnboardingFrontierPort {
  async function preparePlaceFrontier(
    input: Parameters<PlaceFrontierApplication["preparePlaceFrontier"]>[0],
  ): Promise<PlaceFrontierPrepared> {
    const now = ports.clock();
    const profile = "profile" in input
      ? confirmRelocationProfile(input.profile, () => now)
      : await ports.profiles.loadRelocationVerified(input.profileId);
    const preferences = "preferences" in input
      ? confirmPreferenceProfile(input.preferences, () => now)
      : await ports.profiles.loadPreferenceVerified(input.preferenceProfileId);
    if ("profile" in input) await ports.profiles.appendRelocation(profile);
    if ("preferences" in input) await ports.profiles.appendPreference(preferences);

    const runId = ports.nextRunId();
    const assessmentAt = now.toISOString();
    const rankingSnapshotId = `${runId}:ranking`;
    const contextHash = frontierContextHash({
      runId,
      profileId: profile.id,
      preferenceProfileId: preferences.id,
      assessmentAt,
      rankingSnapshotId,
    }, ports.integrity);
    const rankingInputs = await ports.rankingInputs.freezeCurrent();
    const result = ports.rank({
      assessmentAt: assessmentAt.slice(0, 10),
      preferences,
      places: rankingInputs.places,
    });
    const excludedCountryCodes = new Set(result.excluded.map(({ countryCode }) => countryCode));
    const excludedPlaces = rankingInputs.places
      .filter(({ countryCode }) => excludedCountryCodes.has(countryCode))
      .map((place) => structuredClone(place))
      .sort((left, right) => left.countryCode.localeCompare(right.countryCode));
    const snapshot: RankingSnapshot = {
      schemaVersion: "place-ranking@1",
      id: rankingSnapshotId,
      runId,
      profileSnapshotId: profile.id,
      preferenceProfileSnapshotId: preferences.id,
      assessmentAt,
      contextHash,
      knowledgeRevisionIds: rankingInputs.knowledgeRevisionIds,
      ordered: result.ordered,
      excludedPlaces,
      excluded: result.excluded,
      rulesVersion: result.rulesVersion,
      createdAt: assessmentAt,
    };
    await verifyRankingKnowledge(snapshot, ports, false);
    await ports.store.appendRanking(snapshot);
    return {
      runId,
      profileId: profile.id,
      preferenceProfileId: preferences.id,
      assessmentAt,
      rankingSnapshotId,
      contextHash,
    };
  }

  async function prepareFromOnboardingReceipt(
    borrowedReceipt: OnboardingReceipt,
  ): Promise<PlaceFrontierPrepared> {
    let receipt: OnboardingReceipt;
    try {
      receipt = reconstructOnboardingReceipt(borrowedReceipt, ports.integrity);
    } catch {
      integrityMismatch();
    }
    const onboardingConfirmations = ports.onboardingConfirmations;
    if (onboardingConfirmations === undefined) integrityMismatch();
    const verified = await onboardingConfirmations.loadBySnapshotBindingsVerified({
      profileId: receipt.profileId,
      preferenceProfileId: receipt.preferenceProfileId,
    });
    const confirmation = verifyOnboardingConfirmation(receipt, verified, ports.integrity);
    const existing = await ports.store.loadRankingVerifiedIfPresent(receipt.frontierRunId);
    if (existing !== undefined) return verifiedReceiptPrepared(receipt, existing, ports);

    const prepared = receiptPrepared(receipt, ports.integrity);
    const rankingInputs = await ports.rankingInputs.freezeCurrent();
    const result = (ports.rankVerifiedPreferences ?? rankPlacesForVerifiedPreferences)({
      assessmentAt: receipt.confirmedAt.slice(0, 10),
      preferences: confirmation.preferences,
      places: rankingInputs.places,
    });
    const excludedCountryCodes = new Set(result.excluded.map(({ countryCode }) => countryCode));
    const excludedPlaces = rankingInputs.places
      .filter(({ countryCode }) => excludedCountryCodes.has(countryCode))
      .map((place) => structuredClone(place))
      .sort((left, right) => left.countryCode.localeCompare(right.countryCode));
    const candidate: RankingSnapshot = {
      schemaVersion: "place-ranking@1",
      id: prepared.rankingSnapshotId,
      runId: prepared.runId,
      profileSnapshotId: confirmation.profile.id,
      preferenceProfileSnapshotId: confirmation.preferences.id,
      assessmentAt: prepared.assessmentAt,
      contextHash: prepared.contextHash,
      knowledgeRevisionIds: rankingInputs.knowledgeRevisionIds,
      ordered: result.ordered,
      excludedPlaces,
      excluded: result.excluded,
      rulesVersion: result.rulesVersion,
      createdAt: prepared.assessmentAt,
    };
    await verifyRankingKnowledge(candidate, ports, false);
    const winner = await ports.store.insertOrLoadRanking(candidate);
    return verifiedReceiptPrepared(receipt, winner, ports);
  }

  async function runPlaceFrontier(
    prepared: PlaceFrontierPrepared,
    emit: (event: PlaceFrontierEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<PlaceFrontierReadModel> {
    if (signal.aborted) abort(signal);
    const ranking = await ports.store.loadRankingVerified(prepared.rankingSnapshotId);
    verifyPrepared(prepared, ranking);
    await loadBoundProfiles(ranking, ports);
    const completed = await ports.store.loadShortlistVerifiedIfPresent(prepared.runId);
    if (completed !== undefined) {
      const readModel = await verifyCompletedShortlist(ranking, completed, ports);
      const sendPersisted = createPersistedEventEmitter(prepared.runId, emit);
      for (const event of completedReplayEvents(ranking, completed, readModel)) {
        await sendPersisted(event.draft, event.occurredAt);
      }
      return readModel;
    }
    await verifyRankingKnowledge(ranking, ports, false);

    const send = createEventEmitter(prepared.runId, emit, ports.clock);
    await send({
      type: "ranking_sealed",
      payload: {
        rankingSnapshotId: ranking.id,
        orderedCountryCodes: ranking.ordered.map(({ countryCode }) => countryCode),
        excludedCountryCodes: [...new Set(
          ranking.excluded.map(({ countryCode }) => countryCode),
        )].sort(),
      },
    });
    const activated = [...ranking.ordered.slice(0, 5)];
    for (const place of activated) {
      await send({ type: "country_activated", payload: { country: frontierCountry(place), rank: place.rank } });
    }

    const markers: FrontierMarker[] = [];
    let checkIndex = 0;
    let nextIndex = activated.length;
    while (checkIndex < activated.length) {
      if (signal.aborted) abort(signal);
      const place = activated[checkIndex++]!;
      const checked = await ports.verifier.check({
        country: place,
        profileId: prepared.profileId,
        parentRunId: prepared.runId,
        emitProgress: async (progress) => send(progressDraft(place.countryCode, progress)),
        signal,
      });
      const marker = materializeFrontierMarker({
        place,
        checked,
        parentRunId: prepared.runId,
        profileId: prepared.profileId,
        integrity: ports.integrity,
      });
      markers.push(marker);
      await send({ type: "country_completed", payload: { marker } });
      if (marker.formalVerdict.marker === "red" && nextIndex < ranking.ordered.length) {
        const replacement = ranking.ordered[nextIndex++]!;
        activated.push(replacement);
        await send({
          type: "country_activated",
          payload: { country: frontierCountry(replacement), rank: replacement.rank },
        });
      }
      if (nonRedCount(markers) === 5) break;
    }
    if (nonRedCount(markers) !== 5 && markers.length !== ranking.ordered.length) {
      integrityMismatch();
    }
    if (signal.aborted) abort(signal);
    const shortlist = shortlistSnapshot(
      prepared.runId,
      ranking.id,
      markers,
      canonicalMaxInstant(ports.clock(), ranking.assessmentAt),
    );
    await ports.store.appendShortlist(shortlist);
    const readModel = immutableCopy({
      runId: prepared.runId,
      assessmentAt: ranking.assessmentAt,
      rankingSnapshot: ranking,
      shortlistSnapshot: shortlist,
    });
    await send({ type: "frontier_completed", payload: { readModel } });
    return readModel;
  }

  async function presentVerifiedShortlist(shortlistSnapshotIdOrRunId: string): Promise<PlaceFrontierReadModel> {
    const shortlist = await ports.store.loadShortlistVerified(shortlistSnapshotIdOrRunId);
    const ranking = await ports.store.loadRankingVerified(shortlist.rankingSnapshotId);
    await loadBoundProfiles(ranking, ports);
    return verifyCompletedShortlist(ranking, shortlist, ports);
  }

  async function presentPlaceFrontier(runId: string): Promise<PlaceFrontierReadModel> {
    return presentVerifiedShortlist(runId);
  }

  async function presentPlaceFrontierByShortlistId(
    shortlistSnapshotId: string,
  ): Promise<PlaceFrontierReadModel> {
    return presentVerifiedShortlist(shortlistSnapshotId);
  }

  return Object.freeze({
    preparePlaceFrontier,
    prepareFromOnboardingReceipt,
    runPlaceFrontier,
    presentPlaceFrontier,
    presentPlaceFrontierByShortlistId,
  });
}
