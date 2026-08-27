import { types } from "node:util";

import {
  CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogProjection,
} from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CapturedEntry, LiveCapturedArtifact } from "../research/contracts";
import { reconstructCitySafetyArtifactBridge } from
  "../research/city-safety-artifact-bridge";
import {
  citySafetyTerminalEntry,
  reconstructCityFixedAttemptLedger,
  reconstructCityFixedSourcePlan,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
  type CityEvidenceClaim,
  type CityEvidenceReplayIntegrity,
  type CityFixedAttemptLedger,
  type CityFixedSourcePlan,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../research/city-evidence";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../research/slovenia-city-plan";
import {
  reconstructCitySafetyAttemptLedger,
  type CitySafetyAttemptLedger,
  type CitySafetyPreviousAcceptedReference,
} from "../research/city-safety-evidence";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type CitySafetySourcePlan,
  type OfficialAuthorityDirectory,
} from "../research/city-safety-source-plan";
import {
  assertSealedEvidenceStructure,
  evidenceArtifactProvenance,
} from "../research/research-plan";
import {
  cityEvidenceContextHash,
  type CityEvidenceContext,
  type CityEvidencePackageReplayPort,
  type CityEvidenceReadPort,
  type CityEvidenceReplayPorts,
  type CityEvidenceSnapshot,
  type CityFixedAttemptLedgerTuple,
  type CityPackageEvidenceReplayContract,
  type VerifiedCityEvidence,
} from "./city-data-contracts";

const INPUT_KEYS = ["evidenceSnapshotId", "cityId", "packageId"] as const;
const PORT_KEYS = ["read", "integrity", "package"] as const;
const READ_KEYS = ["loadVerified", "findVerifiedByCheckRunId"] as const;
const INTEGRITY_KEYS = ["canonical", "hash", "hashBytes"] as const;
const PACKAGE_KEYS = ["loadExactReplayContract"] as const;
const CONTRACT_KEYS = [
  "installedPackageManifest", "definition", "catalogProjection", "fixedPlansByCityId",
  "safetySourcePlan", "officialAuthorityDirectory", "validateValue", "validateSourcePeriod",
] as const;
const SNAPSHOT_KEYS = [
  "schemaVersion", "id", "cityCheckRunId", "frontierRunId", "cityId", "countryCode",
  "packageId", "packageSchemaVersion", "catalogRevisionId", "criteriaSnapshotId",
  "rankingSnapshotId", "definitionIds", "evidenceRulesVersion", "assessmentAt",
  "fixedAttemptLedgers", "safetyAttemptLedger", "contextHash", "completedAt", "payloadHash",
  "hmac",
] as const;
const FIXED_SOURCE_IDS = SLOVENIA_CITY_FACT_SOURCE_IDS.slice(1) as unknown as readonly [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
];
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

type DataRecord = Record<string, unknown>;
type ReplayInput = {
  readonly evidenceSnapshotId: string;
  readonly cityId: string;
  readonly packageId: string;
};

interface CapturedPorts {
  readonly read: CityEvidenceReadPort;
  readonly loadVerified: CityEvidenceReadPort["loadVerified"];
  readonly package: CityEvidencePackageReplayPort;
  readonly loadExactReplayContract: CityEvidencePackageReplayPort["loadExactReplayContract"];
  readonly decisionIntegrity: CityDecisionIntegrity;
  readonly integrity: CityEvidenceReplayIntegrity;
}

interface OwnedNode {
  readonly verified: VerifiedCityEvidence;
  readonly context: CityEvidenceContext;
}

interface VerifiedReplayContract {
  readonly definition: CityPackageEvidenceReplayContract["definition"];
  readonly catalog: CityCatalogProjection;
  readonly fixedPlansByCityId: CityPackageEvidenceReplayContract["fixedPlansByCityId"];
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly validateValue: CityPackageEvidenceReplayContract["validateValue"];
  readonly validateSourcePeriod: CityPackageEvidenceReplayContract["validateSourcePeriod"];
}

interface SemanticReplay {
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
}

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/
    .exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as
    [number, number, number, number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1]! &&
    hour <= 23 && minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
}

function exactDataRecord(value: unknown, keys: readonly string[]): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value)) mismatch();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) mismatch();
  if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const names = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    mismatch();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
      descriptor.value === undefined) mismatch();
  }
  return value as DataRecord;
}

function ownValue<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) mismatch();
      return value;
    }
    if (value === undefined || typeof value !== "object" || types.isProxy(value)) mismatch();
    if (value instanceof Uint8Array) {
      if (Object.getPrototypeOf(value) !== Uint8Array.prototype ||
        Object.getOwnPropertySymbols(value).length !== 0 ||
        typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
        mismatch();
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length || names.some((name, index) => name !== String(index))) {
        mismatch();
      }
      return new Uint8Array(value);
    }
    if (active.has(value)) mismatch();
    active.add(value);
    try {
      if (Object.getOwnPropertySymbols(value).length !== 0) mismatch();
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const names = Object.getOwnPropertyNames(value).sort();
        const expected = [
          ...Array.from({ length: value.length }, (_, index) => String(index)),
          "length",
        ].sort();
        if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
          mismatch();
        }
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
            descriptor.value === undefined) mismatch();
          copy.push(visit(descriptor.value));
        }
        return Object.freeze(copy);
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) mismatch();
      const copy = Object.create(null) as DataRecord;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
          descriptor.value === undefined) mismatch();
        Object.defineProperty(copy, key, {
          value: visit(descriptor.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return Object.freeze(copy);
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function captureFunction<T extends (...args: never[]) => unknown>(
  record: DataRecord,
  key: string,
): T {
  const value = record[key];
  if (typeof value !== "function" || types.isProxy(value)) mismatch();
  return value as T;
}

function ownInput(value: unknown): ReplayInput {
  const record = exactDataRecord(value, INPUT_KEYS);
  const input = Object.freeze({
    evidenceSnapshotId: record.evidenceSnapshotId,
    cityId: record.cityId,
    packageId: record.packageId,
  });
  if (!identifier(input.evidenceSnapshotId) || !identifier(input.cityId) ||
    !identifier(input.packageId)) mismatch();
  return input as ReplayInput;
}

function capturePorts(value: unknown): CapturedPorts {
  const root = exactDataRecord(value, PORT_KEYS);
  const readRecord = exactDataRecord(root.read, READ_KEYS);
  const integrityRecord = exactDataRecord(root.integrity, INTEGRITY_KEYS);
  const packageRecord = exactDataRecord(root.package, PACKAGE_KEYS);
  const loadVerified = captureFunction<CityEvidenceReadPort["loadVerified"]>(
    readRecord,
    "loadVerified",
  );
  captureFunction<(...args: never[]) => unknown>(
    readRecord,
    "findVerifiedByCheckRunId",
  );
  const loadExactReplayContract = captureFunction<
    CityEvidencePackageReplayPort["loadExactReplayContract"]
  >(packageRecord, "loadExactReplayContract");
  const canonical = captureFunction<CityEvidenceReplayIntegrity["canonical"]>(
    integrityRecord,
    "canonical",
  );
  const hash = captureFunction<CityEvidenceReplayIntegrity["hash"]>(integrityRecord, "hash");
  const hashBytes = captureFunction<CityEvidenceReplayIntegrity["hashBytes"]>(
    integrityRecord,
    "hashBytes",
  );
  const decisionView: CityDecisionIntegrity = Object.freeze({
    canonical(input: unknown): string {
      let result: unknown;
      try {
        result = Reflect.apply(canonical, decisionView, [ownValue(input)]);
      } catch {
        mismatch();
      }
      if (typeof result !== "string") mismatch();
      return result;
    },
    hash(canonicalText: string): string {
      if (typeof canonicalText !== "string") mismatch();
      let result: unknown;
      try {
        result = Reflect.apply(hash, decisionView, [canonicalText]);
      } catch {
        mismatch();
      }
      if (typeof result !== "string" || !SHA256.test(result)) mismatch();
      return result;
    },
  });
  const replayView: CityEvidenceReplayIntegrity = Object.freeze({
    canonical(input: unknown): string {
      let result: unknown;
      try {
        result = Reflect.apply(canonical, replayView, [ownValue(input)]);
      } catch {
        mismatch();
      }
      if (typeof result !== "string") mismatch();
      return result;
    },
    hash(canonicalText: string): string {
      if (typeof canonicalText !== "string") mismatch();
      let result: unknown;
      try {
        result = Reflect.apply(hash, replayView, [canonicalText]);
      } catch {
        mismatch();
      }
      if (typeof result !== "string" || !SHA256.test(result)) mismatch();
      return result;
    },
    hashBytes(bytes: Uint8Array): string {
      if (!(bytes instanceof Uint8Array)) mismatch();
      const privateBytes = new Uint8Array(bytes);
      let result: unknown;
      try {
        result = Reflect.apply(hashBytes, replayView, [privateBytes]);
      } catch {
        mismatch();
      }
      if (typeof result !== "string" || !SHA256.test(result)) mismatch();
      return result;
    },
  });
  return Object.freeze({
    read: root.read as CityEvidenceReadPort,
    loadVerified,
    package: root.package as CityEvidencePackageReplayPort,
    loadExactReplayContract,
    decisionIntegrity: decisionView,
    integrity: replayView,
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: CityDecisionIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

function contextFromSnapshot(snapshot: CityEvidenceSnapshot): CityEvidenceContext {
  const definitionIds = exactDataRecord(snapshot.definitionIds, [
    "safety", "long_term_rent", "urban_transit", "fixed_broadband",
  ]);
  const context: CityEvidenceContext = Object.freeze({
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: snapshot.cityCheckRunId,
    frontierRunId: snapshot.frontierRunId,
    cityId: snapshot.cityId,
    countryCode: snapshot.countryCode,
    packageId: snapshot.packageId,
    packageSchemaVersion: snapshot.packageSchemaVersion,
    catalogRevisionId: snapshot.catalogRevisionId,
    criteriaSnapshotId: snapshot.criteriaSnapshotId,
    rankingSnapshotId: snapshot.rankingSnapshotId,
    definitionIds: definitionIds as unknown as CityEvidenceContext["definitionIds"],
    evidenceRulesVersion: snapshot.evidenceRulesVersion,
    assessmentAt: snapshot.assessmentAt,
    completedAt: snapshot.completedAt,
  });
  if (snapshot.schemaVersion !== "city-evidence@1" || !identifier(snapshot.id) ||
    snapshot.id !== `${snapshot.cityCheckRunId}:evidence` ||
    !identifier(snapshot.cityCheckRunId) || !identifier(snapshot.frontierRunId) ||
    !identifier(snapshot.cityId) || !/^[A-Z]{2}$/.test(snapshot.countryCode) ||
    !identifier(snapshot.packageId) || !identifier(snapshot.packageSchemaVersion) ||
    !identifier(snapshot.catalogRevisionId) || !identifier(snapshot.criteriaSnapshotId) ||
    !identifier(snapshot.rankingSnapshotId) || !identifier(snapshot.evidenceRulesVersion) ||
    Object.values(definitionIds).some((value) => !identifier(value)) ||
    !instant(snapshot.assessmentAt) || !instant(snapshot.completedAt) ||
    snapshot.assessmentAt > snapshot.completedAt || !SHA256.test(snapshot.contextHash) ||
    !SHA256.test(snapshot.payloadHash) || !SHA256.test(snapshot.hmac)) mismatch();
  return context;
}

function ownVerified(borrowed: unknown, expectedId: string): OwnedNode {
  const verified = ownValue(borrowed) as VerifiedCityEvidence;
  const root = exactDataRecord(verified, ["snapshot", "genericEvidence"]);
  const snapshot = exactDataRecord(root.snapshot, SNAPSHOT_KEYS) as unknown as CityEvidenceSnapshot;
  const generic = exactDataRecord(root.genericEvidence, ["snapshot", "manifest", "entries"]);
  exactDataRecord(generic.manifest, ["snapshot", "entries", "artifacts"]);
  if (!Array.isArray(generic.entries)) mismatch();
  const context = contextFromSnapshot(snapshot);
  if (snapshot.id !== expectedId) mismatch();
  return {
    context,
    verified: {
      snapshot,
      genericEvidence: generic as unknown as VerifiedCityEvidence["genericEvidence"],
    },
  };
}

function errorMessage(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || types.isProxy(error) ||
    Object.getPrototypeOf(error) !== Error.prototype ||
    Object.getOwnPropertySymbols(error).length !== 0) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function loadNode(id: string, ports: CapturedPorts, current: boolean): OwnedNode {
  let borrowed: unknown;
  try {
    borrowed = Reflect.apply(ports.loadVerified, ports.read, [id]);
  } catch (error) {
    if (current && errorMessage(error) === "city_evidence_not_found") {
      throw new Error("city_evidence_not_found");
    }
    mismatch();
  }
  return ownVerified(borrowed, id);
}

function previousEvidenceId(ledger: unknown): string | undefined {
  const record = exactDataRecord(ledger, [
    "schemaVersion", "catalogRevisionId", "authorityDirectoryId", "sourcePlanId", "cityId",
    "municipalityCode", "assessmentAt", "definitionId", "freshnessPolicyVersion",
    "discoveryRulesVersion", "queries", "candidates", "counters", "result", "completedAt",
  ]);
  if (!Array.isArray(record.candidates)) mismatch();
  const ids: string[] = [];
  for (const candidate of record.candidates) {
    const candidateRecord = candidate as DataRecord;
    if (candidateRecord === null || typeof candidateRecord !== "object" ||
      Array.isArray(candidateRecord)) mismatch();
    const origin = candidateRecord.origin as unknown;
    if (origin === null || typeof origin !== "object" || Array.isArray(origin)) mismatch();
    const kindDescriptor = Object.getOwnPropertyDescriptor(origin, "kind");
    if (kindDescriptor === undefined || !("value" in kindDescriptor)) mismatch();
    if (kindDescriptor.value !== "previous") continue;
    const previous = exactDataRecord(origin, [
      "kind", "priorSourcePlanId", "priorEvidenceSnapshotId",
    ]);
    if (!identifier(previous.priorSourcePlanId) || !identifier(previous.priorEvidenceSnapshotId)) {
      mismatch();
    }
    ids.push(previous.priorEvidenceSnapshotId);
  }
  const distinct = [...new Set(ids)];
  if (distinct.length > 1) mismatch();
  return distinct[0];
}

function loadChain(input: ReplayInput, ports: CapturedPorts): readonly OwnedNode[] {
  const chain: OwnedNode[] = [];
  const visited = new Set<string>();
  let id: string | undefined = input.evidenceSnapshotId;
  let current = true;
  while (id !== undefined) {
    if (visited.has(id)) mismatch();
    visited.add(id);
    const node = loadNode(id, ports, current);
    if (current && (node.context.cityId !== input.cityId ||
      node.context.packageId !== input.packageId)) mismatch();
    chain.push(node);
    id = previousEvidenceId(node.verified.snapshot.safetyAttemptLedger);
    current = false;
  }
  return Object.freeze(chain);
}

function payloadFromSnapshot(snapshot: CityEvidenceSnapshot): DataRecord {
  const payload = Object.create(null) as DataRecord;
  for (const key of SNAPSHOT_KEYS) {
    if (key === "payloadHash" || key === "hmac") continue;
    Object.defineProperty(payload, key, {
      value: snapshot[key],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(payload);
}

function validateCapturedArtifact(
  artifact: LiveCapturedArtifact<SloveniaCityFactSourceId>,
  sourceId: SloveniaCityFactSourceId,
): void {
  const record = exactDataRecord(artifact, [
    "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
    "origin", "capturedAt", "responseStatus", "responseUrl", "request",
  ]);
  const request = exactDataRecord(record.request, [
    "method", "url",
    ...(Object.prototype.hasOwnProperty.call(record.request, "bodyMediaType")
      ? ["bodyMediaType"]
      : []),
    ...(Object.prototype.hasOwnProperty.call(record.request, "bodySha256")
      ? ["bodySha256"]
      : []),
  ]);
  if (!identifier(record.artifactId) || !identifier(record.runId) || record.sourceId !== sourceId ||
    typeof record.role !== "string" || record.role.length === 0 ||
    typeof record.url !== "string" || record.url.length === 0 ||
    typeof record.mediaType !== "string" || record.mediaType.length === 0 ||
    !SHA256.test(record.sha256 as string) || !(record.bytes instanceof Uint8Array) ||
    record.origin !== "live" || !instant(record.capturedAt) ||
    !Number.isInteger(record.responseStatus) || typeof record.responseUrl !== "string" ||
    (request.method !== "GET" && request.method !== "POST") ||
    typeof request.url !== "string") mismatch();
}

function validateCapturedEntry(
  entry: CapturedEntry<SloveniaCityFactSourceId>,
  expectedSourceId: SloveniaCityFactSourceId,
): void {
  const record = exactDataRecord(entry, [
    "sourceId", "navigationUrl",
    ...(Object.prototype.hasOwnProperty.call(entry, "indexedSourceUrl") ? ["indexedSourceUrl"] : []),
    "resolvedEvidenceUrl", "artifacts",
    ...(Object.prototype.hasOwnProperty.call(entry, "versionHint") ? ["versionHint"] : []),
  ]);
  if (record.sourceId !== expectedSourceId || typeof record.navigationUrl !== "string" ||
    typeof record.resolvedEvidenceUrl !== "string" || !Array.isArray(record.artifacts)) mismatch();
  for (const artifact of record.artifacts) {
    validateCapturedArtifact(
      artifact as LiveCapturedArtifact<SloveniaCityFactSourceId>,
      expectedSourceId,
    );
  }
}

function validateOwnedNode(node: OwnedNode, ports: CapturedPorts): void {
  const { snapshot, genericEvidence } = node.verified;
  const payload = payloadFromSnapshot(snapshot);
  const canonicalPayload = ports.decisionIntegrity.canonical(payload);
  if (ports.decisionIntegrity.hash(canonicalPayload) !== snapshot.payloadHash ||
    cityEvidenceContextHash(node.context, ports.decisionIntegrity) !== snapshot.contextHash) mismatch();
  try {
    const origin = assertSealedEvidenceStructure(
      { snapshot: genericEvidence.snapshot, manifest: genericEvidence.manifest },
      SLOVENIA_CITY_FACT_SOURCE_IDS,
    );
    if (origin !== "live") mismatch();
  } catch {
    mismatch();
  }
  const canonicalManifest = ports.decisionIntegrity.canonical(genericEvidence.manifest);
  if (!SHA256.test(genericEvidence.snapshot.manifestHash) ||
    !SHA256.test(genericEvidence.snapshot.hmac) ||
    ports.decisionIntegrity.hash(canonicalManifest) !== genericEvidence.snapshot.manifestHash ||
    genericEvidence.snapshot.id !== `${node.context.cityCheckRunId}:evidence` ||
    genericEvidence.snapshot.assessmentDate !== node.context.assessmentAt.slice(0, 10) ||
    genericEvidence.snapshot.rulesVersion !== node.context.evidenceRulesVersion ||
    genericEvidence.snapshot.contextHash !== snapshot.contextHash ||
    genericEvidence.snapshot.knowledgeBaselineRevisionId !== undefined ||
    !sameStrings(
      genericEvidence.manifest.entries.map(({ sourceId }) => sourceId),
      SLOVENIA_CITY_FACT_SOURCE_IDS,
    ) || !sameStrings(
      genericEvidence.entries.map(({ sourceId }) => sourceId),
      SLOVENIA_CITY_FACT_SOURCE_IDS,
    )) mismatch();
  const provenanceById = new Map(genericEvidence.manifest.artifacts.map((artifact) => [
    artifact.artifactId,
    artifact,
  ]));
  const seen = new Set<string>();
  for (let index = 0; index < genericEvidence.entries.length; index += 1) {
    const entry = genericEvidence.entries[index]!;
    const sourceId = SLOVENIA_CITY_FACT_SOURCE_IDS[index]!;
    validateCapturedEntry(entry, sourceId);
    const manifestEntry = genericEvidence.manifest.entries[index]!;
    if (entry.navigationUrl !== manifestEntry.navigationUrl ||
      entry.indexedSourceUrl !== manifestEntry.indexedSourceUrl ||
      entry.resolvedEvidenceUrl !== manifestEntry.resolvedEvidenceUrl ||
      entry.versionHint !== manifestEntry.versionHint ||
      !sameStrings(
        entry.artifacts.map(({ artifactId }) => artifactId),
        manifestEntry.artifactIds,
      )) mismatch();
    for (const artifact of entry.artifacts) {
      const provenance = provenanceById.get(artifact.artifactId);
      if (seen.has(artifact.artifactId) || provenance === undefined ||
        artifact.runId !== node.context.cityCheckRunId ||
        !sameCanonical(evidenceArtifactProvenance(artifact), provenance, ports.decisionIntegrity)) {
        mismatch();
      }
      if (sourceId !== "si-city-safety" &&
        ports.integrity.hashBytes(artifact.bytes) !== artifact.sha256) mismatch();
      seen.add(artifact.artifactId);
    }
  }
  if (seen.size !== genericEvidence.manifest.artifacts.length) mismatch();
}

function exactKey(context: CityEvidenceContext) {
  return Object.freeze({
    countryCode: context.countryCode,
    packageId: context.packageId,
    packageSchemaVersion: context.packageSchemaVersion,
    catalogRevisionId: context.catalogRevisionId,
    evidenceRulesVersion: context.evidenceRulesVersion,
  });
}

function sameExactKey(left: DataRecord, right: ReturnType<typeof exactKey>): boolean {
  return left.countryCode === right.countryCode && left.packageId === right.packageId &&
    left.packageSchemaVersion === right.packageSchemaVersion &&
    left.catalogRevisionId === right.catalogRevisionId &&
    left.evidenceRulesVersion === right.evidenceRulesVersion;
}

const VALUE_VALIDATOR_RECEIVER = Object.freeze({ capability: "validateValue" });
const PERIOD_VALIDATOR_RECEIVER = Object.freeze({ capability: "validateSourcePeriod" });

function verifyReplayContract(
  borrowed: unknown,
  context: CityEvidenceContext,
  ports: CapturedPorts,
): VerifiedReplayContract {
  const root = exactDataRecord(borrowed, CONTRACT_KEYS);
  const manifest = exactDataRecord(root.installedPackageManifest, ["id", "key"]);
  const manifestKey = exactDataRecord(manifest.key, [
    "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
    "evidenceRulesVersion",
  ]);
  if (!Object.isFrozen(root.installedPackageManifest) || !Object.isFrozen(manifest.key) ||
    !identifier(manifest.id) || !sameExactKey(manifestKey, exactKey(context))) mismatch();
  const rawValidateValue = captureFunction<CityPackageEvidenceReplayContract["validateValue"]>(
    root,
    "validateValue",
  );
  const rawValidateSourcePeriod = captureFunction<
    CityPackageEvidenceReplayContract["validateSourcePeriod"]
  >(root, "validateSourcePeriod");
  const owned = ownValue({
    definition: root.definition,
    catalogProjection: root.catalogProjection,
    fixedPlansByCityId: root.fixedPlansByCityId,
    safetySourcePlan: root.safetySourcePlan,
    officialAuthorityDirectory: root.officialAuthorityDirectory,
  });
  const definition = exactDataRecord(owned.definition, [
    "packageId", "packageSchemaVersion", "countryCode", "evidenceRulesVersion", "sourceIds",
  ]) as unknown as CityPackageEvidenceReplayContract["definition"];
  if (definition.packageId !== context.packageId ||
    definition.packageSchemaVersion !== context.packageSchemaVersion ||
    definition.countryCode !== context.countryCode ||
    definition.evidenceRulesVersion !== context.evidenceRulesVersion ||
    !Array.isArray(definition.sourceIds) ||
    !sameStrings(definition.sourceIds, SLOVENIA_CITY_FACT_SOURCE_IDS)) mismatch();

  let catalog: CityCatalogProjection;
  try {
    catalog = reconstructVerifiedCityCatalog(
      owned.catalogProjection as CityCatalogProjection,
      ports.decisionIntegrity,
    );
  } catch {
    mismatch();
  }
  if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
    throw new Error("city_catalog_upgrade_required");
  }
  if (catalog.catalog.id !== context.catalogRevisionId ||
    catalog.registry.countryCode !== context.countryCode ||
    catalog.catalog.countryCode !== context.countryCode ||
    catalog.registry.packageId !== context.packageId ||
    catalog.catalog.packageId !== context.packageId ||
    catalog.registry.packageSchemaVersion !== context.packageSchemaVersion ||
    catalog.catalog.packageSchemaVersion !== context.packageSchemaVersion) mismatch();

  const memberIds = catalog.catalog.members.map(({ cityId }) => cityId).sort();
  const rawPlans = exactDataRecord(owned.fixedPlansByCityId, memberIds);
  if (!memberIds.includes(context.cityId)) mismatch();
  const plansByCityId = Object.create(null) as Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>;
  for (const cityId of memberIds) {
    const tuple = rawPlans[cityId];
    if (!Array.isArray(tuple) || tuple.length !== FIXED_SOURCE_IDS.length) mismatch();
    const plans = [
      reconstructCityFixedSourcePlan(tuple[0], "si-city-long-term-rent"),
      reconstructCityFixedSourcePlan(tuple[1], "si-city-urban-transit"),
      reconstructCityFixedSourcePlan(tuple[2], "si-city-fixed-broadband"),
    ] as const;
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]!;
      const sourceId = FIXED_SOURCE_IDS[index]!;
      const criterionId = SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE[sourceId];
      if (plan.cityId !== cityId || plan.sourceId !== sourceId ||
        plan.criterionId !== criterionId || plan.definitionId !== context.definitionIds[criterionId] ||
        plan.claimContract.definitionId !== context.definitionIds[criterionId] ||
        plan.parserVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion ||
        plan.rulesVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion) mismatch();
    }
    plansByCityId[cityId] = Object.freeze(plans);
  }
  Object.freeze(plansByCityId);

  let directory: OfficialAuthorityDirectory;
  let safetyPlan: CitySafetySourcePlan;
  try {
    directory = reconstructOfficialAuthorityDirectory(
      owned.officialAuthorityDirectory as OfficialAuthorityDirectory,
      catalog.catalog,
      ports.decisionIntegrity,
    );
    safetyPlan = reconstructCitySafetySourcePlan(
      owned.safetySourcePlan as CitySafetySourcePlan,
      catalog.catalog,
      directory,
      ports.decisionIntegrity,
    );
  } catch {
    mismatch();
  }
  if (safetyPlan.definitionId !== context.definitionIds.safety ||
    safetyPlan.discoveryRulesVersion !== SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].rulesVersion) {
    mismatch();
  }
  const validateValue: CityPackageEvidenceReplayContract["validateValue"] = (input) => {
    const result = Reflect.apply(rawValidateValue, VALUE_VALIDATOR_RECEIVER, [ownValue(input)]);
    if (typeof result !== "string") mismatch();
    return result;
  };
  const validateSourcePeriod: CityPackageEvidenceReplayContract["validateSourcePeriod"] =
    (input) => {
      const result = Reflect.apply(
        rawValidateSourcePeriod,
        PERIOD_VALIDATOR_RECEIVER,
        [ownValue(input)],
      );
      if (result !== "fresh" && result !== "stale") mismatch();
      return result;
    };
  return Object.freeze({
    definition,
    catalog,
    fixedPlansByCityId: plansByCityId,
    safetySourcePlan: safetyPlan,
    officialAuthorityDirectory: directory,
    validateValue,
    validateSourcePeriod,
  });
}

function captureReplayContract(node: OwnedNode, ports: CapturedPorts): VerifiedReplayContract {
  const key = exactKey(node.context);
  let borrowed: unknown;
  try {
    borrowed = Reflect.apply(ports.loadExactReplayContract, ports.package, [key]);
  } catch {
    mismatch();
  }
  if (borrowed === undefined) throw new Error("city_package_revision_not_installed");
  return verifyReplayContract(borrowed, node.context, ports);
}

function reconstructNode(
  node: OwnedNode,
  replay: VerifiedReplayContract,
  previousAccepted: CitySafetyPreviousAcceptedReference | undefined,
  ports: CapturedPorts,
): SemanticReplay {
  const rawFixed = node.verified.snapshot.fixedAttemptLedgers;
  if (!Array.isArray(rawFixed) || rawFixed.length !== FIXED_SOURCE_IDS.length) mismatch();
  const selectedPlans = replay.fixedPlansByCityId[node.context.cityId];
  if (selectedPlans === undefined) mismatch();
  const fixed = selectedPlans.map((plan, index) => reconstructCityFixedAttemptLedger(
    rawFixed[index],
    {
      cityCheckRunId: node.context.cityCheckRunId,
      cityId: node.context.cityId,
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      planId: plan.planId,
      definitionId: plan.definitionId,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      routes: plan.routes,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      assessmentAt: node.context.assessmentAt,
      notAfterAt: node.context.completedAt,
    },
  )) as unknown as CityFixedAttemptLedgerTuple;
  let safety: CitySafetyAttemptLedger;
  try {
    safety = reconstructCitySafetyAttemptLedger(node.verified.snapshot.safetyAttemptLedger, {
      runId: node.context.cityCheckRunId,
      catalog: replay.catalog.catalog,
      integrity: ports.decisionIntegrity,
      sourcePlan: replay.safetySourcePlan,
      authorityDirectory: replay.officialAuthorityDirectory,
      ...(previousAccepted === undefined ? {} : { previousAccepted }),
    });
  } catch {
    mismatch();
  }
  if (safety.cityId !== node.context.cityId) mismatch();
  const safetyEntry = node.verified.genericEvidence.entries.find(
    ({ sourceId }) => sourceId === "si-city-safety",
  );
  if (safetyEntry === undefined) mismatch();
  try {
    const bridged = reconstructCitySafetyArtifactBridge({
      cityCheckRunId: node.context.cityCheckRunId,
      catalog: replay.catalog.catalog,
      sourcePlan: replay.safetySourcePlan,
      authorityDirectory: replay.officialAuthorityDirectory,
      ledger: safety,
      artifacts: safetyEntry.artifacts as readonly LiveCapturedArtifact<"si-city-safety">[],
      ...(previousAccepted === undefined ? {} : { previousAccepted }),
    }, ports.integrity);
    if (!sameCanonical(bridged.ledger, safety, ports.decisionIntegrity)) mismatch();
    safety = bridged.ledger;
  } catch {
    mismatch();
  }
  validateChronology(node.context, fixed, safety, node.verified.genericEvidence);
  return Object.freeze({ fixedAttemptLedgers: fixed, safetyAttemptLedger: safety });
}

function artifactMap(bundle: VerifiedCityEvidence["genericEvidence"]): ReadonlyMap<
  string,
  LiveCapturedArtifact<SloveniaCityFactSourceId>
> {
  return new Map(bundle.entries.flatMap(({ artifacts }) => artifacts)
    .map((artifact) => [artifact.artifactId, artifact]));
}

function validateChronology(
  context: CityEvidenceContext,
  fixedLedgers: CityFixedAttemptLedgerTuple,
  safetyLedger: CitySafetyAttemptLedger,
  bundle: VerifiedCityEvidence["genericEvidence"],
): void {
  const artifacts = artifactMap(bundle);
  for (const ledger of fixedLedgers) {
    if (ledger.assessmentAt !== context.assessmentAt || ledger.completedAt < context.assessmentAt ||
      ledger.completedAt > context.completedAt) mismatch();
    for (const attempt of ledger.attempts) {
      if (attempt.attemptedAt < context.assessmentAt || attempt.attemptedAt > ledger.completedAt) {
        mismatch();
      }
      for (const artifactId of attempt.artifactIds) {
        const artifact = artifacts.get(artifactId);
        if (artifact === undefined || artifact.sourceId !== ledger.sourceId ||
          !instant(artifact.capturedAt) || artifact.capturedAt < attempt.attemptedAt ||
          artifact.capturedAt > ledger.completedAt) mismatch();
      }
    }
  }
  if (safetyLedger.assessmentAt !== context.assessmentAt ||
    safetyLedger.completedAt < context.assessmentAt ||
    safetyLedger.completedAt > context.completedAt) mismatch();
  let previousSearchAt = context.assessmentAt;
  const searchTimes = new Map<string, string>();
  for (const query of safetyLedger.queries) {
    if (!instant(query.searchedAt) || query.searchedAt < previousSearchAt ||
      query.searchedAt > safetyLedger.completedAt) mismatch();
    searchTimes.set(query.queryId, query.searchedAt);
    previousSearchAt = query.searchedAt;
  }
  const acquired = new Set<string>();
  for (const candidate of safetyLedger.candidates) {
    const originAt = candidate.origin.kind === "search"
      ? searchTimes.get(candidate.origin.queryId)
      : context.assessmentAt;
    if (originAt === undefined) mismatch();
    for (const reference of candidate.artifactRefs) {
      const artifact = artifacts.get(reference.artifactId);
      if (artifact === undefined || artifact.sourceId !== "si-city-safety" ||
        artifact.capturedAt > safetyLedger.completedAt) mismatch();
      if (!acquired.has(reference.artifactId) && artifact.capturedAt < originAt) mismatch();
      acquired.add(reference.artifactId);
    }
  }
}

function previousReference(
  replayed: SemanticReplay,
  snapshot: CityEvidenceSnapshot,
): CitySafetyPreviousAcceptedReference {
  const ledger = replayed.safetyAttemptLedger;
  if (ledger.result.kind !== "verified") mismatch();
  const accepted = ledger.candidates[ledger.result.acceptedCandidateIndex];
  if (accepted?.disposition !== "usable") mismatch();
  return Object.freeze({
    cityId: ledger.cityId,
    municipalityCode: ledger.municipalityCode,
    sourcePlanId: ledger.sourcePlanId,
    definitionId: ledger.definitionId,
    publisherId: accepted.publisherId,
    navigationUrl: accepted.publisherNavigationUrl,
    resolvedEvidenceUrl: accepted.resolvedEvidenceUrl,
    referenceYear: accepted.referenceYear,
    evidenceSnapshotId: snapshot.id,
  });
}

function exactArtifactIds(left: readonly string[], right: readonly string[]): boolean {
  return sameStrings(left, right) && new Set(left).size === left.length;
}

function validateFixedClaim(
  claim: CityEvidenceClaim,
  plan: CityFixedSourcePlan<SloveniaCityFixedSourceId>,
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
  entryArtifactIds: readonly string[],
): void {
  const record = exactDataRecord(claim, [
    "claimId", "sourceId", "value", "scope", "sourcePeriod", "anchor", "status", "criterionId",
    "definitionId", "officialAreaId", "geoScope", "unit", "denominator",
    "freshnessPolicyVersion",
  ]);
  const value = exactDataRecord(record.value, ["kind", "value"]);
  const anchor = exactDataRecord(record.anchor, ["artifactId", "locator", "excerptSha256"]);
  if (claim.sourceId !== plan.sourceId || claim.criterionId !== plan.criterionId ||
    claim.definitionId !== plan.definitionId || claim.scope !== plan.claimContract.scope ||
    claim.officialAreaId !== plan.claimContract.officialAreaId ||
    claim.geoScope !== plan.claimContract.geoScope || claim.unit !== plan.claimContract.unit ||
    claim.denominator !== plan.claimContract.denominator ||
    claim.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
    claim.status !== "verified" || !identifier(claim.claimId) ||
    typeof claim.sourcePeriod !== "string" || claim.sourcePeriod.length === 0 ||
    claim.sourcePeriod.trim() !== claim.sourcePeriod || value.kind !== "canonical_scalar" ||
    typeof value.value !== "string" || value.value.length === 0 ||
    value.value.trim() !== value.value || !entryArtifactIds.includes(anchor.artifactId as string) ||
    typeof anchor.locator !== "string" || anchor.locator.length === 0 ||
    anchor.locator.trim() !== anchor.locator || !SHA256.test(anchor.excerptSha256 as string)) {
    mismatch();
  }
  try {
    const validatedValue = replay.validateValue({
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      policyVersion: plan.claimContract.valuePolicyVersion,
      value: value.value,
      unit: plan.claimContract.unit,
      denominator: plan.claimContract.denominator,
    });
    const period = replay.validateSourcePeriod({
      sourceId: plan.sourceId,
      policyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      sourcePeriod: claim.sourcePeriod,
      assessmentAt: context.assessmentAt,
    });
    if (validatedValue !== value.value || period !== "fresh") mismatch();
  } catch {
    mismatch();
  }
}

function validateFixedTerminal(
  ledger: CityFixedAttemptLedger,
  plan: CityFixedSourcePlan<SloveniaCityFixedSourceId>,
  bundle: VerifiedCityEvidence["genericEvidence"],
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
): void {
  const entry = bundle.manifest.entries.find(({ sourceId }) => sourceId === plan.sourceId);
  if (entry === undefined || bundle.snapshot.parserVersions[plan.sourceId] !== plan.parserVersion ||
    entry.indexedSourceUrl !== undefined || entry.versionHint !== plan.parserVersion) mismatch();
  const ledgerArtifactIds = ledger.attempts.flatMap(({ artifactIds }) => artifactIds);
  if (!exactArtifactIds(ledgerArtifactIds, entry.artifactIds)) mismatch();
  const claims = bundle.snapshot.claims.filter(({ sourceId }) => sourceId === plan.sourceId);
  const blockers = bundle.snapshot.blockers.filter(({ sourceId }) => sourceId === plan.sourceId);
  if (ledger.result.kind === "verified") {
    const accepted = ledger.attempts.at(-1);
    if (accepted?.disposition !== "accepted" || entry.navigationUrl !== accepted.navigationUrl ||
      entry.resolvedEvidenceUrl !== accepted.resolvedEvidenceUrl ||
      bundle.snapshot.coverage[plan.sourceId] !== "verified" || blockers.length !== 0 ||
      claims.length !== ledger.result.claimIds.length ||
      !sameStrings(claims.map(({ claimId }) => claimId), ledger.result.claimIds)) mismatch();
    claims.forEach((claim) => validateFixedClaim(
      claim,
      plan,
      replay,
      context,
      accepted.artifactIds,
    ));
    return;
  }
  const terminal = ledger.attempts.at(-1);
  if (terminal === undefined || entry.navigationUrl !== terminal.navigationUrl ||
    entry.resolvedEvidenceUrl !== (terminal.resolvedEvidenceUrl ?? terminal.navigationUrl) ||
    bundle.snapshot.coverage[plan.sourceId] !== "unavailable" || claims.length !== 0 ||
    blockers.length !== 1 || blockers[0]!.kind !== ledger.result.reason ||
    blockers[0]!.navigationUrl !== entry.navigationUrl ||
    blockers[0]!.resolvedUrl !== entry.resolvedEvidenceUrl ||
    !exactArtifactIds(blockers[0]!.artifactIds, entry.artifactIds)) mismatch();
}

function validateSafetyTerminal(
  ledger: CitySafetyAttemptLedger,
  bundle: VerifiedCityEvidence["genericEvidence"],
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
  integrity: CityDecisionIntegrity,
): void {
  const storedEntry = bundle.manifest.entries.find(({ sourceId }) => sourceId === "si-city-safety");
  const captured = bundle.entries.find(({ sourceId }) => sourceId === "si-city-safety");
  if (storedEntry === undefined || captured === undefined ||
    bundle.snapshot.parserVersions["si-city-safety"] !==
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion) mismatch();
  let terminal: ReturnType<typeof citySafetyTerminalEntry>;
  try {
    terminal = citySafetyTerminalEntry({
      cityCheckRunId: context.cityCheckRunId,
      ledger,
      artifacts: captured.artifacts as readonly LiveCapturedArtifact<"si-city-safety">[],
      sourcePlan: replay.safetySourcePlan,
      authorityDirectory: replay.officialAuthorityDirectory,
    });
  } catch {
    mismatch();
  }
  if (terminal.coverage !== bundle.snapshot.coverage["si-city-safety"] ||
    terminal.parserEntry.navigationUrl !== storedEntry.navigationUrl ||
    terminal.parserEntry.resolvedEvidenceUrl !== storedEntry.resolvedEvidenceUrl ||
    terminal.parserEntry.versionHint !== storedEntry.versionHint ||
    !exactArtifactIds(
      terminal.parserEntry.artifacts.map(({ artifactId }) => artifactId),
      storedEntry.artifactIds,
    )) mismatch();
  const claims = bundle.snapshot.claims.filter(({ sourceId }) => sourceId === "si-city-safety");
  const blockers = bundle.snapshot.blockers.filter(({ sourceId }) => sourceId === "si-city-safety");
  if (terminal.coverage === "verified") {
    if (blockers.length !== 0 || !sameCanonical(terminal.claims, claims, integrity)) mismatch();
  } else if (claims.length !== 0 || blockers.length !== 1 ||
    !sameCanonical(terminal.blocker, blockers[0], integrity)) mismatch();
}

function replayOwned(input: ReplayInput, ports: CapturedPorts): VerifiedCityEvidence {
  const chain = loadChain(input, ports);
  if (chain.length === 0) mismatch();
  chain.forEach((node) => validateOwnedNode(node, ports));
  const contracts = chain.map((node) => captureReplayContract(node, ports));
  const replayed: SemanticReplay[] = new Array(chain.length);
  let previousAccepted: CitySafetyPreviousAcceptedReference | undefined;
  let previousCompletedAt: string | undefined;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]!;
    if (previousCompletedAt !== undefined && previousCompletedAt > node.context.assessmentAt) {
      mismatch();
    }
    const semantic = reconstructNode(node, contracts[index]!, previousAccepted, ports);
    if (!sameCanonical(
      semantic.fixedAttemptLedgers,
      node.verified.snapshot.fixedAttemptLedgers,
      ports.decisionIntegrity,
    ) || !sameCanonical(
      semantic.safetyAttemptLedger,
      node.verified.snapshot.safetyAttemptLedger,
      ports.decisionIntegrity,
    )) mismatch();
    replayed[index] = semantic;
    if (index > 0) previousAccepted = previousReference(semantic, node.verified.snapshot);
    previousCompletedAt = node.context.completedAt;
  }

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]!;
    const semantic = replayed[index]!;
    const replay = contracts[index]!;
    const plans = replay.fixedPlansByCityId[node.context.cityId];
    if (plans === undefined) mismatch();
    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      validateFixedTerminal(
        semantic.fixedAttemptLedgers[planIndex],
        plans[planIndex] as CityFixedSourcePlan<SloveniaCityFixedSourceId>,
        node.verified.genericEvidence,
        replay,
        node.context,
      );
    }
    validateSafetyTerminal(
      semantic.safetyAttemptLedger,
      node.verified.genericEvidence,
      replay,
      node.context,
      ports.decisionIntegrity,
    );
  }

  const current = chain[0]!;
  const currentReplay = replayed[0]!;
  return ownValue({
    snapshot: {
      ...current.verified.snapshot,
      fixedAttemptLedgers: currentReplay.fixedAttemptLedgers,
      safetyAttemptLedger: currentReplay.safetyAttemptLedger,
    },
    genericEvidence: current.verified.genericEvidence,
  }) as VerifiedCityEvidence;
}

function normalizedError(error: unknown): Error {
  const code = errorMessage(error);
  if (code === "city_evidence_not_found" ||
    code === "city_package_revision_not_installed" ||
    code === "city_catalog_upgrade_required") return new Error(code);
  return new Error("integrity_mismatch");
}

export function replayCityEvidence(
  input: ReplayInput,
  ports: CityEvidenceReplayPorts,
): Promise<VerifiedCityEvidence> {
  try {
    const ownedInput = ownInput(input);
    const capturedPorts = capturePorts(ports);
    return Promise.resolve(replayOwned(ownedInput, capturedPorts));
  } catch (error) {
    return Promise.reject(normalizedError(error));
  }
}
