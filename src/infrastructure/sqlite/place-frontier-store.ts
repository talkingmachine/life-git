import type Database from "better-sqlite3";

import type { RankingSnapshot, ShortlistSnapshot } from "../../application/place-frontier";
import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";

type Kind = "ranking" | "shortlist";
interface Row { readonly id: string; readonly run_id: string; readonly kind: Kind; readonly schema_version: string; readonly payload_json: string; readonly payload_hash: string; readonly hmac: string; readonly created_at: string; }
function mismatch(): never { throw new Error("integrity_mismatch"); }

export class SqlitePlaceFrontierStore {
  constructor(private readonly database: Database.Database, private readonly hmacKey: string) {}

  async appendRanking(snapshot: RankingSnapshot): Promise<void> { this.append("ranking", snapshot); }
  async appendShortlist(snapshot: ShortlistSnapshot): Promise<void> {
    const ranking = await this.loadRankingVerified(snapshot.runId);
    if (ranking.id !== snapshot.rankingSnapshotId) mismatch();
    this.validateShortlist(snapshot, ranking);
    this.append("shortlist", snapshot);
  }
  async loadRankingVerified(idOrRunId: string): Promise<RankingSnapshot> {
    const snapshot = this.load<RankingSnapshot>("ranking", idOrRunId);
    this.validateRanking(snapshot);
    return snapshot;
  }
  async loadShortlistVerified(runId: string): Promise<ShortlistSnapshot> {
    const snapshot = this.load<ShortlistSnapshot>("shortlist", runId);
    const ranking = await this.loadRankingVerified(snapshot.runId);
    this.validateShortlist(snapshot, ranking);
    return snapshot;
  }
  private append(kind: Kind, snapshot: RankingSnapshot | ShortlistSnapshot): void {
    if ((kind === "ranking" && snapshot.schemaVersion !== "place-ranking@1") ||
      (kind === "shortlist" && snapshot.schemaVersion !== "place-shortlist@1")) mismatch();
    if (kind === "ranking") this.validateRanking(snapshot as RankingSnapshot);
    const payloadJson = canonicalJson(snapshot);
    this.database.prepare(`INSERT INTO place_frontier_snapshots
      (id, run_id, kind, schema_version, payload_json, payload_hash, hmac, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(snapshot.id, snapshot.runId, kind, snapshot.schemaVersion, payloadJson,
        sha256Text(payloadJson), hmacSha256(payloadJson, this.hmacKey), snapshot.createdAt);
  }
  private load<T extends RankingSnapshot | ShortlistSnapshot>(kind: Kind, idOrRunId: string): T {
    const row = this.database.prepare(`SELECT * FROM place_frontier_snapshots
      WHERE kind = ? AND (run_id = ? OR id = ?)`).get(kind, idOrRunId, idOrRunId) as Row | undefined;
    if (row === undefined) throw new Error("snapshot_not_found");
    let payload: T;
    try { payload = JSON.parse(row.payload_json) as T; } catch { mismatch(); }
    if (row.kind !== kind || row.id !== payload.id || row.run_id !== payload.runId ||
      row.schema_version !== payload.schemaVersion || row.created_at !== payload.createdAt ||
      row.payload_json !== canonicalJson(payload) || !secureHexEqual(row.payload_hash, sha256Text(row.payload_json)) ||
      !secureHexEqual(row.hmac, hmacSha256(row.payload_json, this.hmacKey))) mismatch();
    return payload;
  }
  private validateRanking(snapshot: RankingSnapshot): void {
    if (snapshot.schemaVersion !== "place-ranking@1" || snapshot.rulesVersion !== "place-ranker@1" ||
      snapshot.id !== `${snapshot.runId}:ranking` || typeof snapshot.contextHash !== "string") mismatch();
    const codes = [...snapshot.ordered.map(({ countryCode }) => countryCode), ...snapshot.excluded.map(({ countryCode }) => countryCode)];
    if (new Set(codes).size !== codes.length || Object.keys(snapshot.knowledgeRevisionIds).sort().join() !== [...codes].sort().join() ||
      snapshot.ordered.some((item, index) => item.rank !== index + 1)) mismatch();
  }
  private validateShortlist(snapshot: ShortlistSnapshot, ranking: RankingSnapshot): void {
    if (snapshot.schemaVersion !== "place-shortlist@1" || snapshot.rulesVersion !== "country-frontier@1" ||
      snapshot.id !== `${snapshot.runId}:shortlist` || snapshot.rankingSnapshotId !== ranking.id) mismatch();
    const markers = snapshot.markers;
    if (markers.some((marker, index) => marker.rank !== index + 1 ||
      marker.country.countryCode !== ranking.ordered[index]?.countryCode ||
      marker.countryCheckRunId !== `frontier-country:${sha256Text(canonicalJson({ parentRunId: snapshot.runId, countryCode: marker.country.countryCode }))}` ||
      marker.formalVerdict.rulesVersion !== "formal-residence@1" ||
      marker.sourceAssessmentRulesVersion.length === 0)) mismatch();
    if (new Set(markers.map((m) => m.country.countryCode)).size !== markers.length ||
      new Set(markers.map((m) => m.rank)).size !== markers.length) mismatch();
    const nonRed = markers.filter((m) => m.formalVerdict.marker !== "red").length;
    if (!(nonRed === 5 || markers.length === ranking.ordered.length)) mismatch();
  }
}
