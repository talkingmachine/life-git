import {
  CITY_CRITERION_IDS,
  type CityCriterionId,
  type CityUnknownReason,
  type CityVerifiedFactBasis,
} from "../decision/city-criteria";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CityKnowledgeRankingProjection } from "../decision/city-ranker";
import {
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
  type SloveniaCityFactSourceId,
} from "./city-evidence";
import type { InstalledCityPackageExactKey } from "./city-package";

export type CityFactOutcome =
  | { readonly kind: "verified"; readonly basis: CityVerifiedFactBasis }
  | { readonly kind: "unknown"; readonly reason: CityUnknownReason };

export interface CityKnowledgeEvidenceView {
  readonly snapshot: {
    readonly id: string;
    readonly cityId: string;
    readonly countryCode: string;
    readonly packageId: string;
    readonly packageSchemaVersion: string;
    readonly catalogRevisionId: string;
    readonly evidenceRulesVersion: string;
    readonly completedAt: string;
  };
  readonly genericEvidence: {
    readonly snapshot: {
      readonly id: string;
      readonly coverage: Readonly<Record<string, "verified" | "unavailable">>;
      readonly claims: readonly {
        readonly sourceId: string;
        readonly criterionId: CityCriterionId;
        readonly definitionId: string;
        readonly scope: string;
        readonly officialAreaId: string;
        readonly geoScope: string;
        readonly unit: string;
        readonly denominator: string;
        readonly freshnessPolicyVersion: string;
        readonly sourcePeriod: string;
        readonly value: CityVerifiedFactBasis;
        readonly anchor: {
          readonly artifactId: string;
          readonly locator: string;
          readonly excerptSha256: string;
        };
      }[];
      readonly blockers: readonly {
        readonly sourceId: string;
        readonly kind: string;
        readonly navigationUrl: string;
        readonly resolvedUrl?: string;
        readonly artifactIds: readonly string[];
      }[];
    };
    readonly manifest: {
      readonly entries: readonly {
        readonly sourceId: string;
        readonly navigationUrl: string;
        readonly resolvedEvidenceUrl: string;
        readonly artifactIds: readonly string[];
      }[];
      readonly artifacts: readonly {
        readonly artifactId: string;
        readonly sourceId: string;
      }[];
    };
    readonly entries: readonly {
      readonly sourceId: string;
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
      readonly artifacts: readonly {
        readonly artifactId: string;
        readonly sourceId: string;
      }[];
    }[];
  };
}

export interface CityKnowledgeFactContract<
  S extends SloveniaCityFactSourceId = SloveniaCityFactSourceId,
> {
  readonly sourceId: S;
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly scope: string;
  readonly geoScope: string;
  readonly officialAreaId: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
}

export type CityKnowledgeFactContractTuple = readonly [
  CityKnowledgeFactContract<"si-city-safety">,
  CityKnowledgeFactContract<"si-city-long-term-rent">,
  CityKnowledgeFactContract<"si-city-urban-transit">,
  CityKnowledgeFactContract<"si-city-fixed-broadband">,
];

export type CityFactEvidenceReference =
  | {
      readonly kind: "claim";
      readonly sourceId: string;
      readonly artifactId: string;
      readonly locator: string;
      readonly excerptHash: string;
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
    }
  | {
      readonly kind: "blocker";
      readonly sourceId: string;
      readonly blocker: CityUnknownReason;
      readonly artifactIds: readonly string[];
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl?: string;
    };

export interface CityKnowledgeFact {
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly geoScope: { readonly kind: string; readonly officialAreaId: string };
  readonly referencePeriod: string | null;
  readonly freshnessBasis: { readonly policyVersion: string };
  readonly unit: string;
  readonly denominator: string;
  readonly outcome: CityFactOutcome;
  readonly evidenceRefs: readonly CityFactEvidenceReference[];
}

export interface BuildCityKnowledgeInput {
  readonly packageKey: InstalledCityPackageExactKey;
  readonly evidence: CityKnowledgeEvidenceView;
  readonly factContracts: CityKnowledgeFactContractTuple;
  readonly createdAt: string;
  readonly predecessor?: CityKnowledgeRevision;
}

export interface ReconstructCityKnowledgeInput {
  readonly revision: CityKnowledgeRevision;
  readonly packageKey: InstalledCityPackageExactKey;
  readonly evidence: CityKnowledgeEvidenceView;
  readonly factContracts: CityKnowledgeFactContractTuple;
  readonly predecessor?: CityKnowledgeRevision;
}

export interface CityKnowledgeRevision {
  readonly schemaVersion: "city-knowledge@1";
  readonly id: string;
  readonly cityId: string;
  readonly countryCode: string;
  readonly packageId: string;
  readonly packageSchemaVersion: string;
  readonly rulesVersion: string;
  readonly predecessorRevisionId?: string;
  readonly evidenceSnapshotId: string;
  readonly facts: readonly [CityKnowledgeFact, CityKnowledgeFact, CityKnowledgeFact, CityKnowledgeFact];
  readonly lastCheckedAt: string;
  readonly knowledgeUpdatedAt: string;
  readonly createdAt: string;
}

type Failure = () => never;

interface EvidenceClaimProjection {
  readonly sourceId: SloveniaCityFactSourceId;
  readonly criterionId: CityCriterionId;
  readonly definitionId: string;
  readonly scope: string;
  readonly officialAreaId: string;
  readonly geoScope: string;
  readonly unit: string;
  readonly denominator: string;
  readonly freshnessPolicyVersion: string;
  readonly sourcePeriod: string;
  readonly value: CityVerifiedFactBasis;
  readonly anchor: {
    readonly artifactId: string;
    readonly locator: string;
    readonly excerptSha256: string;
  };
}

interface EvidenceBlockerProjection {
  readonly sourceId: SloveniaCityFactSourceId;
  readonly kind: string;
  readonly navigationUrl: string;
  readonly resolvedUrl?: string;
  readonly artifactIds: readonly string[];
}

interface EvidenceEntryProjection {
  readonly sourceId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifactIds: readonly string[];
}

interface CapturedEntryProjection {
  readonly sourceId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifacts: readonly ArtifactProjection[];
}

interface ArtifactProjection {
  readonly artifactId: string;
  readonly sourceId: string;
}

interface EvidenceProjection {
  readonly snapshot: CityKnowledgeEvidenceView["snapshot"];
  readonly genericEvidence: {
    readonly snapshot: {
      readonly id: string;
      readonly coverage: Readonly<Record<SloveniaCityFactSourceId, "verified" | "unavailable">>;
      readonly claims: readonly EvidenceClaimProjection[];
      readonly blockers: readonly EvidenceBlockerProjection[];
    };
    readonly manifest: {
      readonly entries: readonly EvidenceEntryProjection[];
      readonly artifacts: readonly ArtifactProjection[];
    };
    readonly entries: readonly CapturedEntryProjection[];
  };
}

interface BuildProjection {
  readonly packageKey: InstalledCityPackageExactKey;
  readonly evidence: EvidenceProjection;
  readonly factContracts: CityKnowledgeFactContractTuple;
  readonly createdAt: string;
  readonly predecessor?: CityKnowledgeRevision;
}

const PACKAGE_KEY_KEYS = [
  "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId", "evidenceRulesVersion",
] as const;
const CONTRACT_KEYS = [
  "sourceId", "criterionId", "definitionId", "scope", "geoScope", "officialAreaId", "unit",
  "denominator", "freshnessPolicyVersion",
] as const;
const REVISION_KEYS = [
  "schemaVersion", "id", "cityId", "countryCode", "packageId", "packageSchemaVersion", "rulesVersion",
  "evidenceSnapshotId", "facts", "lastCheckedAt", "knowledgeUpdatedAt", "createdAt",
] as const;
const FACT_KEYS = [
  "criterionId", "definitionId", "geoScope", "referencePeriod", "freshnessBasis", "unit", "denominator",
  "outcome", "evidenceRefs",
] as const;
const UNKNOWN_REASONS = [
  "not_found", "stale", "conflict", "not_comparable", "source_unavailable",
] as const satisfies readonly CityUnknownReason[];

function invalidInput(): never {
  throw new Error("invalid_city_knowledge_input");
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function ownData(record: Record<string, unknown>, key: string, fail: Failure): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) fail();
  return descriptor.value;
}

function exactRecord(value: unknown, keys: readonly string[], fail: Failure): Record<string, unknown> {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) fail();
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (!sameStrings(actual, expected)) fail();
  for (const key of keys) ownData(value, key, fail);
  return value;
}

function selectedRecord(value: unknown, keys: readonly string[], fail: Failure): Record<string, unknown> {
  if (!isPlainRecord(value)) fail();
  for (const key of keys) ownData(value, key, fail);
  return value;
}

function denseArray(value: unknown, fail: Failure): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) fail();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
    Object.getOwnPropertyNames(value).length !== lengthDescriptor.value + 1) fail();
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) fail();
  }
  return value;
}

function arrayItem(values: readonly unknown[], index: number, fail: Failure): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) fail();
  return descriptor.value;
}

function canonicalText(value: unknown, fail: Failure): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\u0000-\u001f]/.test(value)) {
    fail();
  }
  return value;
}

function canonicalIdentifier(value: unknown, fail: Failure): string {
  const text = canonicalText(value, fail);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(text)) fail();
  return text;
}

function countryCode(value: unknown, fail: Failure): string {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) fail();
  return value;
}

function canonicalInstant(value: unknown, fail: Failure): string {
  if (typeof value !== "string") fail();
  try {
    if (new Date(value).toISOString() !== value) fail();
  } catch {
    fail();
  }
  return value;
}

function canonicalHttpsUrl(value: unknown, fail: Failure): string {
  const text = canonicalText(value, fail);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.href !== text) fail();
  } catch {
    fail();
  }
  return text;
}

function sha256(value: unknown, fail: Failure): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}

function sourceId(value: unknown, fail: Failure): SloveniaCityFactSourceId {
  if (typeof value !== "string" || !SLOVENIA_CITY_FACT_SOURCE_IDS.includes(value as SloveniaCityFactSourceId)) {
    fail();
  }
  return value as SloveniaCityFactSourceId;
}

function criterionId(value: unknown, fail: Failure): CityCriterionId {
  if (typeof value !== "string" || !CITY_CRITERION_IDS.includes(value as CityCriterionId)) fail();
  return value as CityCriterionId;
}

function stringArray(value: unknown, fail: Failure): readonly string[] {
  const values = denseArray(value, fail);
  const copied = values.map((_, index) => canonicalIdentifier(arrayItem(values, index, fail), fail));
  if (new Set(copied).size !== copied.length) fail();
  return copied;
}

function snapshotPackageKey(value: unknown, fail: Failure): InstalledCityPackageExactKey {
  const record = exactRecord(value, PACKAGE_KEY_KEYS, fail);
  return {
    countryCode: countryCode(ownData(record, "countryCode", fail), fail),
    packageId: canonicalIdentifier(ownData(record, "packageId", fail), fail),
    packageSchemaVersion: canonicalIdentifier(ownData(record, "packageSchemaVersion", fail), fail),
    catalogRevisionId: canonicalIdentifier(ownData(record, "catalogRevisionId", fail), fail),
    evidenceRulesVersion: canonicalIdentifier(ownData(record, "evidenceRulesVersion", fail), fail),
  };
}

function snapshotContracts(value: unknown, fail: Failure): CityKnowledgeFactContractTuple {
  const tuple = denseArray(value, fail);
  if (tuple.length !== SLOVENIA_CITY_FACT_SOURCE_IDS.length) fail();
  const contracts = tuple.map((_, index) => {
    const record = exactRecord(arrayItem(tuple, index, fail), CONTRACT_KEYS, fail);
    const contract = {
      sourceId: sourceId(ownData(record, "sourceId", fail), fail),
      criterionId: criterionId(ownData(record, "criterionId", fail), fail),
      definitionId: canonicalIdentifier(ownData(record, "definitionId", fail), fail),
      scope: canonicalText(ownData(record, "scope", fail), fail),
      geoScope: canonicalText(ownData(record, "geoScope", fail), fail),
      officialAreaId: canonicalText(ownData(record, "officialAreaId", fail), fail),
      unit: canonicalText(ownData(record, "unit", fail), fail),
      denominator: canonicalText(ownData(record, "denominator", fail), fail),
      freshnessPolicyVersion: canonicalIdentifier(ownData(record, "freshnessPolicyVersion", fail), fail),
    };
    if (contract.sourceId !== SLOVENIA_CITY_FACT_SOURCE_IDS[index] ||
      contract.criterionId !== CITY_CRITERION_IDS[index]) fail();
    return contract;
  });
  const safety = contracts[0]!;
  if (safety.sourceId !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.sourceId ||
    safety.criterionId !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.criterionId ||
    safety.definitionId !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.definitionId ||
    safety.geoScope !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.geoScope ||
    safety.unit !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.unit ||
    safety.denominator !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.denominator ||
    safety.freshnessPolicyVersion !== SLOVENIA_CITY_SAFETY_FACT_CONTRACT.freshnessPolicyVersion) fail();
  return contracts as unknown as CityKnowledgeFactContractTuple;
}

function snapshotBasis(value: unknown, fail: Failure): CityVerifiedFactBasis {
  const base = selectedRecord(value, ["kind"], fail);
  const kind = ownData(base, "kind", fail);
  if (kind === "canonical_scalar") {
    const scalar = exactRecord(value, ["kind", "value"], fail);
    return { kind, value: canonicalText(ownData(scalar, "value", fail), fail) };
  }
  if (kind === "municipal_safety") {
    const safety = exactRecord(value, ["kind", "quantity"], fail);
    const quantity = exactRecord(ownData(safety, "quantity", fail), [
      "offenceCount", "population", "rateBasis",
    ], fail);
    const offenceCount = canonicalText(ownData(quantity, "offenceCount", fail), fail);
    const population = canonicalText(ownData(quantity, "population", fail), fail);
    if (!/^(0|[1-9][0-9]*)$/.test(offenceCount) || !/^[1-9][0-9]*$/.test(population) ||
      ownData(quantity, "rateBasis", fail) !== "offences_per_100000_residents") fail();
    return {
      kind,
      quantity: { offenceCount, population, rateBasis: "offences_per_100000_residents" },
    };
  }
  fail();
}

function snapshotClaim(value: unknown, fail: Failure): EvidenceClaimProjection {
  const record = selectedRecord(value, [
    "sourceId", "criterionId", "definitionId", "scope", "officialAreaId", "geoScope", "unit",
    "denominator", "freshnessPolicyVersion", "sourcePeriod", "value", "anchor",
  ], fail);
  const anchor = selectedRecord(ownData(record, "anchor", fail), [
    "artifactId", "locator", "excerptSha256",
  ], fail);
  return {
    sourceId: sourceId(ownData(record, "sourceId", fail), fail),
    criterionId: criterionId(ownData(record, "criterionId", fail), fail),
    definitionId: canonicalIdentifier(ownData(record, "definitionId", fail), fail),
    scope: canonicalText(ownData(record, "scope", fail), fail),
    officialAreaId: canonicalText(ownData(record, "officialAreaId", fail), fail),
    geoScope: canonicalText(ownData(record, "geoScope", fail), fail),
    unit: canonicalText(ownData(record, "unit", fail), fail),
    denominator: canonicalText(ownData(record, "denominator", fail), fail),
    freshnessPolicyVersion: canonicalIdentifier(ownData(record, "freshnessPolicyVersion", fail), fail),
    sourcePeriod: canonicalText(ownData(record, "sourcePeriod", fail), fail),
    value: snapshotBasis(ownData(record, "value", fail), fail),
    anchor: {
      artifactId: canonicalIdentifier(ownData(anchor, "artifactId", fail), fail),
      locator: canonicalText(ownData(anchor, "locator", fail), fail),
      excerptSha256: sha256(ownData(anchor, "excerptSha256", fail), fail),
    },
  };
}

function snapshotBlocker(value: unknown, fail: Failure): EvidenceBlockerProjection {
  const record = selectedRecord(value, ["sourceId", "kind", "navigationUrl", "artifactIds"], fail);
  const resolvedDescriptor = Object.getOwnPropertyDescriptor(record, "resolvedUrl");
  if (resolvedDescriptor !== undefined && (!("value" in resolvedDescriptor) || !resolvedDescriptor.enumerable)) fail();
  const resolvedUrl = resolvedDescriptor === undefined
    ? undefined
    : canonicalHttpsUrl(resolvedDescriptor.value, fail);
  return {
    sourceId: sourceId(ownData(record, "sourceId", fail), fail),
    kind: canonicalIdentifier(ownData(record, "kind", fail), fail),
    navigationUrl: canonicalHttpsUrl(ownData(record, "navigationUrl", fail), fail),
    ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
    artifactIds: stringArray(ownData(record, "artifactIds", fail), fail),
  };
}

function snapshotEntry(value: unknown, fail: Failure): EvidenceEntryProjection {
  const record = selectedRecord(value, [
    "sourceId", "navigationUrl", "resolvedEvidenceUrl", "artifactIds",
  ], fail);
  return {
    sourceId: sourceId(ownData(record, "sourceId", fail), fail),
    navigationUrl: canonicalHttpsUrl(ownData(record, "navigationUrl", fail), fail),
    resolvedEvidenceUrl: canonicalHttpsUrl(ownData(record, "resolvedEvidenceUrl", fail), fail),
    artifactIds: stringArray(ownData(record, "artifactIds", fail), fail),
  };
}

function snapshotArtifact(value: unknown, fail: Failure): ArtifactProjection {
  const record = selectedRecord(value, ["artifactId", "sourceId"], fail);
  return {
    artifactId: canonicalIdentifier(ownData(record, "artifactId", fail), fail),
    sourceId: sourceId(ownData(record, "sourceId", fail), fail),
  };
}

function snapshotCapturedEntry(value: unknown, fail: Failure): CapturedEntryProjection {
  const record = selectedRecord(value, [
    "sourceId", "navigationUrl", "resolvedEvidenceUrl", "artifacts",
  ], fail);
  const artifacts = denseArray(ownData(record, "artifacts", fail), fail).map(
    (items, index, values) => snapshotArtifact(arrayItem(values, index, fail), fail),
  );
  return {
    sourceId: sourceId(ownData(record, "sourceId", fail), fail),
    navigationUrl: canonicalHttpsUrl(ownData(record, "navigationUrl", fail), fail),
    resolvedEvidenceUrl: canonicalHttpsUrl(ownData(record, "resolvedEvidenceUrl", fail), fail),
    artifacts,
  };
}

function snapshotEvidence(value: unknown, fail: Failure): EvidenceProjection {
  const evidence = selectedRecord(value, ["snapshot", "genericEvidence"], fail);
  const snapshot = selectedRecord(ownData(evidence, "snapshot", fail), [
    "id", "cityId", "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
    "evidenceRulesVersion", "completedAt",
  ], fail);
  const genericEvidence = selectedRecord(ownData(evidence, "genericEvidence", fail), [
    "snapshot", "manifest", "entries",
  ], fail);
  const genericSnapshot = selectedRecord(ownData(genericEvidence, "snapshot", fail), [
    "id", "coverage", "claims", "blockers",
  ], fail);
  const coverageRecord = exactRecord(
    ownData(genericSnapshot, "coverage", fail),
    SLOVENIA_CITY_FACT_SOURCE_IDS,
    fail,
  );
  const coverage = Object.fromEntries(SLOVENIA_CITY_FACT_SOURCE_IDS.map((source) => {
    const state = ownData(coverageRecord, source, fail);
    if (state !== "verified" && state !== "unavailable") fail();
    return [source, state];
  })) as Record<SloveniaCityFactSourceId, "verified" | "unavailable">;
  const claimsArray = denseArray(ownData(genericSnapshot, "claims", fail), fail);
  const blockersArray = denseArray(ownData(genericSnapshot, "blockers", fail), fail);
  const manifest = selectedRecord(ownData(genericEvidence, "manifest", fail), ["entries", "artifacts"], fail);
  const manifestEntriesArray = denseArray(ownData(manifest, "entries", fail), fail);
  const manifestArtifactsArray = denseArray(ownData(manifest, "artifacts", fail), fail);
  const capturedEntriesArray = denseArray(ownData(genericEvidence, "entries", fail), fail);

  return {
    snapshot: {
      id: canonicalIdentifier(ownData(snapshot, "id", fail), fail),
      cityId: canonicalIdentifier(ownData(snapshot, "cityId", fail), fail),
      countryCode: countryCode(ownData(snapshot, "countryCode", fail), fail),
      packageId: canonicalIdentifier(ownData(snapshot, "packageId", fail), fail),
      packageSchemaVersion: canonicalIdentifier(ownData(snapshot, "packageSchemaVersion", fail), fail),
      catalogRevisionId: canonicalIdentifier(ownData(snapshot, "catalogRevisionId", fail), fail),
      evidenceRulesVersion: canonicalIdentifier(ownData(snapshot, "evidenceRulesVersion", fail), fail),
      completedAt: canonicalInstant(ownData(snapshot, "completedAt", fail), fail),
    },
    genericEvidence: {
      snapshot: {
        id: canonicalIdentifier(ownData(genericSnapshot, "id", fail), fail),
        coverage,
        claims: claimsArray.map((_, index) => snapshotClaim(arrayItem(claimsArray, index, fail), fail)),
        blockers: blockersArray.map((_, index) => snapshotBlocker(arrayItem(blockersArray, index, fail), fail)),
      },
      manifest: {
        entries: manifestEntriesArray.map((_, index) => snapshotEntry(
          arrayItem(manifestEntriesArray, index, fail), fail,
        )),
        artifacts: manifestArtifactsArray.map((_, index) => snapshotArtifact(
          arrayItem(manifestArtifactsArray, index, fail), fail,
        )),
      },
      entries: capturedEntriesArray.map((_, index) => snapshotCapturedEntry(
        arrayItem(capturedEntriesArray, index, fail), fail,
      )),
    },
  };
}

function snapshotReference(value: unknown, fail: Failure): CityFactEvidenceReference {
  const base = selectedRecord(value, ["kind", "sourceId"], fail);
  const kind = ownData(base, "kind", fail);
  if (kind === "claim") {
    const record = exactRecord(value, [
      "kind", "sourceId", "artifactId", "locator", "excerptHash", "navigationUrl", "resolvedEvidenceUrl",
    ], fail);
    return {
      kind,
      sourceId: sourceId(ownData(record, "sourceId", fail), fail),
      artifactId: canonicalIdentifier(ownData(record, "artifactId", fail), fail),
      locator: canonicalText(ownData(record, "locator", fail), fail),
      excerptHash: sha256(ownData(record, "excerptHash", fail), fail),
      navigationUrl: canonicalHttpsUrl(ownData(record, "navigationUrl", fail), fail),
      resolvedEvidenceUrl: canonicalHttpsUrl(ownData(record, "resolvedEvidenceUrl", fail), fail),
    };
  }
  if (kind === "blocker") {
    const hasResolved = Object.hasOwn(value as object, "resolvedEvidenceUrl");
    const keys = hasResolved
      ? ["kind", "sourceId", "blocker", "artifactIds", "navigationUrl", "resolvedEvidenceUrl"]
      : ["kind", "sourceId", "blocker", "artifactIds", "navigationUrl"];
    const record = exactRecord(value, keys, fail);
    const blocker = ownData(record, "blocker", fail);
    if (!UNKNOWN_REASONS.includes(blocker as CityUnknownReason)) fail();
    return {
      kind,
      sourceId: sourceId(ownData(record, "sourceId", fail), fail),
      blocker: blocker as CityUnknownReason,
      artifactIds: stringArray(ownData(record, "artifactIds", fail), fail),
      navigationUrl: canonicalHttpsUrl(ownData(record, "navigationUrl", fail), fail),
      ...(hasResolved
        ? { resolvedEvidenceUrl: canonicalHttpsUrl(ownData(record, "resolvedEvidenceUrl", fail), fail) }
        : {}),
    };
  }
  fail();
}

function snapshotOutcome(value: unknown, fail: Failure): CityFactOutcome {
  const base = selectedRecord(value, ["kind"], fail);
  const kind = ownData(base, "kind", fail);
  if (kind === "verified") {
    const record = exactRecord(value, ["kind", "basis"], fail);
    return { kind, basis: snapshotBasis(ownData(record, "basis", fail), fail) };
  }
  if (kind === "unknown") {
    const record = exactRecord(value, ["kind", "reason"], fail);
    const reason = ownData(record, "reason", fail);
    if (!UNKNOWN_REASONS.includes(reason as CityUnknownReason)) fail();
    return { kind, reason: reason as CityUnknownReason };
  }
  fail();
}

function snapshotFact(value: unknown, index: number, fail: Failure): CityKnowledgeFact {
  const record = exactRecord(value, FACT_KEYS, fail);
  const geoScope = exactRecord(ownData(record, "geoScope", fail), ["kind", "officialAreaId"], fail);
  const freshness = exactRecord(ownData(record, "freshnessBasis", fail), ["policyVersion"], fail);
  const references = denseArray(ownData(record, "evidenceRefs", fail), fail);
  if (references.length === 0) fail();
  const criterion = criterionId(ownData(record, "criterionId", fail), fail);
  if (criterion !== CITY_CRITERION_IDS[index]) fail();
  const period = ownData(record, "referencePeriod", fail);
  if (period !== null && (typeof period !== "string" || period.length === 0 || period.trim() !== period)) fail();
  return {
    criterionId: criterion,
    definitionId: canonicalIdentifier(ownData(record, "definitionId", fail), fail),
    geoScope: {
      kind: canonicalText(ownData(geoScope, "kind", fail), fail),
      officialAreaId: canonicalText(ownData(geoScope, "officialAreaId", fail), fail),
    },
    referencePeriod: period,
    freshnessBasis: {
      policyVersion: canonicalIdentifier(ownData(freshness, "policyVersion", fail), fail),
    },
    unit: canonicalText(ownData(record, "unit", fail), fail),
    denominator: canonicalText(ownData(record, "denominator", fail), fail),
    outcome: snapshotOutcome(ownData(record, "outcome", fail), fail),
    evidenceRefs: references.map((_, referenceIndex) => snapshotReference(
      arrayItem(references, referenceIndex, fail), fail,
    )),
  };
}

function snapshotRevision(value: unknown, fail: Failure): CityKnowledgeRevision {
  if (!isPlainRecord(value)) fail();
  const hasPredecessor = Object.hasOwn(value, "predecessorRevisionId");
  const keys = hasPredecessor ? [...REVISION_KEYS, "predecessorRevisionId"] : REVISION_KEYS;
  const record = exactRecord(value, keys, fail);
  const facts = denseArray(ownData(record, "facts", fail), fail);
  if (facts.length !== CITY_CRITERION_IDS.length) fail();
  const revision: CityKnowledgeRevision = {
    schemaVersion: ownData(record, "schemaVersion", fail) === "city-knowledge@1"
      ? "city-knowledge@1"
      : fail(),
    id: canonicalText(ownData(record, "id", fail), fail),
    cityId: canonicalIdentifier(ownData(record, "cityId", fail), fail),
    countryCode: countryCode(ownData(record, "countryCode", fail), fail),
    packageId: canonicalIdentifier(ownData(record, "packageId", fail), fail),
    packageSchemaVersion: canonicalIdentifier(ownData(record, "packageSchemaVersion", fail), fail),
    rulesVersion: canonicalIdentifier(ownData(record, "rulesVersion", fail), fail),
    ...(hasPredecessor
      ? { predecessorRevisionId: canonicalText(ownData(record, "predecessorRevisionId", fail), fail) }
      : {}),
    evidenceSnapshotId: canonicalIdentifier(ownData(record, "evidenceSnapshotId", fail), fail),
    facts: facts.map((_, index) => snapshotFact(arrayItem(facts, index, fail), index, fail)) as unknown as
      CityKnowledgeRevision["facts"],
    lastCheckedAt: canonicalInstant(ownData(record, "lastCheckedAt", fail), fail),
    knowledgeUpdatedAt: canonicalInstant(ownData(record, "knowledgeUpdatedAt", fail), fail),
    createdAt: canonicalInstant(ownData(record, "createdAt", fail), fail),
  };
  if (revision.knowledgeUpdatedAt > revision.lastCheckedAt || revision.lastCheckedAt > revision.createdAt) fail();
  return revision;
}

function snapshotBuildInput(value: unknown): BuildProjection {
  if (!isPlainRecord(value)) invalidInput();
  const hasPredecessor = Object.hasOwn(value, "predecessor");
  const keys = hasPredecessor
    ? ["packageKey", "evidence", "factContracts", "createdAt", "predecessor"]
    : ["packageKey", "evidence", "factContracts", "createdAt"];
  const record = exactRecord(value, keys, invalidInput);
  const packageKey = snapshotPackageKey(ownData(record, "packageKey", invalidInput), integrityMismatch);
  const evidence = snapshotEvidence(ownData(record, "evidence", invalidInput), integrityMismatch);
  const factContracts = snapshotContracts(ownData(record, "factContracts", invalidInput), invalidInput);
  const createdAt = canonicalInstant(ownData(record, "createdAt", invalidInput), invalidInput);
  const predecessor = hasPredecessor
    ? snapshotRevision(ownData(record, "predecessor", invalidInput), invalidInput)
    : undefined;
  return { packageKey, evidence, factContracts, createdAt, ...(predecessor === undefined ? {} : { predecessor }) };
}

function assertKeyEvidenceBinding(input: BuildProjection, fail: Failure): void {
  const { packageKey: key, evidence } = input;
  const snapshot = evidence.snapshot;
  if (snapshot.countryCode !== key.countryCode || snapshot.packageId !== key.packageId ||
    snapshot.packageSchemaVersion !== key.packageSchemaVersion ||
    snapshot.catalogRevisionId !== key.catalogRevisionId ||
    snapshot.evidenceRulesVersion !== key.evidenceRulesVersion ||
    evidence.genericEvidence.snapshot.id !== snapshot.id) fail();
}

function evidenceEntriesBySource(evidence: EvidenceProjection, fail: Failure): ReadonlyMap<
  SloveniaCityFactSourceId,
  { readonly manifest: EvidenceEntryProjection; readonly captured: CapturedEntryProjection }
> {
  const manifestEntries = evidence.genericEvidence.manifest.entries;
  const capturedEntries = evidence.genericEvidence.entries;
  if (manifestEntries.length !== SLOVENIA_CITY_FACT_SOURCE_IDS.length ||
    capturedEntries.length !== SLOVENIA_CITY_FACT_SOURCE_IDS.length) fail();
  const manifestArtifacts = evidence.genericEvidence.manifest.artifacts;
  const allArtifactIds = manifestArtifacts.map(({ artifactId }) => artifactId);
  if (new Set(allArtifactIds).size !== allArtifactIds.length) fail();

  const entries = new Map<SloveniaCityFactSourceId, {
    readonly manifest: EvidenceEntryProjection;
    readonly captured: CapturedEntryProjection;
  }>();
  for (let index = 0; index < SLOVENIA_CITY_FACT_SOURCE_IDS.length; index += 1) {
    const source = SLOVENIA_CITY_FACT_SOURCE_IDS[index]!;
    const manifest = manifestEntries[index];
    const captured = capturedEntries[index];
    if (manifest?.sourceId !== source || captured?.sourceId !== source ||
      manifest.navigationUrl !== captured.navigationUrl ||
      manifest.resolvedEvidenceUrl !== captured.resolvedEvidenceUrl) fail();
    const capturedIds = captured.artifacts.map((artifact) => {
      if (artifact.sourceId !== source) fail();
      return artifact.artifactId;
    });
    const sourceManifestArtifacts = manifestArtifacts.filter(({ sourceId: owner }) => owner === source);
    const sourceManifestIds = sourceManifestArtifacts.map(({ artifactId }) => artifactId);
    if (!sameStrings(manifest.artifactIds, capturedIds) ||
      !sameStrings(manifest.artifactIds, sourceManifestIds)) fail();
    entries.set(source, { manifest, captured });
  }
  const expectedGlobalIds = manifestEntries.flatMap(({ artifactIds }) => artifactIds);
  if (!sameStrings(expectedGlobalIds, allArtifactIds)) fail();
  return entries;
}

function sameContractClaim(contract: CityKnowledgeFactContract, claim: EvidenceClaimProjection): boolean {
  return contract.sourceId === claim.sourceId && contract.criterionId === claim.criterionId &&
    contract.definitionId === claim.definitionId && contract.scope === claim.scope &&
    contract.officialAreaId === claim.officialAreaId && contract.geoScope === claim.geoScope &&
    contract.unit === claim.unit && contract.denominator === claim.denominator &&
    contract.freshnessPolicyVersion === claim.freshnessPolicyVersion;
}

function factForSource(
  contract: CityKnowledgeFactContract,
  evidence: EvidenceProjection,
  entry: EvidenceEntryProjection,
  fail: Failure,
): CityKnowledgeFact {
  const claims = evidence.genericEvidence.snapshot.claims.filter(({ sourceId: source }) => source === contract.sourceId);
  const blockers = evidence.genericEvidence.snapshot.blockers.filter(({ sourceId: source }) => source === contract.sourceId);
  const coverage = evidence.genericEvidence.snapshot.coverage[contract.sourceId];
  const sourceArtifactIds = new Set(entry.artifactIds);
  if (coverage === "verified") {
    if (claims.length !== 1 || blockers.length !== 0) fail();
    const claim = claims[0]!;
    if (!sameContractClaim(contract, claim) || !sourceArtifactIds.has(claim.anchor.artifactId) ||
      (contract.sourceId === "si-city-safety" && claim.value.kind !== "municipal_safety") ||
      (contract.sourceId !== "si-city-safety" && claim.value.kind !== "canonical_scalar")) fail();
    return {
      criterionId: contract.criterionId,
      definitionId: contract.definitionId,
      geoScope: { kind: contract.geoScope, officialAreaId: contract.officialAreaId },
      referencePeriod: claim.sourcePeriod,
      freshnessBasis: { policyVersion: contract.freshnessPolicyVersion },
      unit: contract.unit,
      denominator: contract.denominator,
      outcome: { kind: "verified", basis: claim.value },
      evidenceRefs: [{
        kind: "claim",
        sourceId: contract.sourceId,
        artifactId: claim.anchor.artifactId,
        locator: claim.anchor.locator,
        excerptHash: claim.anchor.excerptSha256,
        navigationUrl: entry.navigationUrl,
        resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
      }],
    };
  }
  if (coverage !== "unavailable" || claims.length !== 0 || blockers.length !== 1) fail();
  const blocker = blockers[0]!;
  if (!UNKNOWN_REASONS.includes(blocker.kind as CityUnknownReason) ||
    blocker.navigationUrl !== entry.navigationUrl ||
    (blocker.resolvedUrl !== undefined && blocker.resolvedUrl !== entry.resolvedEvidenceUrl) ||
    blocker.artifactIds.some((artifactId) => !sourceArtifactIds.has(artifactId))) fail();
  const reason = blocker.kind as CityUnknownReason;
  return {
    criterionId: contract.criterionId,
    definitionId: contract.definitionId,
    geoScope: { kind: contract.geoScope, officialAreaId: contract.officialAreaId },
    referencePeriod: null,
    freshnessBasis: { policyVersion: contract.freshnessPolicyVersion },
    unit: contract.unit,
    denominator: contract.denominator,
    outcome: { kind: "unknown", reason },
    evidenceRefs: [{
      kind: "blocker",
      sourceId: contract.sourceId,
      blocker: reason,
      artifactIds: [...blocker.artifactIds],
      navigationUrl: blocker.navigationUrl,
      ...(blocker.resolvedUrl === undefined ? {} : { resolvedEvidenceUrl: blocker.resolvedUrl }),
    }],
  };
}

function buildFacts(input: BuildProjection, fail: Failure): CityKnowledgeRevision["facts"] {
  assertKeyEvidenceBinding(input, fail);
  const bySource = evidenceEntriesBySource(input.evidence, fail);
  const claims = input.evidence.genericEvidence.snapshot.claims;
  const blockers = input.evidence.genericEvidence.snapshot.blockers;
  if (claims.some(({ sourceId: source }) => !SLOVENIA_CITY_FACT_SOURCE_IDS.includes(source)) ||
    blockers.some(({ sourceId: source }) => !SLOVENIA_CITY_FACT_SOURCE_IDS.includes(source))) fail();
  const facts = input.factContracts.map((contract) => {
    const entry = bySource.get(contract.sourceId);
    if (entry === undefined) fail();
    return factForSource(contract, input.evidence, entry.manifest, fail);
  });
  return facts as unknown as CityKnowledgeRevision["facts"];
}

function revisionPayload(revision: CityKnowledgeRevision): Omit<CityKnowledgeRevision, "id"> {
  return {
    schemaVersion: revision.schemaVersion,
    cityId: revision.cityId,
    countryCode: revision.countryCode,
    packageId: revision.packageId,
    packageSchemaVersion: revision.packageSchemaVersion,
    rulesVersion: revision.rulesVersion,
    ...(revision.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: revision.predecessorRevisionId }),
    evidenceSnapshotId: revision.evidenceSnapshotId,
    facts: revision.facts,
    lastCheckedAt: revision.lastCheckedAt,
    knowledgeUpdatedAt: revision.knowledgeUpdatedAt,
    createdAt: revision.createdAt,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function integrityFunctions(integrity: CityDecisionIntegrity, fail: Failure): CityDecisionIntegrity {
  if (!isPlainRecord(integrity)) fail();
  const canonicalDescriptor = Object.getOwnPropertyDescriptor(integrity, "canonical");
  const hashDescriptor = Object.getOwnPropertyDescriptor(integrity, "hash");
  if (canonicalDescriptor === undefined || !("value" in canonicalDescriptor) ||
    typeof canonicalDescriptor.value !== "function" || hashDescriptor === undefined ||
    !("value" in hashDescriptor) || typeof hashDescriptor.value !== "function") fail();
  return { canonical: canonicalDescriptor.value, hash: hashDescriptor.value };
}

function revisionId(
  payload: Omit<CityKnowledgeRevision, "id">,
  integrity: CityDecisionIntegrity,
  fail: Failure,
): string {
  const callbacks = integrityFunctions(integrity, fail);
  try {
    const canonical = callbacks.canonical(deepFreeze(payload));
    if (typeof canonical !== "string") fail();
    const hash = callbacks.hash(canonical);
    if (typeof hash !== "string" || hash.length === 0) fail();
    return `city-knowledge:${hash}`;
  } catch {
    fail();
  }
}

function assertRevisionIntegrity(
  revision: CityKnowledgeRevision,
  integrity: CityDecisionIntegrity,
  fail: Failure,
): void {
  const expectedId = revisionId(revisionPayload(revision), integrity, fail);
  if (revision.id !== expectedId) fail();
}

function semanticFact(fact: CityKnowledgeFact): unknown {
  return {
    criterionId: fact.criterionId,
    definitionId: fact.definitionId,
    geoScope: fact.geoScope,
    referencePeriod: fact.referencePeriod,
    freshnessBasis: fact.freshnessBasis,
    unit: fact.unit,
    denominator: fact.denominator,
    outcome: fact.outcome,
  };
}

function structural(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "b:1" : "b:0";
  if (typeof value === "number" && Number.isFinite(value)) return `n:${value}`;
  if (Array.isArray(value)) return `[${value.map(structural).join(",")}]`;
  if (!isPlainRecord(value)) integrityMismatch();
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${structural(value[key])}`).join(",")}}`;
}

function factsSemanticallyEqual(
  left: CityKnowledgeRevision["facts"],
  right: CityKnowledgeRevision["facts"],
): boolean {
  return structural(left.map(semanticFact)) === structural(right.map(semanticFact));
}

function buildFromProjection(
  input: BuildProjection,
  integrity: CityDecisionIntegrity,
  callerFail: Failure,
  evidenceFail: Failure,
  integrityFail: Failure,
): CityKnowledgeRevision {
  const facts = buildFacts(input, evidenceFail);
  const lastCheckedAt = input.evidence.snapshot.completedAt;
  if (lastCheckedAt > input.createdAt) callerFail();
  let knowledgeUpdatedAt = lastCheckedAt;
  if (input.predecessor !== undefined) {
    assertRevisionIntegrity(input.predecessor, integrity, callerFail);
    if (input.predecessor.cityId !== input.evidence.snapshot.cityId ||
      input.predecessor.countryCode !== input.evidence.snapshot.countryCode ||
      input.predecessor.createdAt >= lastCheckedAt) callerFail();
    if (factsSemanticallyEqual(facts, input.predecessor.facts)) {
      knowledgeUpdatedAt = input.predecessor.knowledgeUpdatedAt;
    }
  }
  const payload = deepFreeze({
    schemaVersion: "city-knowledge@1" as const,
    cityId: input.evidence.snapshot.cityId,
    countryCode: input.packageKey.countryCode,
    packageId: input.packageKey.packageId,
    packageSchemaVersion: input.packageKey.packageSchemaVersion,
    rulesVersion: input.packageKey.evidenceRulesVersion,
    ...(input.predecessor === undefined ? {} : { predecessorRevisionId: input.predecessor.id }),
    evidenceSnapshotId: input.evidence.snapshot.id,
    facts,
    lastCheckedAt,
    knowledgeUpdatedAt,
    createdAt: input.createdAt,
  });
  const id = revisionId(payload, integrity, integrityFail);
  return deepFreeze({ id, ...payload });
}

function normalizedBuildError(error: unknown): never {
  if (error instanceof Error &&
    (error.message === "invalid_city_knowledge_input" || error.message === "integrity_mismatch")) {
    throw error;
  }
  invalidInput();
}

export function buildCityKnowledgeRevision(
  input: BuildCityKnowledgeInput,
  integrity: CityDecisionIntegrity,
): CityKnowledgeRevision {
  try {
    return buildFromProjection(
      snapshotBuildInput(input), integrity, invalidInput, integrityMismatch, integrityMismatch,
    );
  } catch (error) {
    normalizedBuildError(error);
  }
}

function snapshotReconstructInput(value: unknown): {
  readonly revision: CityKnowledgeRevision;
  readonly build: BuildProjection;
} {
  if (!isPlainRecord(value)) integrityMismatch();
  const revisionValue = ownData(value, "revision", integrityMismatch);
  const revision = snapshotRevision(revisionValue, integrityMismatch);
  const hasPredecessor = Object.hasOwn(value, "predecessor");
  const keys = hasPredecessor
    ? ["revision", "packageKey", "evidence", "factContracts", "predecessor"]
    : ["revision", "packageKey", "evidence", "factContracts"];
  const record = exactRecord(value, keys, integrityMismatch);
  if (hasPredecessor !== (revision.predecessorRevisionId !== undefined)) integrityMismatch();
  const predecessor = hasPredecessor
    ? snapshotRevision(ownData(record, "predecessor", integrityMismatch), integrityMismatch)
    : undefined;
  return {
    revision,
    build: {
      packageKey: snapshotPackageKey(ownData(record, "packageKey", integrityMismatch), integrityMismatch),
      evidence: snapshotEvidence(ownData(record, "evidence", integrityMismatch), integrityMismatch),
      factContracts: snapshotContracts(ownData(record, "factContracts", integrityMismatch), integrityMismatch),
      createdAt: revision.createdAt,
      ...(predecessor === undefined ? {} : { predecessor }),
    },
  };
}

export function reconstructCityKnowledgeRevision(
  input: ReconstructCityKnowledgeInput,
  integrity: CityDecisionIntegrity,
): CityKnowledgeRevision {
  try {
    const snapshot = snapshotReconstructInput(input);
    const expected = buildFromProjection(
      snapshot.build, integrity, integrityMismatch, integrityMismatch, integrityMismatch,
    );
    if (structural(expected) !== structural(snapshot.revision)) integrityMismatch();
    return expected;
  } catch {
    integrityMismatch();
  }
}

export function projectCityKnowledgeForRanking(
  revision: CityKnowledgeRevision,
): CityKnowledgeRankingProjection {
  try {
    const snapshot = snapshotRevision(revision, integrityMismatch);
    return deepFreeze({
      cityId: snapshot.cityId,
      knowledgeRevisionId: snapshot.id,
      facts: snapshot.facts.map((fact) => ({
        criterionId: fact.criterionId,
        definitionId: fact.definitionId,
        geoScope: fact.geoScope.kind,
        referencePeriod: fact.referencePeriod,
        freshnessBasis: fact.freshnessBasis.policyVersion,
        unit: fact.unit,
        denominator: fact.denominator,
        outcome: fact.outcome,
      })) as unknown as Exclude<CityKnowledgeRankingProjection, { readonly knowledgeRevisionId: null }>["facts"],
    });
  } catch {
    integrityMismatch();
  }
}
