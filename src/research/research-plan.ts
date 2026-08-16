import type {
  CaptureFailureKind,
  CaptureResult,
  Claim,
  EvidenceBlocker,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParserEntry,
  RequestStep,
  SourceId,
} from "./contracts";

export interface VerifiedEvidenceEntry<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly sourceId: S;
  readonly parserEntry: ParserEntry<S>;
  readonly coverage: "verified";
  readonly claims: readonly C[];
}

export interface UnavailableEvidenceEntry<S extends string = SourceId> {
  readonly sourceId: S;
  readonly parserEntry: ParserEntry<S>;
  readonly coverage: "unavailable";
  readonly blocker: EvidenceBlocker<S>;
}

export type TerminalEvidenceEntry<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> = VerifiedEvidenceEntry<S, C> | UnavailableEvidenceEntry<S>;

export interface EvidenceManifest<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly snapshot: Omit<EvidenceSnapshot<S, C>, "manifestHash" | "hmac">;
  readonly entries: readonly {
    readonly sourceId: S;
    readonly navigationUrl: string;
    readonly indexedSourceUrl?: string;
    readonly resolvedEvidenceUrl: string;
    readonly artifactIds: readonly string[];
    readonly versionHint?: string;
  }[];
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly runId: string;
    readonly sourceId: S;
    readonly role: string;
    readonly request: LiveCapturedArtifact<S>["request"];
    readonly url: string;
    readonly responseUrl: string;
    readonly capturedAt: string;
    readonly responseStatus: number;
    readonly mediaType: string;
    readonly origin: "live";
    readonly byteLength: number;
    readonly sha256: string;
  }[];
}

export type EvidenceArtifactProvenance<S extends string = SourceId> =
  EvidenceManifest<S>["artifacts"][number];

export interface SealedEvidence<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C>;
  readonly canonicalManifest: string;
}

export interface SealEvidenceInput<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly id: string;
  readonly assessmentDate: string;
  readonly entries: readonly TerminalEvidenceEntry<S, C>[];
  readonly sourceIds: readonly S[];
  readonly parserVersions: Readonly<Record<S, string>>;
  readonly rulesVersion: string;
  readonly contextHash?: string;
  readonly knowledgeBaselineRevisionId?: string;
}

export interface EvidenceIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
  sign(value: string): string;
}

export interface EvidenceWriteStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  appendArtifact(artifact: LiveCapturedArtifact<S>): Promise<void>;
  seal(sealed: SealedEvidence<S, C>): Promise<void>;
}

export interface ResearchSourceLineage {
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
}

export interface ResearchPlan<S extends string, C extends Claim<unknown, S>> {
  readonly id: string;
  readonly scope: string;
  readonly sourceIds: readonly S[];
  readonly sourceLineage: Readonly<Record<S, ResearchSourceLineage>>;
  readonly parserVersions: Readonly<Record<S, string>>;
  readonly rulesVersion: string;
  readonly limits: {
    readonly concurrency: number;
    readonly maxCaptures: number;
    readonly deadlineMs: number;
  };
  validate(entry: ParserEntry<S>, assessmentAt: string): Promise<
    | { readonly ok: true; readonly claims: readonly C[] }
    | {
        readonly ok: false;
        readonly kind: "integrity_mismatch" | "semantic_mismatch" | "stale" | "conflict";
      }
  >;
  applyRules(
    entries: readonly TerminalEvidenceEntry<S, C>[],
    assessmentAt: string,
  ): readonly TerminalEvidenceEntry<S, C>[];
}

export type EvidenceProgress<S extends string, C extends Claim<unknown, S>> =
  | {
      readonly type: "artifact_captured";
      readonly sourceId: S;
      readonly artifact: LiveCapturedArtifact<S>;
    }
  | { readonly type: "claim_verified"; readonly sourceId: S; readonly claim: C };

export interface EvidencePlanInput {
  readonly runId: string;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
  readonly signal?: AbortSignal;
  readonly contextHash?: string;
  readonly knowledgeBaselineRevisionId?: string;
}

interface PrepareEvidencePorts<S extends string, C extends Claim<unknown, S>> {
  readonly source: OfficialSourcePort<S>;
  readonly requestStep: RequestStep<S>;
  readonly artifacts: Pick<EvidenceWriteStore<S, C>, "appendArtifact">;
  readonly integrity: EvidenceIntegrity;
  readonly onProgress?: (event: EvidenceProgress<S, C>) => void | Promise<void>;
}

function validateTerminalEntries<S extends string, C extends Claim<unknown, S>>(
  sourceIds: readonly S[],
  entries: readonly TerminalEvidenceEntry<S, C>[],
): void {
  if (
    !denseArray(sourceIds) || !denseArray(entries) ||
    entries.some((entry) => !containsOnlyDenseArrays(entry)) ||
    entries.length !== sourceIds.length ||
    sourceIds.some((sourceId) => entries.filter((entry) => entry.sourceId === sourceId).length !== 1)
  ) {
    throw new Error("non_terminal_evidence");
  }

  for (const entry of entries) {
    const artifactIds = new Set(entry.parserEntry.artifacts.map((artifact) => artifact.artifactId));
    if (entry.parserEntry.sourceId !== entry.sourceId) throw new Error("invalid_terminal_evidence");
    if (entry.parserEntry.artifacts.some((artifact) => {
      const captured = artifact as Partial<LiveCapturedArtifact<S>>;
      return captured.origin !== "live" ||
        typeof captured.runId !== "string" ||
        captured.runId.length === 0 ||
        captured.sourceId !== entry.sourceId;
    })) {
      throw new Error("invalid_terminal_evidence");
    }
    if (entry.coverage === "verified") {
      if (
        entry.claims.length === 0 ||
        entry.claims.some((claim) =>
          claim.sourceId !== entry.sourceId ||
          claim.status !== "verified" ||
          !artifactIds.has(claim.anchor.artifactId)
        )
      ) {
        throw new Error("invalid_terminal_evidence");
      }
    } else if (
      "claims" in entry ||
      entry.blocker.sourceId !== entry.sourceId ||
      entry.blocker.artifactIds.some((artifactId) => !artifactIds.has(artifactId))
    ) {
      throw new Error("invalid_terminal_evidence");
    }
  }
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function containsOnlyDenseArrays(value: unknown, ancestors = new Set<object>()): boolean {
  if (value instanceof Uint8Array || value === null || typeof value !== "object") return true;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? denseArray(value) && value.every((item) => containsOnlyDenseArrays(item, ancestors))
    : Object.values(value).every((item) => containsOnlyDenseArrays(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function cloneFrozenTerminalValue<T>(value: T): T {
  if (value instanceof Uint8Array) return new Uint8Array(value) as T;
  if (Array.isArray(value)) {
    const clone = value.map((item) => cloneFrozenTerminalValue(item));
    return Object.freeze(clone) as T;
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("invalid_terminal_evidence");
    }
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneFrozenTerminalValue(item)]),
    );
    return Object.freeze(clone) as T;
  }
  return value;
}

export function composeTerminalEvidenceEntries<
  S extends string,
  C extends Claim<unknown, S>,
>(
  sourceIds: readonly S[],
  batches: readonly (readonly TerminalEvidenceEntry<S, C>[])[],
): readonly TerminalEvidenceEntry<S, C>[] {
  const ownedSourceIds = cloneFrozenTerminalValue(sourceIds);
  const ownedBatches = cloneFrozenTerminalValue(batches);
  if (
    !denseArray(ownedSourceIds) || ownedSourceIds.length === 0 ||
    ownedSourceIds.some((sourceId) => typeof sourceId !== "string" || sourceId.length === 0) ||
    new Set(ownedSourceIds).size !== ownedSourceIds.length ||
    !denseArray(ownedBatches) || !ownedBatches.every(denseArray)
  ) {
    throw new Error("non_terminal_evidence");
  }
  const entries = ownedBatches.flat();
  validateTerminalEntries(ownedSourceIds, entries);
  const artifactIds = entries.flatMap((entry) =>
    entry.parserEntry.artifacts.map((artifact) => artifact.artifactId));
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error("invalid_terminal_evidence");
  }
  const ordered = ownedSourceIds.map(
    (sourceId) => entries.find((entry) => entry.sourceId === sourceId)!,
  );
  return cloneFrozenTerminalValue(ordered);
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecordKeys(value: object, sourceIds: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...sourceIds].sort();
  return sameOrderedStrings(keys, expected);
}

export function assertSealedEvidenceStructure<
  S extends string,
  C extends Claim<unknown, S>,
>(
  sealed: Pick<SealedEvidence<S, C>, "snapshot" | "manifest">,
  sourceIds: readonly S[],
): void {
  const { snapshot, manifest } = sealed;
  const fail = (): never => {
    throw new Error("integrity_mismatch");
  };
  if (
    !isRecord(snapshot) || !isRecord(manifest) || !isRecord(manifest.snapshot) ||
    !isRecord(snapshot.coverage) || !isRecord(snapshot.parserVersions) ||
    !Array.isArray(snapshot.artifactIds) || !Array.isArray(snapshot.claims) ||
    !Array.isArray(snapshot.blockers) ||
    !isRecord(manifest.snapshot.coverage) || !isRecord(manifest.snapshot.parserVersions) ||
    !Array.isArray(manifest.snapshot.artifactIds) ||
    !Array.isArray(manifest.snapshot.claims) || !Array.isArray(manifest.snapshot.blockers) ||
    !Array.isArray(manifest.entries) ||
    !manifest.entries.every((entry) => isRecord(entry) && Array.isArray(entry.artifactIds)) ||
    !Array.isArray(manifest.artifacts) || !manifest.artifacts.every(isRecord) ||
    !snapshot.claims.every((claim) => isRecord(claim) && isRecord(claim.anchor)) ||
    !snapshot.blockers.every((blocker) => isRecord(blocker) && Array.isArray(blocker.artifactIds)) ||
    (snapshot.knowledgeBaselineRevisionId !== undefined &&
      typeof snapshot.knowledgeBaselineRevisionId !== "string") ||
    (manifest.snapshot.knowledgeBaselineRevisionId !== undefined &&
      typeof manifest.snapshot.knowledgeBaselineRevisionId !== "string")
  ) fail();
  if (
    sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length ||
    manifest.entries.length !== sourceIds.length ||
    !manifest.entries.every((entry, index) => entry.sourceId === sourceIds[index]) ||
    new Set(manifest.entries.map((entry) => entry.sourceId)).size !== sourceIds.length ||
    !exactRecordKeys(snapshot.coverage, sourceIds) ||
    !exactRecordKeys(snapshot.parserVersions, sourceIds)
  ) fail();
  if (
    manifest.snapshot.id !== snapshot.id ||
    manifest.snapshot.assessmentDate !== snapshot.assessmentDate ||
    manifest.snapshot.rulesVersion !== snapshot.rulesVersion ||
    manifest.snapshot.contextHash !== snapshot.contextHash ||
    manifest.snapshot.knowledgeBaselineRevisionId !== snapshot.knowledgeBaselineRevisionId ||
    !sameOrderedStrings(manifest.snapshot.artifactIds, snapshot.artifactIds) ||
    !exactRecordKeys(manifest.snapshot.coverage, sourceIds) ||
    !exactRecordKeys(manifest.snapshot.parserVersions, sourceIds) ||
    sourceIds.some((sourceId) =>
      manifest.snapshot.coverage[sourceId] !== snapshot.coverage[sourceId] ||
      manifest.snapshot.parserVersions[sourceId] !== snapshot.parserVersions[sourceId]
    ) ||
    JSON.stringify(manifest.snapshot.claims) !== JSON.stringify(snapshot.claims) ||
    JSON.stringify(manifest.snapshot.blockers) !== JSON.stringify(snapshot.blockers)
  ) fail();

  const flattenedArtifactIds = manifest.entries.flatMap((entry) => entry.artifactIds);
  const manifestArtifactIds = manifest.artifacts.map((artifact) => artifact.artifactId);
  if (
    new Set(flattenedArtifactIds).size !== flattenedArtifactIds.length ||
    !sameOrderedStrings(flattenedArtifactIds, snapshot.artifactIds) ||
    !sameOrderedStrings(flattenedArtifactIds, manifestArtifactIds)
  ) fail();

  for (const entry of manifest.entries) {
    for (const artifactId of entry.artifactIds) {
      const artifacts = manifest.artifacts.filter((artifact) => artifact.artifactId === artifactId);
      if (artifacts.length !== 1 || artifacts[0]!.sourceId !== entry.sourceId) fail();
    }
  }
  for (const artifact of manifest.artifacts) {
    const owners = manifest.entries.filter((entry) => entry.artifactIds.includes(artifact.artifactId));
    if (owners.length !== 1 || owners[0]!.sourceId !== artifact.sourceId) fail();
  }

  for (const claim of snapshot.claims) {
    const entry = manifest.entries.find((candidate) => candidate.sourceId === claim.sourceId);
    if (
      entry === undefined || claim.status !== "verified" ||
      snapshot.coverage[claim.sourceId] !== "verified" ||
      !entry.artifactIds.includes(claim.anchor.artifactId)
    ) fail();
  }
  if (snapshot.blockers.some((blocker) => !sourceIds.includes(blocker.sourceId))) fail();
  for (const sourceId of sourceIds) {
    const entry = manifest.entries.find((candidate) => candidate.sourceId === sourceId)!;
    const blockers = snapshot.blockers.filter((blocker) => blocker.sourceId === sourceId);
    const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
    const coverage = snapshot.coverage[sourceId];
    if (
      (coverage !== "verified" && coverage !== "unavailable") ||
      (coverage === "verified" && (blockers.length !== 0 || claims.length === 0)) ||
      (coverage === "unavailable" && blockers.length !== 1) ||
      blockers.some((blocker) =>
        blocker.artifactIds.some((artifactId) => !entry.artifactIds.includes(artifactId))
      )
    ) fail();
  }
}

export function evidenceArtifactProvenance<S extends string>(
  artifact: LiveCapturedArtifact<S>,
): EvidenceArtifactProvenance<S> {
  return {
    artifactId: artifact.artifactId,
    runId: artifact.runId,
    sourceId: artifact.sourceId,
    role: artifact.role,
    request: artifact.request,
    url: artifact.url,
    responseUrl: artifact.responseUrl,
    capturedAt: artifact.capturedAt,
    responseStatus: artifact.responseStatus,
    mediaType: artifact.mediaType,
    origin: artifact.origin,
    byteLength: artifact.bytes.byteLength,
    sha256: artifact.sha256,
  };
}

export async function sealEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: SealEvidenceInput<S, C>,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence<S, C>> {
  validateTerminalEntries(input.sourceIds, input.entries);
  const orderedEntries = input.sourceIds.map(
    (sourceId) => input.entries.find((entry) => entry.sourceId === sourceId)!,
  );
  const artifactIds = orderedEntries.flatMap((entry) =>
    entry.parserEntry.artifacts.map((artifact) => artifact.artifactId),
  );
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error("invalid_terminal_evidence");
  const artifactRunIds = new Set(orderedEntries.flatMap((entry) =>
    entry.parserEntry.artifacts.map((artifact) => (artifact as LiveCapturedArtifact<S>).runId),
  ));
  if (artifactRunIds.size > 1) throw new Error("invalid_terminal_evidence");

  const coverage = Object.fromEntries(
    orderedEntries.map((entry) => [entry.sourceId, entry.coverage]),
  ) as Record<S, "verified" | "unavailable">;
  const snapshotPayload: Omit<EvidenceSnapshot<S, C>, "manifestHash" | "hmac"> = {
    id: input.id,
    assessmentDate: input.assessmentDate,
    artifactIds,
    claims: orderedEntries.flatMap((entry) =>
      entry.coverage === "verified" ? [...entry.claims] : [],
    ) as C[],
    blockers: orderedEntries.flatMap((entry) =>
      entry.coverage === "unavailable" ? [entry.blocker] : [],
    ),
    coverage,
    parserVersions: input.parserVersions,
    rulesVersion: input.rulesVersion,
    ...(input.contextHash === undefined ? {} : { contextHash: input.contextHash }),
    ...(input.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: input.knowledgeBaselineRevisionId }),
  };
  const manifest: EvidenceManifest<S, C> = {
    snapshot: snapshotPayload,
    entries: orderedEntries.map((entry) => ({
      sourceId: entry.sourceId,
      navigationUrl: entry.parserEntry.navigationUrl,
      ...(entry.parserEntry.indexedSourceUrl === undefined
        ? {}
        : { indexedSourceUrl: entry.parserEntry.indexedSourceUrl }),
      resolvedEvidenceUrl: entry.parserEntry.resolvedEvidenceUrl,
      artifactIds: entry.parserEntry.artifacts.map((artifact) => artifact.artifactId),
      ...(entry.parserEntry.versionHint === undefined
        ? {}
        : { versionHint: entry.parserEntry.versionHint }),
    })),
    artifacts: orderedEntries.flatMap((entry) =>
      entry.parserEntry.artifacts.map((artifact) =>
        evidenceArtifactProvenance(artifact as LiveCapturedArtifact<S>),
      ),
    ),
  };
  const canonicalManifest = integrity.canonical(manifest);
  const manifestHash = integrity.hash(canonicalManifest);
  const hmac = integrity.sign(canonicalManifest);
  return {
    snapshot: Object.freeze({ ...snapshotPayload, manifestHash, hmac }),
    manifest,
    canonicalManifest,
  };
}

function unavailableEntry<S extends string, C extends Claim<unknown, S>>(
  plan: ResearchPlan<S, C>,
  sourceId: S,
  kind: EvidenceBlocker<S>["kind"],
  artifacts: readonly LiveCapturedArtifact<S>[],
  parserEntry?: ParserEntry<S>,
  indexedSourceUrl?: string,
): TerminalEvidenceEntry<S, C> {
  const plannedLineage = plan.sourceLineage[sourceId];
  const navigationUrl = parserEntry?.navigationUrl ?? plannedLineage.navigationUrl;
  const selectedIndexedSourceUrl = parserEntry?.indexedSourceUrl ??
    indexedSourceUrl ??
    plannedLineage.indexedSourceUrl;
  const resolvedUrl = parserEntry?.resolvedEvidenceUrl ?? artifacts.at(-1)?.responseUrl;
  const terminalParserEntry = parserEntry === undefined
    ? {
        sourceId,
        navigationUrl,
        ...(selectedIndexedSourceUrl === undefined
          ? {}
          : { indexedSourceUrl: selectedIndexedSourceUrl }),
        resolvedEvidenceUrl: resolvedUrl ?? navigationUrl,
        artifacts,
      }
    : selectedIndexedSourceUrl === undefined || parserEntry.indexedSourceUrl !== undefined
      ? parserEntry
      : { ...parserEntry, indexedSourceUrl: selectedIndexedSourceUrl };
  return {
    sourceId,
    parserEntry: terminalParserEntry,
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind,
      navigationUrl,
      ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
      artifactIds: artifacts.map((artifact) => artifact.artifactId),
    },
  };
}

function retryableKind(error: unknown): CaptureFailureKind | undefined {
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined;
  const kind = (error as { readonly kind?: unknown }).kind;
  return kind === "timeout" || kind === "rate_limited" || kind === "server_error"
    ? kind
    : undefined;
}

function captureFailure<S extends string>(error: unknown): {
  readonly kind: CaptureFailureKind;
  readonly partialArtifacts: readonly LiveCapturedArtifact<S>[];
} | undefined {
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined;
  const kind = (error as { readonly kind?: unknown }).kind;
  const captureKinds: readonly CaptureFailureKind[] = [
    "timeout",
    "rate_limited",
    "server_error",
    "http_error",
    "wrong_media_type",
    "too_large",
    "navigation_mismatch",
  ];
  if (!captureKinds.includes(kind as CaptureFailureKind)) return undefined;
  const partial = "partialArtifacts" in error
    ? (error as { readonly partialArtifacts?: unknown }).partialArtifacts
    : undefined;
  return {
    kind: kind as CaptureFailureKind,
    partialArtifacts: Array.isArray(partial)
      ? partial as readonly LiveCapturedArtifact<S>[]
      : [],
  };
}

class ArtifactOwnershipError<S extends string> extends Error {
  readonly kind = "navigation_mismatch" as const;

  constructor(readonly partialArtifacts: readonly LiveCapturedArtifact<S>[]) {
    super("artifact ownership mismatch");
  }
}

class CaptureLimitError extends Error {
  constructor() {
    super("capture_limit_exhausted");
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index]!, index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}

export async function prepareEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: EvidencePlanInput,
  plan: ResearchPlan<S, C>,
  ports: PrepareEvidencePorts<S, C>,
): Promise<SealedEvidence<S, C>> {
  const callerDeadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(callerDeadline)) throw new Error("invalid_deadline");
  if (
    !Number.isInteger(plan.limits.concurrency) || plan.limits.concurrency < 1 ||
    !Number.isInteger(plan.limits.maxCaptures) || plan.limits.maxCaptures < 0 ||
    !Number.isFinite(plan.limits.deadlineMs) ||
    !Number.isInteger(plan.limits.deadlineMs) ||
    plan.limits.deadlineMs <= 0
  ) {
    throw new Error("invalid_research_plan");
  }
  if (input.signal?.aborted) throw abortReason(input.signal);

  const startedAt = Date.now();
  const planDeadline = startedAt + plan.limits.deadlineMs;
  const deadline = Math.min(callerDeadline, planDeadline);
  const effectiveDeadlineAt = callerDeadline <= planDeadline
    ? input.deadlineAt
    : new Date(planDeadline).toISOString();

  const controller = new AbortController();
  let announceDeadline!: () => void;
  const deadlineReached = new Promise<void>((resolve) => {
    announceDeadline = resolve;
  });
  let announceExternalAbort!: (reason: unknown) => void;
  const externalAbortReached = new Promise<{
    readonly type: "external_abort";
    readonly reason: unknown;
  }>((resolve) => {
    announceExternalAbort = (reason) => resolve({ type: "external_abort", reason });
  });
  const expireDeadline = (): void => {
    if (!controller.signal.aborted) controller.abort("deadline");
    announceDeadline();
  };
  const externalAbort = (): void => {
    const reason = abortReason(input.signal!);
    if (!controller.signal.aborted) controller.abort(reason);
    announceExternalAbort(reason);
  };
  input.signal?.addEventListener("abort", externalAbort, { once: true });
  const remaining = deadline - startedAt;
  const deadlineTimer = remaining > 0 ? setTimeout(expireDeadline, remaining) : undefined;
  if (remaining <= 0) expireDeadline();

  let captureAttempts = 0;
  const persisted = new Set<string>();
  const persistArtifact = async (artifact: LiveCapturedArtifact<S>, sourceId: S): Promise<void> => {
    if (
      artifact.origin !== "live" ||
      artifact.runId !== input.runId ||
      artifact.sourceId !== sourceId
    ) {
      throw new ArtifactOwnershipError<S>([]);
    }
    const key = `${artifact.runId}\u0000${artifact.artifactId}`;
    const alreadyPersisted = persisted.has(key);
    await ports.artifacts.appendArtifact(artifact);
    if (alreadyPersisted) return;
    persisted.add(key);
    await ports.onProgress?.({ type: "artifact_captured", sourceId, artifact });
  };

  try {
    const captured = await mapWithConcurrency(
      plan.sourceIds,
      plan.limits.concurrency,
      async (sourceId): Promise<TerminalEvidenceEntry<S, C>> => {
        if (input.signal?.aborted) throw abortReason(input.signal);
        if (controller.signal.aborted) {
          return unavailableEntry(plan, sourceId, "deadline", []);
        }
        let retryAvailable = true;
        const persistedForSource: LiveCapturedArtifact<S>[] = [];
        const requestStep: RequestStep<S> = async (request, signal) => {
          if (
            signal !== controller.signal ||
            request.runId !== input.runId ||
            request.sourceId !== sourceId
          ) {
            throw new ArtifactOwnershipError([...persistedForSource]);
          }
          const execute = async (): Promise<LiveCapturedArtifact<S>> => {
            if (captureAttempts >= plan.limits.maxCaptures) throw new CaptureLimitError();
            captureAttempts += 1;
            const artifact = await ports.requestStep(request, signal);
            if (
              artifact.origin !== "live" ||
              artifact.runId !== input.runId ||
              artifact.sourceId !== sourceId
            ) {
              throw new ArtifactOwnershipError([...persistedForSource]);
            }
            await persistArtifact(artifact, sourceId);
            persistedForSource.push(artifact);
            return artifact;
          };
          try {
            return await execute();
          } catch (error) {
            if (input.signal?.aborted) throw abortReason(input.signal);
            if (
              retryAvailable &&
              retryableKind(error) !== undefined &&
              !controller.signal.aborted &&
              Date.now() < deadline
            ) {
              retryAvailable = false;
              return execute();
            }
            throw error;
          }
        };

        let result: CaptureResult<S>;
        try {
          result = await ports.source.capture({
            runId: input.runId,
            sourceId,
            assessmentDate: input.assessmentDate,
            deadlineAt: effectiveDeadlineAt,
            signal: controller.signal,
          }, requestStep);
          if (input.signal?.aborted) throw abortReason(input.signal);
        } catch (error) {
          if (input.signal?.aborted) throw abortReason(input.signal);
          if (error instanceof CaptureLimitError) {
            return unavailableEntry(plan, sourceId, "deadline", persistedForSource);
          }
          const failure = captureFailure<S>(error);
          if (failure === undefined) throw error;
          result = {
            ok: false,
            sourceId,
            kind: failure.kind,
            attempts: 1,
            partialArtifacts: failure.partialArtifacts,
          };
        }
        if (input.signal?.aborted) throw abortReason(input.signal);
        if (!result.ok) {
          if (
            result.sourceId !== sourceId ||
            result.partialArtifacts.some((artifact) =>
              artifact.origin !== "live" ||
              artifact.runId !== input.runId ||
              artifact.sourceId !== sourceId
            )
          ) {
            return unavailableEntry(plan, sourceId, "integrity_mismatch", []);
          }
          for (const artifact of result.partialArtifacts) await persistArtifact(artifact, sourceId);
          return unavailableEntry(
            plan,
            sourceId,
            result.kind,
            result.partialArtifacts,
            undefined,
            result.indexedSourceUrl,
          );
        }
        if (
          result.entry.sourceId !== sourceId ||
          result.entry.artifacts.some((artifact) =>
            artifact.origin !== "live" ||
            (artifact as Partial<LiveCapturedArtifact<S>>).runId !== input.runId ||
            (artifact as Partial<LiveCapturedArtifact<S>>).sourceId !== sourceId
          )
        ) {
          return unavailableEntry(plan, sourceId, "integrity_mismatch", []);
        }
        for (const artifact of result.entry.artifacts) {
          await persistArtifact(artifact as LiveCapturedArtifact<S>, sourceId);
        }
        if (controller.signal.aborted) {
          if (input.signal?.aborted) throw abortReason(input.signal);
          return unavailableEntry(
            plan,
            sourceId,
            "deadline",
            result.entry.artifacts,
            result.entry,
          );
        }
        const validated = await Promise.race([
          plan.validate(result.entry, input.assessmentDate).then((value) => ({
            type: "validated" as const,
            value,
          })),
          deadlineReached.then(() => ({ type: "deadline" as const })),
          externalAbortReached,
        ]);
        if (validated.type === "external_abort") throw validated.reason;
        if (input.signal?.aborted) throw abortReason(input.signal);
        if (validated.type === "deadline") {
          return unavailableEntry(
            plan,
            sourceId,
            "deadline",
            result.entry.artifacts,
            result.entry,
          );
        }
        if (!validated.value.ok) {
          return unavailableEntry(
            plan,
            sourceId,
            validated.value.kind,
            result.entry.artifacts,
            result.entry,
          );
        }
        const artifactIds = new Set(result.entry.artifacts.map((artifact) => artifact.artifactId));
        if (
          validated.value.claims.length === 0 ||
          validated.value.claims.some((claim) =>
            claim.sourceId !== sourceId ||
            claim.status !== "verified" ||
            !artifactIds.has(claim.anchor.artifactId)
          )
        ) {
          return unavailableEntry(
            plan,
            sourceId,
            "integrity_mismatch",
            result.entry.artifacts,
            result.entry,
          );
        }
        for (const claim of validated.value.claims) {
          await ports.onProgress?.({ type: "claim_verified", sourceId, claim });
        }
        return {
          sourceId,
          parserEntry: result.entry,
          coverage: "verified",
          claims: validated.value.claims,
        };
      },
    );
    if (input.signal?.aborted) throw abortReason(input.signal);
    const terminalEntries = plan.applyRules(captured, input.assessmentDate);
    return sealEvidencePlan({
      id: `${input.runId}:evidence`,
      assessmentDate: input.assessmentDate,
      entries: terminalEntries,
      sourceIds: plan.sourceIds,
      parserVersions: plan.parserVersions,
      rulesVersion: plan.rulesVersion,
      ...(input.contextHash === undefined ? {} : { contextHash: input.contextHash }),
      ...(input.knowledgeBaselineRevisionId === undefined
        ? {}
        : { knowledgeBaselineRevisionId: input.knowledgeBaselineRevisionId }),
    }, ports.integrity);
  } finally {
    input.signal?.removeEventListener("abort", externalAbort);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

export async function runEvidencePlan<S extends string, C extends Claim<unknown, S>>(
  input: EvidencePlanInput,
  plan: ResearchPlan<S, C>,
  ports: {
    readonly source: OfficialSourcePort<S>;
    readonly requestStep: RequestStep<S>;
    readonly store: EvidenceWriteStore<S, C>;
    readonly integrity: EvidenceIntegrity;
    readonly onProgress?: (event: EvidenceProgress<S, C>) => void | Promise<void>;
  },
): Promise<EvidenceSnapshot<S, C>> {
  const sealed = await prepareEvidencePlan(input, plan, {
    source: ports.source,
    requestStep: ports.requestStep,
    artifacts: ports.store,
    integrity: ports.integrity,
    ...(ports.onProgress === undefined ? {} : { onProgress: ports.onProgress }),
  });
  if (input.signal?.aborted) throw abortReason(input.signal);
  await ports.store.seal(sealed);
  return sealed.snapshot;
}
