import {
  countryResolutionContextHash,
  countryResolutionMarkerProjection,
  countryResolutionRevisionId,
  countryResolutionRunId,
  countryResolutionStartCommandId,
  type CountryResolutionOperation,
  type CountryResolutionRevision,
  type CountryResolutionSemanticContext,
  type CountryResolutionStorePort,
  type ResolvedCountryShortlistSnapshot,
  type ResolutionIntegrity,
  type ResolutionSourceBinding,
} from "./country-resolution-contracts";
import {
  countryCheckRunId,
  countryVerificationReplayExpectation,
  materializeFrontierMarker,
  type CountryVerificationProgress,
  type CountryVerifierPort,
  type FrontierCountry,
  type FrontierMarker,
} from "./country-verifier";
import type {
  PlaceFrontierReadModel,
  PlaceFrontierShortlistPresentation,
} from "./place-frontier";
import {
  COUNTRY_RESOLUTION_RULES_VERSION,
  YELLOW_RISK_WARNING_VERSION,
  reconstructCountryResolution,
  type CountryResolutionProjection,
  type YellowDecision,
  type YellowDecisionKind,
} from "../decision/country-resolution-policy";

export interface CountryResolutionReadModel {
  readonly resolutionRunId: string;
  readonly assessmentAt: string;
  readonly automaticFrontier: PlaceFrontierReadModel;
  readonly revision: CountryResolutionRevision;
}

export interface CountryResolutionContinuationPrepared {
  readonly resolutionRunId: string;
  readonly expectedRevisionId: string;
  readonly automaticShortlistSnapshotId: string;
  readonly profileId: string;
  readonly contextHash: string;
}

export interface ResolutionEvent<T extends string, P> {
  readonly resolutionRunId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: T;
  readonly payload: P;
}

export type CountryResolutionContinuationEvent =
  | ResolutionEvent<"replacement_country_activated", {
      readonly country: FrontierCountry;
      readonly rank: number;
    }>
  | ResolutionEvent<"replacement_country_progress", {
      readonly countryCode: string;
      readonly stage: CountryVerificationProgress["stage"];
      readonly label: string;
      readonly detail?: string;
      readonly sourceUrl?: string;
    }>
  | ResolutionEvent<"resolution_revision_committed", {
      readonly marker: FrontierMarker;
      readonly revision: CountryResolutionRevision;
    }>
  | ResolutionEvent<"resolution_continuation_completed", {
      readonly readModel: CountryResolutionReadModel;
    }>;

export interface CountryResolutionApplication {
  startCountryResolution(input: {
    readonly automaticShortlistSnapshotId: string;
  }): Promise<CountryResolutionReadModel>;
  decideYellow(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
    readonly countryCode: string;
    readonly decision: YellowDecisionKind;
    readonly warningCopyVersion: "yellow-risk@1";
    readonly commandId: string;
  }): Promise<CountryResolutionReadModel>;
  prepareCountryResolutionContinuation(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
  }): Promise<CountryResolutionContinuationPrepared>;
  continueCountryResolution(
    prepared: CountryResolutionContinuationPrepared,
    emit: (event: CountryResolutionContinuationEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CountryResolutionReadModel>;
  presentCountryResolution(resolutionRunId: string): Promise<CountryResolutionReadModel>;
  requireResolvedCountryShortlistForCity(
    revisionId: string,
  ): Promise<ResolvedCountryShortlistSnapshot>;
}

export interface CountryResolutionApplicationPorts {
  readonly frontier: PlaceFrontierShortlistPresentation;
  readonly store: CountryResolutionStorePort;
  readonly verifier: CountryVerifierPort;
  readonly integrity: ResolutionIntegrity;
  readonly clock: () => Date;
}

interface VerifiedResolution {
  readonly readModel: CountryResolutionReadModel;
  readonly context: CountryResolutionSemanticContext;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function staleResolutionHead(): never {
  throw new Error("stale_resolution_head");
}

function abort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sourceBinding(automatic: PlaceFrontierReadModel): ResolutionSourceBinding {
  return {
    automaticShortlistSnapshotId: automatic.shortlistSnapshot.id,
    rankingSnapshotId: automatic.rankingSnapshot.id,
    profileSnapshotId: automatic.rankingSnapshot.profileSnapshotId,
    preferenceProfileSnapshotId: automatic.rankingSnapshot.preferenceProfileSnapshotId,
  };
}

function sameCanonical(
  left: unknown,
  right: unknown,
  integrity: ResolutionIntegrity,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

function markerProjections(
  automatic: PlaceFrontierReadModel,
  replacements: readonly FrontierMarker[],
  integrity: ResolutionIntegrity,
) {
  return [...automatic.shortlistSnapshot.markers, ...replacements].map((marker) =>
    countryResolutionMarkerProjection(marker, integrity, {
      profileSnapshotId: automatic.rankingSnapshot.profileSnapshotId,
      evidenceSnapshotId: marker.evidenceSnapshotId,
    }));
}

function semanticContext(
  automatic: PlaceFrontierReadModel,
  replacements: readonly FrontierMarker[],
  integrity: ResolutionIntegrity,
): CountryResolutionSemanticContext {
  return {
    source: sourceBinding(automatic),
    orderedCountryCodes: automatic.rankingSnapshot.ordered.map(({ countryCode }) => countryCode),
    markerProjections: markerProjections(automatic, replacements, integrity),
  };
}

function revisionFromProjection(input: {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly predecessorRevisionId?: string;
  readonly decisions: readonly YellowDecision[];
  readonly replacementMarkers: readonly FrontierMarker[];
  readonly projection: CountryResolutionProjection;
  readonly operation: CountryResolutionOperation;
  readonly createdAt: string;
  readonly integrity: ResolutionIntegrity;
}): CountryResolutionRevision {
  const identity = {
    resolutionRunId: input.resolutionRunId,
    source: input.source,
    ...(input.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: input.predecessorRevisionId }),
    operation: input.operation,
    rulesVersion: COUNTRY_RESOLUTION_RULES_VERSION,
  };
  const base = {
    schemaVersion: COUNTRY_RESOLUTION_RULES_VERSION,
    rulesVersion: COUNTRY_RESOLUTION_RULES_VERSION,
    id: countryResolutionRevisionId(
      input.resolutionRunId,
      input.operation,
      input.integrity,
    ),
    resolutionRunId: input.resolutionRunId,
    ...(input.predecessorRevisionId === undefined
      ? {}
      : { predecessorRevisionId: input.predecessorRevisionId }),
    ...input.source,
    decisions: input.decisions,
    replacementMarkers: input.replacementMarkers,
    nextUncheckedRank: input.projection.nextUncheckedRank,
    unresolvedCountryCodes: input.projection.unresolvedCountryCodes,
    slotCountryCodes: input.projection.slotCountryCodes,
    contextHash: countryResolutionContextHash(identity, input.integrity),
    createdAt: input.createdAt,
  };
  return input.projection.terminal === undefined
    ? immutableCopy({
        ...base,
        kind: "working" as const,
        phase: input.projection.phase!,
      })
    : immutableCopy({
        ...base,
        kind: "resolved" as const,
        resolvedEntries: input.projection.terminal.resolvedEntries,
        stopCondition: input.projection.terminal.stopCondition,
      });
}

function readModel(
  automaticFrontier: PlaceFrontierReadModel,
  revision: CountryResolutionRevision,
): CountryResolutionReadModel {
  return immutableCopy({
    resolutionRunId: revision.resolutionRunId,
    assessmentAt: automaticFrontier.assessmentAt,
    automaticFrontier,
    revision,
  });
}

function isEvidenceNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "evidence_not_found";
}

function continuationContextHash(input: Omit<
  CountryResolutionContinuationPrepared,
  "contextHash"
>, integrity: ResolutionIntegrity): string {
  return integrity.hash(integrity.canonical(input));
}

function createContinuationEmitter(
  resolutionRunId: string,
  emit: (event: CountryResolutionContinuationEvent) => void | Promise<void>,
  clock: () => Date,
): (draft: CountryResolutionContinuationEvent extends infer Event
  ? Event extends CountryResolutionContinuationEvent
    ? Pick<Event, "type" | "payload">
    : never
  : never) => Promise<void> {
  let sequence = 0;
  return async (draft) => {
    await emit(immutableCopy({
      resolutionRunId,
      sequence: ++sequence,
      occurredAt: clock().toISOString(),
      type: draft.type,
      payload: draft.payload,
    } as CountryResolutionContinuationEvent));
  };
}

export function createCountryResolutionApplication(
  ports: CountryResolutionApplicationPorts,
): CountryResolutionApplication {
  async function presentVerified(
    input: { readonly resolutionRunId: string } | { readonly revisionId: string },
  ): Promise<VerifiedResolution> {
    const located = ports.store.locateChainVerified(input);
    const automatic = await ports.frontier.presentPlaceFrontierByShortlistId(
      located.source.automaticShortlistSnapshotId,
    );
    if (!sameCanonical(sourceBinding(automatic), located.source, ports.integrity)) {
      integrityMismatch();
    }
    const locatedHead = located.revisions.at(-1);
    if (locatedHead === undefined) integrityMismatch();
    const replayedReplacements: FrontierMarker[] = [];
    for (const stored of locatedHead.replacementMarkers) {
      const place = automatic.rankingSnapshot.ordered[stored.rank - 1];
      if (place?.countryCode !== stored.country.countryCode) integrityMismatch();
      const replay = await ports.verifier.present({
        parentRunId: located.resolutionRunId,
        countryCode: stored.country.countryCode,
        countryCheckRunId: stored.countryCheckRunId,
        profileId: located.source.profileSnapshotId,
      });
      const materialized = materializeFrontierMarker({
        place,
        checked: { countryCheckRunId: stored.countryCheckRunId, ...replay },
        parentRunId: located.resolutionRunId,
        profileId: located.source.profileSnapshotId,
        integrity: ports.integrity,
      });
      if (!sameCanonical(materialized, stored, ports.integrity) || !sameCanonical(
        replay,
        countryVerificationReplayExpectation(stored),
        ports.integrity,
      )) integrityMismatch();
      replayedReplacements.push(materialized);
    }
    const context = semanticContext(automatic, replayedReplacements, ports.integrity);
    const verified = ports.store.loadChainVerified(located.resolutionRunId, context);
    if (!sameCanonical(verified, located.revisions, ports.integrity)) integrityMismatch();
    const head = verified.at(-1);
    if (head === undefined || head.resolutionRunId !== countryResolutionRunId(
      located.source.automaticShortlistSnapshotId,
      ports.integrity,
    )) integrityMismatch();
    return { readModel: readModel(automatic, head), context };
  }

  async function startCountryResolution(input: {
    readonly automaticShortlistSnapshotId: string;
  }): Promise<CountryResolutionReadModel> {
    if (!isRecord(input) || !exactKeys(input, ["automaticShortlistSnapshotId"]) ||
      !isNonEmptyString(input.automaticShortlistSnapshotId)) integrityMismatch();
    const automatic = await ports.frontier.presentPlaceFrontierByShortlistId(
      input.automaticShortlistSnapshotId,
    );
    if (automatic.shortlistSnapshot.id !== input.automaticShortlistSnapshotId) {
      integrityMismatch();
    }
    const context = semanticContext(automatic, [], ports.integrity);
    const resolutionRunId = countryResolutionRunId(
      input.automaticShortlistSnapshotId,
      ports.integrity,
    );
    try {
      const existing = ports.store.findRootForRunVerified(resolutionRunId, context);
      if (existing !== undefined) {
        return (await presentVerified({ resolutionRunId })).readModel;
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === "resolution_not_found")) throw error;
    }
    const operation: CountryResolutionOperation = {
      commandId: countryResolutionStartCommandId(
        input.automaticShortlistSnapshotId,
        ports.integrity,
      ),
      kind: "start",
      automaticShortlistSnapshotId: input.automaticShortlistSnapshotId,
    };
    const projection = reconstructCountryResolution({
      orderedCountryCodes: context.orderedCountryCodes,
      markers: context.markerProjections,
      decisions: [],
    });
    const revision = revisionFromProjection({
      resolutionRunId,
      source: context.source,
      decisions: [],
      replacementMarkers: [],
      projection,
      operation,
      createdAt: ports.clock().toISOString(),
      integrity: ports.integrity,
    });
    return readModel(automatic, ports.store.append({ revision, operation, context }));
  }

  async function decideYellow(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
    readonly countryCode: string;
    readonly decision: YellowDecisionKind;
    readonly warningCopyVersion: "yellow-risk@1";
    readonly commandId: string;
  }): Promise<CountryResolutionReadModel> {
    if (!isRecord(input) || !exactKeys(input, [
      "resolutionRunId", "expectedRevisionId", "countryCode", "decision",
      "warningCopyVersion", "commandId",
    ]) || !isNonEmptyString(input.resolutionRunId) ||
      !isNonEmptyString(input.expectedRevisionId) || !/^[A-Z]{2}$/.test(input.countryCode) ||
      (input.decision !== "accepted_at_own_risk" && input.decision !== "rejected") ||
      input.warningCopyVersion !== YELLOW_RISK_WARNING_VERSION ||
      !isNonEmptyString(input.commandId)) integrityMismatch();
    const verified = await presentVerified({ resolutionRunId: input.resolutionRunId });
    const operation: CountryResolutionOperation = {
      commandId: input.commandId,
      kind: "yellow_decision",
      expectedHeadRevisionId: input.expectedRevisionId,
      countryCode: input.countryCode,
      decision: input.decision,
      warningCopyVersion: input.warningCopyVersion,
    };
    const existing = ports.store.findByCommandVerified(
      input.resolutionRunId,
      input.commandId,
      verified.context,
    );
    if (existing !== undefined) {
      if (!sameCanonical(existing.operation, operation, ports.integrity)) integrityMismatch();
      return readModel(verified.readModel.automaticFrontier, existing.revision);
    }
    const predecessor = verified.readModel.revision;
    if (predecessor.id !== input.expectedRevisionId) staleResolutionHead();
    if (predecessor.kind !== "working" || predecessor.phase !== "awaiting_decision" ||
      predecessor.unresolvedCountryCodes[0] !== input.countryCode) integrityMismatch();
    const marker = verified.context.markerProjections.find(
      ({ countryCode }) => countryCode === input.countryCode,
    );
    if (marker?.formalStatus !== "yellow" || marker.expectedUncertaintyBasis === undefined) {
      integrityMismatch();
    }
    const decision: YellowDecision = {
      countryCode: input.countryCode,
      decision: input.decision,
      formalMarkerDigest: marker.formalMarkerDigest,
      uncertaintyBasis: marker.expectedUncertaintyBasis,
      warningCopyVersion: YELLOW_RISK_WARNING_VERSION,
      decidedAt: ports.clock().toISOString(),
      commandId: input.commandId,
    };
    const decisions = [...predecessor.decisions, decision];
    const projection = reconstructCountryResolution({
      orderedCountryCodes: verified.context.orderedCountryCodes,
      markers: verified.context.markerProjections,
      decisions,
    });
    const revision = revisionFromProjection({
      resolutionRunId: input.resolutionRunId,
      source: verified.context.source,
      predecessorRevisionId: predecessor.id,
      decisions,
      replacementMarkers: predecessor.replacementMarkers,
      projection,
      operation,
      createdAt: ports.clock().toISOString(),
      integrity: ports.integrity,
    });
    const appended = ports.store.append({ revision, operation, context: verified.context });
    return readModel(verified.readModel.automaticFrontier, appended);
  }

  async function presentCountryResolution(
    resolutionRunId: string,
  ): Promise<CountryResolutionReadModel> {
    if (!isNonEmptyString(resolutionRunId)) integrityMismatch();
    return (await presentVerified({ resolutionRunId })).readModel;
  }

  async function requireResolvedCountryShortlistForCity(
    revisionId: string,
  ): Promise<ResolvedCountryShortlistSnapshot> {
    try {
      if (!isNonEmptyString(revisionId)) throw new Error("resolution_not_found");
      const revision = (await presentVerified({ revisionId })).readModel.revision;
      if (revision.id !== revisionId || revision.kind !== "resolved" ||
        revision.resolvedEntries.length === 0) {
        throw new Error("resolved_country_shortlist_required");
      }
      return immutableCopy(revision);
    } catch {
      throw new Error("resolved_country_shortlist_required");
    }
  }

  async function prepareCountryResolutionContinuation(input: {
    readonly resolutionRunId: string;
    readonly expectedRevisionId: string;
  }): Promise<CountryResolutionContinuationPrepared> {
    if (!isRecord(input) || !exactKeys(input, ["resolutionRunId", "expectedRevisionId"]) ||
      !isNonEmptyString(input.resolutionRunId) || !isNonEmptyString(input.expectedRevisionId)) {
      integrityMismatch();
    }
    const verified = await presentVerified({ resolutionRunId: input.resolutionRunId });
    const revision = verified.readModel.revision;
    if (revision.id !== input.expectedRevisionId) staleResolutionHead();
    if (revision.kind !== "working" || revision.phase !== "replacement_required") {
      integrityMismatch();
    }
    const bound = {
      resolutionRunId: input.resolutionRunId,
      expectedRevisionId: input.expectedRevisionId,
      automaticShortlistSnapshotId: revision.automaticShortlistSnapshotId,
      profileId: revision.profileSnapshotId,
    };
    return immutableCopy({
      ...bound,
      contextHash: continuationContextHash(bound, ports.integrity),
    });
  }

  async function continueCountryResolution(
    prepared: CountryResolutionContinuationPrepared,
    emit: (event: CountryResolutionContinuationEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<CountryResolutionReadModel> {
    if (signal.aborted) abort(signal);
    if (!isRecord(prepared) || !exactKeys(prepared, [
      "resolutionRunId", "expectedRevisionId", "automaticShortlistSnapshotId",
      "profileId", "contextHash",
    ]) || !isNonEmptyString(prepared.resolutionRunId) ||
      !isNonEmptyString(prepared.expectedRevisionId) ||
      !isNonEmptyString(prepared.automaticShortlistSnapshotId) ||
      !isNonEmptyString(prepared.profileId) || !isNonEmptyString(prepared.contextHash) ||
      continuationContextHash({
        resolutionRunId: prepared.resolutionRunId,
        expectedRevisionId: prepared.expectedRevisionId,
        automaticShortlistSnapshotId: prepared.automaticShortlistSnapshotId,
        profileId: prepared.profileId,
      }, ports.integrity) !== prepared.contextHash) integrityMismatch();
    let verified = await presentVerified({ resolutionRunId: prepared.resolutionRunId });
    if (verified.readModel.revision.id !== prepared.expectedRevisionId) staleResolutionHead();
    if (verified.readModel.revision.kind !== "working" ||
      verified.readModel.revision.phase !== "replacement_required" ||
      verified.readModel.revision.automaticShortlistSnapshotId !==
        prepared.automaticShortlistSnapshotId ||
      verified.readModel.revision.profileSnapshotId !== prepared.profileId) integrityMismatch();
    const send = createContinuationEmitter(prepared.resolutionRunId, emit, ports.clock);

    while (verified.readModel.revision.kind === "working" &&
      verified.readModel.revision.phase === "replacement_required") {
      if (signal.aborted) abort(signal);
      const predecessor = verified.readModel.revision;
      const place = verified.readModel.automaticFrontier.rankingSnapshot.ordered[
        predecessor.nextUncheckedRank - 1
      ];
      if (place === undefined || place.rank !== predecessor.nextUncheckedRank) {
        integrityMismatch();
      }
      await send({
        type: "replacement_country_activated",
        payload: {
          country: {
            countryCode: place.countryCode,
            label: place.label,
            flag: place.flag,
            coordinate: { ...place.coordinate },
          },
          rank: place.rank,
        },
      });
      if (signal.aborted) abort(signal);
      const childRunId = countryCheckRunId(
        prepared.resolutionRunId,
        place.countryCode,
        ports.integrity,
      );
      let checked;
      try {
        const replayed = await ports.verifier.present({
          parentRunId: prepared.resolutionRunId,
          countryCode: place.countryCode,
          countryCheckRunId: childRunId,
          profileId: prepared.profileId,
        });
        checked = { countryCheckRunId: childRunId, ...replayed };
      } catch (error) {
        if (!isEvidenceNotFound(error)) throw error;
        checked = await ports.verifier.check({
          country: place,
          profileId: prepared.profileId,
          parentRunId: prepared.resolutionRunId,
          emitProgress: async (progress) => send({
            type: "replacement_country_progress",
            payload: { countryCode: place.countryCode, ...progress },
          }),
          signal,
        });
      }
      const marker = materializeFrontierMarker({
        place,
        checked,
        parentRunId: prepared.resolutionRunId,
        profileId: prepared.profileId,
        integrity: ports.integrity,
      });
      if (signal.aborted) abort(signal);
      const replacements = [...predecessor.replacementMarkers, marker];
      const context = semanticContext(
        verified.readModel.automaticFrontier,
        replacements,
        ports.integrity,
      );
      const operation: CountryResolutionOperation = {
        commandId: childRunId,
        kind: "replacement_completed",
        expectedHeadRevisionId: predecessor.id,
        countryCode: place.countryCode,
        countryCheckRunId: childRunId,
      };
      const projection = reconstructCountryResolution({
        orderedCountryCodes: context.orderedCountryCodes,
        markers: context.markerProjections,
        decisions: predecessor.decisions,
      });
      const candidate = revisionFromProjection({
        resolutionRunId: prepared.resolutionRunId,
        source: context.source,
        predecessorRevisionId: predecessor.id,
        decisions: predecessor.decisions,
        replacementMarkers: replacements,
        projection,
        operation,
        createdAt: ports.clock().toISOString(),
        integrity: ports.integrity,
      });
      const revision = ports.store.append({ revision: candidate, operation, context });
      await send({
        type: "resolution_revision_committed",
        payload: { marker, revision },
      });
      verified = {
        context,
        readModel: readModel(verified.readModel.automaticFrontier, revision),
      };
    }
    const completed = verified.readModel;
    await send({
      type: "resolution_continuation_completed",
      payload: { readModel: completed },
    });
    return completed;
  }

  return Object.freeze({
    startCountryResolution,
    decideYellow,
    prepareCountryResolutionContinuation,
    continueCountryResolution,
    presentCountryResolution,
    requireResolvedCountryShortlistForCity,
  });
}
