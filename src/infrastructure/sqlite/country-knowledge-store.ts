import type Database from "better-sqlite3";

import {
  buildSloveniaKnowledgeRevision,
  type InstalledCountryKnowledgeRevision,
  type KnowledgeStatusObservation,
  type SloveniaCountryKnowledgeRevision,
  type VerifiedCountryEvidenceInput,
} from "../../research/country-knowledge";
import type { ClaimKind, SloveniaSourceId } from "../../research/cold-start-contracts";
import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";
import { loadVerifiedCountryEvidence } from "./evidence-store";

export interface CountryKnowledgeStore {
  publish(revision: InstalledCountryKnowledgeRevision): InstalledCountryKnowledgeRevision;
  latest(countryCode: string): InstalledCountryKnowledgeRevision | undefined;
  loadVerified(id: string): InstalledCountryKnowledgeRevision;
  resolveForEvidence(evidenceSnapshotId: string): CountryKnowledgePublication;
  publishCurrentFromEvidence(evidenceSnapshotId: string): CountryKnowledgePublication;
}

export interface CountryKnowledgePublication {
  readonly publishedRevision?: InstalledCountryKnowledgeRevision;
  readonly currentRevision?: InstalledCountryKnowledgeRevision;
}

interface KnowledgeRow {
  readonly id: string;
  readonly country_code: string;
  readonly predecessor_id: string | null;
  readonly trigger_evidence_snapshot_id: string;
  readonly schema_version: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

const CLAIM_KINDS: readonly ClaimKind[] = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
  "duration",
  "general_statutory_prerequisites",
];
const SOURCE_IDS: readonly SloveniaSourceId[] = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
];

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
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

function isStatus(value: unknown): value is KnowledgeStatusObservation["status"] {
  return value === "superseded" || value === "expired" || value === "unresolved";
}

function validOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function decodeRevision(value: unknown): SloveniaCountryKnowledgeRevision {
  if (
    !isRecord(value) || value.schemaVersion !== "country-knowledge@1" ||
    value.packageId !== "SI" || value.observationSchemaVersion !== "si-knowledge@1" ||
    value.countryCode !== "SI" || typeof value.id !== "string" ||
    typeof value.triggerEvidenceSnapshotId !== "string" ||
    (value.predecessorId !== undefined && typeof value.predecessorId !== "string") ||
    !canonicalInstant(value.createdAt) || !Array.isArray(value.formalClaimRefs) ||
    !Array.isArray(value.statusObservations)
  ) integrityMismatch();
  if (value.id !== `country-knowledge:SI:${value.triggerEvidenceSnapshotId}`) {
    integrityMismatch();
  }
  if (!value.formalClaimRefs.every((reference) =>
    isRecord(reference) && typeof reference.claimId === "string" &&
    CLAIM_KINDS.includes(reference.claimKind as ClaimKind) &&
    typeof reference.definitionId === "string" &&
    typeof reference.evidenceSnapshotId === "string"
  )) integrityMismatch();
  if (new Set(value.formalClaimRefs.map((reference) => reference.claimKind)).size !==
    value.formalClaimRefs.length) integrityMismatch();
  if (!value.statusObservations.every((observation) =>
    isRecord(observation) && observation.kind === "source_status" &&
    typeof observation.observationId === "string" &&
    SOURCE_IDS.includes(observation.sourceId as SloveniaSourceId) &&
    isStatus(observation.status) && Array.isArray(observation.affectedClaimKinds) &&
    observation.affectedClaimKinds.length > 0 &&
    observation.affectedClaimKinds.every((kind) => CLAIM_KINDS.includes(kind as ClaimKind)) &&
    typeof observation.evidenceSnapshotId === "string" &&
    isStringArray(observation.artifactIds) && observation.artifactIds.length > 0 &&
    typeof observation.definitionId === "string" &&
    canonicalInstant(observation.capturedAt) &&
    typeof observation.verifiedAt === "string" &&
    validOptionalString(observation, "supersedesObservationId") &&
    validOptionalString(observation, "publishedAt") &&
    validOptionalString(observation, "referencePeriod") &&
    validOptionalString(observation, "effectiveFrom") &&
    validOptionalString(observation, "effectiveTo")
  )) integrityMismatch();
  return deepFreeze(structuredClone(value) as unknown as SloveniaCountryKnowledgeRevision);
}

function rowPayload(row: KnowledgeRow, key: string): SloveniaCountryKnowledgeRevision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload_json) as unknown;
  } catch {
    integrityMismatch();
  }
  const revision = decodeRevision(parsed);
  if (
    canonicalJson(revision) !== row.payload_json ||
    row.id !== revision.id || row.country_code !== revision.countryCode ||
    row.predecessor_id !== (revision.predecessorId ?? null) ||
    row.trigger_evidence_snapshot_id !== revision.triggerEvidenceSnapshotId ||
    row.schema_version !== revision.schemaVersion || row.created_at !== revision.createdAt ||
    !secureHexEqual(row.payload_hash, sha256Text(row.payload_json)) ||
    !secureHexEqual(row.hmac, hmacSha256(row.payload_json, key))
  ) integrityMismatch();
  return revision;
}

function normalizeFailure(error: unknown): never {
  if (error instanceof Error && error.message === "knowledge_not_found") throw error;
  integrityMismatch();
}

export class SqliteCountryKnowledgeStore implements CountryKnowledgeStore {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
  }

  publish(revisionInput: InstalledCountryKnowledgeRevision): InstalledCountryKnowledgeRevision {
    let revision: SloveniaCountryKnowledgeRevision;
    try {
      revision = decodeRevision(revisionInput);
    } catch (error) {
      normalizeFailure(error);
    }
    const publish = this.database.transaction((): InstalledCountryKnowledgeRevision => {
      const existingRows = this.database.prepare(`
        SELECT id FROM country_knowledge_revisions
        WHERE country_code = ? AND trigger_evidence_snapshot_id = ?
      `).all(revision.countryCode, revision.triggerEvidenceSnapshotId) as { readonly id: string }[];
      if (existingRows.length > 1) integrityMismatch();
      if (existingRows.length === 1) {
        const existing = this.loadVerified(existingRows[0]!.id);
        if (canonicalJson(existing) !== canonicalJson(revision)) integrityMismatch();
        return existing;
      }

      const predecessor = this.latest(revision.countryCode);
      if (revision.predecessorId !== predecessor?.id) integrityMismatch();
      return this.insertVerified(revision, predecessor);
    });
    try {
      return publish.immediate();
    } catch (error) {
      normalizeFailure(error);
    }
  }

  latest(countryCode: string): InstalledCountryKnowledgeRevision | undefined {
    if (!/^[A-Z]{2}$/.test(countryCode)) return undefined;
    try {
      const rows = this.database.prepare(`
        SELECT candidate.id
        FROM country_knowledge_revisions AS candidate
        WHERE candidate.country_code = ?
          AND NOT EXISTS (
            SELECT 1 FROM country_knowledge_revisions AS successor
            WHERE successor.predecessor_id = candidate.id
          )
      `).all(countryCode) as { readonly id: string }[];
      if (rows.length > 1) integrityMismatch();
      const count = this.database.prepare(`
        SELECT COUNT(*) AS count FROM country_knowledge_revisions WHERE country_code = ?
      `).get(countryCode) as { readonly count: number };
      if (rows.length === 0) {
        if (count.count !== 0) integrityMismatch();
        return undefined;
      }
      if (countryCode !== "SI") integrityMismatch();
      const loaded = this.loadChain(rows[0]!.id, false);
      if (loaded.length !== count.count) integrityMismatch();
      return loaded.revision;
    } catch (error) {
      normalizeFailure(error);
    }
  }

  loadVerified(id: string): InstalledCountryKnowledgeRevision {
    try {
      return this.loadChain(id, true).revision;
    } catch (error) {
      normalizeFailure(error);
    }
  }

  resolveForEvidence(evidenceSnapshotId: string): CountryKnowledgePublication {
    try {
      const evidence = loadVerifiedCountryEvidence(
        this.database,
        evidenceSnapshotId,
        this.hmacKey,
      );
      return this.resolveVerifiedEvidence(evidence);
    } catch {
      integrityMismatch();
    }
  }

  publishCurrentFromEvidence(evidenceSnapshotId: string): CountryKnowledgePublication {
    const publish = this.database.transaction((): CountryKnowledgePublication => {
      const evidence = loadVerifiedCountryEvidence(
        this.database,
        evidenceSnapshotId,
        this.hmacKey,
      );
      const bound = this.resolveVerifiedEvidence(evidence);
      if (bound.publishedRevision !== undefined) return bound;
      const createdAt = evidence.artifacts
        .filter(({ sourceId }) => sourceId !== "cbr-eur")
        .map(({ capturedAt }) => capturedAt)
        .sort()
        .at(-1);
      if (createdAt === undefined) return bound;
      const predecessor = this.latest("SI");
      const revision = buildSloveniaKnowledgeRevision({
        evidence,
        ...(predecessor === undefined ? {} : { predecessor }),
        createdAt,
      });
      if (revision === undefined) return bound;
      const publishedRevision = this.insertVerified(revision, predecessor);
      return { publishedRevision, currentRevision: publishedRevision };
    });
    try {
      return publish.immediate();
    } catch {
      integrityMismatch();
    }
  }

  private resolveVerifiedEvidence(
    evidence: VerifiedCountryEvidenceInput,
  ): CountryKnowledgePublication {
    const baselineId = evidence.snapshot.knowledgeBaselineRevisionId;
    let baseline: InstalledCountryKnowledgeRevision | undefined;
    if (baselineId !== undefined) {
      baseline = this.loadVerified(baselineId);
      if (baseline.countryCode !== "SI") integrityMismatch();
    }
    const triggeredRows = this.database.prepare(`
      SELECT id FROM country_knowledge_revisions
      WHERE country_code = 'SI' AND trigger_evidence_snapshot_id = ?
    `).all(evidence.snapshot.id) as { readonly id: string }[];
    if (triggeredRows.length > 1) integrityMismatch();
    if (triggeredRows.length === 0) {
      return baseline === undefined ? {} : { currentRevision: baseline };
    }
    const publishedRevision = this.loadVerified(triggeredRows[0]!.id);
    return { publishedRevision, currentRevision: publishedRevision };
  }

  private insertVerified(
    revision: SloveniaCountryKnowledgeRevision,
    predecessor: SloveniaCountryKnowledgeRevision | undefined,
  ): InstalledCountryKnowledgeRevision {
    this.verifyExpectedRevision(revision, predecessor);
    const payloadJson = canonicalJson(revision);
    this.database.prepare(`
      INSERT INTO country_knowledge_revisions (
        id, country_code, predecessor_id, trigger_evidence_snapshot_id,
        schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id,
      revision.countryCode,
      revision.predecessorId ?? null,
      revision.triggerEvidenceSnapshotId,
      revision.schemaVersion,
      payloadJson,
      sha256Text(payloadJson),
      hmacSha256(payloadJson, this.hmacKey),
      revision.createdAt,
    );
    return this.loadVerified(revision.id);
  }

  private loadChain(
    id: string,
    firstMissingIsNotFound: boolean,
  ): { readonly revision: SloveniaCountryKnowledgeRevision; readonly length: number } {
    const seen = new Set<string>();
    const chain: SloveniaCountryKnowledgeRevision[] = [];
    let currentId: string | undefined = id;
    while (currentId !== undefined) {
      if (seen.has(currentId)) integrityMismatch();
      seen.add(currentId);
      const row = this.row(currentId);
      if (row === undefined) {
        if (chain.length === 0 && firstMissingIsNotFound) throw new Error("knowledge_not_found");
        integrityMismatch();
      }
      const revision = rowPayload(row, this.hmacKey);
      chain.push(revision);
      currentId = revision.predecessorId;
    }
    let predecessor: SloveniaCountryKnowledgeRevision | undefined;
    for (const revision of [...chain].reverse()) {
      this.verifyExpectedRevision(revision, predecessor);
      predecessor = revision;
    }
    return { revision: chain[0]!, length: chain.length };
  }

  private row(id: string): KnowledgeRow | undefined {
    return this.database.prepare(`
      SELECT id, country_code, predecessor_id, trigger_evidence_snapshot_id,
             schema_version, payload_json, payload_hash, hmac, created_at
      FROM country_knowledge_revisions WHERE id = ?
    `).get(id) as KnowledgeRow | undefined;
  }

  private verifyExpectedRevision(
    revision: SloveniaCountryKnowledgeRevision,
    predecessor: SloveniaCountryKnowledgeRevision | undefined,
  ): void {
    const evidence = loadVerifiedCountryEvidence(
      this.database,
      revision.triggerEvidenceSnapshotId,
      this.hmacKey,
    );
    const expected = buildSloveniaKnowledgeRevision({
      evidence,
      ...(predecessor === undefined ? {} : { predecessor }),
      createdAt: revision.createdAt,
    });
    if (expected === undefined || canonicalJson(expected) !== canonicalJson(revision)) {
      integrityMismatch();
    }
  }
}
