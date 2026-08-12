import type {
  ClaimKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "./cold-start-contracts";
import type { EvidenceSnapshot } from "./contracts";
import type { EvidenceArtifactProvenance } from "./research-plan";

export interface FormalKnowledgeReference {
  readonly claimId: string;
  readonly claimKind: ClaimKind;
  readonly definitionId: string;
  readonly evidenceSnapshotId: string;
}

export interface KnowledgeStatusObservation {
  readonly kind: "source_status";
  readonly observationId: string;
  readonly sourceId: SloveniaSourceId;
  readonly status: "superseded" | "expired" | "unresolved";
  readonly affectedClaimKinds: readonly ClaimKind[];
  readonly supersedesObservationId?: string;
  readonly evidenceSnapshotId: string;
  readonly artifactIds: readonly string[];
  readonly definitionId: string;
  readonly capturedAt: string;
  readonly publishedAt?: string;
  readonly referencePeriod?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly verifiedAt: string;
}

export interface SloveniaCountryKnowledgeRevision {
  readonly schemaVersion: "country-knowledge@1";
  readonly packageId: "SI";
  readonly observationSchemaVersion: "si-knowledge@1";
  readonly id: string;
  readonly countryCode: "SI";
  readonly predecessorId?: string;
  readonly triggerEvidenceSnapshotId: string;
  readonly formalClaimRefs: readonly FormalKnowledgeReference[];
  readonly statusObservations: readonly KnowledgeStatusObservation[];
  readonly createdAt: string;
}

export type InstalledCountryKnowledgeRevision = SloveniaCountryKnowledgeRevision;

export interface KnowledgeEvidenceEntry {
  readonly sourceId: SloveniaSourceId;
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly resolvedEvidenceUrl: string;
  readonly artifactIds: readonly string[];
  readonly versionHint?: string;
}

export interface VerifiedCountryEvidenceInput {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly entries: readonly KnowledgeEvidenceEntry[];
  readonly artifacts: readonly EvidenceArtifactProvenance<SloveniaSourceId>[];
}

const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];

const CLAIM_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];

const AFFECTED_CLAIM_KINDS: Readonly<Record<SloveniaSourceId, readonly ClaimKind[]>> = {
  "si-digital-nomad-route": [
    "route_basis",
    "citizenship_applicability",
    "remote_work_relations",
    "qualification",
    "companion_entry",
    "duration",
    "general_statutory_prerequisites",
  ],
  "si-income-threshold": ["income"],
  "si-companion-employment": ["companion_local_work_access"],
  "cbr-eur": [],
};

const EXPECTED_PARSERS: Readonly<Record<SloveniaSourceId, string>> = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
};

const claimOrder = new Map<ClaimKind, number>(
  CLAIM_KINDS.map((claimKind, index) => [claimKind, index]),
);
const sourceOrder = new Map<SloveniaSourceId, number>(
  SOURCE_IDS.map((sourceId, index) => [sourceId, index]),
);

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function evidenceEntry(
  evidence: VerifiedCountryEvidenceInput,
  sourceId: SloveniaSourceId,
): KnowledgeEvidenceEntry {
  const matches = evidence.entries.filter((entry) => entry.sourceId === sourceId);
  if (matches.length !== 1) integrityMismatch();
  return matches[0]!;
}

function evidenceArtifact(
  evidence: VerifiedCountryEvidenceInput,
  artifactId: string,
): EvidenceArtifactProvenance<SloveniaSourceId> {
  const matches = evidence.artifacts.filter((artifact) => artifact.artifactId === artifactId);
  if (matches.length !== 1) integrityMismatch();
  return matches[0]!;
}

function assertArtifactOwned(
  evidence: VerifiedCountryEvidenceInput,
  sourceId: SloveniaSourceId,
  artifactId: string,
): EvidenceArtifactProvenance<SloveniaSourceId> {
  const entry = evidenceEntry(evidence, sourceId);
  const artifact = evidenceArtifact(evidence, artifactId);
  if (artifact.sourceId !== sourceId || !entry.artifactIds.includes(artifactId)) {
    integrityMismatch();
  }
  return artifact;
}

function assertCountryClaim(
  evidence: VerifiedCountryEvidenceInput,
  claim: VerifiedCountryClaim,
): void {
  if (
    !CLAIM_KINDS.includes(claim.claimKind) ||
    !AFFECTED_CLAIM_KINDS[claim.sourceId].includes(claim.claimKind) ||
    claim.validatorVersion !== EXPECTED_PARSERS[claim.sourceId] ||
    claim.status !== "verified" ||
    claim.evidence.length === 0
  ) integrityMismatch();
  assertArtifactOwned(evidence, claim.sourceId, claim.anchor.artifactId);
  for (const reference of claim.evidence) {
    const artifact = assertArtifactOwned(evidence, reference.sourceId, reference.artifactId);
    if (
      reference.anchor.artifactId !== reference.artifactId ||
      reference.sourcePeriod !== claim.sourcePeriod ||
      reference.navigationUrl !== artifact.request.url ||
      reference.resolvedEvidenceUrl !== artifact.responseUrl
    ) integrityMismatch();
  }
}

function assertEvidence(evidence: VerifiedCountryEvidenceInput): void {
  const { snapshot } = evidence;
  if (
    !isRecord(snapshot) || !isRecord(snapshot.coverage) ||
    !isRecord(snapshot.parserVersions) || !Array.isArray(snapshot.artifactIds) ||
    !Array.isArray(snapshot.claims) || !Array.isArray(snapshot.blockers) ||
    !Array.isArray(evidence.entries) || !Array.isArray(evidence.artifacts) ||
    snapshot.rulesVersion !== "vs2-si-evidence@2" ||
    !canonicalDay(snapshot.assessmentDate) ||
    evidence.entries.length !== SOURCE_IDS.length ||
    evidence.artifacts.some((artifact) => !isRecord(artifact)) ||
    SOURCE_IDS.some((sourceId) =>
      snapshot.parserVersions[sourceId] !== EXPECTED_PARSERS[sourceId] ||
      evidence.entries.filter((entry) => entry.sourceId === sourceId).length !== 1
    )
  ) integrityMismatch();

  const entryArtifactIds = evidence.entries.flatMap((entry) => entry.artifactIds);
  const provenanceArtifactIds = evidence.artifacts.map((artifact) => artifact.artifactId);
  if (
    new Set(entryArtifactIds).size !== entryArtifactIds.length ||
    !sameStrings(snapshot.artifactIds, entryArtifactIds) ||
    !sameStrings(snapshot.artifactIds, provenanceArtifactIds)
  ) integrityMismatch();
  for (const artifact of evidence.artifacts) {
    assertArtifactOwned(evidence, artifact.sourceId, artifact.artifactId);
  }

  const countryClaims = snapshot.claims.filter(
    (claim): claim is VerifiedCountryClaim => "claimKind" in claim,
  );
  if (
    new Set(countryClaims.map(({ claimKind }) => claimKind)).size !== countryClaims.length ||
    countryClaims.some((claim) => snapshot.coverage[claim.sourceId] !== "verified")
  ) integrityMismatch();
  for (const claim of countryClaims) assertCountryClaim(evidence, claim);

  for (const sourceId of SOURCE_IDS) {
    const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
    const blockers = snapshot.blockers.filter((blocker) => blocker.sourceId === sourceId);
    if (
      (snapshot.coverage[sourceId] === "verified" && (claims.length === 0 || blockers.length > 0)) ||
      (snapshot.coverage[sourceId] === "unavailable" && blockers.length !== 1) ||
      (snapshot.coverage[sourceId] !== "verified" && snapshot.coverage[sourceId] !== "unavailable")
    ) integrityMismatch();
    for (const blocker of blockers) {
      const entry = evidenceEntry(evidence, sourceId);
      if (
        blocker.navigationUrl !== entry.navigationUrl ||
        blocker.artifactIds.some((artifactId: string) => !entry.artifactIds.includes(artifactId))
      ) integrityMismatch();
      for (const artifactId of blocker.artifactIds) {
        assertArtifactOwned(evidence, sourceId, artifactId);
      }
    }
  }
}

function formalReference(
  claim: VerifiedCountryClaim,
  evidenceSnapshotId: string,
): FormalKnowledgeReference {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    definitionId: claim.validatorVersion,
    evidenceSnapshotId,
  };
}

function statusFor(kind: string): KnowledgeStatusObservation["status"] | undefined {
  if (kind === "stale") return "expired";
  if (kind === "semantic_mismatch" || kind === "conflict") return "unresolved";
  return undefined;
}

function latestCapturedAt(
  evidence: VerifiedCountryEvidenceInput,
  artifactIds: readonly string[],
): string {
  const captured = artifactIds.map((artifactId) => evidenceArtifact(evidence, artifactId).capturedAt);
  if (captured.length === 0 || captured.some((value) => !canonicalInstant(value))) {
    integrityMismatch();
  }
  return [...captured].sort().at(-1)!;
}

function removeKindsFromStatuses(
  observations: readonly KnowledgeStatusObservation[],
  removedKinds: ReadonlySet<ClaimKind>,
): KnowledgeStatusObservation[] {
  return observations.flatMap((observation) => {
    const affectedClaimKinds = observation.affectedClaimKinds.filter(
      (claimKind) => !removedKinds.has(claimKind),
    );
    return affectedClaimKinds.length === 0 ? [] : [{ ...observation, affectedClaimKinds }];
  });
}

function assertPredecessor(predecessor: SloveniaCountryKnowledgeRevision): void {
  if (
    predecessor.schemaVersion !== "country-knowledge@1" ||
    predecessor.packageId !== "SI" ||
    predecessor.observationSchemaVersion !== "si-knowledge@1" ||
    predecessor.countryCode !== "SI" ||
    !Array.isArray(predecessor.formalClaimRefs) ||
    !Array.isArray(predecessor.statusObservations)
  ) integrityMismatch();
}

export function buildSloveniaKnowledgeRevision(input: {
  readonly evidence: VerifiedCountryEvidenceInput;
  readonly predecessor?: SloveniaCountryKnowledgeRevision;
  readonly createdAt: string;
}): SloveniaCountryKnowledgeRevision | undefined {
  assertEvidence(input.evidence);
  if (input.predecessor !== undefined) assertPredecessor(input.predecessor);

  const countryClaims = input.evidence.snapshot.claims.filter(
    (claim): claim is VerifiedCountryClaim => "claimKind" in claim,
  );
  const relevantBlockers = input.evidence.snapshot.blockers.filter(
    ({ sourceId }) => AFFECTED_CLAIM_KINDS[sourceId].length > 0,
  );
  if (relevantBlockers.some(({ kind }) =>
    kind === "timeout" || kind === "deadline" || kind === "rate_limited" ||
    kind === "server_error"
  )) return undefined;

  const masks = relevantBlockers.flatMap((blocker) => {
    const status = statusFor(blocker.kind);
    return status === undefined || blocker.artifactIds.length === 0
      ? []
      : [{ blocker, status }];
  });
  if (countryClaims.length === 0 && masks.length === 0) return undefined;
  if (!canonicalInstant(input.createdAt)) throw new Error("invalid_created_at");

  const references = new Map<ClaimKind, FormalKnowledgeReference>(
    input.predecessor?.formalClaimRefs.map((reference) => [reference.claimKind, reference]) ?? [],
  );
  let observations = [...(input.predecessor?.statusObservations ?? [])];
  const replacedKinds = new Set(countryClaims.map(({ claimKind }) => claimKind));
  observations = removeKindsFromStatuses(observations, replacedKinds);
  for (const claim of countryClaims) {
    references.set(claim.claimKind, formalReference(claim, input.evidence.snapshot.id));
  }

  for (const { blocker, status } of masks) {
    const affectedClaimKinds = AFFECTED_CLAIM_KINDS[blocker.sourceId].filter(
      (claimKind) => !replacedKinds.has(claimKind),
    );
    if (affectedClaimKinds.length === 0) continue;
    const affectedSet = new Set(affectedClaimKinds);
    const superseded = observations.find((observation) =>
      observation.sourceId === blocker.sourceId ||
      observation.affectedClaimKinds.some((claimKind) => affectedSet.has(claimKind))
    );
    observations = removeKindsFromStatuses(observations, affectedSet);
    for (const claimKind of affectedClaimKinds) references.delete(claimKind);
    observations.push({
      kind: "source_status",
      observationId: `${input.evidence.snapshot.id}:${blocker.sourceId}:${status}`,
      sourceId: blocker.sourceId,
      status,
      affectedClaimKinds,
      ...(superseded === undefined
        ? {}
        : { supersedesObservationId: superseded.observationId }),
      evidenceSnapshotId: input.evidence.snapshot.id,
      artifactIds: [...blocker.artifactIds],
      definitionId: input.evidence.snapshot.parserVersions[blocker.sourceId],
      capturedAt: latestCapturedAt(input.evidence, blocker.artifactIds),
      verifiedAt: input.evidence.snapshot.assessmentDate,
    });
  }

  const formalClaimRefs = [...references.values()].sort(
    (left, right) => claimOrder.get(left.claimKind)! - claimOrder.get(right.claimKind)!,
  );
  const statusObservations = observations.sort((left, right) =>
    sourceOrder.get(left.sourceId)! - sourceOrder.get(right.sourceId)! ||
    left.observationId.localeCompare(right.observationId)
  );
  return deepFreeze({
    schemaVersion: "country-knowledge@1",
    packageId: "SI",
    observationSchemaVersion: "si-knowledge@1",
    id: `country-knowledge:SI:${input.evidence.snapshot.id}`,
    countryCode: "SI",
    ...(input.predecessor === undefined ? {} : { predecessorId: input.predecessor.id }),
    triggerEvidenceSnapshotId: input.evidence.snapshot.id,
    formalClaimRefs,
    statusObservations,
    createdAt: input.createdAt,
  });
}
