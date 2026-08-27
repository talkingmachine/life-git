import { types } from "node:util";

import type Database from "better-sqlite3";

import type { CountryResolutionStorePort } from "../../application/country-resolution-contracts";
import type { CityBranchReadPort } from "../../application/city-frontier-contracts";
import {
  createPreCityBranchCommit,
  reconstructPreCityBranchCommit,
  replayPreCityBranchCommit,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../../branch/city";
import type { ResolvedCountryShortlistSnapshot } from
  "../../application/country-resolution-contracts";
import type { EvidenceIntegrity } from "../../research/research-plan";
import {
  createCityDecisionIntegrityView,
  secureHexEqual,
} from "../integrity";

interface BranchRow {
  readonly id: string;
  readonly kind: string;
  readonly profile_snapshot_id: string;
  readonly preference_profile_snapshot_id: string;
  readonly resolved_country_shortlist_revision_id: string;
  readonly country_code: string;
  readonly resolved_country_entry_digest: string;
  readonly city_id: string | null;
  readonly parent_id: string | null;
  readonly forked_from: string | null;
  readonly selection_snapshot_id: string | null;
  readonly schema_version: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;
const OWNED_SOURCE_INSTANT = "1970-01-01T00:00:00.000Z";

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function ownData<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
      mismatch();
    }
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) ||
          !Number.isSafeInteger(length.value) || length.value < 0 ||
          Object.getOwnPropertyNames(value).length !== length.value + 1) {
          mismatch();
        }
        const result: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) ||
            !descriptor.enumerable) {
            mismatch();
          }
          result.push(visit(descriptor.value));
        }
        return result;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) mismatch();
      const result: Record<string, unknown> = {};
      for (const name of Object.getOwnPropertyNames(value)) {
        if (name === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !("value" in descriptor) ||
          !descriptor.enumerable) {
          mismatch();
        }
        result[name] = visit(descriptor.value);
      }
      return result;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) mismatch();
    freeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function isResolvedHead(value: unknown): value is ResolvedCountryShortlistSnapshot {
  return value !== null && typeof value === "object" &&
    (value as { readonly kind?: unknown }).kind === "resolved";
}

export class SqliteCityBranchStore implements CityBranchReadPort {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
    private readonly countries: CountryResolutionStorePort,
  ) {}

  loadPreCityBranchVerified(id: string): PreCityBranchCommit {
    const row = this.rowById(id);
    if (row === undefined) throw new Error("pre_city_branch_not_found");
    return this.reconstructRow(row);
  }

  findPreCityBranchBySourceVerified(
    source: PreCityBranchSourceProjection,
  ): PreCityBranchCommit | undefined {
    const ownedSource = this.ownSource(source);
    const row = this.database.prepare(`
      SELECT id FROM city_branch_commits
      WHERE kind = 'pre_city'
        AND resolved_country_shortlist_revision_id = ? AND country_code = ?
    `).get(
      ownedSource.resolvedCountryShortlistRevisionId,
      ownedSource.resolvedCountryEntry.countryCode,
    ) as { readonly id: string } | undefined;
    if (row === undefined) return undefined;
    const commit = this.loadPreCityBranchVerified(row.id);
    try {
      return replayPreCityBranchCommit(
        commit,
        ownedSource,
        createCityDecisionIntegrityView(this.integrity),
      );
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private rowById(id: string): BranchRow | undefined {
    return this.database.prepare(`
      SELECT id, kind, profile_snapshot_id, preference_profile_snapshot_id,
             resolved_country_shortlist_revision_id, country_code,
             resolved_country_entry_digest, city_id, parent_id, forked_from,
             selection_snapshot_id, schema_version, payload_json, payload_hash,
             hmac, created_at
      FROM city_branch_commits WHERE id = ?
    `).get(id) as BranchRow | undefined;
  }

  private ownSource(source: PreCityBranchSourceProjection): PreCityBranchSourceProjection {
    try {
      const owned = freeze(ownData(source));
      createPreCityBranchCommit(
        { source: owned, createdAt: OWNED_SOURCE_INSTANT },
        createCityDecisionIntegrityView(this.integrity),
      );
      return owned;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private reconstructRow(row: BranchRow): PreCityBranchCommit {
    try {
      if (!LOWERCASE_DIGEST.test(row.payload_hash) ||
        !LOWERCASE_DIGEST.test(row.hmac) ||
        !LOWERCASE_DIGEST.test(row.resolved_country_entry_digest)) {
        mismatch();
      }
      const value = JSON.parse(row.payload_json) as unknown;
      const canonical = this.integrity.canonical(value);
      if (canonical !== row.payload_json ||
        !secureHexEqual(this.integrity.hash(row.payload_json), row.payload_hash) ||
        !secureHexEqual(this.integrity.sign(row.payload_json), row.hmac)) {
        mismatch();
      }
      const commit = reconstructPreCityBranchCommit(
        value,
        createCityDecisionIntegrityView(this.integrity),
      );
      if (row.id !== commit.id || row.kind !== "pre_city" ||
        row.profile_snapshot_id !== commit.profileSnapshotId ||
        row.preference_profile_snapshot_id !== commit.preferenceProfileSnapshotId ||
        row.resolved_country_shortlist_revision_id !==
          commit.resolvedCountryShortlistRevisionId ||
        row.country_code !== commit.countryCode ||
        row.resolved_country_entry_digest !== commit.resolvedCountryEntryDigest ||
        row.city_id !== null || row.parent_id !== null || row.forked_from !== null ||
        row.selection_snapshot_id !== null || row.schema_version !== commit.schemaVersion ||
        row.created_at !== commit.createdAt) {
        mismatch();
      }
      return this.replayAgainstResolvedHead(commit);
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private replayAgainstResolvedHead(commit: PreCityBranchCommit): PreCityBranchCommit {
    const locator = this.countries.locateChainVerified({
      revisionId: commit.resolvedCountryShortlistRevisionId,
    });
    const head = locator.revisions.at(-1);
    if (!isResolvedHead(head) || head.id !== commit.resolvedCountryShortlistRevisionId ||
      head.resolutionRunId !== locator.resolutionRunId ||
      head.automaticShortlistSnapshotId !== locator.source.automaticShortlistSnapshotId ||
      head.rankingSnapshotId !== locator.source.rankingSnapshotId ||
      head.profileSnapshotId !== locator.source.profileSnapshotId ||
      head.preferenceProfileSnapshotId !== locator.source.preferenceProfileSnapshotId) {
      mismatch();
    }
    const entries = head.resolvedEntries.filter(
      ({ countryCode }) => countryCode === commit.countryCode,
    );
    if (entries.length !== 1) mismatch();
    const source: PreCityBranchSourceProjection = {
      profileSnapshotId: locator.source.profileSnapshotId,
      preferenceProfileSnapshotId: locator.source.preferenceProfileSnapshotId,
      resolvedCountryShortlistRevisionId: head.id,
      resolvedCountryEntry: entries[0]!,
    };
    replayPreCityBranchCommit(
      commit,
      source,
      createCityDecisionIntegrityView(this.integrity),
    );
    const expected = createPreCityBranchCommit({
      source,
      createdAt: head.createdAt,
    }, createCityDecisionIntegrityView(this.integrity));
    if (this.integrity.canonical(commit) !== this.integrity.canonical(expected)) mismatch();
    return expected;
  }
}
