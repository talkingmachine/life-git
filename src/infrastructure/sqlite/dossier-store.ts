import type Database from "better-sqlite3";

import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "../../research/cold-start-contracts";
import {
  buildCountryDossier,
  freezeDossierVersion,
  isCountryDossierPayload,
  type CountryDossierPayload,
  type DossierPublishResult,
  type DossierVersion,
} from "../../research/dossier";
import type { EvidenceSnapshot } from "../../research/contracts";
import type {
  EvidenceManifest,
  SealedEvidence,
} from "../../research/research-plan";
import {
  canonicalJson,
  hmacSha256,
  secureHexEqual,
  sha256Text,
} from "../integrity";
import {
  insertSealedEvidence,
  loadVerifiedEvidence,
} from "./evidence-store";

interface DossierRow {
  readonly id: string;
  readonly country_code: string;
  readonly predecessor_id: string | null;
  readonly evidence_snapshot_id: string;
  readonly schema_version: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly manifest_hash: string;
  readonly hmac: string;
  readonly published_at: string;
}

interface DossierManifest {
  readonly countryCode: "SI";
  readonly schemaVersion: "si-dossier@1";
  readonly payloadHash: string;
  readonly evidenceSnapshotId: string;
  readonly predecessorId?: string;
  readonly publishedAt: string;
}

const EXPECTED_PARSERS: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
};

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function snapshotPayload(
  snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>,
): EvidenceManifest<SloveniaSourceId, ColdStartEvidenceClaim>["snapshot"] {
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

function verifyPreparedEvidence(
  prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
  key: string,
): void {
  const canonicalManifest = canonicalJson(prepared.manifest);
  if (
    prepared.canonicalManifest !== canonicalManifest ||
    canonicalJson(prepared.manifest.snapshot) !== canonicalJson(snapshotPayload(prepared.snapshot)) ||
    !secureHexEqual(prepared.snapshot.manifestHash, sha256Text(canonicalManifest)) ||
    !secureHexEqual(prepared.snapshot.hmac, hmacSha256(canonicalManifest, key))
  ) integrityMismatch();
}

function canonicalInstant(value: string): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function manifestFor(input: {
  readonly payloadHash: string;
  readonly evidenceSnapshotId: string;
  readonly predecessorId?: string;
  readonly publishedAt: string;
}): DossierManifest {
  return {
    countryCode: "SI",
    schemaVersion: "si-dossier@1",
    payloadHash: input.payloadHash,
    evidenceSnapshotId: input.evidenceSnapshotId,
    ...(input.predecessorId === undefined ? {} : { predecessorId: input.predecessorId }),
    publishedAt: input.publishedAt,
  };
}

function isConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    (error as { readonly code: string }).code.startsWith("SQLITE_CONSTRAINT");
}

export class SqliteDossierStore {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
  }

  publishWithEvidence(input: {
    readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
    readonly publishedAt: string;
  }): DossierPublishResult {
    verifyPreparedEvidence(input.preparedEvidence, this.hmacKey);
    const payload = buildCountryDossier(input.preparedEvidence);
    if (!canonicalInstant(input.publishedAt)) throw new Error("invalid_published_at");
    const payloadHash = sha256Text(canonicalJson(payload));

    const publish = this.database.transaction((): DossierPublishResult => {
      insertSealedEvidence(this.database, input.preparedEvidence);
      const existing = this.findByPayload("SI", "si-dossier@1", payloadHash);
      if (existing !== undefined) return { version: existing, created: false };

      let predecessor = this.loadHead("SI", "si-dossier@1");
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const manifest = manifestFor({
          payloadHash,
          evidenceSnapshotId: input.preparedEvidence.snapshot.id,
          ...(predecessor === undefined ? {} : { predecessorId: predecessor.id }),
          publishedAt: input.publishedAt,
        });
        const canonicalManifest = canonicalJson(manifest);
        const manifestHash = sha256Text(canonicalManifest);
        try {
          this.database.prepare(`
            INSERT INTO dossier_versions (
              id, country_code, predecessor_id, evidence_snapshot_id, schema_version,
              payload_json, payload_hash, manifest_hash, hmac, published_at
            ) VALUES (?, 'SI', ?, ?, 'si-dossier@1', ?, ?, ?, ?, ?)
          `).run(
            manifestHash,
            predecessor?.id ?? null,
            input.preparedEvidence.snapshot.id,
            canonicalJson(payload),
            payloadHash,
            manifestHash,
            hmacSha256(canonicalManifest, this.hmacKey),
            input.publishedAt,
          );
          return { version: this.loadVerified(manifestHash), created: true };
        } catch (error) {
          if (!isConstraint(error)) throw error;
          const winner = this.findByPayload("SI", "si-dossier@1", payloadHash);
          if (winner !== undefined) return { version: winner, created: false };
          const currentHead = this.loadHead("SI", "si-dossier@1");
          if (currentHead?.id === predecessor?.id) throw error;
          predecessor = currentHead;
        }
      }
      integrityMismatch();
    });
    return publish.immediate();
  }

  loadVerified(id: string): DossierVersion {
    const seen = new Set<string>();
    const chain: DossierRow[] = [];
    let currentId: string | undefined = id;
    let expectedCountry: string | undefined;
    let expectedSchema: string | undefined;
    while (currentId !== undefined) {
      if (seen.has(currentId)) integrityMismatch();
      seen.add(currentId);
      const row = this.row(currentId, chain.length > 0);
      if (expectedCountry === undefined) {
        expectedCountry = row.country_code;
        expectedSchema = row.schema_version;
      } else if (row.country_code !== expectedCountry || row.schema_version !== expectedSchema) {
        integrityMismatch();
      }
      this.verifyRow(row);
      chain.push(row);
      currentId = row.predecessor_id ?? undefined;
    }

    const row = chain[0]!;
    let payload: CountryDossierPayload;
    try {
      const parsed: unknown = JSON.parse(row.payload_json);
      if (!isCountryDossierPayload(parsed)) integrityMismatch();
      payload = parsed;
    } catch {
      integrityMismatch();
    }
    return freezeDossierVersion({
      id: row.id,
      ordinal: chain.length,
      countryCode: "SI",
      ...(row.predecessor_id === null ? {} : { predecessorId: row.predecessor_id }),
      evidenceSnapshotId: row.evidence_snapshot_id,
      schemaVersion: "si-dossier@1",
      payload,
      payloadHash: row.payload_hash,
      manifestHash: row.manifest_hash,
      hmac: row.hmac,
      publishedAt: row.published_at,
    });
  }

  findByPayload(
    countryCode: "SI",
    schemaVersion: "si-dossier@1",
    payloadHash: string,
  ): DossierVersion | undefined {
    const rows = this.database.prepare(`
      SELECT id FROM dossier_versions
      WHERE country_code = ? AND schema_version = ? AND payload_hash = ?
    `).all(countryCode, schemaVersion, payloadHash) as { readonly id: string }[];
    if (rows.length > 1) integrityMismatch();
    if (rows.length === 0) return undefined;
    const version = this.loadVerified(rows[0]!.id);
    if (version.payloadHash !== payloadHash) integrityMismatch();
    return version;
  }

  loadHead(
    countryCode: "SI",
    schemaVersion: "si-dossier@1",
  ): DossierVersion | undefined {
    const rows = this.database.prepare(`
      SELECT candidate.id
      FROM dossier_versions AS candidate
      WHERE candidate.country_code = ? AND candidate.schema_version = ?
        AND NOT EXISTS (
          SELECT 1 FROM dossier_versions AS successor
          WHERE successor.predecessor_id = candidate.id
        )
    `).all(countryCode, schemaVersion) as { readonly id: string }[];
    if (rows.length > 1) integrityMismatch();
    if (rows.length === 0) {
      const count = this.database.prepare(`
        SELECT COUNT(*) AS count FROM dossier_versions
        WHERE country_code = ? AND schema_version = ?
      `).get(countryCode, schemaVersion) as { readonly count: number };
      if (count.count !== 0) integrityMismatch();
      return undefined;
    }
    const version = this.loadVerified(rows[0]!.id);
    const count = this.database.prepare(`
      SELECT COUNT(*) AS count FROM dossier_versions
      WHERE country_code = ? AND schema_version = ?
    `).get(countryCode, schemaVersion) as { readonly count: number };
    if (count.count !== version.ordinal) integrityMismatch();
    return version;
  }

  private row(id: string, missingIsIntegrityMismatch = false): DossierRow {
    const row = this.database.prepare(`
      SELECT id, country_code, predecessor_id, evidence_snapshot_id, schema_version,
             payload_json, payload_hash, manifest_hash, hmac, published_at
      FROM dossier_versions WHERE id = ?
    `).get(id) as DossierRow | undefined;
    if (row === undefined) {
      if (missingIsIntegrityMismatch) integrityMismatch();
      throw new Error("dossier_not_found");
    }
    return row;
  }

  private verifyRow(row: DossierRow): void {
    if (
      row.country_code !== "SI" || row.schema_version !== "si-dossier@1" ||
      !canonicalInstant(row.published_at)
    ) integrityMismatch();
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json) as unknown;
    } catch {
      integrityMismatch();
    }
    if (
      !isCountryDossierPayload(payload) || canonicalJson(payload) !== row.payload_json ||
      !secureHexEqual(row.payload_hash, sha256Text(canonicalJson(payload)))
    ) integrityMismatch();
    const manifest = manifestFor({
      payloadHash: row.payload_hash,
      evidenceSnapshotId: row.evidence_snapshot_id,
      ...(row.predecessor_id === null ? {} : { predecessorId: row.predecessor_id }),
      publishedAt: row.published_at,
    });
    const canonicalManifest = canonicalJson(manifest);
    if (
      !secureHexEqual(row.manifest_hash, sha256Text(canonicalManifest)) ||
      !secureHexEqual(row.id, row.manifest_hash) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalManifest, this.hmacKey))
    ) integrityMismatch();
    loadVerifiedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>(
      this.database,
      row.evidence_snapshot_id,
      this.hmacKey,
      { parserVersions: EXPECTED_PARSERS, rulesVersion: "vs2-si-evidence@2" },
    );
  }
}
