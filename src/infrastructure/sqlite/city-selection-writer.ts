import { types } from "node:util";

import type Database from "better-sqlite3";

import type { CityCatalogStorePort } from "../../application/city-data-contracts";
import {
  reconstructCitySelectionSnapshot,
  reconstructCitySelectionWithBranch,
  type CityBranchReadPort,
  type CityFrontierReadPort,
  type CityRankingReadPort,
  type CitySelectionCommandIntent,
  type CitySelectionPublication,
  type CitySelectionSnapshot,
  type CitySelectionWithBranch,
  type CitySelectionWriterPort,
} from "../../application/city-frontier-contracts";
import type { CityBranchCommit, PreCityBranchCommit } from "../../branch/city";
import { CITY_CATALOG_RULES_VERSION } from "../../decision/city-catalog";
import type { EvidenceIntegrity } from "../../research/research-plan";
import {
  createCityDecisionIntegrityView,
  secureHexEqual,
} from "../integrity";

interface CitySelectionWriterDependencies {
  readonly catalogs: Pick<CityCatalogStorePort, "loadVerified">;
  readonly branches: Pick<CityBranchReadPort, "loadPreCityBranchVerified">;
  readonly rankings: Pick<CityRankingReadPort, "loadRankingVerified">;
  readonly frontier: Pick<CityFrontierReadPort, "loadRevisionVerified">;
}

interface SelectionRow {
  readonly id: string;
  readonly run_id: string;
  readonly command_id: string;
  readonly terminal_revision_id: string;
  readonly city_id: string;
  readonly country_code: string;
  readonly profile_snapshot_id: string;
  readonly preference_profile_snapshot_id: string;
  readonly resolved_country_shortlist_revision_id: string;
  readonly criteria_snapshot_id: string;
  readonly ranking_snapshot_id: string;
  readonly pre_city_branch_commit_id: string;
  readonly selected_marker_digest: string;
  readonly knowledge_revision_id: string;
  readonly evidence_snapshot_id: string;
  readonly warning_copy_version: string | null;
  readonly schema_version: string;
  readonly command_json: string;
  readonly command_hash: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

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

interface CapturedPublication {
  readonly commandId: string;
  readonly intent: CitySelectionCommandIntent;
  readonly pair: CitySelectionWithBranch;
  readonly runId: string;
}

type PlainRecord = Record<string, unknown>;

const PUBLICATION_KEYS = ["commandId", "intent", "pair"] as const;
const INTENT_REQUIRED_KEYS = ["terminalCityShortlistSnapshotId", "cityId"] as const;
const INTENT_OPTIONAL_KEYS = ["warningCopyVersion"] as const;
const LOWERCASE_DIGEST = /^[0-9a-f]{64}$/;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0;
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  if (!isPlainRecord(value)) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!required.every((key) => keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))) mismatch();
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function dataProperty(value: unknown, key: string): unknown {
  if (!isPlainRecord(value)) mismatch();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  return descriptor.value;
}

function ownData<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
        const length = Object.getOwnPropertyDescriptor(value, "length");
        if (length === undefined || !("value" in length) ||
          !Number.isSafeInteger(length.value) || length.value < 0 ||
          Object.getOwnPropertyNames(value).length !== length.value + 1) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            mismatch();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) mismatch();
      const copy: PlainRecord = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          mismatch();
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

function identifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function parseIntent(value: unknown): CitySelectionCommandIntent {
  const record = exactRecord(value, INTENT_REQUIRED_KEYS, INTENT_OPTIONAL_KEYS);
  const hasWarning = Object.prototype.hasOwnProperty.call(record, "warningCopyVersion");
  if (hasWarning && record.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  return freeze({
    terminalCityShortlistSnapshotId: identifier(record.terminalCityShortlistSnapshotId),
    cityId: identifier(record.cityId),
    ...(hasWarning ? { warningCopyVersion: "city-unknown-risk@1" as const } : {}),
  });
}

function capturePublication(value: CitySelectionPublication): CapturedPublication {
  const publication = exactRecord(value, PUBLICATION_KEYS);
  const commandId = identifier(publication.commandId);
  const intent = parseIntent(publication.intent);
  const selection = dataProperty(publication.pair, "selection");
  const runId = identifier(dataProperty(selection, "runId"));
  return Object.freeze({
    commandId,
    intent,
    pair: publication.pair as CitySelectionWithBranch,
    runId,
  });
}

function hasCode(error: unknown, prefix: string): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    (error as { readonly code: string }).code.startsWith(prefix);
}

function normalize(error: unknown): never {
  if (error instanceof Error && [
    "integrity_mismatch",
    "city_selection_not_found",
    "city_catalog_upgrade_required",
  ].includes(error.message)) throw error;
  if (hasCode(error, "SQLITE_BUSY") || hasCode(error, "SQLITE_CONSTRAINT")) mismatch();
  mismatch();
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: EvidenceIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

export class SqliteCitySelectionWriter implements CitySelectionWriterPort {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
    private readonly dependencies: CitySelectionWriterDependencies,
  ) {}

  async publishSelection(input: CitySelectionPublication): Promise<CitySelectionWithBranch> {
    let publication: CapturedPublication;
    try {
      publication = capturePublication(input);
    } catch (error) {
      normalize(error);
    }
    const operation = this.database.transaction(() => this.publishInTransaction(publication));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return operation.immediate();
      } catch (error) {
        if (!hasCode(error, "SQLITE_BUSY") || attempt === 7) normalize(error);
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
    return mismatch();
  }

  async loadSelectionWithBranchVerified(
    citySelectionSnapshotId: string,
  ): Promise<CitySelectionWithBranch> {
    try {
      const id = identifier(citySelectionSnapshotId);
      const operation = this.database.transaction(() => {
        const rows = this.selectionRowsById(id);
        if (rows.length === 0) throw new Error("city_selection_not_found");
        if (rows.length !== 1) mismatch();
        this.requireCurrentCatalog(rows[0]!.ranking_snapshot_id);
        return this.reconstructPair(rows[0]!);
      });
      return operation.deferred();
    } catch (error) {
      normalize(error);
    }
  }

  async listSelectionsWithBranchesVerified(
    runId: string,
  ): Promise<readonly CitySelectionWithBranch[]> {
    try {
      const ownedRunId = identifier(runId);
      const operation = this.database.transaction(() => {
        const rows = this.database.prepare(`
          SELECT ${this.selectionColumns()}
          FROM city_selection_snapshots
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `).all(ownedRunId) as SelectionRow[];
        return freeze(rows.map((row) => {
          this.requireCurrentCatalog(row.ranking_snapshot_id);
          return this.reconstructPair(row);
        }));
      });
      return operation.deferred();
    } catch (error) {
      normalize(error);
    }
  }

  private publishInTransaction(publication: CapturedPublication): CitySelectionWithBranch {
    const existing = this.selectionRowByCommand(publication.runId, publication.commandId);
    if (existing !== undefined) {
      const storedIntent = this.verifyCommand(existing);
      if (!sameCanonical(storedIntent, publication.intent, this.integrity)) mismatch();
      this.requireCurrentCatalog(existing.ranking_snapshot_id);
      return this.reconstructPair(existing);
    }

    const candidate = ownData(publication.pair);
    const candidateSelection = dataProperty(candidate, "selection");
    const rankingSnapshotId = identifier(dataProperty(candidateSelection, "rankingSnapshotId"));
    this.requireCurrentCatalog(rankingSnapshotId);
    const pair = this.reconstructCandidate(candidate, publication);
    this.insertSelection(pair.selection, publication.intent);
    this.insertBranch(pair.commit, pair.selection);
    const rows = this.selectionRowsById(pair.selection.id);
    if (rows.length !== 1) mismatch();
    return this.reconstructPair(rows[0]!);
  }

  private reconstructCandidate(
    value: CitySelectionWithBranch,
    publication: CapturedPublication,
  ): CitySelectionWithBranch {
    const selectionValue = dataProperty(value, "selection");
    const structural = reconstructCitySelectionSnapshot(
      selectionValue,
      createCityDecisionIntegrityView(this.integrity),
    );
    const hasIntentWarning = Object.prototype.hasOwnProperty.call(
      publication.intent,
      "warningCopyVersion",
    );
    const hasSelectionWarning = Object.prototype.hasOwnProperty.call(
      structural,
      "warningCopyVersion",
    );
    if (structural.commandId !== publication.commandId ||
      structural.runId !== publication.runId ||
      structural.terminalRevisionId !== publication.intent.terminalCityShortlistSnapshotId ||
      structural.cityId !== publication.intent.cityId ||
      hasIntentWarning !== hasSelectionWarning ||
      structural.warningCopyVersion !== publication.intent.warningCopyVersion) mismatch();
    const terminal = this.dependencies.frontier.loadRevisionVerified(
      structural.terminalRevisionId,
    );
    if (terminal.kind !== "terminal") mismatch();
    const ranking = this.dependencies.rankings.loadRankingVerified(
      structural.rankingSnapshotId,
    );
    const preCityBranch = this.dependencies.branches.loadPreCityBranchVerified(
      structural.preCityBranchCommitId,
    );
    return reconstructCitySelectionWithBranch(value, {
      terminal,
      ranking,
      preCityBranch,
    }, createCityDecisionIntegrityView(this.integrity));
  }

  private reconstructPair(row: SelectionRow): CitySelectionWithBranch {
    const { selection, intent } = this.verifySelection(row);
    const terminal = this.dependencies.frontier.loadRevisionVerified(
      selection.terminalRevisionId,
    );
    if (terminal.kind !== "terminal") mismatch();
    const ranking = this.dependencies.rankings.loadRankingVerified(selection.rankingSnapshotId);
    const parent = this.dependencies.branches.loadPreCityBranchVerified(
      selection.preCityBranchCommitId,
    );
    const branchRows = this.branchRowsBySelection(selection.id);
    if (branchRows.length !== 1) mismatch();
    const commit = this.verifyBranch(branchRows[0]!, selection, parent);
    const pair = reconstructCitySelectionWithBranch({ selection, commit }, {
      terminal,
      ranking,
      preCityBranch: parent,
    }, createCityDecisionIntegrityView(this.integrity));
    if (selection.runId !== row.run_id ||
      intent.terminalCityShortlistSnapshotId !== selection.terminalRevisionId ||
      intent.cityId !== selection.cityId) mismatch();
    return pair;
  }

  private verifySelection(row: SelectionRow): {
    readonly selection: CitySelectionSnapshot;
    readonly intent: CitySelectionCommandIntent;
  } {
    const intent = this.verifyCommand(row);
    let value: unknown;
    try {
      value = JSON.parse(row.payload_json) as unknown;
    } catch {
      mismatch();
    }
    if (this.integrity.canonical(value) !== row.payload_json ||
      !LOWERCASE_DIGEST.test(row.payload_hash) ||
      !secureHexEqual(this.integrity.hash(row.payload_json), row.payload_hash) ||
      !LOWERCASE_DIGEST.test(row.hmac) ||
      !secureHexEqual(this.integrity.sign(this.integrity.canonical({
        value,
        command: intent,
      })), row.hmac)) mismatch();
    const selection = reconstructCitySelectionSnapshot(
      value,
      createCityDecisionIntegrityView(this.integrity),
    );
    if (row.id !== selection.id || row.run_id !== selection.runId ||
      row.command_id !== selection.commandId ||
      row.terminal_revision_id !== selection.terminalRevisionId ||
      row.city_id !== selection.cityId || row.country_code !== selection.countryCode ||
      row.profile_snapshot_id !== selection.profileSnapshotId ||
      row.preference_profile_snapshot_id !== selection.preferenceProfileSnapshotId ||
      row.resolved_country_shortlist_revision_id !==
        selection.resolvedCountryShortlistRevisionId ||
      row.criteria_snapshot_id !== selection.criteriaSnapshotId ||
      row.ranking_snapshot_id !== selection.rankingSnapshotId ||
      row.pre_city_branch_commit_id !== selection.preCityBranchCommitId ||
      row.selected_marker_digest !== selection.selectedMarkerDigest ||
      row.knowledge_revision_id !== selection.knowledgeRevisionId ||
      row.evidence_snapshot_id !== selection.evidenceSnapshotId ||
      row.warning_copy_version !== (selection.warningCopyVersion ?? null) ||
      row.schema_version !== selection.schemaVersion || row.created_at !== selection.createdAt ||
      intent.terminalCityShortlistSnapshotId !== selection.terminalRevisionId ||
      intent.cityId !== selection.cityId ||
      intent.warningCopyVersion !== selection.warningCopyVersion) mismatch();
    return freeze({ selection, intent });
  }

  private verifyCommand(row: SelectionRow): CitySelectionCommandIntent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.command_json) as unknown;
    } catch {
      mismatch();
    }
    const intent = parseIntent(parsed);
    if (this.integrity.canonical(intent) !== row.command_json ||
      !LOWERCASE_DIGEST.test(row.command_hash) ||
      !secureHexEqual(this.integrity.hash(row.command_json), row.command_hash)) mismatch();
    return intent;
  }

  private verifyBranch(
    row: BranchRow,
    selection: CitySelectionSnapshot,
    parent: PreCityBranchCommit,
  ): CityBranchCommit {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json) as unknown;
    } catch {
      mismatch();
    }
    if (this.integrity.canonical(parsed) !== row.payload_json ||
      !LOWERCASE_DIGEST.test(row.payload_hash) ||
      !secureHexEqual(this.integrity.hash(row.payload_json), row.payload_hash) ||
      !LOWERCASE_DIGEST.test(row.hmac) ||
      !secureHexEqual(this.integrity.sign(row.payload_json), row.hmac)) mismatch();
    const commit = parsed as CityBranchCommit;
    if (row.id !== commit.id || row.kind !== "selection" ||
      row.profile_snapshot_id !== selection.profileSnapshotId ||
      row.preference_profile_snapshot_id !== selection.preferenceProfileSnapshotId ||
      row.resolved_country_shortlist_revision_id !==
        selection.resolvedCountryShortlistRevisionId ||
      row.country_code !== selection.countryCode ||
      row.resolved_country_entry_digest !== parent.resolvedCountryEntryDigest ||
      row.city_id !== selection.cityId || row.parent_id !== parent.id ||
      row.forked_from !== parent.id || row.selection_snapshot_id !== selection.id ||
      row.schema_version !== "city-branch@1" || row.created_at !== selection.createdAt) {
      mismatch();
    }
    return commit;
  }

  private requireCurrentCatalog(rankingSnapshotId: string): void {
    const locator = this.database.prepare(`
      SELECT catalog_revision_id FROM city_ranking_snapshots WHERE id = ?
    `).get(identifier(rankingSnapshotId)) as {
      readonly catalog_revision_id: string;
    } | undefined;
    if (locator === undefined) mismatch();
    const catalog = this.dependencies.catalogs.loadVerified(locator.catalog_revision_id);
    if (catalog.catalog.id !== locator.catalog_revision_id) mismatch();
    if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
      if (catalog.catalog.rulesVersion === "city-catalog@1") {
        throw new Error("city_catalog_upgrade_required");
      }
      mismatch();
    }
  }

  private insertSelection(
    selection: CitySelectionSnapshot,
    intent: CitySelectionCommandIntent,
  ): void {
    const payload = this.integrity.canonical(selection);
    const command = this.integrity.canonical(intent);
    this.database.prepare(`
      INSERT INTO city_selection_snapshots (
        id, run_id, command_id, terminal_revision_id, city_id, country_code,
        profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, criteria_snapshot_id,
        ranking_snapshot_id, pre_city_branch_commit_id, selected_marker_digest,
        knowledge_revision_id, evidence_snapshot_id, warning_copy_version,
        schema_version, command_json, command_hash, payload_json, payload_hash, hmac,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      selection.id,
      selection.runId,
      selection.commandId,
      selection.terminalRevisionId,
      selection.cityId,
      selection.countryCode,
      selection.profileSnapshotId,
      selection.preferenceProfileSnapshotId,
      selection.resolvedCountryShortlistRevisionId,
      selection.criteriaSnapshotId,
      selection.rankingSnapshotId,
      selection.preCityBranchCommitId,
      selection.selectedMarkerDigest,
      selection.knowledgeRevisionId,
      selection.evidenceSnapshotId,
      selection.warningCopyVersion ?? null,
      selection.schemaVersion,
      command,
      this.integrity.hash(command),
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(this.integrity.canonical({ value: selection, command: intent })),
      selection.createdAt,
    );
  }

  private insertBranch(commit: CityBranchCommit, selection: CitySelectionSnapshot): void {
    const parent = this.dependencies.branches.loadPreCityBranchVerified(
      selection.preCityBranchCommitId,
    );
    const payload = this.integrity.canonical(commit);
    this.database.prepare(`
      INSERT INTO city_branch_commits (
        id, kind, profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, country_code,
        resolved_country_entry_digest, city_id, parent_id, forked_from,
        selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, 'selection', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      commit.id,
      selection.profileSnapshotId,
      selection.preferenceProfileSnapshotId,
      selection.resolvedCountryShortlistRevisionId,
      selection.countryCode,
      parent.resolvedCountryEntryDigest,
      selection.cityId,
      commit.parentId,
      commit.forkedFrom,
      selection.id,
      commit.schemaVersion,
      payload,
      this.integrity.hash(payload),
      this.integrity.sign(payload),
      commit.createdAt,
    );
  }

  private selectionRowByCommand(runId: string, commandId: string): SelectionRow | undefined {
    return this.database.prepare(`
      SELECT ${this.selectionColumns()}
      FROM city_selection_snapshots WHERE run_id = ? AND command_id = ?
    `).get(runId, commandId) as SelectionRow | undefined;
  }

  private selectionRowsById(id: string): SelectionRow[] {
    return this.database.prepare(`
      SELECT ${this.selectionColumns()}
      FROM city_selection_snapshots WHERE id = ?
    `).all(id) as SelectionRow[];
  }

  private branchRowsBySelection(selectionId: string): BranchRow[] {
    return this.database.prepare(`
      SELECT id, kind, profile_snapshot_id, preference_profile_snapshot_id,
             resolved_country_shortlist_revision_id, country_code,
             resolved_country_entry_digest, city_id, parent_id, forked_from,
             selection_snapshot_id, schema_version, payload_json, payload_hash,
             hmac, created_at
      FROM city_branch_commits WHERE selection_snapshot_id = ?
    `).all(selectionId) as BranchRow[];
  }

  private selectionColumns(): string {
    return `id, run_id, command_id, terminal_revision_id, city_id, country_code,
      profile_snapshot_id, preference_profile_snapshot_id,
      resolved_country_shortlist_revision_id, criteria_snapshot_id,
      ranking_snapshot_id, pre_city_branch_commit_id, selected_marker_digest,
      knowledge_revision_id, evidence_snapshot_id, warning_copy_version,
      schema_version, command_json, command_hash, payload_json, payload_hash, hmac,
      created_at`;
  }
}
