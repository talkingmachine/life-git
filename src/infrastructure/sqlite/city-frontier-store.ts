import { types } from "node:util";

import type Database from "better-sqlite3";

import {
  cityCriteriaPayloadHash,
  cityFrontierRunId,
  type CityCatalogStorePort,
  type CityCriteriaCommandPayload,
  type CityFrontierRunIdentity,
  type VerifiedCityCatalogBundle,
} from "../../application/city-data-contracts";
import {
  reconstructCityFrontierRevision,
  reconstructCityRankingSnapshot,
  type CityBranchReadPort,
  type CityCommandResult,
  type CityCriteriaReadPort,
  type CityFrontierAppendInput,
  type CityFrontierOperation,
  type CityFrontierRevision,
  type CityFrontierStartIntent,
  type CityFrontierStartPublication,
  type CityFrontierStartPublicationResult,
  type CityFrontierStartWriterPort,
  type CityFrontierStorePort,
  type CityRankingReadPort,
  type CityRankingSnapshot,
} from "../../application/city-frontier-contracts";
import {
  reconstructPreCityBranchCommit,
  replayPreCityBranchCommit,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../../branch/city";
import { reconstructCityCriteriaSnapshot } from "../../decision/city-criteria";
import type { EvidenceIntegrity } from "../../research/research-plan";
import {
  createCityDecisionIntegrityView,
  secureHexEqual,
} from "../integrity";

interface SqliteCityFrontierStoreDependencies {
  readonly criteria: CityCriteriaReadPort;
  readonly branches: CityBranchReadPort;
  readonly catalogs: CityCatalogStorePort;
}

interface RankingRow {
  readonly id: string;
  readonly run_id: string;
  readonly resolved_country_shortlist_revision_id: string;
  readonly country_code: string;
  readonly package_id: string;
  readonly package_schema_version: string;
  readonly registry_revision_id: string;
  readonly catalog_revision_id: string;
  readonly criteria_snapshot_id: string;
  readonly pre_city_branch_commit_id: string;
  readonly profile_snapshot_id: string;
  readonly preference_profile_snapshot_id: string;
  readonly evidence_rules_version: string;
  readonly installed_package_context_json: string;
  readonly live_city_candidate_limit: number;
  readonly target_selectable_cities: number;
  readonly budget_rules_version: string;
  readonly schema_version: string;
  readonly rules_version: string;
  readonly assessment_at: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

interface FrontierRow {
  readonly id: string;
  readonly run_id: string;
  readonly kind: string;
  readonly predecessor_id: string | null;
  readonly ranking_snapshot_id: string;
  readonly operation_kind: string;
  readonly command_id: string;
  readonly schema_version: string;
  readonly command_json: string;
  readonly command_hash: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

interface VerifiedFrontierRow {
  readonly revision: CityFrontierRevision;
  readonly command: CityFrontierStartIntent | CityFrontierOperation;
}

interface OwnedStartPublication extends CityFrontierStartPublication {
  readonly intent: CityFrontierStartIntent;
  readonly criteria: CityFrontierStartPublication["criteria"];
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly ranking: CityRankingSnapshot;
  readonly root: CityFrontierRevision;
}

const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;
const START_PUBLICATION_KEYS = [
  "intent",
  "criteria",
  "preCityBranch",
  "preCitySource",
  "ranking",
  "root",
] as const;

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

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    mismatch();
  }
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    mismatch();
  }
  return value as Record<string, unknown>;
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

function parseStartIntent(value: unknown): CityFrontierStartIntent {
  const intent = exactRecord(value, [
    "schemaVersion",
    "runId",
    "resolvedCountryShortlistRevisionId",
    "countryCode",
    "criteriaPayloadHash",
  ]);
  if (intent.schemaVersion !== "city-frontier-start-intent@1" ||
    typeof intent.runId !== "string" || intent.runId.length === 0 ||
    typeof intent.resolvedCountryShortlistRevisionId !== "string" ||
    intent.resolvedCountryShortlistRevisionId.length === 0 ||
    typeof intent.countryCode !== "string" || !/^[A-Z]{2}$/.test(intent.countryCode) ||
    typeof intent.criteriaPayloadHash !== "string" ||
    !LOWERCASE_DIGEST.test(intent.criteriaPayloadHash)) {
    mismatch();
  }
  return freeze(intent as unknown as CityFrontierStartIntent);
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: EvidenceIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

function criteriaCommandPayload(
  criteria: CityFrontierStartPublication["criteria"],
): CityCriteriaCommandPayload {
  return {
    schemaVersion: "city-criteria-command@1",
    profileSnapshotId: criteria.profileSnapshotId,
    preferenceProfileSnapshotId: criteria.preferenceProfileSnapshotId,
    criteria: criteria.criteria,
    rulesVersion: criteria.rulesVersion,
  };
}

export class SqliteCityFrontierStore implements
  CityFrontierStorePort,
  CityRankingReadPort,
  CityFrontierStartWriterPort {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
    private readonly dependencies: SqliteCityFrontierStoreDependencies,
  ) {}

  loadRankingVerified(id: string): CityRankingSnapshot {
    const row = this.rankingRow(id);
    if (row === undefined) throw new Error("city_ranking_not_found");
    return this.reconstructRankingRow(row);
  }

  loadRevisionVerified(id: string): CityFrontierRevision {
    const locator = this.database.prepare(`
      SELECT run_id FROM city_frontier_revisions WHERE id = ?
    `).get(id) as { readonly run_id: string } | undefined;
    if (locator === undefined) throw new Error("city_frontier_not_found");
    const result = this.loadChainVerified(locator.run_id)
      .find((revision) => revision.id === id);
    if (result === undefined) throw new Error("integrity_mismatch");
    return result;
  }

  loadHeadVerified(runId: string): CityFrontierRevision {
    return this.loadChainVerified(runId).at(-1)!;
  }

  loadChainVerified(runId: string): readonly CityFrontierRevision[] {
    const rows = this.database.prepare(`
      SELECT id, run_id, kind, predecessor_id, ranking_snapshot_id,
             operation_kind, command_id, schema_version, command_json,
             command_hash, payload_json, payload_hash, hmac, created_at
      FROM city_frontier_revisions WHERE run_id = ?
    `).all(runId) as FrontierRow[];
    if (rows.length === 0) throw new Error("city_frontier_not_found");

    try {
      const verified = rows.map((row) => this.reconstructFrontierRow(row));
      const byId = new Map(verified.map((entry) => [entry.revision.id, entry]));
      if (byId.size !== verified.length) mismatch();
      const roots = verified.filter(({ revision }) =>
        revision.predecessorRevisionId === undefined);
      if (roots.length !== 1) mismatch();
      const children = new Map<string, VerifiedFrontierRow[]>();
      for (const entry of verified) {
        const predecessor = entry.revision.predecessorRevisionId;
        if (predecessor === undefined) continue;
        const siblings = children.get(predecessor) ?? [];
        siblings.push(entry);
        children.set(predecessor, siblings);
      }
      const chain: VerifiedFrontierRow[] = [];
      let current: VerifiedFrontierRow | undefined = roots[0];
      while (current !== undefined) {
        chain.push(current);
        const next: VerifiedFrontierRow[] = children.get(current.revision.id) ?? [];
        if (next.length > 1) mismatch();
        if (current.revision.kind === "terminal" && next.length !== 0) mismatch();
        current = next[0];
      }
      if (chain.length !== verified.length) mismatch();

      const ranking = this.loadRankingVerified(chain[0]!.revision.rankingSnapshotId);
      const criteria = this.dependencies.criteria.loadCriteriaVerified(
        ranking.criteriaSnapshotId,
      );
      const criteriaHash = cityCriteriaPayloadHash(
        criteriaCommandPayload(criteria),
        createCityDecisionIntegrityView(this.integrity),
      );
      const parent = this.dependencies.branches.loadPreCityBranchVerified(
        ranking.preCityBranchCommitId,
      );
      for (let index = 0; index < chain.length; index += 1) {
        const entry = chain[index]!;
        const revision = entry.revision;
        if (revision.runId !== runId || revision.rankingSnapshotId !== ranking.id ||
          revision.nextUncheckedRank !== revision.markers.length + 1 ||
          revision.markers.some((marker, markerIndex) => marker.rank !== markerIndex + 1)) {
          mismatch();
        }
        if (index === 0) {
          if (revision.operation.kind !== "start" ||
            revision.createdAt !== ranking.assessmentAt ||
            revision.createdAt !== ranking.createdAt ||
            revision.createdAt !== criteria.confirmedAt ||
            parent.createdAt > revision.createdAt ||
            !this.startCommandMatches(entry.command, revision, ranking, criteriaHash)) {
            mismatch();
          }
          continue;
        }
        const previous = chain[index - 1]!.revision;
        if (revision.predecessorRevisionId !== previous.id ||
          revision.createdAt < previous.createdAt ||
          revision.markers.length !== previous.markers.length + 1 ||
          !sameCanonical(
            revision.markers.slice(0, -1),
            previous.markers,
            this.integrity,
          )) {
          mismatch();
        }
      }
      const head = chain.at(-1)!.revision;
      if (head.kind === "working" &&
        head.markers.length >= ranking.verificationBudget.liveCityCandidateLimit) {
        mismatch();
      }
      return freeze(chain.map(({ revision }) => revision));
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  findCommandVerified(
    runId: string,
    commandId: string,
  ): CityCommandResult | undefined {
    const chain = this.loadChainVerified(runId);
    const revision = chain.find((candidate) =>
      candidate.operation.commandId === commandId);
    if (revision === undefined) return undefined;
    return freeze({
      operation: ownData(revision.operation),
      revision: ownData(revision),
    });
  }

  appendRevision(input: CityFrontierAppendInput): CityFrontierRevision {
    const candidate = this.ownAppend(input);
    return this.database.transaction(() => this.appendOwnedRevisionInTransaction(candidate)).immediate();
  }

  /** Caller owns the surrounding SQLite immediate transaction. */
  appendRevisionInTransaction(input: CityFrontierAppendInput): CityFrontierRevision {
    const candidate = this.ownAppend(input);
    return this.appendOwnedRevisionInTransaction(candidate);
  }

  private appendOwnedRevisionInTransaction(candidate: ReturnType<SqliteCityFrontierStore["ownAppend"]>): CityFrontierRevision {
      const commandRow = this.frontierRowByCommand(
        candidate.runId,
        candidate.operation.commandId,
      );
      const commandWinner = commandRow === undefined
        ? undefined
        : this.reconstructFrontierRow(commandRow);
      if (commandWinner !== undefined &&
        !sameCanonical(commandWinner.revision.operation, candidate.operation, this.integrity)) {
        mismatch();
      }
      let chain: readonly CityFrontierRevision[];
      try {
        chain = this.loadChainVerified(candidate.runId);
      } catch (error) {
        if (error instanceof Error && error.message === "city_frontier_not_found") mismatch();
        throw error;
      }
      const ranking = this.loadRankingVerified(chain[0]!.rankingSnapshotId);
      this.requireWritableCatalog(ranking);
      if (commandWinner !== undefined) {
        const verifiedWinner = chain.find(({ id }) => id === commandWinner.revision.id);
        if (verifiedWinner === undefined) mismatch();
        return verifiedWinner;
      }
      const predecessor = candidate.predecessorRevisionId === undefined
        ? undefined
        : chain.find(({ id }) => id === candidate.predecessorRevisionId);
      if (predecessor === undefined || predecessor.runId !== candidate.runId ||
        predecessor.rankingSnapshotId !== candidate.rankingSnapshotId) {
        mismatch();
      }
      if (predecessor.id !== chain.at(-1)!.id) {
        throw new Error("stale_city_frontier_head");
      }
      this.requireSuccessor(predecessor, candidate, ranking);
      this.insertFrontier(candidate, candidate.operation);
      return this.loadRevisionVerified(candidate.id);
  }

  publishStart(
    input: CityFrontierStartPublication,
  ): CityFrontierStartPublicationResult {
    const publication = this.ownStart(input);
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT id, command_json FROM city_frontier_revisions
        WHERE operation_kind = 'start' AND command_id = ?
      `).get(publication.root.operation.commandId) as {
        readonly id: string;
        readonly command_json: string;
      } | undefined;
      const catalog = this.verifyCatalog(publication.ranking);
      this.requireDerivedRun(
        publication.ranking,
        publication.criteria,
        catalog,
      );
      if (existing !== undefined) {
        if (existing.command_json !== this.integrity.canonical(publication.intent)) mismatch();
        const root = this.loadRevisionVerified(existing.id);
        const ranking = this.loadRankingVerified(root.rankingSnapshotId);
        const winnerCatalog = this.verifyCatalog(ranking);
        if (catalog.catalog.rulesVersion === "city-catalog@1" ||
          winnerCatalog.catalog.rulesVersion === "city-catalog@1") {
          throw new Error("city_catalog_upgrade_required");
        }
        return freeze({
          criteria: this.dependencies.criteria.loadCriteriaVerified(
            ranking.criteriaSnapshotId,
          ),
          preCityBranch: this.dependencies.branches.loadPreCityBranchVerified(
            ranking.preCityBranchCommitId,
          ),
          ranking,
          root,
        });
      }
      if (catalog.catalog.rulesVersion === "city-catalog@1") {
        throw new Error("city_catalog_upgrade_required");
      }
      const runRoot = this.database.prepare(`
        SELECT id FROM city_frontier_revisions
        WHERE run_id = ? AND predecessor_id IS NULL
      `).get(publication.root.runId) as { readonly id: string } | undefined;
      if (runRoot !== undefined) {
        this.loadRevisionVerified(runRoot.id);
        mismatch();
      }

      const storedParent = this.dependencies.branches.findPreCityBranchBySourceVerified(
        publication.preCitySource,
      );
      if (storedParent !== undefined &&
        !sameCanonical(storedParent, publication.preCityBranch, this.integrity)) {
        mismatch();
      }

      this.insertCriteria(publication);
      if (storedParent === undefined) this.insertBranch(publication);
      this.insertRanking(publication.ranking);
      this.insertFrontier(publication.root, publication.intent);
      const root = this.loadRevisionVerified(publication.root.id);
      const ranking = this.loadRankingVerified(publication.ranking.id);
      return freeze({
        criteria: this.dependencies.criteria.loadCriteriaVerified(publication.criteria.id),
        preCityBranch: this.dependencies.branches.loadPreCityBranchVerified(
          publication.preCityBranch.id,
        ),
        ranking,
        root,
      });
    });
    return transaction.immediate();
  }

  private rankingRow(id: string): RankingRow | undefined {
    return this.database.prepare(`
      SELECT id, run_id, resolved_country_shortlist_revision_id, country_code,
             package_id, package_schema_version, registry_revision_id,
             catalog_revision_id, criteria_snapshot_id, pre_city_branch_commit_id,
             profile_snapshot_id, preference_profile_snapshot_id,
             evidence_rules_version, installed_package_context_json,
             live_city_candidate_limit, target_selectable_cities,
             budget_rules_version, schema_version, rules_version, assessment_at,
             payload_json, payload_hash, hmac, created_at
      FROM city_ranking_snapshots WHERE id = ?
    `).get(id) as RankingRow | undefined;
  }

  private frontierRowByCommand(runId: string, commandId: string): FrontierRow | undefined {
    return this.database.prepare(`
      SELECT id, run_id, kind, predecessor_id, ranking_snapshot_id,
             operation_kind, command_id, schema_version, command_json,
             command_hash, payload_json, payload_hash, hmac, created_at
      FROM city_frontier_revisions WHERE run_id = ? AND command_id = ?
    `).get(runId, commandId) as FrontierRow | undefined;
  }

  private reconstructRankingRow(row: RankingRow): CityRankingSnapshot {
    try {
      const value = this.standardEnvelope(row.payload_json, row.payload_hash, row.hmac);
      const ranking = reconstructCityRankingSnapshot(
        value,
        createCityDecisionIntegrityView(this.integrity),
      );
      const contextJson = this.integrity.canonical(ranking.installedPackageContext);
      if (row.id !== ranking.id || row.run_id !== ranking.runId ||
        row.resolved_country_shortlist_revision_id !==
          ranking.resolvedCountryShortlistRevisionId ||
        row.country_code !== ranking.countryCode || row.package_id !== ranking.packageId ||
        row.package_schema_version !== ranking.packageSchemaVersion ||
        row.registry_revision_id !== ranking.registryRevisionId ||
        row.catalog_revision_id !== ranking.catalogRevisionId ||
        row.criteria_snapshot_id !== ranking.criteriaSnapshotId ||
        row.pre_city_branch_commit_id !== ranking.preCityBranchCommitId ||
        row.profile_snapshot_id !== ranking.profileSnapshotId ||
        row.preference_profile_snapshot_id !== ranking.preferenceProfileSnapshotId ||
        row.evidence_rules_version !== ranking.installedPackageContext.evidenceRulesVersion ||
        row.installed_package_context_json !== contextJson ||
        row.live_city_candidate_limit !== ranking.verificationBudget.liveCityCandidateLimit ||
        row.target_selectable_cities !== ranking.verificationBudget.targetSelectableCities ||
        row.budget_rules_version !== ranking.verificationBudget.rulesVersion ||
        row.schema_version !== ranking.schemaVersion ||
        row.rules_version !== ranking.rulesVersion || row.assessment_at !== ranking.assessmentAt ||
        row.created_at !== ranking.createdAt) {
        mismatch();
      }
      const criteria = this.dependencies.criteria.loadCriteriaVerified(
        ranking.criteriaSnapshotId,
      );
      const branch = this.dependencies.branches.loadPreCityBranchVerified(
        ranking.preCityBranchCommitId,
      );
      const catalog = this.verifyCatalog(ranking);
      if (ranking.profileSnapshotId !== criteria.profileSnapshotId ||
        ranking.preferenceProfileSnapshotId !== criteria.preferenceProfileSnapshotId ||
        ranking.profileSnapshotId !== branch.profileSnapshotId ||
        ranking.preferenceProfileSnapshotId !== branch.preferenceProfileSnapshotId ||
        ranking.resolvedCountryShortlistRevisionId !==
          branch.resolvedCountryShortlistRevisionId ||
        ranking.countryCode !== branch.countryCode) {
        mismatch();
      }
      this.requireDerivedRun(ranking, criteria, catalog);
      return ranking;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private reconstructFrontierRow(row: FrontierRow): VerifiedFrontierRow {
    const payload = this.standardEnvelope(row.payload_json, row.payload_hash);
    let command: unknown;
    try {
      command = JSON.parse(row.command_json) as unknown;
      if (this.integrity.canonical(command) !== row.command_json ||
        !LOWERCASE_DIGEST.test(row.command_hash) ||
        !secureHexEqual(this.integrity.hash(row.command_json), row.command_hash) ||
        !LOWERCASE_DIGEST.test(row.hmac) ||
        !secureHexEqual(
          this.integrity.sign(this.integrity.canonical({ value: payload, command })),
          row.hmac,
        )) {
        mismatch();
      }
      const revision = reconstructCityFrontierRevision(
        payload,
        createCityDecisionIntegrityView(this.integrity),
      );
      const parsedCommand = revision.operation.kind === "start"
        ? parseStartIntent(command)
        : reconstructCityFrontierRevision(
            { ...revision, operation: command },
            createCityDecisionIntegrityView(this.integrity),
          ).operation;
      if (row.id !== revision.id || row.run_id !== revision.runId ||
        row.kind !== revision.kind ||
        row.predecessor_id !== (revision.predecessorRevisionId ?? null) ||
        row.ranking_snapshot_id !== revision.rankingSnapshotId ||
        row.operation_kind !== revision.operation.kind ||
        row.command_id !== revision.operation.commandId ||
        row.schema_version !== revision.schemaVersion || row.created_at !== revision.createdAt ||
        (revision.operation.kind !== "start" &&
          !sameCanonical(parsedCommand, revision.operation, this.integrity))) {
        mismatch();
      }
      return freeze({ revision, command: parsedCommand });
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private standardEnvelope(
    payloadJson: string,
    payloadHash: string,
    hmac?: string,
  ): unknown {
    try {
      if (!LOWERCASE_DIGEST.test(payloadHash) ||
        (hmac !== undefined && !LOWERCASE_DIGEST.test(hmac))) {
        mismatch();
      }
      const value = JSON.parse(payloadJson) as unknown;
      if (this.integrity.canonical(value) !== payloadJson ||
        !secureHexEqual(this.integrity.hash(payloadJson), payloadHash) ||
        (hmac !== undefined &&
          !secureHexEqual(this.integrity.sign(payloadJson), hmac))) {
        mismatch();
      }
      return value;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private verifyCatalog(ranking: CityRankingSnapshot): VerifiedCityCatalogBundle {
    try {
      const catalog = this.dependencies.catalogs.loadVerified(ranking.catalogRevisionId);
      if (catalog.catalog.rulesVersion !== "city-catalog@1" &&
        catalog.catalog.rulesVersion !== "city-catalog@2") {
        mismatch();
      }
      if (catalog.catalog.id !== ranking.catalogRevisionId ||
        catalog.registry.id !== ranking.registryRevisionId ||
        catalog.catalog.countryCode !== ranking.countryCode ||
        catalog.catalog.packageId !== ranking.packageId ||
        catalog.catalog.packageSchemaVersion !== ranking.packageSchemaVersion ||
        ranking.installedPackageContext.countryCode !== ranking.countryCode ||
        ranking.installedPackageContext.packageId !== ranking.packageId ||
        ranking.installedPackageContext.packageSchemaVersion !== ranking.packageSchemaVersion ||
        ranking.installedPackageContext.catalogRevisionId !== ranking.catalogRevisionId) {
        mismatch();
      }
      return catalog;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private requireWritableCatalog(ranking: CityRankingSnapshot): void {
    if (this.verifyCatalog(ranking).catalog.rulesVersion === "city-catalog@1") {
      throw new Error("city_catalog_upgrade_required");
    }
  }

  private requireDerivedRun(
    ranking: CityRankingSnapshot,
    criteria: CityFrontierStartPublication["criteria"],
    catalog: VerifiedCityCatalogBundle,
  ): string {
    const criteriaHash = cityCriteriaPayloadHash(
      criteriaCommandPayload(criteria),
      createCityDecisionIntegrityView(this.integrity),
    );
    const runIdentity: CityFrontierRunIdentity = {
      schemaVersion: "city-frontier-run@1",
      resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
      countryCode: ranking.countryCode,
      registryRevisionId: ranking.registryRevisionId,
      installedPackageContext: ranking.installedPackageContext,
      criteriaPayloadHash: criteriaHash,
      catalogRulesVersion: catalog.catalog.rulesVersion,
      rankingRulesVersion: ranking.rulesVersion,
      verificationBudget: ranking.verificationBudget,
    };
    if (ranking.runId !== cityFrontierRunId(
      runIdentity,
      createCityDecisionIntegrityView(this.integrity),
    )) {
      mismatch();
    }
    return criteriaHash;
  }

  private startCommandMatches(
    command: CityFrontierStartIntent | CityFrontierOperation,
    revision: CityFrontierRevision,
    ranking: CityRankingSnapshot,
    criteriaHash: string,
  ): boolean {
    return revision.operation.kind === "start" && "schemaVersion" in command &&
      command.schemaVersion === "city-frontier-start-intent@1" &&
      command.runId === revision.runId &&
      command.resolvedCountryShortlistRevisionId ===
        ranking.resolvedCountryShortlistRevisionId &&
      command.countryCode === ranking.countryCode &&
      command.criteriaPayloadHash === criteriaHash &&
      revision.operation.criteriaPayloadHash === criteriaHash;
  }

  private ownAppend(input: CityFrontierAppendInput): CityFrontierRevision {
    try {
      const owned = exactRecord(ownData(input), ["revision"]);
      const revision = reconstructCityFrontierRevision(
        owned.revision,
        createCityDecisionIntegrityView(this.integrity),
      );
      if (revision.operation.kind !== "city_completed" ||
        revision.predecessorRevisionId === undefined ||
        revision.nextUncheckedRank !== revision.markers.length + 1 ||
        revision.markers.some((marker, index) => marker.rank !== index + 1) ||
        (revision.kind === "working" && revision.markers.length >= 10)) {
        mismatch();
      }
      return revision;
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private ownStart(input: CityFrontierStartPublication): OwnedStartPublication {
    try {
      const owned = exactRecord(ownData(input), START_PUBLICATION_KEYS);
      const decisionIntegrity = createCityDecisionIntegrityView(this.integrity);
      const criteria = reconstructCityCriteriaSnapshot(owned.criteria, decisionIntegrity);
      const preCityBranch = reconstructPreCityBranchCommit(
        owned.preCityBranch,
        decisionIntegrity,
      );
      const preCitySource = freeze(owned.preCitySource as PreCityBranchSourceProjection);
      replayPreCityBranchCommit(preCityBranch, preCitySource, decisionIntegrity);
      const ranking = reconstructCityRankingSnapshot(owned.ranking, decisionIntegrity);
      const root = reconstructCityFrontierRevision(owned.root, decisionIntegrity);
      const intent = parseStartIntent(owned.intent);
      const criteriaHash = cityCriteriaPayloadHash(
        criteriaCommandPayload(criteria),
        decisionIntegrity,
      );
      if (intent.runId !== ranking.runId || intent.runId !== root.runId ||
        intent.resolvedCountryShortlistRevisionId !==
          ranking.resolvedCountryShortlistRevisionId ||
        intent.countryCode !== ranking.countryCode ||
        intent.criteriaPayloadHash !== criteriaHash ||
        ranking.criteriaSnapshotId !== criteria.id ||
        ranking.preCityBranchCommitId !== preCityBranch.id ||
        ranking.profileSnapshotId !== criteria.profileSnapshotId ||
        ranking.preferenceProfileSnapshotId !== criteria.preferenceProfileSnapshotId ||
        ranking.profileSnapshotId !== preCityBranch.profileSnapshotId ||
        ranking.preferenceProfileSnapshotId !== preCityBranch.preferenceProfileSnapshotId ||
        ranking.resolvedCountryShortlistRevisionId !==
          preCityBranch.resolvedCountryShortlistRevisionId ||
        ranking.countryCode !== preCityBranch.countryCode || root.kind !== "working" ||
        root.markers.length !== 0 || root.nextUncheckedRank !== 1 ||
        root.rankingSnapshotId !== ranking.id || root.operation.kind !== "start" ||
        root.operation.criteriaPayloadHash !== criteriaHash ||
        root.createdAt !== criteria.confirmedAt || root.createdAt !== ranking.assessmentAt ||
        root.createdAt !== ranking.createdAt || preCityBranch.createdAt > root.createdAt ||
        ranking.installedPackageContext.countryCode !== ranking.countryCode ||
        ranking.installedPackageContext.packageId !== ranking.packageId ||
        ranking.installedPackageContext.packageSchemaVersion !== ranking.packageSchemaVersion ||
        ranking.installedPackageContext.catalogRevisionId !== ranking.catalogRevisionId) {
        mismatch();
      }
      return freeze({ intent, criteria, preCityBranch, preCitySource, ranking, root });
    } catch {
      throw new Error("integrity_mismatch");
    }
  }

  private requireSuccessor(
    predecessor: CityFrontierRevision,
    candidate: CityFrontierRevision,
    ranking: CityRankingSnapshot,
  ): void {
    if (predecessor.kind === "terminal" || candidate.operation.kind !== "city_completed" ||
      candidate.predecessorRevisionId !== predecessor.id ||
      candidate.operation.expectedHeadRevisionId !== predecessor.id ||
      candidate.runId !== predecessor.runId ||
      candidate.rankingSnapshotId !== predecessor.rankingSnapshotId ||
      candidate.createdAt < predecessor.createdAt ||
      candidate.markers.length !== predecessor.markers.length + 1 ||
      !sameCanonical(candidate.markers.slice(0, -1), predecessor.markers, this.integrity) ||
      candidate.nextUncheckedRank !== candidate.markers.length + 1 ||
      (candidate.kind === "working" &&
        candidate.markers.length >= ranking.verificationBudget.liveCityCandidateLimit)) {
      mismatch();
    }
  }

  private insertCriteria(publication: OwnedStartPublication): void {
    const value = publication.criteria;
    const payload = this.integrity.canonical(value);
    this.database.prepare(`
      INSERT INTO city_criteria_snapshots (
        id, profile_snapshot_id, preference_profile_snapshot_id, schema_version,
        rules_version, confirmed_at, payload_json, payload_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      value.id,
      value.profileSnapshotId,
      value.preferenceProfileSnapshotId,
      value.schemaVersion,
      value.rulesVersion,
      value.confirmedAt,
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(payload),
    );
    if (!sameCanonical(
      this.dependencies.criteria.loadCriteriaVerified(value.id),
      value,
      this.integrity,
    )) mismatch();
  }

  private insertBranch(publication: OwnedStartPublication): void {
    const value = publication.preCityBranch;
    const payload = this.integrity.canonical(value);
    this.database.prepare(`
      INSERT INTO city_branch_commits (
        id, kind, profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, country_code,
        resolved_country_entry_digest, city_id, parent_id, forked_from,
        selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, 'pre_city', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      value.id,
      value.profileSnapshotId,
      value.preferenceProfileSnapshotId,
      value.resolvedCountryShortlistRevisionId,
      value.countryCode,
      value.resolvedCountryEntryDigest,
      value.schemaVersion,
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(payload),
      value.createdAt,
    );
    if (!sameCanonical(
      this.dependencies.branches.loadPreCityBranchVerified(value.id),
      value,
      this.integrity,
    )) mismatch();
  }

  private insertRanking(value: CityRankingSnapshot): void {
    const payload = this.integrity.canonical(value);
    this.database.prepare(`
      INSERT INTO city_ranking_snapshots (
        id, run_id, resolved_country_shortlist_revision_id, country_code, package_id,
        package_schema_version, registry_revision_id, catalog_revision_id,
        criteria_snapshot_id, pre_city_branch_commit_id, profile_snapshot_id,
        preference_profile_snapshot_id, evidence_rules_version,
        installed_package_context_json, live_city_candidate_limit,
        target_selectable_cities, budget_rules_version, schema_version, rules_version,
        assessment_at, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      value.id,
      value.runId,
      value.resolvedCountryShortlistRevisionId,
      value.countryCode,
      value.packageId,
      value.packageSchemaVersion,
      value.registryRevisionId,
      value.catalogRevisionId,
      value.criteriaSnapshotId,
      value.preCityBranchCommitId,
      value.profileSnapshotId,
      value.preferenceProfileSnapshotId,
      value.installedPackageContext.evidenceRulesVersion,
      this.integrity.canonical(value.installedPackageContext),
      value.verificationBudget.liveCityCandidateLimit,
      value.verificationBudget.targetSelectableCities,
      value.verificationBudget.rulesVersion,
      value.schemaVersion,
      value.rulesVersion,
      value.assessmentAt,
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(payload),
      value.createdAt,
    );
    if (!sameCanonical(this.loadRankingVerified(value.id), value, this.integrity)) mismatch();
  }

  private insertFrontier(
    value: CityFrontierRevision,
    command: CityFrontierStartIntent | CityFrontierOperation,
  ): void {
    const payload = this.integrity.canonical(value);
    const commandJson = this.integrity.canonical(command);
    this.database.prepare(`
      INSERT INTO city_frontier_revisions (
        id, run_id, kind, predecessor_id, ranking_snapshot_id, operation_kind,
        command_id, schema_version, command_json, command_hash, payload_json,
        payload_hash, hmac, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      value.id,
      value.runId,
      value.kind,
      value.predecessorRevisionId ?? null,
      value.rankingSnapshotId,
      value.operation.kind,
      value.operation.commandId,
      value.schemaVersion,
      commandJson,
      this.integrity.hash(commandJson),
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(this.integrity.canonical({ value, command })),
      value.createdAt,
    );
  }
}
