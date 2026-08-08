import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";
import type {
  EvidenceSnapshot,
  LiveCapturedArtifact,
  ParserEntry,
  SourceId,
} from "../../research/contracts";
import {
  EVIDENCE_SOURCE_IDS,
  type EvidenceManifest,
  type SealedEvidence,
} from "../../research/run";

interface SnapshotRow {
  readonly assessment_date: string;
  readonly snapshot_json: string;
  readonly manifest_json: string;
  readonly manifest_hash: string;
  readonly hmac: string;
  readonly parser_versions_json: string;
  readonly rules_version: string;
}

interface ArtifactRow {
  readonly artifact_id: string;
  readonly role: string;
  readonly url: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly captured_at: string;
  readonly response_status: number;
  readonly response_url: string;
  readonly request_json: string;
}

export interface VerifiedEvidenceBundle {
  readonly snapshot: EvidenceSnapshot;
  readonly entries: readonly ParserEntry[];
}

export interface VerifiedLoadExpectations {
  readonly assessmentDate?: string;
  readonly parserVersions?: Readonly<Record<SourceId, string>>;
  readonly rulesVersion?: string;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function sourceIdFromArtifactId(artifactId: string): SourceId {
  const sourceId = EVIDENCE_SOURCE_IDS.find((value) => artifactId.startsWith(`${value}:`));
  if (sourceId === undefined) throw new Error("artifact_source_missing");
  return sourceId;
}

function bytesHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function snapshotPayload(snapshot: EvidenceSnapshot): EvidenceManifest["snapshot"] {
  return {
    id: snapshot.id,
    assessmentDate: snapshot.assessmentDate,
    artifactIds: snapshot.artifactIds,
    claims: snapshot.claims,
    blockers: snapshot.blockers,
    coverage: snapshot.coverage,
    parserVersions: snapshot.parserVersions,
    rulesVersion: snapshot.rulesVersion,
  };
}

export class SqliteEvidenceStore {
  constructor(private readonly database: Database.Database) {}

  async appendArtifact(artifact: LiveCapturedArtifact): Promise<void> {
    if (artifact.origin !== "live" || bytesHash(artifact.bytes) !== artifact.sha256) {
      integrityMismatch();
    }
    const existing = this.database.prepare(
      "SELECT sha256, bytes FROM artifacts WHERE artifact_id = ?",
    ).get(artifact.artifactId) as Pick<ArtifactRow, "sha256" | "bytes"> | undefined;
    if (existing !== undefined) {
      if (existing.sha256 !== artifact.sha256 || bytesHash(existing.bytes) !== artifact.sha256) {
        integrityMismatch();
      }
      return;
    }
    this.database.prepare(`
      INSERT INTO artifacts (
        artifact_id, source_id, role, url, media_type, sha256, bytes, origin,
        captured_at, response_status, response_url, request_json, sealed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, 0)
    `).run(
      artifact.artifactId,
      sourceIdFromArtifactId(artifact.artifactId),
      artifact.role,
      artifact.url,
      artifact.mediaType,
      artifact.sha256,
      artifact.bytes,
      artifact.capturedAt,
      artifact.responseStatus,
      artifact.responseUrl,
      canonicalJson(artifact.request),
    );
  }

  async seal(sealed: SealedEvidence): Promise<void> {
    const sealTransaction = this.database.transaction(() => {
      for (const expected of sealed.manifest.artifactHashes) {
        const row = this.database.prepare(
          "SELECT artifact_id, sha256, bytes FROM artifacts WHERE artifact_id = ?",
        ).get(expected.artifactId) as ArtifactRow | undefined;
        if (
          row === undefined ||
          row.sha256 !== expected.sha256 ||
          bytesHash(row.bytes) !== expected.sha256
        ) {
          integrityMismatch();
        }
      }
      const placeholders = sealed.snapshot.artifactIds.map(() => "?").join(", ");
      this.database.prepare(
        `UPDATE artifacts SET sealed = 1 WHERE sealed = 0 AND artifact_id IN (${placeholders})`,
      ).run(...sealed.snapshot.artifactIds);
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
    expected: VerifiedLoadExpectations = {},
  ): Promise<EvidenceSnapshot> {
    const row = this.database.prepare(`
      SELECT assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
             parser_versions_json, rules_version
      FROM evidence_snapshots WHERE id = ?
    `).get(id) as SnapshotRow | undefined;
    if (row === undefined) throw new Error("evidence_not_found");

    let snapshot: EvidenceSnapshot;
    let manifest: EvidenceManifest;
    try {
      snapshot = JSON.parse(row.snapshot_json) as EvidenceSnapshot;
      manifest = JSON.parse(row.manifest_json) as EvidenceManifest;
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
      snapshot.artifactIds.length !== manifest.artifactHashes.length ||
      canonicalJson(snapshot.artifactIds) !==
        canonicalJson(manifest.artifactHashes.map((artifact) => artifact.artifactId))
    ) {
      integrityMismatch();
    }
    for (const expectedArtifact of manifest.artifactHashes) {
      const artifact = this.database.prepare(
        "SELECT artifact_id, sha256, bytes FROM artifacts WHERE artifact_id = ? AND sealed = 1",
      ).get(expectedArtifact.artifactId) as ArtifactRow | undefined;
      if (
        artifact === undefined ||
        artifact.sha256 !== expectedArtifact.sha256 ||
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
    expected: VerifiedLoadExpectations = {},
  ): Promise<VerifiedEvidenceBundle> {
    const snapshot = await this.loadVerified(id, key, expected);
    const row = this.database.prepare(
      "SELECT manifest_json FROM evidence_snapshots WHERE id = ?",
    ).get(id) as { readonly manifest_json: string } | undefined;
    if (row === undefined) integrityMismatch();
    const manifest = JSON.parse(row.manifest_json) as EvidenceManifest;
    const entries = manifest.entries.map((entry): ParserEntry => ({
      sourceId: entry.sourceId,
      navigationUrl: entry.navigationUrl,
      ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
      resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
      artifacts: entry.artifactIds.map((artifactId) => {
        const artifact = this.database.prepare(`
          SELECT artifact_id, role, url, media_type, sha256, bytes, captured_at,
                 response_status, response_url, request_json
          FROM artifacts WHERE artifact_id = ? AND sealed = 1
        `).get(artifactId) as ArtifactRow | undefined;
        if (artifact === undefined) integrityMismatch();
        return {
          artifactId: artifact.artifact_id,
          role: artifact.role,
          url: artifact.url,
          mediaType: artifact.media_type,
          sha256: artifact.sha256,
          bytes: new Uint8Array(artifact.bytes),
          origin: "live" as const,
          capturedAt: artifact.captured_at,
          responseStatus: artifact.response_status,
          responseUrl: artifact.response_url,
          request: JSON.parse(artifact.request_json) as LiveCapturedArtifact["request"],
        };
      }),
      ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
    }));
    return { snapshot, entries };
  }
}
