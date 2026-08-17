import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import {
  canonicalJson,
  createEvidenceIntegrity,
  secureHexEqual,
  sha256Text,
} from "../integrity";
import type {
  CapturedEntry,
  Claim,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  ParserEntry,
  SourceId,
} from "../../research/contracts";
import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "../../research/cold-start-contracts";
import type {
  KnowledgeEvidenceEntry,
  VerifiedCountryEvidenceInput,
} from "../../research/country-knowledge";
import {
  assertSealedEvidenceStructure,
  evidenceArtifactProvenance,
  type EvidenceIntegrity,
  type EvidenceArtifactProvenance,
  type EvidenceManifest,
  type SealedEvidence,
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

interface ArtifactRow<S extends string = SourceId> {
  readonly run_id: string;
  readonly artifact_id: string;
  readonly source_id: S;
  readonly role: string;
  readonly url: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly byte_length: number;
  readonly origin: "live";
  readonly captured_at: string;
  readonly response_status: number;
  readonly response_url: string;
  readonly request_json: string;
}

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

function bytesHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function rowProvenance<S extends string>(row: ArtifactRow<S>): EvidenceArtifactProvenance<S> {
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

function capturedArtifactFromRow<S extends string>(row: ArtifactRow<S>): LiveCapturedArtifact<S> {
  const provenance = rowProvenance(row);
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
  byte_length, origin, captured_at, response_status, response_url, request_json
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownedDataSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object") integrityMismatch();
    if (value instanceof Uint8Array) {
      if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
        integrityMismatch();
      }
      return new Uint8Array(value);
    }
    if (active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) integrityMismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) integrityMismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            integrityMismatch();
          }
          copy.push(visit(descriptor.value));
        }
        const expected = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"];
        if (Object.getOwnPropertyNames(value).sort().some((name, index) =>
          name !== expected.sort()[index])) integrityMismatch();
        return copy;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
      const copy = Object.create(null) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          integrityMismatch();
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

function structuralSourceIds<S extends string, C extends Claim<unknown, S>>(
  snapshot: EvidenceSnapshot<S, C>,
  manifest: EvidenceManifest<S, C>,
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
  if (
    !Array.isArray(manifest.entries) ||
    !manifest.entries.every((entry) => isRecord(entry) && typeof entry.sourceId === "string")
  ) integrityMismatch();
  return manifest.entries.map((entry) => entry.sourceId);
}

function snapshotPayload<S extends string, C extends Claim<unknown, S>>(
  snapshot: EvidenceSnapshot<S, C>,
): EvidenceManifest<S, C>["snapshot"] {
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
>(
  sealed: SealedEvidence<S, C>,
  integrity: EvidenceIntegrity,
): void {
  assertSealedEvidenceStructure(
    sealed,
    structuralSourceIds(sealed.snapshot, sealed.manifest),
  );
  const canonicalManifest = integrity.canonical(sealed.manifest);
  if (canonicalManifest !== sealed.canonicalManifest ||
    !secureHexEqual(sealed.snapshot.manifestHash, integrity.hash(canonicalManifest)) ||
    !secureHexEqual(sealed.snapshot.hmac, integrity.sign(canonicalManifest)) ||
    integrity.canonical(sealed.manifest.snapshot) !==
      integrity.canonical(snapshotPayload(sealed.snapshot))) {
    integrityMismatch();
  }
}

/** @internal */
export function insertLiveArtifact<S extends string>(
  database: Database.Database,
  artifact: LiveCapturedArtifact<S>,
  integrity: EvidencePersistenceCanonicalizer = DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY,
): void {
  if (artifact.origin !== "live" || artifact.runId.length === 0 ||
    !(artifact.bytes instanceof Uint8Array) || bytesHash(artifact.bytes) !== artifact.sha256) {
    integrityMismatch();
  }
  const existing = database.prepare(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
  ).get(artifact.runId, artifact.artifactId) as ArtifactRow<S> | undefined;
  const canonical = integrity.canonical.bind(integrity);
  if (existing !== undefined) {
    if (!bytesEqual(existing.bytes, artifact.bytes) ||
      canonical(rowProvenance(existing)) !== canonical(evidenceArtifactProvenance(artifact))) {
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

export function insertSealedEvidence<S extends string, C extends Claim<unknown, S>>(
  database: Database.Database,
  sealed: SealedEvidence<S, C>,
  integrity: EvidencePersistenceIntegrity = DEFAULT_EVIDENCE_PERSISTENCE_INTEGRITY,
): void {
  assertSealedEvidenceStructure(
    sealed,
    structuralSourceIds(sealed.snapshot, sealed.manifest),
  );
  const canonical = integrity.canonical.bind(integrity);
  const hash = integrity.hash.bind(integrity);
  const canonicalManifest = canonical(sealed.manifest);
  if (canonicalManifest !== sealed.canonicalManifest ||
    !secureHexEqual(sealed.snapshot.manifestHash, hash(canonicalManifest)) ||
    canonical(sealed.manifest.snapshot) !== canonical(snapshotPayload(sealed.snapshot))) {
    integrityMismatch();
  }
  for (const expected of sealed.manifest.artifacts) {
    const row = database.prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
    ).get(expected.runId, expected.artifactId) as ArtifactRow<S> | undefined;
    if (
      row === undefined ||
      canonical(rowProvenance(row)) !== canonical(expected) ||
      row.byte_length !== row.bytes.byteLength ||
      bytesHash(row.bytes) !== expected.sha256
    ) {
      integrityMismatch();
    }
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
    canonical(sealed.snapshot),
    sealed.canonicalManifest,
    sealed.snapshot.manifestHash,
    sealed.snapshot.hmac,
    canonical(sealed.snapshot.parserVersions),
    sealed.snapshot.rulesVersion,
  );
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
  assertSealedEvidenceStructure(
    { snapshot, manifest },
    structuralSourceIds(snapshot, manifest),
  );
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
    ).get(expectedArtifact.runId, expectedArtifact.artifactId) as ArtifactRow<S> | undefined;
    if (stored === undefined ||
      integrity.canonical(rowProvenance(stored)) !== integrity.canonical(expectedArtifact) ||
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
> {
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
}
