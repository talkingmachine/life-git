import { createHash } from "node:crypto";
import { types } from "node:util";

import type Database from "better-sqlite3";

import {
  canonicalJson,
  createEvidenceIntegrity,
  secureHexEqual,
  sha256Text,
} from "../integrity";
import type {
  AdministrativeCapturedArtifact,
  CapturedEntry,
  Claim,
  EvidenceOrigin,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  ParserEntry,
  SourceId,
} from "../../research/contracts";
import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "../../research/cold-start-contracts";
import {
  type ColdStartEvidenceClaimV2,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_SOURCE_ORDER,
} from "../../research/cold-start-contracts-v2";
import type {
  KnowledgeEvidenceEntry,
  VerifiedCountryEvidenceInput,
  VerifiedCountryEvidenceInputV2,
} from "../../research/country-knowledge";
import {
  assertSealedEvidenceStructure,
  evidenceArtifactProvenance,
  type EvidenceIntegrity,
  type EvidenceArtifactProvenance,
  type EvidenceManifest,
  type SealedEvidence,
  type EvidenceWriteStore,
  type VerifiedEvidenceBundle,
  type VerifiedLoadExpectations,
} from "../../research/research-plan";

interface SnapshotRow {
  readonly assessment_date: string;
  readonly snapshot_json: string;
  readonly manifest_json: string;
  readonly manifest_hash: string;
  readonly hmac: string;
  readonly parser_versions_json: string;
  readonly rules_version: string;
}

interface StoredArtifactCommon<S extends string = SourceId> {
  readonly run_id: string;
  readonly artifact_id: string;
  readonly source_id: S;
  readonly role: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly sealed: 0 | 1;
}

interface StoredLiveArtifactRow<S extends string = SourceId> extends StoredArtifactCommon<S> {
  readonly origin: "live";
  readonly url: string;
  readonly captured_at: string;
  readonly response_status: number;
  readonly response_url: string;
  readonly request_json: string;
  readonly producer: null;
  readonly created_at: null;
}

interface StoredAdministrativeArtifactRow<S extends string = SourceId>
  extends StoredArtifactCommon<S> {
  readonly origin: "administrative";
  readonly url: null;
  readonly captured_at: null;
  readonly response_status: null;
  readonly response_url: null;
  readonly request_json: null;
  readonly producer: string;
  readonly created_at: string;
}

type StoredArtifactRow<S extends string = SourceId> =
  | StoredLiveArtifactRow<S>
  | StoredAdministrativeArtifactRow<S>;

interface VerifiedStoredEvidenceBundle<
  S extends string,
  C extends Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C>;
  readonly entries: readonly CapturedEntry<S>[];
}

type EvidencePersistenceIntegrity = Pick<EvidenceIntegrity, "canonical" | "hash">;
type EvidencePersistenceCanonicalizer = Pick<EvidenceIntegrity, "canonical">;

const DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY: EvidencePersistenceIntegrity = Object.freeze({
  canonical: canonicalJson,
  hash: sha256Text,
});

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)!.get!;
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!;

function isSharedArrayBuffer(buffer: ArrayBufferLike): boolean {
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotUint8Array(value: object): Uint8Array | undefined {
  let brand: unknown;
  let buffer: ArrayBufferLike;
  let byteLength: number;
  let byteOffset: number;
  try {
    brand = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []);
    if (brand === undefined) return undefined;
    if (brand !== "Uint8Array") integrityMismatch();
    buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
    byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
  } catch {
    return integrityMismatch();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length: byteLength }, (_, index) => String(index)).sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (
    !Number.isSafeInteger(byteLength) || byteLength < 0 ||
    !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
    isSharedArrayBuffer(buffer) || Object.getOwnPropertySymbols(descriptors).length !== 0 ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    Object.values(descriptors).some((descriptor) =>
      !("value" in descriptor) || !descriptor.enumerable
    ) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype
  ) integrityMismatch();
  try {
    const copy = Reflect.apply(
      ARRAY_BUFFER_SLICE,
      buffer,
      [byteOffset, byteOffset + byteLength],
    ) as ArrayBuffer;
    return new Uint8Array(copy);
  } catch {
    return integrityMismatch();
  }
}

function bytesHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function liveRowProvenance<S extends string>(
  row: StoredLiveArtifactRow<S>,
): EvidenceArtifactProvenance<S> {
  let request: LiveCapturedArtifact<S>["request"];
  try {
    request = JSON.parse(row.request_json) as LiveCapturedArtifact<S>["request"];
  } catch {
    integrityMismatch();
  }
  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    sourceId: row.source_id,
    role: row.role,
    request,
    url: row.url,
    responseUrl: row.response_url,
    capturedAt: row.captured_at,
    responseStatus: row.response_status,
    mediaType: row.media_type,
    origin: row.origin,
    byteLength: row.byte_length,
    sha256: row.sha256,
  };
}

function administrativeRowProvenance<S extends string>(
  row: StoredAdministrativeArtifactRow<S>,
): EvidenceArtifactProvenance<S, "administrative"> {
  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    sourceId: row.source_id,
    role: row.role,
    mediaType: row.media_type,
    sha256: row.sha256,
    byteLength: row.byte_length,
    origin: "administrative",
    producer: row.producer,
    createdAt: row.created_at,
  };
}

function storedRowProvenance<S extends string>(
  row: StoredArtifactRow<S>,
): EvidenceArtifactProvenance<S, EvidenceOrigin> {
  return row.origin === "live" ? liveRowProvenance(row) : administrativeRowProvenance(row);
}

function capturedArtifactFromRow<S extends string>(
  row: StoredLiveArtifactRow<S>,
): LiveCapturedArtifact<S> {
  const provenance = liveRowProvenance(row);
  return {
    artifactId: provenance.artifactId,
    runId: provenance.runId,
    sourceId: provenance.sourceId,
    role: provenance.role,
    request: provenance.request,
    url: provenance.url,
    responseUrl: provenance.responseUrl,
    capturedAt: provenance.capturedAt,
    responseStatus: provenance.responseStatus,
    mediaType: provenance.mediaType,
    origin: "live",
    sha256: provenance.sha256,
    bytes: new Uint8Array(row.bytes),
  };
}

const ARTIFACT_COLUMNS = `
  run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
  byte_length, origin, captured_at, response_status, response_url, request_json,
  producer, created_at, sealed
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownedDataSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (
      value === null || value === undefined || typeof value === "string" ||
      typeof value === "boolean"
    ) return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) integrityMismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) integrityMismatch();
    const copiedBytes = snapshotUint8Array(value);
    if (copiedBytes !== undefined) return copiedBytes;
    if (active.has(value)) integrityMismatch();
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (prototype !== Array.prototype) integrityMismatch();
        const lengthDescriptor = descriptors.length;
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
          integrityMismatch();
        }
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0) integrityMismatch();
        const expectedNames = [
          ...Array.from({ length }, (_, index) => String(index)),
          "length",
        ].sort();
        const actualNames = Object.keys(descriptors).sort();
        if (
          actualNames.length !== expectedNames.length ||
          actualNames.some((name, index) => name !== expectedNames[index])
        ) integrityMismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            integrityMismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (
          key === "__proto__" || !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          integrityMismatch();
        }
        Object.defineProperty(copy, key, {
          configurable: true,
          enumerable: true,
          value: visit(descriptor.value),
          writable: true,
        });
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function structuralSourceIds<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin,
>(
  snapshot: EvidenceSnapshot<S, C>,
  manifest: EvidenceManifest<S, C, O>,
): readonly S[] {
  if (!isRecord(snapshot) || !isRecord(manifest)) integrityMismatch();
  if (snapshot.rulesVersion === "vs1-evidence@1") {
    return [
      "al-law-79",
      "al-decision-858",
      "cbr-eur",
      "boa-eur",
      "tirana-urban-lines",
    ] as unknown as readonly S[];
  }
  if (snapshot.rulesVersion === "vs2-si-evidence@2") {
    return [
      "si-digital-nomad-route",
      "si-income-threshold",
      "si-companion-employment",
      "cbr-eur",
    ] as unknown as readonly S[];
  }
  if (snapshot.rulesVersion === SLOVENIA_V2_EVIDENCE_RULES_VERSION) {
    return SLOVENIA_V2_SOURCE_ORDER as unknown as readonly S[];
  }
  if (
    !Array.isArray(manifest.entries) ||
    !manifest.entries.every((entry) => isRecord(entry) && typeof entry.sourceId === "string")
  ) integrityMismatch();
  return manifest.entries.map((entry) => entry.sourceId);
}

function snapshotPayload<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
>(
  snapshot: EvidenceSnapshot<S, C>,
): EvidenceManifest<S, C, O>["snapshot"] {
  return {
    id: snapshot.id,
    assessmentDate: snapshot.assessmentDate,
    artifactIds: snapshot.artifactIds,
    claims: snapshot.claims,
    blockers: snapshot.blockers,
    coverage: snapshot.coverage,
    parserVersions: snapshot.parserVersions,
    rulesVersion: snapshot.rulesVersion,
    ...(snapshot.contextHash === undefined ? {} : { contextHash: snapshot.contextHash }),
    ...(snapshot.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: snapshot.knowledgeBaselineRevisionId }),
  };
}

export function verifySealedEvidenceForInsert<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin,
>(
  sealed: SealedEvidence<S, C, O>,
  integrity: EvidenceIntegrity,
): void {
  const ownedSealed = ownedDataSnapshot(sealed);
  if (!isRecord(ownedSealed) ||
    !exactObjectKeys(ownedSealed, ["snapshot", "manifest", "canonicalManifest"])) {
    integrityMismatch();
  }
  assertSealedEvidenceStructure(
    ownedSealed,
    structuralSourceIds(ownedSealed.snapshot, ownedSealed.manifest),
  );
  const canonicalManifest = integrity.canonical(ownedSealed.manifest);
  if (canonicalManifest !== ownedSealed.canonicalManifest ||
    !secureHexEqual(ownedSealed.snapshot.manifestHash, integrity.hash(canonicalManifest)) ||
    !secureHexEqual(ownedSealed.snapshot.hmac, integrity.sign(canonicalManifest)) ||
    integrity.canonical(ownedSealed.manifest.snapshot) !==
      integrity.canonical(snapshotPayload(ownedSealed.snapshot))) {
    integrityMismatch();
  }
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function canonicalUtcMilliseconds(value: unknown): value is string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertLiveArtifactForStorage<S extends string>(artifact: LiveCapturedArtifact<S>): void {
  if (!isRecord(artifact) || !exactObjectKeys(artifact, [
    "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
    "origin", "capturedAt", "responseStatus", "responseUrl", "request",
  ]) || !isRecord(artifact.request)) integrityMismatch();
  const requestKeys = [
    "method", "url",
    ...(Object.prototype.hasOwnProperty.call(artifact.request, "bodyMediaType")
      ? ["bodyMediaType"]
      : []),
    ...(Object.prototype.hasOwnProperty.call(artifact.request, "bodySha256")
      ? ["bodySha256"]
      : []),
  ];
  if (
    !exactObjectKeys(artifact.request, requestKeys) || artifact.origin !== "live" ||
    !nonemptyString(artifact.runId) || !nonemptyString(artifact.artifactId) ||
    !nonemptyString(artifact.sourceId) || !nonemptyString(artifact.role) ||
    !nonemptyString(artifact.url) || !nonemptyString(artifact.mediaType) ||
    !nonemptyString(artifact.responseUrl) ||
    !nonemptyString(artifact.capturedAt) ||
    !Number.isInteger(artifact.responseStatus) || artifact.responseStatus < 100 ||
    artifact.responseStatus > 599 || !(artifact.bytes instanceof Uint8Array) ||
    bytesHash(artifact.bytes) !== artifact.sha256
  ) integrityMismatch();
}

function assertAdministrativeArtifactForStorage<S extends string>(
  artifact: AdministrativeCapturedArtifact<S>,
): void {
  if (
    !isRecord(artifact) || !exactObjectKeys(artifact, [
      "artifactId", "runId", "sourceId", "role", "mediaType", "sha256", "bytes",
      "origin", "producer", "createdAt",
    ]) ||
    artifact.origin !== "administrative" || !nonemptyString(artifact.runId) ||
    !nonemptyString(artifact.artifactId) || !nonemptyString(artifact.sourceId) ||
    !nonemptyString(artifact.role) || !nonemptyString(artifact.mediaType) ||
    !nonemptyString(artifact.producer) ||
    !canonicalUtcMilliseconds(artifact.createdAt) || !(artifact.bytes instanceof Uint8Array) ||
    bytesHash(artifact.bytes) !== artifact.sha256
  ) integrityMismatch();
}

/** @internal */
export function insertLiveArtifact<S extends string>(
  database: Database.Database,
  artifact: LiveCapturedArtifact<S>,
  integrity: EvidencePersistenceCanonicalizer = DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY,
): void {
  assertLiveArtifactForStorage(artifact);
  const existing = database.prepare(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
  ).get(artifact.runId, artifact.artifactId) as StoredArtifactRow<S> | undefined;
  const canonical = integrity.canonical.bind(integrity);
  if (existing !== undefined) {
    if (existing.origin !== "live" || !bytesEqual(existing.bytes, artifact.bytes) ||
      canonical(liveRowProvenance(existing)) !== canonical(evidenceArtifactProvenance(artifact))) {
      integrityMismatch();
    }
    return;
  }
  const ownedBytes = new Uint8Array(artifact.bytes);
  database.prepare(`
    INSERT INTO artifacts (
      run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
      byte_length, origin, captured_at, response_status, response_url, request_json, sealed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, 0)
  `).run(
    artifact.runId,
    artifact.artifactId,
    artifact.sourceId,
    artifact.role,
    artifact.url,
    artifact.mediaType,
    artifact.sha256,
    ownedBytes,
    ownedBytes.byteLength,
    artifact.capturedAt,
    artifact.responseStatus,
    artifact.responseUrl,
    canonical(artifact.request),
  );
}

function insertAdministrativeArtifact<S extends string>(
  database: Database.Database,
  artifact: AdministrativeCapturedArtifact<S>,
  integrity: EvidencePersistenceCanonicalizer = DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY,
): void {
  assertAdministrativeArtifactForStorage(artifact);
  const existing = database.prepare(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
  ).get(artifact.runId, artifact.artifactId) as StoredArtifactRow<S> | undefined;
  const canonical = integrity.canonical.bind(integrity);
  if (existing !== undefined) {
    if (
      existing.origin !== "administrative" || !bytesEqual(existing.bytes, artifact.bytes) ||
      canonical(administrativeRowProvenance(existing)) !==
        canonical(evidenceArtifactProvenance<S, "administrative">(artifact))
    ) integrityMismatch();
    return;
  }
  const ownedBytes = new Uint8Array(artifact.bytes);
  database.prepare(`
    INSERT INTO artifacts (
      run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
      byte_length, origin, captured_at, response_status, response_url, request_json,
      producer, created_at, sealed
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'administrative', NULL, NULL, NULL, NULL, ?, ?, 0)
  `).run(
    artifact.runId,
    artifact.artifactId,
    artifact.sourceId,
    artifact.role,
    artifact.mediaType,
    artifact.sha256,
    ownedBytes,
    ownedBytes.byteLength,
    artifact.producer,
    artifact.createdAt,
  );
}

function insertSealedEvidenceForOrigin<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin,
>(
  database: Database.Database,
  sealed: SealedEvidence<S, C, O>,
  integrity: EvidencePersistenceIntegrity,
  expectedOrigin: O,
  acceptExactRetry: boolean,
): void {
  if (!isRecord(sealed) ||
    !exactObjectKeys(sealed, ["snapshot", "manifest", "canonicalManifest"])) {
    integrityMismatch();
  }
  if (assertSealedEvidenceStructure(
    sealed,
    structuralSourceIds(sealed.snapshot, sealed.manifest),
  ) !== expectedOrigin) integrityMismatch();
  const canonical = integrity.canonical.bind(integrity);
  const hash = integrity.hash.bind(integrity);
  const canonicalManifest = canonical(sealed.manifest);
  if (canonicalManifest !== sealed.canonicalManifest ||
    !secureHexEqual(sealed.snapshot.manifestHash, hash(canonicalManifest)) ||
    canonical(sealed.manifest.snapshot) !== canonical(snapshotPayload(sealed.snapshot))) {
    integrityMismatch();
  }
  const storedArtifacts: StoredArtifactRow<S>[] = [];
  for (const expected of sealed.manifest.artifacts) {
    const row = database.prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
    ).get(expected.runId, expected.artifactId) as StoredArtifactRow<S> | undefined;
    if (
      row === undefined ||
      canonical(storedRowProvenance(row)) !== canonical(expected) ||
      row.byte_length !== row.bytes.byteLength ||
      bytesHash(row.bytes) !== expected.sha256
    ) {
      integrityMismatch();
    }
    storedArtifacts.push(row);
  }
  const canonicalSnapshot = canonical(sealed.snapshot);
  const canonicalParserVersions = canonical(sealed.snapshot.parserVersions);
  const existingSnapshot = database.prepare(`
    SELECT assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
           parser_versions_json, rules_version
    FROM evidence_snapshots WHERE id = ?
  `).get(sealed.snapshot.id) as SnapshotRow | undefined;
  if (existingSnapshot !== undefined) {
    if (
      !acceptExactRetry || storedArtifacts.some((artifact) => artifact.sealed !== 1) ||
      existingSnapshot.assessment_date !== sealed.snapshot.assessmentDate ||
      existingSnapshot.snapshot_json !== canonicalSnapshot ||
      existingSnapshot.manifest_json !== sealed.canonicalManifest ||
      existingSnapshot.manifest_hash !== sealed.snapshot.manifestHash ||
      existingSnapshot.hmac !== sealed.snapshot.hmac ||
      existingSnapshot.parser_versions_json !== canonicalParserVersions ||
      existingSnapshot.rules_version !== sealed.snapshot.rulesVersion
    ) integrityMismatch();
    return;
  }
  for (const artifact of sealed.manifest.artifacts) {
    database.prepare(`
      UPDATE artifacts SET sealed = 1
      WHERE sealed = 0 AND run_id = ? AND artifact_id = ?
    `).run(artifact.runId, artifact.artifactId);
  }
  database.prepare(`
    INSERT INTO evidence_snapshots (
      id, assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
      parser_versions_json, rules_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sealed.snapshot.id,
    sealed.snapshot.assessmentDate,
    canonicalSnapshot,
    sealed.canonicalManifest,
    sealed.snapshot.manifestHash,
    sealed.snapshot.hmac,
    canonicalParserVersions,
    sealed.snapshot.rulesVersion,
  );
}

export function insertSealedEvidence<S extends string, C extends Claim<unknown, S>>(
  database: Database.Database,
  sealed: SealedEvidence<S, C>,
  integrity: EvidencePersistenceIntegrity = DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY,
): void {
  insertSealedEvidenceForOrigin(database, sealed, integrity, "live", false);
}

function insertVerifiedAdministrativeEvidence<
  S extends string,
  C extends Claim<unknown, S>,
>(
  database: Database.Database,
  sealed: SealedEvidence<S, C, "administrative">,
  integrity: EvidencePersistenceIntegrity,
): void {
  insertSealedEvidenceForOrigin(database, sealed, integrity, "administrative", true);
}

/** @internal Synchronous verified bundle reader for a single SQLite view. */
export function loadVerifiedEvidenceBundle<
  S extends string,
  C extends Claim<unknown, S>,
>(
  database: Database.Database,
  id: string,
  integrity: EvidenceIntegrity,
  expected: VerifiedLoadExpectations<S> = {},
): VerifiedStoredEvidenceBundle<S, C> {
  const row = database.prepare(`
    SELECT assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
           parser_versions_json, rules_version
    FROM evidence_snapshots WHERE id = ?
  `).get(id) as SnapshotRow | undefined;
  if (row === undefined) throw new Error("evidence_not_found");

  let snapshot: EvidenceSnapshot<S, C>;
  let manifest: EvidenceManifest<S, C>;
  try {
    snapshot = JSON.parse(row.snapshot_json) as EvidenceSnapshot<S, C>;
    manifest = JSON.parse(row.manifest_json) as EvidenceManifest<S, C>;
  } catch {
    integrityMismatch();
  }
  if (assertSealedEvidenceStructure(
    { snapshot, manifest },
    structuralSourceIds(snapshot, manifest),
  ) !== "live") integrityMismatch();
  const canonicalManifest = integrity.canonical(manifest);
  if (snapshot.id !== id || row.assessment_date !== snapshot.assessmentDate ||
    row.rules_version !== snapshot.rulesVersion ||
    row.parser_versions_json !== integrity.canonical(snapshot.parserVersions) ||
    integrity.canonical(manifest.snapshot) !== integrity.canonical(snapshotPayload(snapshot)) ||
    !secureHexEqual(row.manifest_hash, integrity.hash(canonicalManifest)) ||
    !secureHexEqual(snapshot.manifestHash, row.manifest_hash) ||
    !secureHexEqual(row.hmac, integrity.sign(canonicalManifest)) ||
    !secureHexEqual(snapshot.hmac, row.hmac) ||
    (expected.assessmentDate !== undefined && snapshot.assessmentDate !== expected.assessmentDate) ||
    (expected.rulesVersion !== undefined && snapshot.rulesVersion !== expected.rulesVersion) ||
    (expected.parserVersions !== undefined &&
      integrity.canonical(snapshot.parserVersions) !== integrity.canonical(expected.parserVersions)) ||
    snapshot.artifactIds.length !== manifest.artifacts.length ||
    integrity.canonical(snapshot.artifactIds) !==
      integrity.canonical(manifest.artifacts.map(({ artifactId }) => artifactId))) {
    integrityMismatch();
  }

  const artifactsById = new Map<string, LiveCapturedArtifact<S>>();
  for (const expectedArtifact of manifest.artifacts) {
    const stored = database.prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts
       WHERE run_id = ? AND artifact_id = ? AND sealed = 1`,
    ).get(expectedArtifact.runId, expectedArtifact.artifactId) as StoredArtifactRow<S> | undefined;
    if (stored === undefined ||
      stored.origin !== "live" ||
      integrity.canonical(liveRowProvenance(stored)) !== integrity.canonical(expectedArtifact) ||
      stored.byte_length !== stored.bytes.byteLength ||
      bytesHash(stored.bytes) !== expectedArtifact.sha256 ||
      artifactsById.has(expectedArtifact.artifactId)) integrityMismatch();
    artifactsById.set(expectedArtifact.artifactId, capturedArtifactFromRow(stored));
  }
  const entries: CapturedEntry<S>[] = manifest.entries.map((entry) => ({
    sourceId: entry.sourceId,
    navigationUrl: entry.navigationUrl,
    ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
    resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
    artifacts: entry.artifactIds.map((artifactId) => {
      const artifact = artifactsById.get(artifactId);
      if (artifact === undefined) integrityMismatch();
      return { ...artifact, bytes: new Uint8Array(artifact.bytes) };
    }),
    ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
  }));
  return { snapshot, manifest, entries };
}

/** @internal Synchronous verifier for callers that must remain inside a SQLite transaction. */
export function loadVerifiedEvidence<S extends string, C extends Claim<unknown, S>>(
  database: Database.Database,
  id: string,
  key: string,
  expected: VerifiedLoadExpectations<S> = {},
): EvidenceSnapshot<S, C> {
  return loadVerifiedEvidenceBundle<S, C>(
    database,
    id,
    createEvidenceIntegrity(key),
    expected,
  ).snapshot;
}

const SLOVENIA_PARSER_VERSIONS: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
};

/** @internal Verified, byte-free Knowledge projection for the closed V2 contract. */
export function loadVerifiedCountryEvidenceV2(
  database: Database.Database,
  id: string,
  key: string,
): VerifiedCountryEvidenceInputV2 {
  const verified = loadVerifiedEvidenceBundle<SloveniaSourceId, ColdStartEvidenceClaimV2>(
    database,
    id,
    createEvidenceIntegrity(key),
    {
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    },
  );
  const { snapshot, manifest } = verified;
  const entries: readonly KnowledgeEvidenceEntry[] = manifest.entries.map((entry) => ({
    sourceId: entry.sourceId,
    navigationUrl: entry.navigationUrl,
    ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
    resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
    artifactIds: [...entry.artifactIds],
    ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
  }));
  return {
    snapshot,
    entries,
    artifacts: manifest.artifacts.map((artifact) => ({ ...artifact })),
  };
}

/** @internal Verified, byte-free Knowledge projection for transactional consumers. */
export function loadVerifiedCountryEvidence(
  database: Database.Database,
  id: string,
  key: string,
): VerifiedCountryEvidenceInput {
  const verified = loadVerifiedEvidenceBundle<SloveniaSourceId, ColdStartEvidenceClaim>(
    database,
    id,
    createEvidenceIntegrity(key),
    { parserVersions: SLOVENIA_PARSER_VERSIONS, rulesVersion: "vs2-si-evidence@2" },
  );
  const { snapshot, manifest } = verified;
  const entries: readonly KnowledgeEvidenceEntry[] = manifest.entries.map((entry) => ({
    sourceId: entry.sourceId,
    navigationUrl: entry.navigationUrl,
    ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
    resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
    artifactIds: [...entry.artifactIds],
    ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
  }));
  return {
    snapshot,
    entries,
    artifacts: manifest.artifacts.map((artifact) => ({ ...artifact })),
  };
}

export class SqliteEvidenceStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> implements EvidenceWriteStore<S, C> {
  constructor(private readonly database: Database.Database) {}

  async appendArtifact(borrowedArtifact: LiveCapturedArtifact<S>): Promise<void> {
    const artifact = ownedDataSnapshot(borrowedArtifact);
    insertLiveArtifact(this.database, artifact);
  }

  async seal(borrowedSealed: SealedEvidence<S, C>): Promise<void> {
    const sealed = ownedDataSnapshot(borrowedSealed);
    const sealTransaction = this.database.transaction(() =>
      insertSealedEvidence(this.database, sealed, DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY)
    );
    sealTransaction();
  }

  async loadVerified(
    id: string,
    key: string,
    borrowedExpected: VerifiedLoadExpectations<S> = {},
  ): Promise<EvidenceSnapshot<S, C>> {
    const expected = ownedDataSnapshot(borrowedExpected);
    return loadVerifiedEvidence(this.database, id, key, expected);
  }

  async loadVerifiedBundle(
    id: string,
    key: string,
    borrowedExpected: VerifiedLoadExpectations<S> = {},
  ): Promise<VerifiedEvidenceBundle<S, C>> {
    const expected = ownedDataSnapshot(borrowedExpected);
    const read = this.database.transaction(() => loadVerifiedEvidenceBundle<S, C>(
      this.database,
      id,
      createEvidenceIntegrity(key),
      expected,
    ));
    const verified = read();
    return {
      snapshot: verified.snapshot,
      entries: verified.entries.map((entry): ParserEntry<S> => ({
        ...entry,
        artifacts: entry.artifacts.map((artifact) => ({
          ...artifact,
          bytes: new Uint8Array(artifact.bytes),
        })),
      })),
    };
  }

  async loadVerifiedCountryEvidence(
    id: string,
    key: string,
  ): Promise<VerifiedCountryEvidenceInput> {
    return loadVerifiedCountryEvidence(this.database, id, key);
  }

  async loadVerifiedCountryEvidenceV2(
    id: string,
    key: string,
  ): Promise<VerifiedCountryEvidenceInputV2> {
    return loadVerifiedCountryEvidenceV2(this.database, id, key);
  }
}

export class SqliteAdministrativeEvidenceStore<
  S extends string,
  C extends Claim<unknown, S>,
> implements EvidenceWriteStore<S, C, "administrative"> {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
  ) {
    this.database.pragma("busy_timeout = 5000");
  }

  async appendArtifact(
    borrowedArtifact: AdministrativeCapturedArtifact<S>,
  ): Promise<void> {
    const artifact = ownedDataSnapshot(borrowedArtifact);
    const appendTransaction = this.database.transaction(() =>
      insertAdministrativeArtifact(this.database, artifact)
    );
    appendTransaction.immediate();
  }

  async seal(
    borrowedSealed: SealedEvidence<S, C, "administrative">,
  ): Promise<void> {
    const sealed = ownedDataSnapshot(borrowedSealed);
    verifySealedEvidenceForInsert(sealed, this.integrity);
    const sealTransaction = this.database.transaction(() =>
      insertVerifiedAdministrativeEvidence(
        this.database,
        sealed,
        this.integrity,
      )
    );
    sealTransaction.immediate();
  }
}
