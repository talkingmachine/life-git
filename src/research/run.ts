import type {
  CaptureFailureKind,
  CaptureResult,
  Claim,
  EvidenceBlocker,
  EvidenceSnapshot,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParseResult,
  ParserEntry,
  RequestStep,
  SourceId,
} from "./contracts";
import { parseBoaEur } from "./parsers/boa-eur";
import { parseCbrEur, fxPeriodsAreCurrent } from "./parsers/cbr-eur";
import { parseDecision858 } from "./parsers/decision-858";
import { parseLaw79 } from "./parsers/law-79";
import { parseTiranaUrbanLines } from "./parsers/tirana-urban-lines";
import { SOURCE_POLICIES } from "./source-policy";

export const EVIDENCE_PARSER_VERSIONS = Object.freeze({
  "al-law-79": "law-79@1",
  "al-decision-858": "decision-858@1",
  "cbr-eur": "cbr-eur@1",
  "boa-eur": "boa-eur@1",
  "tirana-urban-lines": "tirana-urban-lines@1",
} satisfies Record<SourceId, string>);

export const EVIDENCE_RULES_VERSION = "vs1-evidence@1";

export const EVIDENCE_SOURCE_IDS = [
  "al-law-79",
  "al-decision-858",
  "cbr-eur",
  "boa-eur",
  "tirana-urban-lines",
] as const satisfies readonly SourceId[];

interface VerifiedEvidenceEntry {
  readonly sourceId: SourceId;
  readonly parserEntry: ParserEntry;
  readonly coverage: "verified";
  readonly claims: readonly Claim<unknown>[];
}

interface UnavailableEvidenceEntry {
  readonly sourceId: SourceId;
  readonly parserEntry: ParserEntry;
  readonly coverage: "unavailable";
  readonly blocker: EvidenceBlocker;
}

export type TerminalEvidenceEntry = VerifiedEvidenceEntry | UnavailableEvidenceEntry;

export interface EvidenceManifest {
  readonly snapshot: Omit<EvidenceSnapshot, "manifestHash" | "hmac">;
  readonly entries: readonly {
    readonly sourceId: SourceId;
    readonly navigationUrl: string;
    readonly indexedSourceUrl?: string;
    readonly resolvedEvidenceUrl: string;
    readonly artifactIds: readonly string[];
    readonly versionHint?: string;
  }[];
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly runId: string;
    readonly sourceId: SourceId;
    readonly role: string;
    readonly request: LiveCapturedArtifact["request"];
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

export type EvidenceArtifactProvenance = EvidenceManifest["artifacts"][number];

export interface SealedEvidence {
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: EvidenceManifest;
  readonly canonicalManifest: string;
}

export interface SealEvidenceInput {
  readonly id: string;
  readonly assessmentDate: string;
  readonly entries: readonly TerminalEvidenceEntry[];
  readonly parserVersions: Readonly<Record<SourceId, string>>;
  readonly rulesVersion: string;
}

export interface EvidenceIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
  sign(value: string): string;
}

type EvidenceParser = (entry: ParserEntry) => ParseResult<unknown> | Promise<ParseResult<unknown>>;

export type EvidenceParsers = Record<SourceId, EvidenceParser>;

export const STANDARD_EVIDENCE_PARSERS: EvidenceParsers = {
  "al-law-79": parseLaw79,
  "al-decision-858": parseDecision858,
  "cbr-eur": parseCbrEur,
  "boa-eur": parseBoaEur,
  "tirana-urban-lines": parseTiranaUrbanLines,
};

export interface EvidenceWriteStore {
  appendArtifact(artifact: LiveCapturedArtifact): Promise<void>;
  seal(sealed: SealedEvidence): Promise<void>;
}

export interface RunCurrentEvidenceInput {
  readonly runId: string;
  readonly assessmentDate: string;
  readonly deadlineAt: string;
}

export interface RunCurrentEvidencePorts {
  readonly source: OfficialSourcePort;
  readonly requestStep: RequestStep;
  readonly store: EvidenceWriteStore;
  readonly integrity: EvidenceIntegrity;
  readonly parsers?: EvidenceParsers;
}

function validateEntries(entries: readonly TerminalEvidenceEntry[]): void {
  if (
    entries.length !== EVIDENCE_SOURCE_IDS.length ||
    EVIDENCE_SOURCE_IDS.some(
      (sourceId) => entries.filter((entry) => entry.sourceId === sourceId).length !== 1,
    )
  ) {
    throw new Error("non_terminal_evidence");
  }

  for (const entry of entries) {
    const artifactIds = new Set(entry.parserEntry.artifacts.map((artifact) => artifact.artifactId));
    if (entry.parserEntry.sourceId !== entry.sourceId) throw new Error("invalid_terminal_evidence");
    if (entry.parserEntry.artifacts.some((artifact) => {
      const captured = artifact as Partial<LiveCapturedArtifact>;
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
        entry.claims.some(
          (claim) =>
            claim.sourceId !== entry.sourceId ||
            claim.status !== "verified" ||
            !artifactIds.has(claim.anchor.artifactId),
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

export async function sealEvidence(
  input: SealEvidenceInput,
  integrity: EvidenceIntegrity,
): Promise<SealedEvidence> {
  validateEntries(input.entries);
  const orderedEntries = EVIDENCE_SOURCE_IDS.map(
    (sourceId) => input.entries.find((entry) => entry.sourceId === sourceId)!,
  );
  const artifactIds = orderedEntries.flatMap((entry) =>
    entry.parserEntry.artifacts.map((artifact) => artifact.artifactId),
  );
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error("invalid_terminal_evidence");
  const artifactRunIds = new Set(orderedEntries.flatMap((entry) =>
    entry.parserEntry.artifacts.map((artifact) =>
      (artifact as LiveCapturedArtifact).runId,
    ),
  ));
  if (artifactRunIds.size > 1) throw new Error("invalid_terminal_evidence");

  const coverage = Object.fromEntries(
    orderedEntries.map((entry) => [entry.sourceId, entry.coverage]),
  ) as Record<SourceId, "verified" | "unavailable">;
  const snapshotPayload: Omit<EvidenceSnapshot, "manifestHash" | "hmac"> = {
    id: input.id,
    assessmentDate: input.assessmentDate,
    artifactIds,
    claims: orderedEntries.flatMap((entry) =>
      entry.coverage === "verified" ? entry.claims : [],
    ),
    blockers: orderedEntries.flatMap((entry) =>
      entry.coverage === "unavailable" ? [entry.blocker] : [],
    ),
    coverage,
    parserVersions: input.parserVersions,
    rulesVersion: input.rulesVersion,
  };
  const manifest: EvidenceManifest = {
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
        evidenceArtifactProvenance(artifact as LiveCapturedArtifact),
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

export function evidenceArtifactProvenance(
  artifact: LiveCapturedArtifact,
): EvidenceArtifactProvenance {
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

function navigationUrl(sourceId: SourceId): string {
  const policy = SOURCE_POLICIES[sourceId];
  return "navigationUrl" in policy ? policy.navigationUrl : policy.url;
}

function unavailableEntry(
  sourceId: SourceId,
  kind: EvidenceBlocker["kind"],
  artifacts: readonly LiveCapturedArtifact[],
  parserEntry?: ParserEntry,
): TerminalEvidenceEntry {
  const navigation = parserEntry?.navigationUrl ?? navigationUrl(sourceId);
  const resolvedUrl = parserEntry?.resolvedEvidenceUrl ?? artifacts.at(-1)?.responseUrl;
  return {
    sourceId,
    parserEntry: parserEntry ?? {
      sourceId,
      navigationUrl: navigation,
      resolvedEvidenceUrl: resolvedUrl ?? navigation,
      artifacts,
    },
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind,
      navigationUrl: navigation,
      ...(resolvedUrl === undefined ? {} : { resolvedUrl }),
      artifactIds: artifacts.map((artifact) => artifact.artifactId),
    },
  };
}

export async function parseEvidenceEntry(
  entry: ParserEntry,
  parsers: EvidenceParsers,
): Promise<TerminalEvidenceEntry> {
  const parsed = await parsers[entry.sourceId](entry);
  if (!parsed.ok) {
    return unavailableEntry(
      entry.sourceId,
      parsed.kind,
      entry.artifacts as readonly LiveCapturedArtifact[],
      entry,
    );
  }
  if (parsed.anchors.length === 0) {
    return unavailableEntry(
      entry.sourceId,
      "semantic_mismatch",
      entry.artifacts as readonly LiveCapturedArtifact[],
      entry,
    );
  }
  return {
    sourceId: entry.sourceId,
    parserEntry: entry,
    coverage: "verified",
    claims: parsed.anchors.map((anchor, index) => ({
      claimId: `${entry.sourceId}-facts-${index + 1}`,
      sourceId: entry.sourceId,
      value: parsed.facts,
      scope: "VS-1 confirmed-life",
      sourcePeriod: parsed.sourcePeriod,
      anchor,
      status: "verified",
    })),
  };
}

function retryableKind(error: unknown): CaptureFailureKind | undefined {
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined;
  const kind = (error as { readonly kind?: unknown }).kind;
  return kind === "timeout" || kind === "rate_limited" || kind === "server_error"
    ? kind
    : undefined;
}

function captureFailure(error: unknown): {
  readonly kind: CaptureFailureKind;
  readonly partialArtifacts: readonly LiveCapturedArtifact[];
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
      ? partial as readonly LiveCapturedArtifact[]
      : [],
  };
}

class CurrentArtifactOwnershipError extends Error {
  readonly kind = "navigation_mismatch" as const;
  readonly partialArtifacts: readonly LiveCapturedArtifact[] = [];
}

function isCurrentArtifact(
  artifact: LiveCapturedArtifact,
  runId: string,
  sourceId: SourceId,
): boolean {
  return artifact.origin === "live" && artifact.runId === runId && artifact.sourceId === sourceId;
}

export function applyEvidenceRules(
  entries: readonly TerminalEvidenceEntry[],
  assessmentDate: string,
): readonly TerminalEvidenceEntry[] {
  const cbr = entries.find((entry) => entry.sourceId === "cbr-eur");
  const boa = entries.find((entry) => entry.sourceId === "boa-eur");
  if (
    cbr?.coverage !== "verified" ||
    boa?.coverage !== "verified" ||
    fxPeriodsAreCurrent(
      cbr.claims[0]!.sourcePeriod,
      boa.claims[0]!.sourcePeriod,
      assessmentDate,
    )
  ) {
    return entries;
  }
  return entries.map((entry) =>
    entry.sourceId === "cbr-eur" || entry.sourceId === "boa-eur"
      ? unavailableEntry(
          entry.sourceId,
          "stale",
          entry.parserEntry.artifacts as readonly LiveCapturedArtifact[],
          entry.parserEntry,
        )
      : entry,
  );
}

export async function runCurrentEvidence(
  input: RunCurrentEvidenceInput,
  ports: RunCurrentEvidencePorts,
): Promise<EvidenceSnapshot> {
  const deadline = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadline)) throw new Error("invalid_deadline");
  const controller = new AbortController();
  let announceDeadline!: () => void;
  const deadlineReached = new Promise<void>((resolve) => {
    announceDeadline = resolve;
  });
  const expireDeadline = (): void => {
    if (!controller.signal.aborted) controller.abort("deadline");
    announceDeadline();
  };
  const remaining = deadline - Date.now();
  const deadlineTimer = remaining > 0
    ? setTimeout(expireDeadline, remaining)
    : undefined;
  if (remaining <= 0) expireDeadline();
  const parsers = ports.parsers ?? STANDARD_EVIDENCE_PARSERS;

  try {
    const captured = await Promise.all(EVIDENCE_SOURCE_IDS.map(async (sourceId) => {
      if (controller.signal.aborted) return unavailableEntry(sourceId, "deadline", []);
      let retryAvailable = true;
      const requestStep: RequestStep = async (request, signal) => {
        if (
          signal !== controller.signal ||
          request.runId !== input.runId ||
          request.sourceId !== sourceId
        ) {
          throw new CurrentArtifactOwnershipError("request ownership mismatch");
        }
        try {
          const capturedArtifact = await ports.requestStep(request, signal);
          if (!isCurrentArtifact(capturedArtifact, input.runId, sourceId)) {
            throw new CurrentArtifactOwnershipError("artifact ownership mismatch");
          }
          await ports.store.appendArtifact(capturedArtifact);
          return capturedArtifact;
        } catch (error) {
          if (
            retryAvailable &&
            retryableKind(error) !== undefined &&
            !controller.signal.aborted &&
            Date.now() < deadline
          ) {
            retryAvailable = false;
            const capturedArtifact = await ports.requestStep(request, signal);
            if (!isCurrentArtifact(capturedArtifact, input.runId, sourceId)) {
              throw new CurrentArtifactOwnershipError("artifact ownership mismatch");
            }
            await ports.store.appendArtifact(capturedArtifact);
            return capturedArtifact;
          }
          throw error;
        }
      };
      let result: CaptureResult;
      try {
        result = await ports.source.capture({
          runId: input.runId,
          sourceId,
          assessmentDate: input.assessmentDate,
          deadlineAt: input.deadlineAt,
          signal: controller.signal,
        }, requestStep);
      } catch (error) {
        const failure = captureFailure(error);
        if (failure === undefined) throw error;
        result = {
          ok: false,
          sourceId,
          kind: failure.kind,
          attempts: 1,
          partialArtifacts: failure.partialArtifacts,
        };
      }
      if (!result.ok) {
        if (
          result.sourceId !== sourceId ||
          result.partialArtifacts.some((artifact) =>
            !isCurrentArtifact(artifact, input.runId, sourceId),
          )
        ) {
          return unavailableEntry(sourceId, "integrity_mismatch", []);
        }
        for (const artifact of result.partialArtifacts) await ports.store.appendArtifact(artifact);
        return unavailableEntry(sourceId, result.kind, result.partialArtifacts);
      }
      if (
        result.entry.sourceId !== sourceId ||
        result.entry.artifacts.some((artifact) =>
          !isCurrentArtifact(artifact, input.runId, sourceId),
        )
      ) {
        return unavailableEntry(sourceId, "integrity_mismatch", []);
      }
      for (const artifact of result.entry.artifacts) await ports.store.appendArtifact(artifact);
      if (controller.signal.aborted) {
        return unavailableEntry(sourceId, "deadline", result.entry.artifacts, result.entry);
      }
      return Promise.race([
        parseEvidenceEntry(result.entry, parsers),
        deadlineReached.then(() =>
          unavailableEntry(sourceId, "deadline", result.entry.artifacts, result.entry),
        ),
      ]);
    }));
    const terminalEntries = applyEvidenceRules(captured, input.assessmentDate);
    const sealed = await sealEvidence({
      id: `${input.runId}:evidence`,
      assessmentDate: input.assessmentDate,
      entries: terminalEntries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, ports.integrity);
    await ports.store.seal(sealed);
    return sealed.snapshot;
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}
