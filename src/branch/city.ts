import { types } from "node:util";

import type { CityDecisionIntegrity } from "../decision/city-integrity";

export interface PreCityResolvedCountryEntryProjection {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalMarkerDigest: string;
}

export interface PreCityBranchSourceProjection {
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly resolvedCountryEntry: PreCityResolvedCountryEntryProjection;
}

export interface CreatePreCityBranchCommitInput {
  readonly source: PreCityBranchSourceProjection;
  readonly createdAt: string;
}

export interface PreCityBranchCommit {
  readonly schemaVersion: "pre-city-branch@1";
  readonly id: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
  readonly resolvedCountryShortlistRevisionId: string;
  readonly countryCode: string;
  readonly resolvedCountryEntryDigest: string;
  readonly createdAt: string;
}

export interface CityBranchCommit {
  readonly schemaVersion: "city-branch@1";
  readonly id: string;
  readonly parentId: string;
  readonly forkedFrom: string;
  readonly citySelectionSnapshotId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly createdAt: string;
}

export interface CityBranchSelectionProjection {
  readonly citySelectionSnapshotId: string;
  readonly preCityBranchCommitId: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly createdAt: string;
}

type PlainRecord = Record<string, unknown>;

interface CapturedIntegrity {
  readonly canonical: (value: unknown) => string;
  readonly hash: (canonicalText: string) => string;
}

const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function atBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error("integrity_mismatch");
  }
}

function ownData<T>(borrowed: T): T {
  const active = new Set<object>();

  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) mismatch();
    if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();

    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) ||
          !Number.isSafeInteger(length.value) || length.value < 0 ||
          Object.getOwnPropertyNames(value).length !== length.value + 1) {
          mismatch();
        }
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }

      if (Object.getPrototypeOf(value) !== Object.prototype) mismatch();
      const copy: PlainRecord = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          mismatch();
        }
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };

  return visit(borrowed) as T;
}

function captureIntegrity(borrowed: CityDecisionIntegrity): CapturedIntegrity {
  if (borrowed === null || typeof borrowed !== "object" || Array.isArray(borrowed) ||
    types.isProxy(borrowed) || Object.getPrototypeOf(borrowed) !== Object.prototype ||
    Object.getOwnPropertySymbols(borrowed).length !== 0) {
    mismatch();
  }
  const names = Object.getOwnPropertyNames(borrowed);
  if (!names.includes("canonical") || !names.includes("hash")) mismatch();
  const canonical = Object.getOwnPropertyDescriptor(borrowed, "canonical");
  const hash = Object.getOwnPropertyDescriptor(borrowed, "hash");
  if (canonical === undefined || !("value" in canonical) || !canonical.enumerable ||
    typeof canonical.value !== "function" || types.isProxy(canonical.value) ||
    hash === undefined || !("value" in hash) || !hash.enumerable ||
    typeof hash.value !== "function" || types.isProxy(hash.value)) {
    mismatch();
  }
  return Object.freeze({
    canonical: canonical.value as (value: unknown) => string,
    hash: hash.value as (canonicalText: string) => string,
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) mismatch();
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function hashOwned(value: unknown, integrity: CapturedIntegrity): string {
  const privateValue = deepFreeze(value);
  const canonical = Reflect.apply(
    integrity.canonical,
    Object.freeze({ capability: "canonical" }),
    [privateValue],
  ) as unknown;
  if (typeof canonical !== "string") mismatch();
  const digest = Reflect.apply(
    integrity.hash,
    Object.freeze({ capability: "hash" }),
    [canonical],
  ) as unknown;
  if (typeof digest !== "string" || !LOWERCASE_DIGEST.test(digest)) mismatch();
  return digest;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    mismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  return value as PlainRecord;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    CONTROL_CHARACTER.test(value)) {
    mismatch();
  }
  return value;
}

function countryCode(value: unknown): string {
  const country = text(value);
  if (!/^[A-Z]{2}$/.test(country)) mismatch();
  return country;
}

function positiveRank(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) mismatch();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !LOWERCASE_DIGEST.test(value)) mismatch();
  return value;
}

function instant(value: unknown): string {
  const candidate = text(value);
  try {
    if (new Date(candidate).toISOString() !== candidate) mismatch();
  } catch {
    mismatch();
  }
  return candidate;
}

function contentIdentifier(value: unknown, prefix: string): string {
  const identifier = text(value);
  if (!identifier.startsWith(`${prefix}:`) ||
    !LOWERCASE_DIGEST.test(identifier.slice(prefix.length + 1))) {
    mismatch();
  }
  return identifier;
}

function parseResolvedCountryEntry(
  value: unknown,
): PreCityResolvedCountryEntryProjection {
  const entry = exactRecord(value, ["countryCode", "rank", "formalMarkerDigest"]);
  return {
    countryCode: countryCode(entry.countryCode),
    rank: positiveRank(entry.rank),
    formalMarkerDigest: digest(entry.formalMarkerDigest),
  };
}

function parsePreCitySource(value: unknown): PreCityBranchSourceProjection {
  const source = exactRecord(value, [
    "profileSnapshotId",
    "preferenceProfileSnapshotId",
    "resolvedCountryShortlistRevisionId",
    "resolvedCountryEntry",
  ]);
  return {
    profileSnapshotId: text(source.profileSnapshotId),
    preferenceProfileSnapshotId: text(source.preferenceProfileSnapshotId),
    resolvedCountryShortlistRevisionId: text(source.resolvedCountryShortlistRevisionId),
    resolvedCountryEntry: parseResolvedCountryEntry(source.resolvedCountryEntry),
  };
}

function parsePreCityCommit(value: unknown): PreCityBranchCommit {
  const commit = exactRecord(value, [
    "schemaVersion",
    "id",
    "profileSnapshotId",
    "preferenceProfileSnapshotId",
    "resolvedCountryShortlistRevisionId",
    "countryCode",
    "resolvedCountryEntryDigest",
    "createdAt",
  ]);
  if (commit.schemaVersion !== "pre-city-branch@1") mismatch();
  return {
    schemaVersion: "pre-city-branch@1",
    id: contentIdentifier(commit.id, "pre-city-branch"),
    profileSnapshotId: text(commit.profileSnapshotId),
    preferenceProfileSnapshotId: text(commit.preferenceProfileSnapshotId),
    resolvedCountryShortlistRevisionId: text(commit.resolvedCountryShortlistRevisionId),
    countryCode: countryCode(commit.countryCode),
    resolvedCountryEntryDigest: digest(commit.resolvedCountryEntryDigest),
    createdAt: instant(commit.createdAt),
  };
}

function preCityPayload(commit: PreCityBranchCommit): Omit<PreCityBranchCommit, "id"> {
  return {
    schemaVersion: "pre-city-branch@1",
    profileSnapshotId: commit.profileSnapshotId,
    preferenceProfileSnapshotId: commit.preferenceProfileSnapshotId,
    resolvedCountryShortlistRevisionId: commit.resolvedCountryShortlistRevisionId,
    countryCode: commit.countryCode,
    resolvedCountryEntryDigest: commit.resolvedCountryEntryDigest,
    createdAt: commit.createdAt,
  };
}

function verifyPreCityCommit(
  commit: PreCityBranchCommit,
  integrity: CapturedIntegrity,
): PreCityBranchCommit {
  if (commit.id !== `pre-city-branch:${hashOwned(preCityPayload(commit), integrity)}`) mismatch();
  return commit;
}

function parseBranchSelection(value: unknown): CityBranchSelectionProjection {
  const selection = exactRecord(value, [
    "citySelectionSnapshotId",
    "preCityBranchCommitId",
    "cityId",
    "countryCode",
    "createdAt",
  ]);
  return {
    citySelectionSnapshotId: contentIdentifier(
      selection.citySelectionSnapshotId,
      "city-selection",
    ),
    preCityBranchCommitId: contentIdentifier(
      selection.preCityBranchCommitId,
      "pre-city-branch",
    ),
    cityId: text(selection.cityId),
    countryCode: countryCode(selection.countryCode),
    createdAt: instant(selection.createdAt),
  };
}

function parseCityBranchCommit(value: unknown): CityBranchCommit {
  const commit = exactRecord(value, [
    "schemaVersion",
    "id",
    "parentId",
    "forkedFrom",
    "citySelectionSnapshotId",
    "cityId",
    "countryCode",
    "createdAt",
  ]);
  if (commit.schemaVersion !== "city-branch@1") mismatch();
  return {
    schemaVersion: "city-branch@1",
    id: contentIdentifier(commit.id, "city-branch"),
    parentId: contentIdentifier(commit.parentId, "pre-city-branch"),
    forkedFrom: contentIdentifier(commit.forkedFrom, "pre-city-branch"),
    citySelectionSnapshotId: contentIdentifier(
      commit.citySelectionSnapshotId,
      "city-selection",
    ),
    cityId: text(commit.cityId),
    countryCode: countryCode(commit.countryCode),
    createdAt: instant(commit.createdAt),
  };
}

function cityBranchPayload(commit: CityBranchCommit): Omit<CityBranchCommit, "id"> {
  return {
    schemaVersion: "city-branch@1",
    parentId: commit.parentId,
    forkedFrom: commit.forkedFrom,
    citySelectionSnapshotId: commit.citySelectionSnapshotId,
    cityId: commit.cityId,
    countryCode: commit.countryCode,
    createdAt: commit.createdAt,
  };
}

function requireBranchBindings(
  commit: CityBranchCommit,
  selection: CityBranchSelectionProjection,
  parent: PreCityBranchCommit,
): void {
  if (selection.preCityBranchCommitId !== parent.id ||
    selection.countryCode !== parent.countryCode ||
    commit.parentId !== parent.id || commit.forkedFrom !== parent.id ||
    commit.citySelectionSnapshotId !== selection.citySelectionSnapshotId ||
    commit.cityId !== selection.cityId || commit.countryCode !== selection.countryCode ||
    commit.createdAt !== selection.createdAt) {
    mismatch();
  }
}

export function resolvedCountryEntryDigest(
  entry: PreCityResolvedCountryEntryProjection,
  integrity: CityDecisionIntegrity,
): string {
  return atBoundary(() => {
    const ownedEntry = parseResolvedCountryEntry(ownData(entry));
    const capturedIntegrity = captureIntegrity(integrity);
    return hashOwned(ownedEntry, capturedIntegrity);
  });
}

export function createPreCityBranchCommit(
  input: CreatePreCityBranchCommitInput,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit {
  return atBoundary(() => {
    const owned = exactRecord(ownData(input), ["source", "createdAt"]);
    const source = parsePreCitySource(owned.source);
    const createdAt = instant(owned.createdAt);
    const capturedIntegrity = captureIntegrity(integrity);
    const payload: Omit<PreCityBranchCommit, "id"> = {
      schemaVersion: "pre-city-branch@1",
      profileSnapshotId: source.profileSnapshotId,
      preferenceProfileSnapshotId: source.preferenceProfileSnapshotId,
      resolvedCountryShortlistRevisionId: source.resolvedCountryShortlistRevisionId,
      countryCode: source.resolvedCountryEntry.countryCode,
      resolvedCountryEntryDigest: hashOwned(source.resolvedCountryEntry, capturedIntegrity),
      createdAt,
    };
    return deepFreeze({
      id: `pre-city-branch:${hashOwned(payload, capturedIntegrity)}`,
      ...payload,
    });
  });
}

export function reconstructPreCityBranchCommit(
  value: unknown,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit {
  return atBoundary(() => {
    const commit = parsePreCityCommit(ownData(value));
    const capturedIntegrity = captureIntegrity(integrity);
    return deepFreeze(verifyPreCityCommit(commit, capturedIntegrity));
  });
}

export function replayPreCityBranchCommit(
  value: unknown,
  source: PreCityBranchSourceProjection,
  integrity: CityDecisionIntegrity,
): PreCityBranchCommit {
  return atBoundary(() => {
    const commit = parsePreCityCommit(ownData(value));
    const ownedSource = parsePreCitySource(ownData(source));
    const capturedIntegrity = captureIntegrity(integrity);
    verifyPreCityCommit(commit, capturedIntegrity);
    const expectedDigest = hashOwned(ownedSource.resolvedCountryEntry, capturedIntegrity);
    if (commit.profileSnapshotId !== ownedSource.profileSnapshotId ||
      commit.preferenceProfileSnapshotId !== ownedSource.preferenceProfileSnapshotId ||
      commit.resolvedCountryShortlistRevisionId !==
        ownedSource.resolvedCountryShortlistRevisionId ||
      commit.countryCode !== ownedSource.resolvedCountryEntry.countryCode ||
      commit.resolvedCountryEntryDigest !== expectedDigest) {
      mismatch();
    }
    return deepFreeze(commit);
  });
}

export function createCityBranchCommit(
  selection: CityBranchSelectionProjection,
  parent: PreCityBranchCommit,
  integrity: CityDecisionIntegrity,
): CityBranchCommit {
  return atBoundary(() => {
    const ownedSelection = parseBranchSelection(ownData(selection));
    const ownedParent = parsePreCityCommit(ownData(parent));
    const capturedIntegrity = captureIntegrity(integrity);
    if (ownedSelection.preCityBranchCommitId !== ownedParent.id ||
      ownedSelection.countryCode !== ownedParent.countryCode) {
      mismatch();
    }
    verifyPreCityCommit(ownedParent, capturedIntegrity);
    const payload: Omit<CityBranchCommit, "id"> = {
      schemaVersion: "city-branch@1",
      parentId: ownedParent.id,
      forkedFrom: ownedParent.id,
      citySelectionSnapshotId: ownedSelection.citySelectionSnapshotId,
      cityId: ownedSelection.cityId,
      countryCode: ownedSelection.countryCode,
      createdAt: ownedSelection.createdAt,
    };
    return deepFreeze({
      id: `city-branch:${hashOwned(payload, capturedIntegrity)}`,
      ...payload,
    });
  });
}

export function replayCityBranchCommit(
  value: unknown,
  selection: CityBranchSelectionProjection,
  parent: PreCityBranchCommit,
  integrity: CityDecisionIntegrity,
): CityBranchCommit {
  return atBoundary(() => {
    const commit = parseCityBranchCommit(ownData(value));
    const ownedSelection = parseBranchSelection(ownData(selection));
    const ownedParent = parsePreCityCommit(ownData(parent));
    const capturedIntegrity = captureIntegrity(integrity);
    requireBranchBindings(commit, ownedSelection, ownedParent);
    verifyPreCityCommit(ownedParent, capturedIntegrity);
    if (commit.id !== `city-branch:${hashOwned(cityBranchPayload(commit), capturedIntegrity)}`) {
      mismatch();
    }
    return deepFreeze(commit);
  });
}
