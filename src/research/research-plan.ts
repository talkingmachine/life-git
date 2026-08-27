import { types } from "node:util";

import type {
  AdministrativeCapturedArtifact,
  CapturedArtifactForOrigin,
  CaptureFailureKind,
  CaptureResult,
  Claim,
  EvidenceBlocker,
  EvidenceOrigin,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParserEntry,
  RequestStep,
  SourceId,
} from "./contracts";

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)!.get!;
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!;

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

export interface AdministrativeTerminalEvidenceEntry<
  S extends string,
  C extends Claim<unknown, S>,
> {
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly artifacts: readonly AdministrativeCapturedArtifact<S>[];
  readonly coverage: "verified";
  readonly claims: readonly C[];
}

export type TerminalEvidenceEntryForOrigin<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> = O extends "live"
  ? TerminalEvidenceEntry<S, C>
  : AdministrativeTerminalEvidenceEntry<S, C>;

export interface LiveEvidenceManifestEntry<S extends string> {
  readonly sourceId: S;
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifactIds: readonly string[];
  readonly versionHint?: string;
}

export interface AdministrativeEvidenceManifestEntry<S extends string> {
  readonly sourceId: S;
  readonly origin: "administrative";
  readonly artifactIds: readonly string[];
}

export type EvidenceManifestEntryForOrigin<
  S extends string,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveEvidenceManifestEntry<S> : AdministrativeEvidenceManifestEntry<S>;

export type LiveArtifactProvenance<S extends string = SourceId> =
  Omit<LiveCapturedArtifact<S>, "bytes"> & { readonly byteLength: number };

export interface AdministrativeArtifactProvenance<S extends string = SourceId> {
  readonly artifactId: string;
  readonly runId: string;
  readonly sourceId: S;
  readonly role: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly origin: "administrative";
  readonly producer: string;
  readonly createdAt: string;
}

export type EvidenceArtifactProvenance<
  S extends string = SourceId,
  O extends EvidenceOrigin = "live",
> = O extends "live" ? LiveArtifactProvenance<S> : AdministrativeArtifactProvenance<S>;

export interface EvidenceManifest<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly snapshot: Omit<EvidenceSnapshot<S, C>, "manifestHash" | "hmac">;
  readonly entries: readonly EvidenceManifestEntryForOrigin<S, O>[];
  readonly artifacts: readonly EvidenceArtifactProvenance<S, O>[];
}

export interface SealedEvidence<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly manifest: EvidenceManifest<S, C, O>;
  readonly canonicalManifest: string;
}

export interface SealEvidenceInput<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  readonly id: string;
  readonly assessmentDate: string;
  readonly entries: readonly TerminalEvidenceEntryForOrigin<S, C, O>[];
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

export interface VerifiedLoadExpectations<S extends string = SourceId> {
  readonly assessmentDate?: string;
  readonly parserVersions?: Readonly<Record<S, string>>;
  readonly rulesVersion?: string;
}

export interface VerifiedEvidenceBundle<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
> {
  readonly snapshot: EvidenceSnapshot<S, C>;
  readonly entries: readonly ParserEntry<S>[];
}

export function evidenceCanonicalEqual(
  left: unknown,
  right: unknown,
  integrity: Pick<EvidenceIntegrity, "canonical">,
): boolean {
  return integrity.canonical(left) === integrity.canonical(right);
}

export interface EvidenceWriteStore<
  S extends string = SourceId,
  C extends Claim<unknown, S> = Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
> {
  appendArtifact(artifact: CapturedArtifactForOrigin<S, O>): Promise<void>;
  seal(sealed: SealedEvidence<S, C, O>): Promise<void>;
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

function invalidTerminalEvidence(): never {
  throw new Error("invalid_terminal_evidence");
}

function isSharedArrayBuffer(buffer: ArrayBufferLike): boolean {
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    return true;
  } catch {
    return false;
  }
}

function strictUint8ArraySnapshot(value: object): Uint8Array | undefined {
  let brand: unknown;
  let buffer: ArrayBufferLike;
  let byteLength: number;
  let byteOffset: number;
  try {
    brand = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []);
    if (brand === undefined) return undefined;
    if (brand !== "Uint8Array") invalidTerminalEvidence();
    buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
    byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
  } catch {
    return invalidTerminalEvidence();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length: byteLength }, (_, index) => String(index)).sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (
    !Number.isSafeInteger(byteLength) || byteLength < 0 ||
    !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
    isSharedArrayBuffer(buffer) || Object.getOwnPropertySymbols(descriptors).length !== 0 ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    Object.values(descriptors).some((descriptor) =>
      !("value" in descriptor) || !descriptor.enumerable
    ) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype
  ) invalidTerminalEvidence();
  try {
    const copy = Reflect.apply(
      ARRAY_BUFFER_SLICE,
      buffer,
      [byteOffset, byteOffset + byteLength],
    ) as ArrayBuffer;
    return new Uint8Array(copy);
  } catch {
    return invalidTerminalEvidence();
  }
}

function strictOwnedEvidenceValue<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (
      value === null || value === undefined || typeof value === "string" ||
      typeof value === "boolean"
    ) return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalidTerminalEvidence();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) invalidTerminalEvidence();
    if (active.has(value)) invalidTerminalEvidence();

    const copiedBytes = strictUint8ArraySnapshot(value);
    if (copiedBytes !== undefined) return copiedBytes;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(descriptors).length !== 0) invalidTerminalEvidence();

    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) invalidTerminalEvidence();
        const lengthDescriptor = descriptors.length;
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
          invalidTerminalEvidence();
        }
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0) invalidTerminalEvidence();
        const expectedKeys = [
          ...Array.from({ length }, (_, index) => String(index)),
          "length",
        ].sort();
        const actualKeys = Object.keys(descriptors).sort();
        if (
          actualKeys.length !== expectedKeys.length ||
          actualKeys.some((key, index) => key !== expectedKeys[index])
        ) invalidTerminalEvidence();
        const copy: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            invalidTerminalEvidence();
          }
          copy.push(visit(descriptor.value));
        }
        return copy;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) invalidTerminalEvidence();
      const copy: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) {
          invalidTerminalEvidence();
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

function exactOwnKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function canonicalUtcMilliseconds(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function validClaim<S extends string, C extends Claim<unknown, S>>(
  value: unknown,
  sourceId: S,
  artifactIds: ReadonlySet<string>,
): value is C {
  if (!isRecord(value)) return false;
  const anchor = value.anchor;
  return nonemptyString(value.claimId) && value.sourceId === sourceId &&
    Object.prototype.hasOwnProperty.call(value, "value") &&
    nonemptyString(value.scope) && nonemptyString(value.sourcePeriod) && value.status === "verified" &&
    isRecord(anchor) && exactOwnKeys(anchor, ["artifactId", "locator", "excerptSha256"]) &&
    nonemptyString(anchor.artifactId) && nonemptyString(anchor.locator) &&
    typeof anchor.excerptSha256 === "string" && artifactIds.has(anchor.artifactId);
}

const EVIDENCE_BLOCKER_KINDS: ReadonlySet<EvidenceBlocker["kind"]> = new Set([
  "timeout",
  "rate_limited",
  "server_error",
  "http_error",
  "wrong_media_type",
  "too_large",
  "navigation_mismatch",
  "country_not_installed",
  "integrity_mismatch",
  "semantic_mismatch",
  "not_found",
  "not_comparable",
  "source_unavailable",
  "stale",
  "conflict",
  "deadline",
]);

function validBlocker<S extends string>(
  value: unknown,
  sourceId: S,
  artifactIds: ReadonlySet<string>,
): value is EvidenceBlocker<S> {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    "sourceId", "kind", "navigationUrl", "artifactIds",
    ...(Object.prototype.hasOwnProperty.call(value, "resolvedUrl") ? ["resolvedUrl"] : []),
  ];
  if (
    !exactOwnKeys(value, expectedKeys) || value.sourceId !== sourceId ||
    typeof value.kind !== "string" ||
    !EVIDENCE_BLOCKER_KINDS.has(value.kind as EvidenceBlocker["kind"]) ||
    !nonemptyString(value.navigationUrl) ||
    (Object.prototype.hasOwnProperty.call(value, "resolvedUrl") &&
      !nonemptyString(value.resolvedUrl)) ||
    !denseArray(value.artifactIds)
  ) return false;
  const blockerArtifactIds = value.artifactIds;
  return blockerArtifactIds.every((artifactId) =>
    nonemptyString(artifactId) && artifactIds.has(artifactId)
  ) && new Set(blockerArtifactIds).size === blockerArtifactIds.length;
}

const LIVE_ARTIFACT_KEYS = [
  "artifactId", "runId", "sourceId", "role", "url", "mediaType", "sha256", "bytes",
  "origin", "capturedAt", "responseStatus", "responseUrl", "request",
] as const;
const ADMINISTRATIVE_ARTIFACT_KEYS = [
  "artifactId", "runId", "sourceId", "role", "mediaType", "sha256", "bytes",
  "origin", "producer", "createdAt",
] as const;

function validLiveArtifact<S extends string>(
  value: unknown,
  sourceId: S,
): value is LiveCapturedArtifact<S> {
  if (!isRecord(value) || !exactOwnKeys(value, LIVE_ARTIFACT_KEYS)) return false;
  const request = value.request;
  if (!isRecord(request)) return false;
  const requestKeys = [
    "method",
    "url",
    ...(Object.prototype.hasOwnProperty.call(request, "bodyMediaType") ? ["bodyMediaType"] : []),
    ...(Object.prototype.hasOwnProperty.call(request, "bodySha256") ? ["bodySha256"] : []),
  ];
  return exactOwnKeys(request, requestKeys) &&
    (request.method === "GET" || request.method === "POST") && nonemptyString(request.url) &&
    nonemptyString(value.artifactId) && nonemptyString(value.runId) && value.sourceId === sourceId &&
    nonemptyString(value.role) && nonemptyString(value.url) && nonemptyString(value.mediaType) &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    value.bytes instanceof Uint8Array && value.origin === "live" &&
    nonemptyString(value.capturedAt) && typeof value.responseStatus === "number" &&
    Number.isInteger(value.responseStatus) &&
    value.responseStatus >= 100 && value.responseStatus <= 599 && nonemptyString(value.responseUrl);
}

function validAdministrativeArtifact<S extends string>(
  value: unknown,
  sourceId: S,
): value is AdministrativeCapturedArtifact<S> {
  return isRecord(value) && exactOwnKeys(value, ADMINISTRATIVE_ARTIFACT_KEYS) &&
    nonemptyString(value.artifactId) && nonemptyString(value.runId) && value.sourceId === sourceId &&
    nonemptyString(value.role) && nonemptyString(value.mediaType) &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    value.bytes instanceof Uint8Array && value.origin === "administrative" &&
    nonemptyString(value.producer) && canonicalUtcMilliseconds(value.createdAt);
}

function validateTerminalEntries<S extends string, C extends Claim<unknown, S>>(
  sourceIds: readonly S[],
  entries: readonly (
    TerminalEvidenceEntry<S, C> | AdministrativeTerminalEvidenceEntry<S, C>
  )[],
): EvidenceOrigin {
  if (
    !denseArray(sourceIds) || !denseArray(entries) ||
    entries.some((entry) => !containsOnlyDenseArrays(entry)) ||
    sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((sourceId) => !nonemptyString(sourceId)) ||
    entries.length !== sourceIds.length ||
    sourceIds.some((sourceId) => entries.filter((entry) => entry.sourceId === sourceId).length !== 1)
  ) {
    throw new Error("non_terminal_evidence");
  }

  let selectedOrigin: EvidenceOrigin | undefined;
  for (const entry of entries) {
    if ("origin" in entry) {
      if (
        selectedOrigin === "live" ||
        !exactOwnKeys(entry, ["sourceId", "origin", "artifacts", "coverage", "claims"]) ||
        entry.origin !== "administrative" || entry.coverage !== "verified" ||
        !denseArray(entry.artifacts) || entry.artifacts.length === 0 ||
        entry.artifacts.some((artifact) => !validAdministrativeArtifact(artifact, entry.sourceId))
      ) invalidTerminalEvidence();
      const artifactIds = new Set(entry.artifacts.map((artifact) => artifact.artifactId));
      if (
        artifactIds.size !== entry.artifacts.length || !denseArray(entry.claims) ||
        entry.claims.length === 0 ||
        entry.claims.some((claim) => !validClaim(claim, entry.sourceId, artifactIds))
      ) invalidTerminalEvidence();
      selectedOrigin = "administrative";
      continue;
    }

    if (selectedOrigin === "administrative") invalidTerminalEvidence();
    selectedOrigin = "live";
    const expectedEntryKeys = entry.coverage === "verified"
      ? ["sourceId", "parserEntry", "coverage", "claims"]
      : ["sourceId", "parserEntry", "coverage", "blocker"];
    if (!exactOwnKeys(entry, expectedEntryKeys) || !isRecord(entry.parserEntry)) {
      invalidTerminalEvidence();
    }
    const parserEntryKeys = [
      "sourceId", "navigationUrl", "resolvedEvidenceUrl", "artifacts",
      ...(Object.prototype.hasOwnProperty.call(entry.parserEntry, "indexedSourceUrl")
        ? ["indexedSourceUrl"]
        : []),
      ...(Object.prototype.hasOwnProperty.call(entry.parserEntry, "versionHint")
        ? ["versionHint"]
        : []),
    ];
    if (
      !exactOwnKeys(entry.parserEntry, parserEntryKeys) ||
      entry.parserEntry.sourceId !== entry.sourceId ||
      !nonemptyString(entry.parserEntry.navigationUrl) ||
      !nonemptyString(entry.parserEntry.resolvedEvidenceUrl) ||
      !denseArray(entry.parserEntry.artifacts) ||
      entry.parserEntry.artifacts.some((artifact) => !validLiveArtifact(artifact, entry.sourceId))
    ) invalidTerminalEvidence();
    const artifactIds = new Set(entry.parserEntry.artifacts.map((artifact) => artifact.artifactId));
    if (artifactIds.size !== entry.parserEntry.artifacts.length) invalidTerminalEvidence();
    if (entry.coverage === "verified") {
      if (
        !denseArray(entry.claims) || entry.claims.length === 0 ||
        entry.claims.some((claim) => !validClaim(claim, entry.sourceId, artifactIds))
      ) invalidTerminalEvidence();
    } else if (!validBlocker(entry.blocker, entry.sourceId, artifactIds)) {
      invalidTerminalEvidence();
    }
  }
  return selectedOrigin!;
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

const EVIDENCE_SNAPSHOT_PAYLOAD_KEYS = [
  "id",
  "assessmentDate",
  "artifactIds",
  "claims",
  "blockers",
  "coverage",
  "parserVersions",
  "rulesVersion",
] as const;

function hasExactEvidenceSnapshotKeys(value: object, includeSignatureFields: boolean): boolean {
  const expected = [
    ...EVIDENCE_SNAPSHOT_PAYLOAD_KEYS,
    ...(Object.prototype.hasOwnProperty.call(value, "contextHash") ? ["contextHash"] : []),
    ...(Object.prototype.hasOwnProperty.call(value, "knowledgeBaselineRevisionId")
      ? ["knowledgeBaselineRevisionId"]
      : []),
    ...(includeSignatureFields ? ["manifestHash", "hmac"] : []),
  ].sort();
  return sameOrderedStrings(Object.keys(value).sort(), expected);
}

const LIVE_PROVENANCE_KEYS = [
  "artifactId", "runId", "sourceId", "role", "request", "url", "responseUrl",
  "capturedAt", "responseStatus", "mediaType", "origin", "byteLength", "sha256",
] as const;
const ADMINISTRATIVE_PROVENANCE_KEYS = [
  "artifactId", "runId", "sourceId", "role", "mediaType", "sha256", "byteLength",
  "origin", "producer", "createdAt",
] as const;

function validLiveProvenance<S extends string>(
  value: unknown,
  sourceId: S,
): value is LiveArtifactProvenance<S> {
  if (!isRecord(value) || !exactOwnKeys(value, LIVE_PROVENANCE_KEYS)) return false;
  const request = value.request;
  if (!isRecord(request)) return false;
  const requestKeys = [
    "method",
    "url",
    ...(Object.prototype.hasOwnProperty.call(request, "bodyMediaType") ? ["bodyMediaType"] : []),
    ...(Object.prototype.hasOwnProperty.call(request, "bodySha256") ? ["bodySha256"] : []),
  ];
  return exactOwnKeys(request, requestKeys) &&
    (request.method === "GET" || request.method === "POST") && nonemptyString(request.url) &&
    nonemptyString(value.artifactId) && nonemptyString(value.runId) && value.sourceId === sourceId &&
    nonemptyString(value.role) && nonemptyString(value.url) && nonemptyString(value.responseUrl) &&
    nonemptyString(value.capturedAt) && typeof value.responseStatus === "number" &&
    Number.isInteger(value.responseStatus) &&
    value.responseStatus >= 100 && value.responseStatus <= 599 && nonemptyString(value.mediaType) &&
    value.origin === "live" && typeof value.byteLength === "number" &&
    Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256);
}

function validAdministrativeProvenance<S extends string>(
  value: unknown,
  sourceId: S,
): value is AdministrativeArtifactProvenance<S> {
  return isRecord(value) && exactOwnKeys(value, ADMINISTRATIVE_PROVENANCE_KEYS) &&
    nonemptyString(value.artifactId) && nonemptyString(value.runId) && value.sourceId === sourceId &&
    nonemptyString(value.role) && nonemptyString(value.mediaType) &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.byteLength === "number" &&
    Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
    value.origin === "administrative" && nonemptyString(value.producer) &&
    canonicalUtcMilliseconds(value.createdAt);
}

export function assertSealedEvidenceStructure<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
>(
  sealed: Pick<SealedEvidence<S, C, O>, "snapshot" | "manifest">,
  sourceIds: readonly S[],
): EvidenceOrigin {
  const { snapshot, manifest } = sealed;
  const fail = (): never => {
    throw new Error("integrity_mismatch");
  };
  if (
    !isRecord(snapshot) || !isRecord(manifest) ||
    !exactOwnKeys(manifest, ["snapshot", "entries", "artifacts"]) ||
    !isRecord(manifest.snapshot) ||
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
    !hasExactEvidenceSnapshotKeys(snapshot, true) ||
    !hasExactEvidenceSnapshotKeys(manifest.snapshot, false) ||
    (snapshot.contextHash !== undefined && typeof snapshot.contextHash !== "string") ||
    (manifest.snapshot.contextHash !== undefined &&
      typeof manifest.snapshot.contextHash !== "string") ||
    (snapshot.knowledgeBaselineRevisionId !== undefined &&
      typeof snapshot.knowledgeBaselineRevisionId !== "string") ||
    (manifest.snapshot.knowledgeBaselineRevisionId !== undefined &&
      typeof manifest.snapshot.knowledgeBaselineRevisionId !== "string")
  ) fail();

  const entriesAreAdministrative = manifest.entries.every((entry) =>
    Object.prototype.hasOwnProperty.call(entry, "origin"));
  const entriesAreLive = manifest.entries.every((entry) =>
    !Object.prototype.hasOwnProperty.call(entry, "origin"));
  if (entriesAreAdministrative === entriesAreLive) fail();
  const origin: EvidenceOrigin = entriesAreAdministrative ? "administrative" : "live";
  for (const entry of manifest.entries) {
    const entryRecord = entry as unknown as Record<string, unknown>;
    if (origin === "administrative") {
      if (
        !exactOwnKeys(entryRecord, ["sourceId", "origin", "artifactIds"]) ||
        entryRecord.origin !== "administrative" || !denseArray(entryRecord.artifactIds)
      ) fail();
    } else {
      const expectedEntryKeys = [
        "sourceId", "navigationUrl", "resolvedEvidenceUrl", "artifactIds",
        ...(Object.prototype.hasOwnProperty.call(entryRecord, "indexedSourceUrl")
          ? ["indexedSourceUrl"]
          : []),
        ...(Object.prototype.hasOwnProperty.call(entryRecord, "versionHint") ? ["versionHint"] : []),
      ];
      if (
        !exactOwnKeys(entryRecord, expectedEntryKeys) ||
        !nonemptyString(entryRecord.navigationUrl) ||
        !nonemptyString(entryRecord.resolvedEvidenceUrl) || !denseArray(entryRecord.artifactIds)
      ) fail();
    }
  }
  for (const artifact of manifest.artifacts) {
    if (origin === "administrative") {
      if (!validAdministrativeProvenance(artifact, artifact.sourceId)) fail();
    } else if (!validLiveProvenance(artifact, artifact.sourceId)) fail();
  }
  if (new Set(manifest.artifacts.map((artifact) => artifact.runId)).size > 1) fail();
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
      entry === undefined ||
      !validClaim(claim, entry.sourceId, new Set(entry.artifactIds)) ||
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
      (origin === "administrative" && coverage !== "verified") ||
      (coverage === "verified" && (blockers.length !== 0 || claims.length === 0)) ||
      (coverage === "unavailable" && blockers.length !== 1) ||
      blockers.some((blocker) =>
        !validBlocker(blocker, sourceId, new Set(entry.artifactIds))
      )
    ) fail();
  }
  if (origin === "administrative" && snapshot.blockers.length !== 0) fail();
  return origin;
}

export function evidenceArtifactProvenance<
  S extends string,
  O extends EvidenceOrigin = "live",
>(
  artifact: CapturedArtifactForOrigin<S, O>,
): EvidenceArtifactProvenance<S, O> {
  if (artifact.origin === "administrative") {
    const administrative = artifact as AdministrativeCapturedArtifact<S>;
    return {
      artifactId: administrative.artifactId,
      runId: administrative.runId,
      sourceId: administrative.sourceId,
      role: administrative.role,
      mediaType: administrative.mediaType,
      sha256: administrative.sha256,
      byteLength: administrative.bytes.byteLength,
      origin: "administrative",
      producer: administrative.producer,
      createdAt: administrative.createdAt,
    } as EvidenceArtifactProvenance<S, O>;
  }
  const live = artifact as LiveCapturedArtifact<S>;
  return {
    artifactId: live.artifactId,
    runId: live.runId,
    sourceId: live.sourceId,
    role: live.role,
    request: live.request,
    url: live.url,
    responseUrl: live.responseUrl,
    capturedAt: live.capturedAt,
    responseStatus: live.responseStatus,
    mediaType: live.mediaType,
    origin: "live",
    byteLength: live.bytes.byteLength,
    sha256: live.sha256,
  } as EvidenceArtifactProvenance<S, O>;
}

function terminalArtifacts<S extends string, C extends Claim<unknown, S>>(
  entry: TerminalEvidenceEntry<S, C> | AdministrativeTerminalEvidenceEntry<S, C>,
): readonly (LiveCapturedArtifact<S> | AdministrativeCapturedArtifact<S>)[] {
  return "origin" in entry ? entry.artifacts : entry.parserEntry.artifacts as
    readonly LiveCapturedArtifact<S>[];
}

export async function sealEvidencePlan<
  S extends string,
  C extends Claim<unknown, S>,
  O extends EvidenceOrigin = "live",
>(
  input: SealEvidenceInput<S, C, O>,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence<S, C, O>> {
  let ownedInput: SealEvidenceInput<S, C, O>;
  try {
    ownedInput = strictOwnedEvidenceValue(input);
  } catch {
    invalidTerminalEvidence();
  }
  const inputRecord = ownedInput as unknown as Record<string, unknown>;
  const expectedInputKeys = [
    "id", "assessmentDate", "entries", "sourceIds", "parserVersions", "rulesVersion",
    ...(Object.prototype.hasOwnProperty.call(inputRecord, "contextHash") ? ["contextHash"] : []),
    ...(Object.prototype.hasOwnProperty.call(inputRecord, "knowledgeBaselineRevisionId")
      ? ["knowledgeBaselineRevisionId"]
      : []),
  ];
  if (
    !exactOwnKeys(inputRecord, expectedInputKeys) || !nonemptyString(ownedInput.id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ownedInput.assessmentDate) ||
    !nonemptyString(ownedInput.rulesVersion) || !isRecord(ownedInput.parserVersions) ||
    (ownedInput.contextHash !== undefined && !nonemptyString(ownedInput.contextHash)) ||
    (ownedInput.knowledgeBaselineRevisionId !== undefined &&
      !nonemptyString(ownedInput.knowledgeBaselineRevisionId))
  ) invalidTerminalEvidence();
  const terminalEntries = ownedInput.entries as readonly (
    TerminalEvidenceEntry<S, C> | AdministrativeTerminalEvidenceEntry<S, C>
  )[];
  const origin = validateTerminalEntries(ownedInput.sourceIds, terminalEntries);
  if (
    origin === "administrative" &&
    (!exactRecordKeys(ownedInput.parserVersions, ownedInput.sourceIds) ||
      ownedInput.sourceIds.some((sourceId) => !nonemptyString(ownedInput.parserVersions[sourceId])))
  ) invalidTerminalEvidence();
  const orderedEntries = ownedInput.sourceIds.map(
    (sourceId) => terminalEntries.find((entry) => entry.sourceId === sourceId)!,
  );
  const artifactIds = orderedEntries.flatMap((entry) =>
    terminalArtifacts(entry).map((artifact) => artifact.artifactId),
  );
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error("invalid_terminal_evidence");
  const artifactRunIds = new Set(orderedEntries.flatMap((entry) =>
    terminalArtifacts(entry).map((artifact) => artifact.runId),
  ));
  if (artifactRunIds.size > 1) throw new Error("invalid_terminal_evidence");

  const coverage = Object.fromEntries(
    orderedEntries.map((entry) => [entry.sourceId, entry.coverage]),
  ) as Record<S, "verified" | "unavailable">;
  const snapshotPayload: Omit<EvidenceSnapshot<S, C>, "manifestHash" | "hmac"> = {
    id: ownedInput.id,
    assessmentDate: ownedInput.assessmentDate,
    artifactIds,
    claims: orderedEntries.flatMap((entry) =>
      entry.coverage === "verified" ? [...entry.claims] : [],
    ) as C[],
    blockers: orderedEntries.flatMap((entry) =>
      entry.coverage === "unavailable" ? [entry.blocker] : [],
    ),
    coverage,
    parserVersions: ownedInput.parserVersions,
    rulesVersion: ownedInput.rulesVersion,
    ...(ownedInput.contextHash === undefined ? {} : { contextHash: ownedInput.contextHash }),
    ...(ownedInput.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: ownedInput.knowledgeBaselineRevisionId }),
  };
  const manifestEntries = orderedEntries.map((entry) => {
    if ("origin" in entry) {
      return {
        sourceId: entry.sourceId,
        origin: "administrative" as const,
        artifactIds: entry.artifacts.map((artifact) => artifact.artifactId),
      };
    }
    return {
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
    };
  }) as unknown as readonly EvidenceManifestEntryForOrigin<S, O>[];
  const manifestArtifacts = orderedEntries.flatMap((entry) =>
    terminalArtifacts(entry).map((artifact) =>
      evidenceArtifactProvenance(
        artifact as CapturedArtifactForOrigin<S, O>,
      )
    )
  );
  const manifest: EvidenceManifest<S, C, O> = {
    snapshot: snapshotPayload,
    entries: manifestEntries,
    artifacts: manifestArtifacts,
  };
  if (origin === "administrative" && manifest.entries.some((entry) => !("origin" in entry))) {
    invalidTerminalEvidence();
  }
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
