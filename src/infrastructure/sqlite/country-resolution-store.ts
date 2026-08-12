import type Database from "better-sqlite3";

import type {
  CountryResolutionChainLocator,
  CountryResolutionOperation,
  CountryResolutionRevision,
  CountryResolutionSemanticContext,
  CountryResolutionStorePort,
  ResolutionSourceBinding,
} from "../../application/country-resolution-contracts";
import {
  countryResolutionMarkerProjection,
  countryResolutionContextHash,
  countryResolutionRevisionId,
  countryResolutionRunId,
  countryResolutionStartCommandId,
  reconstructFrontierMarker,
} from "../../application/country-resolution-contracts";
import { countryCheckRunId, type FrontierMarker } from "../../application/place-frontier";
import {
  assertCountryResolutionTransition,
  reconstructCountryResolution,
  type CountryResolutionSemanticState,
  type ResolutionMarkerProjection,
} from "../../decision/country-resolution-policy";
import { canonicalJson, hmacSha256, secureHexEqual, sha256Text } from "../integrity";

interface ResolutionRow {
  readonly id: string;
  readonly resolution_run_id: string;
  readonly kind: string;
  readonly predecessor_id: string | null;
  readonly automatic_shortlist_snapshot_id: string;
  readonly ranking_snapshot_id: string;
  readonly command_id: string;
  readonly command_kind: string;
  readonly command_json: string;
  readonly command_hash: string;
  readonly schema_version: string;
  readonly rules_version: string;
  readonly context_hash: string;
  readonly payload_json: string;
  readonly payload_hash: string;
  readonly hmac: string;
  readonly created_at: string;
}

interface FrontierSourceRow {
  readonly id: string;
  readonly kind: string;
  readonly payload_json: string;
}

const RESOLUTION_COLUMNS = `
  id, resolution_run_id, kind, predecessor_id, automatic_shortlist_snapshot_id, ranking_snapshot_id,
  command_id, command_kind, command_json, command_hash, schema_version, rules_version, context_hash,
  payload_json, payload_hash, hmac, created_at
`;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function staleResolutionHead(): never {
  throw new Error("stale_resolution_head");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function decodeOperation(value: unknown): CountryResolutionOperation {
  if (!isRecord(value) || !isNonEmptyString(value.commandId) || !isNonEmptyString(value.kind)) {
    integrityMismatch();
  }
  if (value.kind === "start") {
    if (!hasExactKeys(value, ["commandId", "kind", "automaticShortlistSnapshotId"]) ||
      !isNonEmptyString(value.automaticShortlistSnapshotId)) integrityMismatch();
    return value as CountryResolutionOperation;
  }
  if (value.kind === "yellow_decision") {
    if (!hasExactKeys(value, [
      "commandId", "kind", "expectedHeadRevisionId", "countryCode", "decision", "warningCopyVersion",
    ]) || !isNonEmptyString(value.expectedHeadRevisionId) || !isNonEmptyString(value.countryCode) ||
      (value.decision !== "accepted_at_own_risk" && value.decision !== "rejected") ||
      value.warningCopyVersion !== "yellow-risk@1") integrityMismatch();
    return value as CountryResolutionOperation;
  }
  if (value.kind === "replacement_completed") {
    if (!hasExactKeys(value, [
      "commandId", "kind", "expectedHeadRevisionId", "countryCode", "countryCheckRunId",
    ]) || !isNonEmptyString(value.expectedHeadRevisionId) || !isNonEmptyString(value.countryCode) ||
      !isNonEmptyString(value.countryCheckRunId)) integrityMismatch();
    return value as CountryResolutionOperation;
  }
  integrityMismatch();
}

function decodeRevision(value: unknown): CountryResolutionRevision {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) integrityMismatch();
  const baseKeys = [
    "schemaVersion", "rulesVersion", "id", "resolutionRunId", "automaticShortlistSnapshotId",
    "rankingSnapshotId", "profileSnapshotId", "preferenceProfileSnapshotId", "decisions",
    "replacementMarkers", "nextUncheckedRank", "unresolvedCountryCodes", "slotCountryCodes",
    "contextHash", "createdAt", ...(value.predecessorRevisionId === undefined ? [] : ["predecessorRevisionId"]),
  ];
  const expected = value.kind === "working"
    ? [...baseKeys, "kind", "phase"]
    : value.kind === "resolved"
      ? [...baseKeys, "kind", "resolvedEntries", "stopCondition"]
      : [];
  if (!hasExactKeys(value, expected) || value.schemaVersion !== "country-resolution@1" ||
    value.rulesVersion !== "country-resolution@1" || !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.resolutionRunId) || !isNonEmptyString(value.automaticShortlistSnapshotId) ||
    !isNonEmptyString(value.rankingSnapshotId) || !isNonEmptyString(value.profileSnapshotId) ||
    !isNonEmptyString(value.preferenceProfileSnapshotId) || !Array.isArray(value.decisions) ||
    !Array.isArray(value.replacementMarkers) || !isPositiveInteger(value.nextUncheckedRank) ||
    !Array.isArray(value.unresolvedCountryCodes) ||
    !Array.isArray(value.slotCountryCodes) || !value.unresolvedCountryCodes.every(isNonEmptyString) ||
    !value.slotCountryCodes.every(isNonEmptyString) || !isSha256(value.contextHash) ||
    !isCanonicalInstant(value.createdAt) ||
    (value.predecessorRevisionId !== undefined && !isNonEmptyString(value.predecessorRevisionId))) {
    integrityMismatch();
  }
  if (value.kind === "working" &&
    (value.phase !== "awaiting_decision" && value.phase !== "replacement_required")) integrityMismatch();
  if (value.kind === "resolved" &&
    (!Array.isArray(value.resolvedEntries) ||
      (value.stopCondition !== "five_effective_green" && value.stopCondition !== "ranking_exhausted"))) {
    integrityMismatch();
  }
  const replacementMarkers = value.replacementMarkers.map((marker) =>
    reconstructFrontierMarker(marker, { profileSnapshotId: value.profileSnapshotId as string }));
  return structuredClone({ ...value, replacementMarkers }) as unknown as CountryResolutionRevision;
}

function sourceOf(revision: CountryResolutionRevision): ResolutionSourceBinding {
  return {
    automaticShortlistSnapshotId: revision.automaticShortlistSnapshotId,
    rankingSnapshotId: revision.rankingSnapshotId,
    profileSnapshotId: revision.profileSnapshotId,
    preferenceProfileSnapshotId: revision.preferenceProfileSnapshotId,
  };
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function semanticState(
  revision: CountryResolutionRevision,
  orderedCountryCodes: readonly string[],
  markerProjections: readonly ResolutionMarkerProjection[],
): CountryResolutionSemanticState {
  const reconstructionInput = {
    orderedCountryCodes,
    markers: markerProjections,
    decisions: revision.decisions,
  };
  const projection = reconstructCountryResolution(reconstructionInput);
  reconstructCountryResolution({
    ...reconstructionInput,
    persisted: revision.kind === "working"
      ? {
          unresolvedCountryCodes: revision.unresolvedCountryCodes,
          slotCountryCodes: revision.slotCountryCodes,
          resolvedCountryCodes: projection.resolvedCountryCodes,
          nextUncheckedRank: revision.nextUncheckedRank,
          ...(projection.currentPromptCountryCode === undefined
            ? {}
            : { currentPromptCountryCode: projection.currentPromptCountryCode }),
          phase: revision.phase,
        }
      : {
          unresolvedCountryCodes: revision.unresolvedCountryCodes,
          slotCountryCodes: revision.slotCountryCodes,
          resolvedCountryCodes: projection.resolvedCountryCodes,
          nextUncheckedRank: revision.nextUncheckedRank,
          terminal: { resolvedEntries: revision.resolvedEntries, stopCondition: revision.stopCondition },
        },
  });
  return revision.kind === "working"
    ? {
        kind: "working",
        decisions: revision.decisions,
        markerProjections,
        nextUncheckedRank: revision.nextUncheckedRank,
        unresolvedCountryCodes: revision.unresolvedCountryCodes,
        slotCountryCodes: revision.slotCountryCodes,
        resolvedEntries: [],
        phase: projection.phase,
      }
    : {
        kind: "resolved",
        decisions: revision.decisions,
        markerProjections,
        nextUncheckedRank: revision.nextUncheckedRank,
        unresolvedCountryCodes: revision.unresolvedCountryCodes,
        slotCountryCodes: revision.slotCountryCodes,
        resolvedEntries: revision.resolvedEntries,
        stopCondition: projection.terminal?.stopCondition,
      };
}

function storedReplacementMarkers(revision: CountryResolutionRevision): readonly FrontierMarker[] {
  return revision.replacementMarkers;
}

function assertReplacementProjectionBinding(
  revision: CountryResolutionRevision,
  context: CountryResolutionSemanticContext,
  sourceMarkerCount: number,
): void {
  const expected = context.markerProjections.slice(
    sourceMarkerCount,
    sourceMarkerCount + revision.replacementMarkers.length,
  );
  const actual = revision.replacementMarkers.map((marker) =>
    countryResolutionMarkerProjection(marker, {
      canonical: canonicalJson,
      hash: sha256Text,
    }, { profileSnapshotId: revision.profileSnapshotId }));
  if (!sameCanonical(actual, expected)) integrityMismatch();
}

export class SqliteCountryResolutionStore implements CountryResolutionStorePort {
  constructor(
    private readonly database: Database.Database,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length === 0) throw new Error("integrity_key_missing");
    this.database.pragma("busy_timeout = 5000");
  }

  append(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }): CountryResolutionRevision {
    try {
      const transaction = this.database.transaction(() => this.appendInTransaction(input));
      return transaction.immediate();
    } catch (error) {
      if (error instanceof Error && (error.message === "integrity_mismatch" ||
        error.message === "stale_resolution_head")) throw error;
      return this.recoverLostRace(input, error);
    }
  }

  loadRevisionVerified(id: string, context: CountryResolutionSemanticContext): CountryResolutionRevision {
    try {
      const record = this.loadRecordById(id);
      const chain = this.loadChainRows(record.revision.resolutionRunId);
      this.assertVerifiedChain(chain, context);
      return record.revision;
    } catch (error) {
      this.normalizeFailure(error);
    }
  }

  loadHeadVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): CountryResolutionRevision {
    const chain = this.loadChainVerified(resolutionRunId, context);
    const head = chain.at(-1);
    if (head === undefined) throw new Error("resolution_not_found");
    return head;
  }

  loadChainVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): readonly CountryResolutionRevision[] {
    try {
      const chain = this.loadChainRows(resolutionRunId);
      if (chain.length === 0) throw new Error("resolution_not_found");
      this.assertVerifiedChain(chain, context);
      return chain.map(({ revision }) => revision);
    } catch (error) {
      this.normalizeFailure(error);
    }
  }

  findByCommandVerified(
    resolutionRunId: string,
    commandId: string,
    context: CountryResolutionSemanticContext,
  ): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } | undefined {
    try {
      const row = this.database.prepare(`
        SELECT ${RESOLUTION_COLUMNS} FROM country_resolution_revisions
        WHERE resolution_run_id = ? AND command_id = ?
      `).get(resolutionRunId, commandId) as ResolutionRow | undefined;
      if (row === undefined) return undefined;
      const record = this.decodeRow(row);
      this.assertVerifiedChain(this.loadChainRows(resolutionRunId), context);
      return record;
    } catch (error) {
      this.normalizeFailure(error);
    }
  }

  findRootForRunVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): CountryResolutionRevision | undefined {
    const chain = this.loadChainVerified(resolutionRunId, context);
    return chain[0];
  }

  locateChainVerified(input:
    | { readonly resolutionRunId: string }
    | { readonly revisionId: string }
  ): CountryResolutionChainLocator {
    try {
      const runId = "resolutionRunId" in input
        ? input.resolutionRunId
        : this.loadRecordById(input.revisionId).revision.resolutionRunId;
      const chain = this.loadChainRows(runId);
      if (chain.length === 0) throw new Error("resolution_not_found");
      this.assertTopologyAndBytes(chain);
      const source = sourceOf(chain[0]!.revision);
      return { resolutionRunId: runId, source, revisions: chain.map(({ revision }) => revision) };
    } catch (error) {
      this.normalizeFailure(error);
    }
  }

  private appendInTransaction(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }): CountryResolutionRevision {
    const revision = decodeRevision(input.revision);
    const operation = decodeOperation(input.operation);
    const existing = this.findStoredCommand(revision.resolutionRunId, operation.commandId);
    if (existing !== undefined) {
      this.assertVerifiedChain(this.loadChainRows(revision.resolutionRunId), input.context);
      if (!sameCanonical(existing.operation, operation)) integrityMismatch();
      return existing.revision;
    }
    const chain = this.loadChainRows(revision.resolutionRunId);
    const head = chain.at(-1)?.revision;
    if (head === undefined) {
      if (revision.predecessorRevisionId !== undefined || operation.kind !== "start") staleResolutionHead();
    } else if (revision.predecessorRevisionId !== head.id) {
      staleResolutionHead();
    }
    this.assertOperationMatchesRevision(revision, operation);
    this.assertRevisionSemantics(revision, operation, input.context, head);
    this.insert(revision, operation);
    const stored = this.loadRecordById(revision.id);
    if (!sameCanonical(stored.revision, revision) || !sameCanonical(stored.operation, operation)) {
      integrityMismatch();
    }
    return stored.revision;
  }

  private recoverLostRace(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }, error: unknown): CountryResolutionRevision {
    const operation = decodeOperation(input.operation);
    const revision = decodeRevision(input.revision);
    const existing = this.findStoredCommand(revision.resolutionRunId, operation.commandId);
    if (existing !== undefined) {
      this.assertVerifiedChain(this.loadChainRows(revision.resolutionRunId), input.context);
      if (!sameCanonical(existing.operation, operation)) integrityMismatch();
      return existing.revision;
    }
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      const head = this.loadChainRows(revision.resolutionRunId).at(-1)?.revision;
      if (head !== undefined && head.id !== revision.predecessorRevisionId) staleResolutionHead();
    }
    this.normalizeFailure(error);
  }

  private insert(revision: CountryResolutionRevision, operation: CountryResolutionOperation): void {
    const payloadJson = canonicalJson(revision);
    const commandJson = canonicalJson(operation);
    this.database.prepare(`
      INSERT INTO country_resolution_revisions (${RESOLUTION_COLUMNS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revision.id, revision.resolutionRunId, revision.kind, revision.predecessorRevisionId ?? null,
      revision.automaticShortlistSnapshotId, revision.rankingSnapshotId, operation.commandId, operation.kind,
      commandJson, sha256Text(commandJson), revision.schemaVersion, revision.rulesVersion, revision.contextHash,
      payloadJson, sha256Text(payloadJson), hmacSha256(canonicalJson({ revision, operation }), this.hmacKey),
      revision.createdAt,
    );
  }

  private assertRevisionSemantics(
    revision: CountryResolutionRevision,
    operation: CountryResolutionOperation,
    context: CountryResolutionSemanticContext,
    predecessor: CountryResolutionRevision | undefined,
  ): void {
    if (!sameCanonical(sourceOf(revision), context.source) ||
      revision.resolutionRunId !== countryResolutionRunId(revision.automaticShortlistSnapshotId, {
        canonical: canonicalJson,
        hash: sha256Text,
      }) || revision.id !== countryResolutionRevisionId(revision.resolutionRunId, operation, {
        canonical: canonicalJson,
        hash: sha256Text,
      }) || revision.contextHash !== countryResolutionContextHash({
        resolutionRunId: revision.resolutionRunId,
        source: sourceOf(revision),
        ...(revision.predecessorRevisionId === undefined
          ? {}
          : { predecessorRevisionId: revision.predecessorRevisionId }),
        operation,
        rulesVersion: revision.rulesVersion,
      }, { canonical: canonicalJson, hash: sha256Text })) integrityMismatch();
    this.verifySourceRows(revision);
    const successorState = semanticState(revision, context.orderedCountryCodes, context.markerProjections);
    const sourceMarkerCount = context.markerProjections.length - revision.replacementMarkers.length;
    if (sourceMarkerCount < 0) integrityMismatch();
    assertReplacementProjectionBinding(revision, context, sourceMarkerCount);
    if (predecessor !== undefined) {
      const predecessorReplacementCount = storedReplacementMarkers(predecessor).length;
      const predecessorMarkers = context.markerProjections.slice(
        0,
        sourceMarkerCount + predecessorReplacementCount,
      );
      assertCountryResolutionTransition({
        predecessor: semanticState(predecessor, context.orderedCountryCodes, predecessorMarkers),
        successor: successorState,
        orderedCountryCodes: context.orderedCountryCodes,
      });
    }
  }

  private assertOperationMatchesRevision(
    revision: CountryResolutionRevision,
    operation: CountryResolutionOperation,
  ): void {
    if (operation.kind === "start") {
      if (revision.predecessorRevisionId !== undefined ||
        operation.automaticShortlistSnapshotId !== revision.automaticShortlistSnapshotId ||
        operation.commandId !== countryResolutionStartCommandId(operation.automaticShortlistSnapshotId, {
          canonical: canonicalJson,
          hash: sha256Text,
        })) integrityMismatch();
      return;
    }
    if (revision.predecessorRevisionId !== operation.expectedHeadRevisionId) integrityMismatch();
    if (operation.kind === "yellow_decision") {
      const decision = revision.decisions.at(-1);
      if (decision === undefined || decision.commandId !== operation.commandId ||
        decision.countryCode !== operation.countryCode || decision.decision !== operation.decision ||
        decision.warningCopyVersion !== operation.warningCopyVersion) integrityMismatch();
      return;
    }
    const marker = revision.replacementMarkers.at(-1);
    if (marker === undefined || marker.country.countryCode !== operation.countryCode ||
      marker.countryCheckRunId !== operation.countryCheckRunId || operation.commandId !== operation.countryCheckRunId ||
      marker.countryCheckRunId !== countryCheckRunId(revision.resolutionRunId, marker.country.countryCode)) {
      integrityMismatch();
    }
  }

  private verifySourceRows(revision: CountryResolutionRevision): void {
    const rows = this.database.prepare(`
      SELECT id, kind, payload_json FROM place_frontier_snapshots WHERE id IN (?, ?)
    `).all(revision.automaticShortlistSnapshotId, revision.rankingSnapshotId) as FrontierSourceRow[];
    if (rows.length !== 2) integrityMismatch();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const shortlist = byId.get(revision.automaticShortlistSnapshotId);
    const ranking = byId.get(revision.rankingSnapshotId);
    if (shortlist?.kind !== "shortlist" || ranking?.kind !== "ranking") integrityMismatch();
    let payload: unknown;
    try {
      payload = JSON.parse(shortlist.payload_json) as unknown;
    } catch {
      integrityMismatch();
    }
    if (!isRecord(payload) || payload.rankingSnapshotId !== revision.rankingSnapshotId) integrityMismatch();
  }

  private assertVerifiedChain(
    chain: readonly { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation }[],
    context: CountryResolutionSemanticContext,
  ): void {
    this.assertTopologyAndBytes(chain);
    const head = chain.at(-1)?.revision;
    if (head === undefined || !sameCanonical(sourceOf(head), context.source)) integrityMismatch();
    for (const record of chain) this.verifySourceRows(record.revision);
    const sourceMarkerCount = context.markerProjections.length - (head?.replacementMarkers.length ?? 0);
    if (sourceMarkerCount < 0) integrityMismatch();
    for (const [index, record] of chain.entries()) {
      const revisionMarkers = context.markerProjections.slice(
        0,
        sourceMarkerCount + record.revision.replacementMarkers.length,
      );
      assertReplacementProjectionBinding(record.revision, context, sourceMarkerCount);
      semanticState(record.revision, context.orderedCountryCodes, revisionMarkers);
      if (index > 0) {
        const predecessor = chain[index - 1]!.revision;
        const predecessorMarkers = context.markerProjections.slice(
          0,
          sourceMarkerCount + predecessor.replacementMarkers.length,
        );
        assertCountryResolutionTransition({
          predecessor: semanticState(predecessor, context.orderedCountryCodes, predecessorMarkers),
          successor: semanticState(record.revision, context.orderedCountryCodes, revisionMarkers),
          orderedCountryCodes: context.orderedCountryCodes,
        });
      }
    }
  }

  private assertTopologyAndBytes(
    chain: readonly { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation }[],
  ): void {
    if (chain.length === 0) integrityMismatch();
    const source = sourceOf(chain[0]!.revision);
    for (const [index, record] of chain.entries()) {
      const predecessor = index === 0 ? undefined : chain[index - 1]!.revision;
      if (!sameCanonical(sourceOf(record.revision), source) ||
        record.revision.predecessorRevisionId !== predecessor?.id) integrityMismatch();
      this.assertOperationMatchesRevision(record.revision, record.operation);
      this.assertStoredIdentity(record.revision, record.operation);
    }
  }

  private assertStoredIdentity(
    revision: CountryResolutionRevision,
    operation: CountryResolutionOperation,
  ): void {
    if (revision.resolutionRunId !== countryResolutionRunId(revision.automaticShortlistSnapshotId, {
      canonical: canonicalJson,
      hash: sha256Text,
    }) || revision.id !== countryResolutionRevisionId(revision.resolutionRunId, operation, {
      canonical: canonicalJson,
      hash: sha256Text,
    }) || revision.contextHash !== countryResolutionContextHash({
      resolutionRunId: revision.resolutionRunId,
      source: sourceOf(revision),
      ...(revision.predecessorRevisionId === undefined ? {} : { predecessorRevisionId: revision.predecessorRevisionId }),
      operation,
      rulesVersion: revision.rulesVersion,
    }, { canonical: canonicalJson, hash: sha256Text })) integrityMismatch();
  }

  private loadChainRows(resolutionRunId: string): Array<{
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
  }> {
    const rows = this.database.prepare(`
      SELECT ${RESOLUTION_COLUMNS} FROM country_resolution_revisions
      WHERE resolution_run_id = ? ORDER BY rowid ASC
    `).all(resolutionRunId) as ResolutionRow[];
    return rows.map((row) => this.decodeRow(row));
  }

  private findStoredCommand(
    resolutionRunId: string,
    commandId: string,
  ): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } | undefined {
    const row = this.database.prepare(`
      SELECT ${RESOLUTION_COLUMNS} FROM country_resolution_revisions
      WHERE resolution_run_id = ? AND command_id = ?
    `).get(resolutionRunId, commandId) as ResolutionRow | undefined;
    return row === undefined ? undefined : this.decodeRow(row);
  }

  private loadRecordById(id: string): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } {
    const row = this.database.prepare(`
      SELECT ${RESOLUTION_COLUMNS} FROM country_resolution_revisions WHERE id = ?
    `).get(id) as ResolutionRow | undefined;
    if (row === undefined) throw new Error("resolution_not_found");
    return this.decodeRow(row);
  }

  private decodeRow(row: ResolutionRow): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } {
    let payload: unknown;
    let command: unknown;
    try {
      payload = JSON.parse(row.payload_json) as unknown;
      command = JSON.parse(row.command_json) as unknown;
    } catch {
      integrityMismatch();
    }
    const revision = decodeRevision(payload);
    const operation = decodeOperation(command);
    if (row.payload_json !== canonicalJson(revision) || row.command_json !== canonicalJson(operation) ||
      !secureHexEqual(row.payload_hash, sha256Text(row.payload_json)) ||
      !secureHexEqual(row.command_hash, sha256Text(row.command_json)) ||
      !secureHexEqual(row.hmac, hmacSha256(canonicalJson({ revision, operation }), this.hmacKey)) ||
      row.id !== revision.id || row.resolution_run_id !== revision.resolutionRunId ||
      row.kind !== revision.kind || row.predecessor_id !== (revision.predecessorRevisionId ?? null) ||
      row.automatic_shortlist_snapshot_id !== revision.automaticShortlistSnapshotId ||
      row.ranking_snapshot_id !== revision.rankingSnapshotId || row.command_id !== operation.commandId ||
      row.command_kind !== operation.kind || row.schema_version !== revision.schemaVersion ||
      row.rules_version !== revision.rulesVersion || row.context_hash !== revision.contextHash ||
      row.created_at !== revision.createdAt) integrityMismatch();
    return { revision, operation };
  }

  private normalizeFailure(error: unknown): never {
    if (error instanceof Error && (error.message === "resolution_not_found" ||
      error.message === "integrity_mismatch" || error.message === "stale_resolution_head")) throw error;
    integrityMismatch();
  }
}
