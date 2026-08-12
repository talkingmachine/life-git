import type Database from "better-sqlite3";
import { z } from "zod";

import {
  type FrontierMarker,
  type RankingSnapshot,
  type ShortlistSnapshot,
} from "../../application/place-frontier";
import { reconstructFrontierMarker } from "../../application/country-resolution-contracts";
import { reconstructPlaceRanking } from "../../decision/place-ranker";
import type { PreferenceProfileSnapshot } from "../../decision/preference-profile";
import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";

type SnapshotKind = "ranking" | "shortlist";

interface SnapshotRow {
  readonly id: string;
  readonly run_id: string;
  readonly kind: SnapshotKind;
  readonly schema_version: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const nonEmptyStringSchema = z.string().min(1);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const instantSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});
const decimalSchema = z.string().refine((value) => {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  return Number.isFinite(Number(value));
});
const criterionSchema = z.enum([
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
]);
const factorStateSchema = z.enum(["known", "missing", "stale", "future", "not_comparable"]);

const coordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).strict();

const factorSchema = z.object({
  criterionId: criterionSchema,
  state: factorStateSchema,
  match: decimalSchema.optional(),
  requirementStatus: z.enum(["matches", "does_not_match"]).optional(),
  observationId: nonEmptyStringSchema.optional(),
  evaluatorVersion: nonEmptyStringSchema,
}).strict();

const contributionSchema = z.object({
  criterionId: criterionSchema,
  state: factorStateSchema,
  effectiveMatch: decimalSchema,
  weightedContribution: decimalSchema,
  observationId: nonEmptyStringSchema.optional(),
}).strict();

const rankedPlaceSchema = z.object({
  countryCode: countryCodeSchema,
  label: nonEmptyStringSchema,
  flag: nonEmptyStringSchema,
  coordinate: coordinateSchema,
  factors: z.array(factorSchema),
  rank: z.number().int().positive(),
  relevance: decimalSchema,
  coverage: decimalSchema,
  contributions: z.array(contributionSchema),
}).strict();

const requiredMismatchSchema = z.object({
  countryCode: countryCodeSchema,
  criterionId: criterionSchema,
  observationId: nonEmptyStringSchema,
}).strict();

const rankingSchema = z.object({
  schemaVersion: z.literal("place-ranking@1"),
  id: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  profileSnapshotId: sha256Schema,
  preferenceProfileSnapshotId: sha256Schema,
  assessmentAt: instantSchema,
  contextHash: sha256Schema,
  knowledgeRevisionIds: z.record(countryCodeSchema, nonEmptyStringSchema.nullable()),
  ordered: z.array(rankedPlaceSchema),
  excludedPlaces: z.array(z.object({
    countryCode: countryCodeSchema,
    label: nonEmptyStringSchema,
    flag: nonEmptyStringSchema,
    coordinate: coordinateSchema,
    factors: z.array(factorSchema),
  }).strict()),
  excluded: z.array(requiredMismatchSchema),
  rulesVersion: z.literal("place-ranker@1"),
  createdAt: instantSchema,
}).strict();

const shortlistEnvelopeSchema = z.object({
  schemaVersion: z.literal("place-shortlist@1"),
  id: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  rankingSnapshotId: nonEmptyStringSchema,
  markers: z.array(z.unknown()),
  rulesVersion: z.literal("country-frontier@1"),
  createdAt: instantSchema,
}).strict();

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function normalizeStoreFailure(error: unknown): never {
  if (error instanceof Error && error.message === "snapshot_not_found") throw error;
  integrityMismatch();
}

function expectedContextHash(snapshot: RankingSnapshot): string {
  return sha256Text(canonicalJson({
    runId: snapshot.runId,
    profileId: snapshot.profileSnapshotId,
    preferenceProfileId: snapshot.preferenceProfileSnapshotId,
    assessmentAt: snapshot.assessmentAt,
    rankingSnapshotId: snapshot.id,
  }));
}

function uniqueCountryCodes(snapshot: RankingSnapshot): readonly string[] {
  return [...new Set([
    ...snapshot.ordered.map(({ countryCode }) => countryCode),
    ...snapshot.excluded.map(({ countryCode }) => countryCode),
  ])];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function decodeRanking(value: unknown): RankingSnapshot {
  const parsed = rankingSchema.parse(value) as RankingSnapshot;
  const orderedCodes = parsed.ordered.map(({ countryCode }) => countryCode);
  const excludedRows = parsed.excluded.map(({ countryCode, criterionId }) =>
    `${countryCode}:${criterionId}`);
  const knowledgeCodes = Object.keys(parsed.knowledgeRevisionIds);
  if (
    parsed.id !== `${parsed.runId}:ranking` ||
    parsed.createdAt !== parsed.assessmentAt ||
    parsed.contextHash !== expectedContextHash(parsed) ||
    new Set(orderedCodes).size !== orderedCodes.length ||
    parsed.ordered.some(({ rank }, index) => rank !== index + 1) ||
    new Set(excludedRows).size !== excludedRows.length ||
    orderedCodes.some((countryCode) => parsed.excluded.some((row) =>
      row.countryCode === countryCode)) ||
    !sameStringSet(knowledgeCodes, uniqueCountryCodes(parsed))
  ) integrityMismatch();
  return structuredClone(parsed);
}

function expectedChildRunId(runId: string, countryCode: string): string {
  return `frontier-country:${sha256Text(canonicalJson({ parentRunId: runId, countryCode }))}`;
}

function decodeMarker(
  value: unknown,
  ranking: RankingSnapshot,
  runId: string,
  index: number,
): FrontierMarker {
  const marker = reconstructFrontierMarker(value, {
    profileSnapshotId: ranking.profileSnapshotId,
  });
  const ranked = ranking.ordered[index];
  if (
    ranked === undefined ||
    marker.rank !== ranked.rank ||
    canonicalJson(marker.country) !== canonicalJson({
      countryCode: ranked.countryCode,
      label: ranked.label,
      flag: ranked.flag,
      coordinate: ranked.coordinate,
    }) ||
    marker.countryCheckRunId !== expectedChildRunId(runId, marker.country.countryCode) ||
    (marker.currentKnowledgeRevisionId === undefined) !==
      (marker.knowledgeUpdatedAt === undefined) ||
    (marker.updatedKnowledgeRevisionId !== undefined &&
      marker.updatedKnowledgeRevisionId !== marker.currentKnowledgeRevisionId)
  ) integrityMismatch();
  return marker;
}

function decodeShortlist(value: unknown, ranking: RankingSnapshot): ShortlistSnapshot {
  const envelope = shortlistEnvelopeSchema.parse(value);
  if (
    envelope.id !== `${envelope.runId}:shortlist` ||
    envelope.runId !== ranking.runId ||
    envelope.rankingSnapshotId !== ranking.id
  ) integrityMismatch();
  const markers = envelope.markers.map((marker, index) =>
    decodeMarker(marker, ranking, envelope.runId, index));
  const markerCodes = markers.map(({ country }) => country.countryCode);
  const markerRanks = markers.map(({ rank }) => rank);
  const nonRedCount = markers.filter(({ formalVerdict }) => formalVerdict.marker !== "red").length;
  if (
    new Set(markerCodes).size !== markerCodes.length ||
    new Set(markerRanks).size !== markerRanks.length ||
    !(nonRedCount === 5 || markers.length === ranking.ordered.length)
  ) integrityMismatch();
  return structuredClone({ ...envelope, markers }) as ShortlistSnapshot;
}

export class SqlitePlaceFrontierStore {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
    private readonly preferences: {
      loadPreferenceVerified(id: string): Promise<PreferenceProfileSnapshot>;
    },
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
  }

  async appendRanking(snapshotInput: RankingSnapshot): Promise<void> {
    try {
      const snapshot = decodeRanking(snapshotInput);
      await this.verifyRankingSemantics(snapshot);
      const append = this.database.transaction(() => {
        this.insertOrIgnore("ranking", snapshot);
        const stored = this.loadRanking(snapshot.runId);
        if (canonicalJson(stored) !== canonicalJson(snapshot)) integrityMismatch();
      });
      append.immediate();
    } catch (error) {
      normalizeStoreFailure(error);
    }
  }

  async appendShortlist(snapshotInput: ShortlistSnapshot): Promise<void> {
    try {
      const verifiedRanking = await this.loadRankingVerified(snapshotInput.runId);
      const append = this.database.transaction(() => {
        const ranking = this.loadRanking(snapshotInput.runId);
        if (canonicalJson(ranking) !== canonicalJson(verifiedRanking)) integrityMismatch();
        const snapshot = decodeShortlist(snapshotInput, ranking);
        this.insertOrIgnore("shortlist", snapshot);
        const stored = this.loadShortlist(snapshot.runId, ranking);
        if (canonicalJson(stored) !== canonicalJson(snapshot)) integrityMismatch();
      });
      append.immediate();
    } catch (error) {
      normalizeStoreFailure(error);
    }
  }

  async loadRankingVerified(idOrRunId: string): Promise<RankingSnapshot> {
    try {
      const ranking = this.loadRanking(idOrRunId);
      await this.verifyRankingSemantics(ranking);
      return ranking;
    } catch (error) {
      normalizeStoreFailure(error);
    }
  }

  async loadShortlistVerified(idOrRunId: string): Promise<ShortlistSnapshot> {
    try {
      const shortlistEnvelope = this.loadPayload("shortlist", idOrRunId);
      const rankingSnapshotId = (shortlistEnvelope as { readonly rankingSnapshotId?: unknown })
        .rankingSnapshotId;
      if (typeof rankingSnapshotId !== "string" || rankingSnapshotId.length === 0) integrityMismatch();
      const ranking = await this.loadRankingVerified(rankingSnapshotId);
      return decodeShortlist(shortlistEnvelope, ranking);
    } catch (error) {
      normalizeStoreFailure(error);
    }
  }

  private async verifyRankingSemantics(snapshot: RankingSnapshot): Promise<void> {
    const preferences = await this.preferences.loadPreferenceVerified(
      snapshot.preferenceProfileSnapshotId,
    );
    if (preferences.id !== snapshot.preferenceProfileSnapshotId) integrityMismatch();
    reconstructPlaceRanking({
      assessmentAt: snapshot.assessmentAt.slice(0, 10),
      preferences,
      ordered: snapshot.ordered,
      excludedPlaces: snapshot.excludedPlaces,
      excluded: snapshot.excluded,
      rulesVersion: snapshot.rulesVersion,
    });
  }

  private insertOrIgnore(
    kind: SnapshotKind,
    snapshot: RankingSnapshot | ShortlistSnapshot,
  ): void {
    const payloadJson = canonicalJson(snapshot);
    this.database.prepare(`
      INSERT INTO place_frontier_snapshots (
        id, run_id, kind, schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      snapshot.id,
      snapshot.runId,
      kind,
      snapshot.schemaVersion,
      payloadJson,
      sha256Text(payloadJson),
      hmacSha256(payloadJson, this.hmacKey),
      snapshot.createdAt,
    );
  }

  private loadRanking(idOrRunId: string): RankingSnapshot {
    return decodeRanking(this.loadPayload("ranking", idOrRunId));
  }

  private loadShortlist(idOrRunId: string, ranking: RankingSnapshot): ShortlistSnapshot {
    return decodeShortlist(this.loadPayload("shortlist", idOrRunId), ranking);
  }

  private loadPayload(kind: SnapshotKind, idOrRunId: string): unknown {
    const rows = this.database.prepare(`
      SELECT id, run_id, kind, schema_version, payload_json, payload_hash, hmac, created_at
      FROM place_frontier_snapshots
      WHERE kind = ? AND (id = ? OR run_id = ?)
    `).all(kind, idOrRunId, idOrRunId) as SnapshotRow[];
    if (rows.length === 0) throw new Error("snapshot_not_found");
    if (rows.length !== 1) integrityMismatch();
    return this.verifyRow(rows[0]!, kind);
  }

  private verifyRow(row: SnapshotRow, expectedKind: SnapshotKind): unknown {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload_json) as unknown;
    } catch {
      integrityMismatch();
    }
    if (
      typeof payload !== "object" || payload === null ||
      row.kind !== expectedKind ||
      row.id !== (payload as { readonly id?: unknown }).id ||
      row.run_id !== (payload as { readonly runId?: unknown }).runId ||
      row.schema_version !== (payload as { readonly schemaVersion?: unknown }).schemaVersion ||
      row.created_at !== (payload as { readonly createdAt?: unknown }).createdAt ||
      row.payload_json !== canonicalJson(payload) ||
      !secureHexEqual(row.payload_hash, sha256Text(row.payload_json)) ||
      !secureHexEqual(row.hmac, hmacSha256(row.payload_json, this.hmacKey))
    ) integrityMismatch();
    return payload;
  }
}
