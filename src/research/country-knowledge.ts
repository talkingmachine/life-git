import { types } from "node:util";

import type {
  ClaimKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "./cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  sloveniaV2ClaimIdentity,
  sloveniaV2ClaimScopeToken,
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type ParticipantRequirementScopeV2,
  type VerifiedCountryClaimV2,
} from "./cold-start-contracts-v2";
import type {
  ClaimAnchor,
  EvidenceBlockerKind,
  EvidenceSnapshot,
} from "./contracts";
import {
  assertSealedEvidenceStructure,
  type EvidenceArtifactProvenance,
  type EvidenceManifest,
} from "./research-plan";

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

export interface VerifiedCountryEvidenceInputV2 {
  readonly snapshot: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
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
const HEX_64 = /^[a-f\d]{64}$/;
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;
const MONEY_TEXT = /^(?:0|[1-9]\d*)\.\d{2}$/;
const MONTH_PERIOD = /^\d{4}M(?:0[1-9]|1[0-2])$/;
const DAY_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DECIMAL_TEXT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const BLOCKER_KINDS = Object.freeze([
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
] as const satisfies readonly EvidenceBlockerKind[]);

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
  evidence: Pick<VerifiedCountryEvidenceInput, "artifacts">,
  artifactIds: readonly string[],
): string {
  const captured = artifactIds.map((artifactId) => {
    const matches = evidence.artifacts.filter((artifact) => artifact.artifactId === artifactId);
    if (matches.length !== 1) integrityMismatch();
    return matches[0]!.capturedAt;
  });
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

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function httpUrl(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cloneBorrowedData<T>(value: T, ancestors = new Set<object>()): T {
  if (
    value === null || value === undefined || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) integrityMismatch();
    return value;
  }
  if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) {
    integrityMismatch();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
  const prototype = Object.getPrototypeOf(value);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) integrityMismatch();
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        integrityMismatch();
      }
      const length = lengthDescriptor.value as number;
      if (Object.keys(descriptors).length !== length + 1) integrityMismatch();
      const copy: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          integrityMismatch();
        }
        copy.push(cloneBorrowedData(descriptor.value, ancestors));
      }
      return copy as T;
    }
    if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) {
        integrityMismatch();
      }
      copy[key] = cloneBorrowedData(descriptor.value, ancestors);
    }
    return copy as T;
  } finally {
    ancestors.delete(value);
  }
}

function validAnchor(value: unknown): value is ClaimAnchor {
  return isRecord(value) && exactKeys(value, ["artifactId", "locator", "excerptSha256"]) &&
    nonEmptyString(value.artifactId) && nonEmptyString(value.locator) &&
    typeof value.excerptSha256 === "string" && HEX_64.test(value.excerptSha256);
}

function sameAnchor(left: ClaimAnchor, right: ClaimAnchor): boolean {
  return left.artifactId === right.artifactId && left.locator === right.locator &&
    left.excerptSha256 === right.excerptSha256;
}

function validRequirementScope(value: unknown): value is ParticipantRequirementScopeV2 {
  if (!isRecord(value)) return false;
  if (value.kind === "applicant") return exactKeys(value, ["kind"]);
  return exactKeys(value, ["kind", "relationship"]) && value.kind === "companion" &&
    (value.relationship === "spouse" || value.relationship === "minor_child" ||
      value.relationship === "other_family");
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validV2ClaimValue(kind: ClaimKind, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (kind) {
    case "route_basis":
      return exactKeys(value, ["route", "legalBasis", "effectiveFrom"]) &&
        value.route === "temporary_residence_digital_nomad" &&
        value.legalBasis === "ZTuj-2 Article 51a" && value.effectiveFrom === "2025-11-21";
    case "citizenship_applicability": {
      if (!exactKeys(value, ["classifications"]) || !Array.isArray(value.classifications) ||
        value.classifications.length === 0) return false;
      const countryCodes: string[] = [];
      for (const classification of value.classifications) {
        if (!isRecord(classification) || !exactKeys(classification, ["countryCode", "status"]) ||
          typeof classification.countryCode !== "string" ||
          !ISO_COUNTRY_CODE.test(classification.countryCode) ||
          (classification.status !== "eligible" && classification.status !== "excluded")) {
          return false;
        }
        countryCodes.push(classification.countryCode);
      }
      return uniqueStrings(countryCodes);
    }
    case "remote_work_relations":
      return exactKeys(value, ["allowedRelations", "slovenianLabourMarketWorkIncluded"]) &&
        Array.isArray(value.allowedRelations) && value.allowedRelations.length === 3 &&
        value.allowedRelations[0] === "foreign_employer" &&
        value.allowedRelations[1] === "own_foreign_business" &&
        value.allowedRelations[2] === "foreign_clients" &&
        value.slovenianLabourMarketWorkIncluded === false;
    case "income":
      return exactKeys(value, [
        "metric",
        "multiplier",
        "thresholdEur",
        "currency",
        "basis",
        "appliesTo",
        "period",
      ]) && value.metric === "latest_official_average_monthly_net_salary" &&
        value.multiplier === "2" && typeof value.thresholdEur === "string" &&
        MONEY_TEXT.test(value.thresholdEur) && value.currency === "EUR" &&
        value.basis === "net" && value.appliesTo === "applicant" &&
        typeof value.period === "string" && MONTH_PERIOD.test(value.period);
    case "qualification":
      return exactKeys(value, ["rule"]) &&
        value.rule === "not_listed_in_authoritative_requirements";
    case "companion_entry": {
      if (!exactKeys(value, ["relationshipClassifications"]) ||
        !Array.isArray(value.relationshipClassifications) ||
        value.relationshipClassifications.length === 0) return false;
      const relationships: string[] = [];
      for (const classification of value.relationshipClassifications) {
        if (!isRecord(classification) ||
          !exactKeys(classification, ["relationship", "status"]) ||
          (classification.relationship !== "spouse" &&
            classification.relationship !== "minor_child" &&
            classification.relationship !== "other_family") ||
          (classification.status !== "eligible" && classification.status !== "excluded")) {
          return false;
        }
        relationships.push(classification.relationship);
      }
      return uniqueStrings(relationships);
    }
    case "companion_local_work_access":
      return exactKeys(value, ["access", "labourMarketCheck", "informationSheet"]) &&
        value.access === "conditional" && value.labourMarketCheck === true &&
        value.informationSheet === true;
    case "duration":
      return exactKeys(value, ["maximumMonths", "extendable", "reapplyAfterMonths", "scope"]) &&
        value.maximumMonths === 12 && value.extendable === false &&
        value.reapplyAfterMonths === 6 && validRequirementScope(value.scope);
    case "general_statutory_prerequisites":
      return exactKeys(value, [
        "passportBeyondPermitMonths",
        "healthInsurance",
        "article55GroundsApply",
        "scope",
      ]) && value.passportBeyondPermitMonths === 3 && value.healthInsurance === true &&
        value.article55GroundsApply === true && validRequirementScope(value.scope);
  }
}

function validRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = [
    "method",
    "url",
    ...(own(value, "bodyMediaType") ? ["bodyMediaType"] : []),
    ...(own(value, "bodySha256") ? ["bodySha256"] : []),
  ];
  return exactKeys(value, keys) && (value.method === "GET" || value.method === "POST") &&
    httpUrl(value.url) &&
    (value.bodyMediaType === undefined || value.bodyMediaType === "application/json") &&
    (value.bodySha256 === undefined ||
      (typeof value.bodySha256 === "string" && HEX_64.test(value.bodySha256)));
}

function assertV2EntriesAndArtifacts(evidence: VerifiedCountryEvidenceInputV2): void {
  for (const [index, entry] of evidence.entries.entries()) {
    if (!isRecord(entry)) integrityMismatch();
    const keys = [
      "sourceId",
      "navigationUrl",
      "resolvedEvidenceUrl",
      "artifactIds",
      ...(own(entry, "indexedSourceUrl") ? ["indexedSourceUrl"] : []),
      ...(own(entry, "versionHint") ? ["versionHint"] : []),
    ];
    if (
      !exactKeys(entry, keys) || entry.sourceId !== SLOVENIA_V2_SOURCE_ORDER[index] ||
      !httpUrl(entry.navigationUrl) || !httpUrl(entry.resolvedEvidenceUrl) ||
      (entry.indexedSourceUrl !== undefined && !httpUrl(entry.indexedSourceUrl)) ||
      (entry.versionHint !== undefined && !nonEmptyString(entry.versionHint)) ||
      !Array.isArray(entry.artifactIds) || !entry.artifactIds.every(nonEmptyString) ||
      !uniqueStrings(entry.artifactIds)
    ) integrityMismatch();
  }
  for (const artifact of evidence.artifacts) {
    if (!isRecord(artifact) || !exactKeys(artifact, [
      "artifactId",
      "runId",
      "sourceId",
      "role",
      "request",
      "url",
      "responseUrl",
      "capturedAt",
      "responseStatus",
      "mediaType",
      "origin",
      "byteLength",
      "sha256",
    ]) || !nonEmptyString(artifact.artifactId) || !nonEmptyString(artifact.runId) ||
      !SLOVENIA_V2_SOURCE_ORDER.includes(artifact.sourceId) ||
      !nonEmptyString(artifact.role) || !validRequest(artifact.request) ||
      !httpUrl(artifact.url) || !httpUrl(artifact.responseUrl) ||
      !canonicalInstant(artifact.capturedAt) ||
      !Number.isSafeInteger(artifact.responseStatus) || artifact.responseStatus < 100 ||
      !nonEmptyString(artifact.mediaType) || artifact.origin !== "live" ||
      !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0 ||
      typeof artifact.sha256 !== "string" || !HEX_64.test(artifact.sha256)) {
      integrityMismatch();
    }
  }
}

function evidenceArtifactV2(
  evidence: VerifiedCountryEvidenceInputV2,
  artifactId: string,
): EvidenceArtifactProvenance<SloveniaSourceId> {
  const matches = evidence.artifacts.filter((artifact) => artifact.artifactId === artifactId);
  if (matches.length !== 1) integrityMismatch();
  return matches[0]!;
}

function assertV2Blockers(evidence: VerifiedCountryEvidenceInputV2): void {
  for (const blocker of evidence.snapshot.blockers) {
    if (!isRecord(blocker)) integrityMismatch();
    const keys = [
      "sourceId",
      "kind",
      "navigationUrl",
      "artifactIds",
      ...(own(blocker, "resolvedUrl") ? ["resolvedUrl"] : []),
    ];
    const entry = evidence.entries.find(({ sourceId }) => sourceId === blocker.sourceId);
    if (
      entry === undefined || !exactKeys(blocker, keys) ||
      !SLOVENIA_V2_SOURCE_ORDER.includes(blocker.sourceId) ||
      !BLOCKER_KINDS.includes(blocker.kind as EvidenceBlockerKind) ||
      blocker.navigationUrl !== entry.navigationUrl ||
      (blocker.resolvedUrl !== undefined && blocker.resolvedUrl !== entry.resolvedEvidenceUrl) ||
      !Array.isArray(blocker.artifactIds) || !blocker.artifactIds.every(nonEmptyString) ||
      !uniqueStrings(blocker.artifactIds)
    ) integrityMismatch();
  }
}

function assertV2CountryClaim(
  evidence: VerifiedCountryEvidenceInputV2,
  claim: VerifiedCountryClaimV2,
): void {
  if (!CLAIM_KINDS.includes(claim.claimKind)) integrityMismatch();
  const kind = claim.claimKind;
  const expectedSource = SLOVENIA_V2_CLAIM_SOURCE[kind];
  if (!exactKeys(claim, [
    "claimId",
    "claimKind",
    "sourceId",
    "value",
    "scope",
    "sourcePeriod",
    "anchor",
    "status",
    "evidence",
    "validatorVersion",
  ]) || claim.sourceId !== expectedSource || claim.status !== "verified" ||
    claim.scope !== SLOVENIA_V2_RESEARCH_SCOPE ||
    claim.validatorVersion !== SLOVENIA_V2_CLAIM_VALIDATOR[kind] ||
    !validV2ClaimValue(kind, claim.value) ||
    claim.claimId !== sloveniaV2ClaimId(kind, claim.value) ||
    !nonEmptyString(claim.sourcePeriod) ||
    (kind === "income" &&
      (claim.value as ClaimValueByKindV2["income"]).period !== claim.sourcePeriod) ||
    !validAnchor(claim.anchor) || !Array.isArray(claim.evidence) || claim.evidence.length === 0) {
    integrityMismatch();
  }
  const entry = evidence.entries.find(({ sourceId }) => sourceId === expectedSource)!;
  for (const reference of claim.evidence) {
    if (!isRecord(reference) || !exactKeys(reference, [
      "sourceId",
      "artifactId",
      "navigationUrl",
      "resolvedEvidenceUrl",
      "sourcePeriod",
      "anchor",
    ]) || reference.sourceId !== expectedSource ||
      reference.sourcePeriod !== claim.sourcePeriod || !validAnchor(reference.anchor) ||
      reference.anchor.artifactId !== reference.artifactId ||
      !entry.artifactIds.includes(reference.artifactId)) integrityMismatch();
    const artifact = evidenceArtifactV2(evidence, reference.artifactId);
    if (artifact.sourceId !== expectedSource ||
      reference.navigationUrl !== artifact.request.url ||
      reference.resolvedEvidenceUrl !== artifact.responseUrl) integrityMismatch();
  }
  if (!sameAnchor(claim.anchor, claim.evidence.at(-1)!.anchor)) integrityMismatch();
}

function assertV2CbrClaim(
  evidence: VerifiedCountryEvidenceInputV2,
  claim: ColdStartEvidenceClaimV2,
): void {
  if (!isRecord(claim)) integrityMismatch();
  const value: unknown = claim.value;
  if (!exactKeys(claim, [
    "claimId",
    "sourceId",
    "value",
    "scope",
    "sourcePeriod",
    "anchor",
    "status",
  ]) || claim.sourceId !== "cbr-eur" || claim.scope !== SLOVENIA_V2_RESEARCH_SCOPE ||
    claim.status !== "verified" || !/^cbr-eur-facts-[1-9]\d*$/.test(claim.claimId) ||
    !validAnchor(claim.anchor) || !isRecord(value) || !exactKeys(value, [
      "base",
      "quote",
      "nominal",
      "rate",
      "effectiveDate",
    ]) || value.base !== "EUR" || value.quote !== "RUB" ||
    value.nominal !== "1" || typeof value.rate !== "string" ||
    !DECIMAL_TEXT.test(value.rate) || !Number.isFinite(Number(value.rate)) ||
    Number(value.rate) <= 0 || typeof value.effectiveDate !== "string" ||
    !DAY_PERIOD.test(value.effectiveDate) ||
    claim.sourcePeriod !== value.effectiveDate) integrityMismatch();
  const entry = evidence.entries.find(({ sourceId }) => sourceId === "cbr-eur")!;
  const artifact = evidenceArtifactV2(evidence, claim.anchor.artifactId);
  if (artifact.sourceId !== "cbr-eur" || !entry.artifactIds.includes(artifact.artifactId)) {
    integrityMismatch();
  }
}

function assertEvidenceV2(value: unknown): asserts value is VerifiedCountryEvidenceInputV2 {
  if (!isRecord(value) || !exactKeys(value, ["snapshot", "entries", "artifacts"]) ||
    !isRecord(value.snapshot) || !Array.isArray(value.entries) || !Array.isArray(value.artifacts)) {
    integrityMismatch();
  }
  const evidence = value as unknown as VerifiedCountryEvidenceInputV2;
  const snapshot = {
    id: evidence.snapshot.id,
    assessmentDate: evidence.snapshot.assessmentDate,
    artifactIds: evidence.snapshot.artifactIds,
    claims: evidence.snapshot.claims,
    blockers: evidence.snapshot.blockers,
    coverage: evidence.snapshot.coverage,
    parserVersions: evidence.snapshot.parserVersions,
    rulesVersion: evidence.snapshot.rulesVersion,
    ...(evidence.snapshot.contextHash === undefined
      ? {}
      : { contextHash: evidence.snapshot.contextHash }),
    ...(evidence.snapshot.knowledgeBaselineRevisionId === undefined
      ? {}
      : {
          knowledgeBaselineRevisionId:
            evidence.snapshot.knowledgeBaselineRevisionId,
        }),
  };
  const manifest: EvidenceManifest<SloveniaSourceId, ColdStartEvidenceClaimV2> = {
    snapshot,
    entries: evidence.entries,
    artifacts: evidence.artifacts,
  };
  assertSealedEvidenceStructure({ snapshot: evidence.snapshot, manifest }, SLOVENIA_V2_SOURCE_ORDER);
  if (
    evidence.snapshot.rulesVersion !== SLOVENIA_V2_EVIDENCE_RULES_VERSION ||
    !canonicalDay(evidence.snapshot.assessmentDate) || !nonEmptyString(evidence.snapshot.id) ||
    typeof evidence.snapshot.manifestHash !== "string" ||
    !HEX_64.test(evidence.snapshot.manifestHash) || typeof evidence.snapshot.hmac !== "string" ||
    !HEX_64.test(evidence.snapshot.hmac) ||
    !exactKeys(evidence.snapshot.parserVersions, SLOVENIA_V2_SOURCE_ORDER) ||
    SLOVENIA_V2_SOURCE_ORDER.some((sourceId) =>
      evidence.snapshot.parserVersions[sourceId] !== SLOVENIA_V2_PARSER_VERSIONS[sourceId]
    )
  ) integrityMismatch();
  assertV2EntriesAndArtifacts(evidence);
  assertV2Blockers(evidence);
  const countryClaims: VerifiedCountryClaimV2[] = [];
  const cbrClaims: ColdStartEvidenceClaimV2[] = [];
  for (const claim of evidence.snapshot.claims) {
    if (isRecord(claim) && own(claim, "claimKind")) {
      assertV2CountryClaim(evidence, claim as VerifiedCountryClaimV2);
      countryClaims.push(claim as VerifiedCountryClaimV2);
    } else {
      assertV2CbrClaim(evidence, claim);
      cbrClaims.push(claim);
    }
  }
  const identities = countryClaims.map((claim) =>
    sloveniaV2ClaimIdentity(claim.claimKind, claim.value)
  );
  const expectedCbrCount = evidence.snapshot.coverage["cbr-eur"] === "verified" ? 1 : 0;
  if (new Set(identities).size !== identities.length || cbrClaims.length !== expectedCbrCount) {
    integrityMismatch();
  }
}

function copyFormalReference(reference: FormalKnowledgeReference): FormalKnowledgeReference {
  return {
    claimId: reference.claimId,
    claimKind: reference.claimKind,
    definitionId: reference.definitionId,
    evidenceSnapshotId: reference.evidenceSnapshotId,
  };
}

function copyStatusObservation(observation: KnowledgeStatusObservation): KnowledgeStatusObservation {
  return {
    kind: "source_status",
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    status: observation.status,
    affectedClaimKinds: [...observation.affectedClaimKinds],
    ...(observation.supersedesObservationId === undefined
      ? {}
      : { supersedesObservationId: observation.supersedesObservationId }),
    evidenceSnapshotId: observation.evidenceSnapshotId,
    artifactIds: [...observation.artifactIds],
    definitionId: observation.definitionId,
    capturedAt: observation.capturedAt,
    ...(observation.publishedAt === undefined ? {} : { publishedAt: observation.publishedAt }),
    ...(observation.referencePeriod === undefined
      ? {}
      : { referencePeriod: observation.referencePeriod }),
    ...(observation.effectiveFrom === undefined
      ? {}
      : { effectiveFrom: observation.effectiveFrom }),
    ...(observation.effectiveTo === undefined ? {} : { effectiveTo: observation.effectiveTo }),
    verifiedAt: observation.verifiedAt,
  };
}

export function buildSloveniaKnowledgeRevisionV2(input: {
  readonly evidence: VerifiedCountryEvidenceInputV2;
  readonly predecessor?: SloveniaCountryKnowledgeRevision;
  readonly createdAt: string;
}): SloveniaCountryKnowledgeRevision | undefined {
  let owned: typeof input;
  try {
    owned = cloneBorrowedData(input);
    const keys = [
      "evidence",
      "createdAt",
      ...(own(owned, "predecessor") ? ["predecessor"] : []),
    ];
    if (!exactKeys(owned, keys)) integrityMismatch();
    assertEvidenceV2(owned.evidence);
    if (owned.predecessor !== undefined) assertPredecessor(owned.predecessor);
  } catch {
    integrityMismatch();
  }

  const countryClaims = owned.evidence.snapshot.claims.filter(
    (claim): claim is VerifiedCountryClaimV2 => isRecord(claim) && own(claim, "claimKind"),
  );
  const relevantBlockers = owned.evidence.snapshot.blockers.filter(
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
  if (!canonicalInstant(owned.createdAt)) throw new Error("invalid_created_at");

  const references = new Map<ClaimKind, FormalKnowledgeReference>(
    owned.predecessor?.formalClaimRefs.map((reference) => [
      reference.claimKind,
      copyFormalReference(reference),
    ]) ?? [],
  );
  let observations = owned.predecessor?.statusObservations.map(copyStatusObservation) ?? [];
  const replacedKinds = new Set(countryClaims.map(({ claimKind }) => claimKind));
  observations = removeKindsFromStatuses(observations, replacedKinds);
  for (const claimKind of replacedKinds) references.delete(claimKind);
  for (const claim of countryClaims) {
    if (sloveniaV2ClaimScopeToken(claim.claimKind, claim.value) !== undefined) continue;
    references.set(claim.claimKind, {
      claimId: claim.claimId,
      claimKind: claim.claimKind,
      definitionId: claim.validatorVersion,
      evidenceSnapshotId: owned.evidence.snapshot.id,
    });
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
      observationId: `${owned.evidence.snapshot.id}:${blocker.sourceId}:${status}`,
      sourceId: blocker.sourceId,
      status,
      affectedClaimKinds,
      ...(superseded === undefined
        ? {}
        : { supersedesObservationId: superseded.observationId }),
      evidenceSnapshotId: owned.evidence.snapshot.id,
      artifactIds: [...blocker.artifactIds],
      definitionId: owned.evidence.snapshot.parserVersions[blocker.sourceId],
      capturedAt: latestCapturedAt(owned.evidence, blocker.artifactIds),
      verifiedAt: owned.evidence.snapshot.assessmentDate,
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
    id: `country-knowledge:SI:${owned.evidence.snapshot.id}`,
    countryCode: "SI",
    ...(owned.predecessor === undefined ? {} : { predecessorId: owned.predecessor.id }),
    triggerEvidenceSnapshotId: owned.evidence.snapshot.id,
    formalClaimRefs,
    statusObservations,
    createdAt: owned.createdAt,
  });
}
