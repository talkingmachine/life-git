import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";
import type {
  Claim,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  ParserEntry,
  SourceId,
} from "../../research/contracts";
import {
  evidenceArtifactProvenance,
  type EvidenceArtifactProvenance,
  type EvidenceManifest,
  type SealedEvidence,
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

export interface VerifiedEvidenceBundle<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly entries: readonly ParserEntry<S>[];
}

export interface VerifiedLoadExpectations<S extends string = SourceId> {
  readonly assessmentDate?: string;
  readonly parserVersions?: Readonly<Record<S, string>>;
  readonly rulesVersion?: string;
}

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

const ARTIFACT_COLUMNS = `
  run_id, artifact_id, source_id, role, url, media_type, sha256, bytes,
  byte_length, origin, captured_at, response_status, response_url, request_json
`;

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
  };
}

export class SqliteEvidenceStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  constructor(private readonly database: Database.Database) {}

  async appendArtifact(artifact: LiveCapturedArtifact<S>): Promise<void> {
    if (
      artifact.origin !== "live" ||
      artifact.runId.length === 0 ||
      bytesHash(artifact.bytes) !== artifact.sha256
    ) {
      integrityMismatch();
    }
    const existing = this.database.prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
    ).get(artifact.runId, artifact.artifactId) as ArtifactRow<S> | undefined;
    if (existing !== undefined) {
      if (
        !bytesEqual(existing.bytes, artifact.bytes) ||
        canonicalJson(rowProvenance(existing)) !== canonicalJson(evidenceArtifactProvenance(artifact))
      ) {
        integrityMismatch();
      }
      return;
    }
    this.database.prepare(`
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
      artifact.bytes,
      artifact.bytes.byteLength,
      artifact.capturedAt,
      artifact.responseStatus,
      artifact.responseUrl,
      canonicalJson(artifact.request),
    );
  }

  async seal(sealed: SealedEvidence<S, C>): Promise<void> {
    const sealTransaction = this.database.transaction(() => {
      for (const expected of sealed.manifest.artifacts) {
        const row = this.database.prepare(
          `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE run_id = ? AND artifact_id = ?`,
        ).get(expected.runId, expected.artifactId) as ArtifactRow<S> | undefined;
        if (
          row === undefined ||
          canonicalJson(rowProvenance(row)) !== canonicalJson(expected) ||
          row.byte_length !== row.bytes.byteLength ||
          bytesHash(row.bytes) !== expected.sha256
        ) {
          integrityMismatch();
        }
      }
      for (const artifact of sealed.manifest.artifacts) {
        this.database.prepare(`
          UPDATE artifacts SET sealed = 1
          WHERE sealed = 0 AND run_id = ? AND artifact_id = ?
        `).run(artifact.runId, artifact.artifactId);
      }
      this.database.prepare(`
        INSERT INTO evidence_snapshots (
          id, assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
          parser_versions_json, rules_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sealed.snapshot.id,
        sealed.snapshot.assessmentDate,
        canonicalJson(sealed.snapshot),
        sealed.canonicalManifest,
        sealed.snapshot.manifestHash,
        sealed.snapshot.hmac,
        canonicalJson(sealed.snapshot.parserVersions),
        sealed.snapshot.rulesVersion,
      );
    });
    sealTransaction();
  }

  async loadVerified(
    id: string,
    key: string,
    expected: VerifiedLoadExpectations<S> = {},
  ): Promise<EvidenceSnapshot<S, C>> {
    const row = this.database.prepare(`
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
    const canonicalManifest = canonicalJson(manifest);
    if (
      snapshot.id !== id ||
      row.assessment_date !== snapshot.assessmentDate ||
      row.rules_version !== snapshot.rulesVersion ||
      row.parser_versions_json !== canonicalJson(snapshot.parserVersions) ||
      canonicalJson(manifest.snapshot) !== canonicalJson(snapshotPayload(snapshot)) ||
      !secureHexEqual(row.manifest_hash, sha256Text(canonicalManifest)) ||
      !secureHexEqual(snapshot.manifestHash, row.manifest_hash) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalManifest, key)) ||
      !secureHexEqual(snapshot.hmac, row.hmac) ||
      (expected.assessmentDate !== undefined && snapshot.assessmentDate !== expected.assessmentDate) ||
      (expected.rulesVersion !== undefined && snapshot.rulesVersion !== expected.rulesVersion) ||
      (expected.parserVersions !== undefined &&
        canonicalJson(snapshot.parserVersions) !== canonicalJson(expected.parserVersions))
    ) {
      integrityMismatch();
    }
    if (
      snapshot.artifactIds.length !== manifest.artifacts.length ||
      canonicalJson(snapshot.artifactIds) !==
        canonicalJson(manifest.artifacts.map((artifact) => artifact.artifactId))
    ) {
      integrityMismatch();
    }
    for (const expectedArtifact of manifest.artifacts) {
      const artifact = this.database.prepare(
        `SELECT ${ARTIFACT_COLUMNS} FROM artifacts
         WHERE run_id = ? AND artifact_id = ? AND sealed = 1`,
      ).get(expectedArtifact.runId, expectedArtifact.artifactId) as ArtifactRow<S> | undefined;
      if (
        artifact === undefined ||
        canonicalJson(rowProvenance(artifact)) !== canonicalJson(expectedArtifact) ||
        artifact.byte_length !== artifact.bytes.byteLength ||
        bytesHash(artifact.bytes) !== expectedArtifact.sha256
      ) {
        integrityMismatch();
      }
    }
    return snapshot;
  }

  async loadVerifiedBundle(
    id: string,
    key: string,
    expected: VerifiedLoadExpectations<S> = {},
  ): Promise<VerifiedEvidenceBundle<S, C>> {
    const snapshot = await this.loadVerified(id, key, expected);
    const row = this.database.prepare(
      "SELECT manifest_json FROM evidence_snapshots WHERE id = ?",
    ).get(id) as { readonly manifest_json: string } | undefined;
    if (row === undefined) integrityMismatch();
    const manifest = JSON.parse(row.manifest_json) as EvidenceManifest<S, C>;
    const entries = manifest.entries.map((entry): ParserEntry<S> => ({
      sourceId: entry.sourceId,
      navigationUrl: entry.navigationUrl,
      ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
      resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
      artifacts: entry.artifactIds.map((artifactId) => {
        const provenance = manifest.artifacts.find(
          (artifact) => artifact.artifactId === artifactId,
        );
        if (provenance === undefined) integrityMismatch();
        const artifact = this.database.prepare(`
          SELECT ${ARTIFACT_COLUMNS}
          FROM artifacts WHERE run_id = ? AND artifact_id = ? AND sealed = 1
        `).get(provenance.runId, artifactId) as ArtifactRow<S> | undefined;
        if (artifact === undefined) integrityMismatch();
        return {
          artifactId: artifact.artifact_id,
          runId: artifact.run_id,
          sourceId: artifact.source_id,
          role: artifact.role,
          url: artifact.url,
          mediaType: artifact.media_type,
          sha256: artifact.sha256,
          bytes: new Uint8Array(artifact.bytes),
          origin: artifact.origin,
          capturedAt: artifact.captured_at,
          responseStatus: artifact.response_status,
          responseUrl: artifact.response_url,
          request: JSON.parse(artifact.request_json) as LiveCapturedArtifact<S>["request"],
        };
      }),
      ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
    }));
    return { snapshot, entries };
  }
}
