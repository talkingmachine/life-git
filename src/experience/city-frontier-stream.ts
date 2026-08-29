import { z } from "zod";

import type {
  CityFrontierEvent,
  CityFrontierReadModel,
  CityFrontierRevision,
} from "../application/city-frontier-contracts";
import {
  cancelStreamWithoutMasking,
  createFiniteStreamHandoff,
  readFiniteNdjson,
  type FiniteStreamHandoff,
} from "./finite-ndjson";

const nonEmptyString = z.string().min(1);
const lowercaseDigest = z.string().regex(/^[a-f0-9]{64}$/);
const countryCode = z.string().regex(/^[A-Z]{2}$/);
const canonicalDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const instant = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
});
const webUrl = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
});
const canonicalHttpsUrl = z.string().refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" && url.toString() === value; } catch { return false; }
});
const positiveInteger = z.number().int().positive();
const contentIdentifier = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
const criterionId = z.enum([
  "safety",
  "long_term_rent",
  "urban_transit",
  "fixed_broadband",
]);
const unknownReason = z.enum([
  "not_found",
  "stale",
  "conflict",
  "not_comparable",
  "source_unavailable",
]);
const rankingUnknownReason = z.enum([
  "not_found",
  "stale",
  "conflict",
  "not_comparable",
  "source_unavailable",
  "no_knowledge_revision",
]);

const canonicalScalarBasis = z.object({
  kind: z.literal("canonical_scalar"),
  value: nonEmptyString,
}).strict();
const municipalSafetyBasis = z.object({
  kind: z.literal("municipal_safety"),
  quantity: z.object({
    offenceCount: z.string().regex(/^(?:0|[1-9]\d*)$/),
    population: z.string().regex(/^[1-9]\d*$/),
    rateBasis: z.literal("offences_per_100000_residents"),
  }).strict(),
}).strict();
const verifiedBasis = z.discriminatedUnion("kind", [
  canonicalScalarBasis,
  municipalSafetyBasis,
]);
const factOutcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("verified"), basis: verifiedBasis }).strict(),
  z.object({ kind: z.literal("unknown"), reason: unknownReason }).strict(),
]);
const rejectionReason = z.enum([
  "http_not_found",
  "transport_unavailable",
  "authority_untrusted",
  "stale",
  "scope_mismatch",
  "definition_mismatch",
  "missing_numerator",
  "denominator_missing",
  "denominator_zero",
  "denominator_period_mismatch",
  "denominator_scope_mismatch",
  "wrong_media_type",
  "too_large",
  "untrusted_redirect",
  "retention_unapproved",
  "conflict",
]);
const acceptedFactLink = z.object({
  sourceId: nonEmptyString,
  disposition: z.literal("accepted"),
  navigationUrl: webUrl,
  resolvedEvidenceUrl: webUrl,
  referenceYear: positiveInteger.optional(),
}).strict();
const reviewedFactLink = z.object({
  sourceId: nonEmptyString,
  disposition: z.literal("reviewed_rejected"),
  navigationUrl: webUrl,
  resolvedEvidenceUrl: webUrl.optional(),
  referenceYear: positiveInteger.optional(),
  rejectionReason: rejectionReason.optional(),
}).strict();
const committedFact = z.object({
  criterionId,
  definitionId: nonEmptyString,
  geoScope: nonEmptyString,
  referencePeriod: nonEmptyString.nullable(),
  freshnessBasis: nonEmptyString,
  unit: nonEmptyString,
  denominator: nonEmptyString,
  outcome: factOutcome,
  evidenceLinks: z.array(acceptedFactLink),
  manualCheckLinks: z.array(reviewedFactLink),
}).strict();
const committedFacts = z.tuple([
  committedFact,
  committedFact,
  committedFact,
  committedFact,
]);
const requiredMismatch = z.object({
  criterionId,
  definitionId: nonEmptyString,
  target: nonEmptyString,
  verifiedBasis,
  evaluatorVersion: nonEmptyString,
}).strict();
const unknownWarning = z.object({
  criterionId,
  definitionId: nonEmptyString,
  reason: unknownReason,
}).strict();
const marker = z.object({
  cityId: nonEmptyString,
  rank: positiveInteger,
  status: z.enum(["selectable", "excluded"]),
  visualStatus: z.enum(["green", "yellow", "red"]),
  knowledgeRevisionId: nonEmptyString,
  evidenceSnapshotId: nonEmptyString,
  lastCheckedAt: instant,
  requiredMismatches: z.array(requiredMismatch),
  unknownBasis: z.array(unknownWarning),
  verificationCoverage: canonicalDecimal,
  facts: committedFacts,
}).strict();

const coordinate = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
}).strict();
const registryEntry = z.object({
  cityId: nonEmptyString,
  countryCode,
  officialName: nonEmptyString,
  coordinate,
  administrativeType: nonEmptyString,
  administrativeTerritory: nonEmptyString,
  capitalRoles: z.array(z.enum(["national", "regional"])),
  evidenceReferenceIds: z.array(nonEmptyString),
}).strict();
const registry = z.object({
  schemaVersion: z.literal("city-registry@1"),
  id: nonEmptyString,
  packageId: nonEmptyString,
  packageSchemaVersion: nonEmptyString,
  countryCode,
  evidenceSnapshotId: nonEmptyString,
  entries: z.array(registryEntry),
  createdAt: instant,
}).strict();
const populationBasis = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verified"),
    value: canonicalDecimal,
    referencePeriod: nonEmptyString,
  }).strict(),
  z.object({
    kind: z.literal("unknown"),
    reason: z.enum(["not_found", "not_comparable"]),
  }).strict(),
]);
const catalog = z.object({
  schemaVersion: z.literal("city-catalog@1"),
  id: nonEmptyString,
  packageId: nonEmptyString,
  packageSchemaVersion: nonEmptyString,
  countryCode,
  registryRevisionId: nonEmptyString,
  evidenceSnapshotId: nonEmptyString,
  populationDefinition: z.object({
    definitionId: nonEmptyString,
    geoScope: nonEmptyString,
    unit: z.literal("people"),
  }).strict(),
  candidateBasis: z.array(z.object({
    cityId: nonEmptyString,
    comparablePopulation: populationBasis,
  }).strict()),
  members: z.array(z.object({
    cityId: nonEmptyString,
    inclusionReasons: z.array(z.enum([
      "population_threshold",
      "national_capital",
      "regional_capital",
      "top_ten_fill",
      "population_fill",
    ])),
  }).strict()),
  coverage: z.discriminatedUnion("status", [
    z.object({ status: z.literal("complete") }).strict(),
    z.object({
      status: z.literal("incomplete"),
      reasons: z.array(z.enum(["missing_population", "official_universe_partial"])),
    }).strict(),
  ]),
  rulesVersion: z.enum(["city-catalog@1", "city-catalog@2"]),
  createdAt: instant,
}).strict();

const criterion = z.object({
  criterionId,
  definitionId: nonEmptyString,
  mode: z.enum(["required", "weighted"]),
  importance: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  target: nonEmptyString,
}).strict();
const criteria = z.object({
  schemaVersion: z.literal("city-criteria@1"),
  id: nonEmptyString,
  profileSnapshotId: nonEmptyString,
  preferenceProfileSnapshotId: nonEmptyString,
  criteria: z.tuple([criterion, criterion, criterion, criterion]),
  rulesVersion: z.literal("city-criteria@1"),
  confirmedAt: instant,
}).strict();
const rankingFactor = z.object({
  criterionId,
  definitionId: nonEmptyString,
  mode: z.enum(["required", "weighted"]),
  importance: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  evaluatorVersion: nonEmptyString,
  freshnessPolicyVersion: nonEmptyString,
  state: z.enum(["verified", "unknown"]),
  factor: canonicalDecimal,
  weightedContribution: canonicalDecimal,
  targetComparison: z.enum(["matches", "does_not_match", "unknown"]),
  requiredMismatch: z.boolean(),
  unknownReason: rankingUnknownReason.optional(),
}).strict();
const rankingFactors = z.tuple([
  rankingFactor,
  rankingFactor,
  rankingFactor,
  rankingFactor,
]);
const ranking = z.object({
  schemaVersion: z.literal("city-ranking@1"),
  id: nonEmptyString,
  runId: nonEmptyString,
  resolvedCountryShortlistRevisionId: nonEmptyString,
  countryCode,
  packageId: nonEmptyString,
  packageSchemaVersion: nonEmptyString,
  preCityBranchCommitId: nonEmptyString,
  profileSnapshotId: nonEmptyString,
  preferenceProfileSnapshotId: nonEmptyString,
  registryRevisionId: nonEmptyString,
  catalogRevisionId: nonEmptyString,
  installedPackageContext: z.object({
    countryCode,
    packageId: nonEmptyString,
    packageSchemaVersion: nonEmptyString,
    catalogRevisionId: nonEmptyString,
    evidenceRulesVersion: nonEmptyString,
  }).strict(),
  criteriaSnapshotId: nonEmptyString,
  assessmentAt: instant,
  knowledgeRevisionIds: z.record(nonEmptyString, nonEmptyString.nullable()),
  ordered: z.array(z.object({
    cityId: nonEmptyString,
    rank: positiveInteger,
    score: canonicalDecimal,
    coverage: canonicalDecimal,
    knowledgeRevisionId: nonEmptyString.nullable(),
    factors: rankingFactors,
  }).strict()),
  screenedExclusions: z.array(z.object({
    cityId: nonEmptyString,
    score: canonicalDecimal,
    coverage: canonicalDecimal,
    knowledgeRevisionId: nonEmptyString.nullable(),
    requiredMismatches: z.array(requiredMismatch),
    factors: rankingFactors,
  }).strict()),
  rulesVersion: z.literal("city-ranker@1"),
  verificationBudget: z.object({
    liveCityCandidateLimit: z.literal(10),
    targetSelectableCities: z.literal(3),
    rulesVersion: z.literal("city-frontier-budget@1"),
  }).strict(),
  createdAt: instant,
}).strict();

const operation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    commandId: nonEmptyString,
    criteriaPayloadHash: nonEmptyString,
  }).strict(),
  z.object({
    kind: z.literal("city_completed"),
    commandId: nonEmptyString,
    expectedHeadRevisionId: nonEmptyString,
    cityId: nonEmptyString,
    cityCheckRunId: nonEmptyString,
  }).strict(),
]);
const revisionBase = {
  schemaVersion: z.literal("city-frontier@1"),
  id: nonEmptyString,
  runId: nonEmptyString,
  predecessorRevisionId: nonEmptyString.optional(),
  rankingSnapshotId: nonEmptyString,
  markers: z.array(marker),
  nextUncheckedRank: positiveInteger,
  operation,
  createdAt: instant,
};
const revision = z.discriminatedUnion("kind", [
  z.object({
    ...revisionBase,
    kind: z.literal("working"),
    phase: z.literal("verification_required"),
  }).strict(),
  z.object({
    ...revisionBase,
    kind: z.literal("terminal"),
    entries: z.array(z.object({
      cityId: nonEmptyString,
      rank: positiveInteger,
      markerDigest: lowercaseDigest,
      knowledgeRevisionId: nonEmptyString,
      evidenceSnapshotId: nonEmptyString,
      unknownBasis: z.array(unknownWarning),
    }).strict()),
    stopCondition: z.enum([
      "three_selectable",
      "catalog_exhausted",
      "live_candidate_limit_reached",
    ]),
  }).strict(),
]);
const selectionSnapshotBase = {
  schemaVersion: z.literal("city-selection@1"),
  id: contentIdentifier("city-selection"),
  commandId: nonEmptyString,
  runId: nonEmptyString,
  terminalRevisionId: nonEmptyString,
  cityId: nonEmptyString,
  countryCode,
  profileSnapshotId: nonEmptyString,
  preferenceProfileSnapshotId: nonEmptyString,
  resolvedCountryShortlistRevisionId: nonEmptyString,
  criteriaSnapshotId: nonEmptyString,
  rankingSnapshotId: nonEmptyString,
  preCityBranchCommitId: nonEmptyString,
  selectedMarkerDigest: lowercaseDigest,
  knowledgeRevisionId: nonEmptyString,
  evidenceSnapshotId: nonEmptyString,
  unknownBasis: z.array(unknownWarning),
  createdAt: instant,
};
const selectionSnapshot = z.union([
  z.object(selectionSnapshotBase).strict(),
  z.object({
    ...selectionSnapshotBase,
    warningCopyVersion: z.literal("city-unknown-risk@1"),
  }).strict(),
]);
const cityBranchCommit = z.object({
  schemaVersion: z.literal("city-branch@1"),
  id: contentIdentifier("city-branch"),
  parentId: contentIdentifier("pre-city-branch"),
  forkedFrom: contentIdentifier("pre-city-branch"),
  citySelectionSnapshotId: contentIdentifier("city-selection"),
  cityId: nonEmptyString,
  countryCode,
  createdAt: instant,
}).strict();
const selectionWithBranch = z.object({
  selection: selectionSnapshot,
  commit: cityBranchCommit,
}).strict();
const readModel = z.object({
  runId: nonEmptyString,
  assessmentAt: instant,
  resolvedCountryShortlistRevisionId: nonEmptyString,
  countryCode,
  preCityBranchCommitId: nonEmptyString,
  registry,
  catalog,
  criteria,
  ranking,
  revision,
  selections: z.array(selectionWithBranch),
}).strict();

const eventBase = {
  runId: nonEmptyString,
  baseRevisionId: nonEmptyString,
  sequence: positiveInteger,
  occurredAt: instant,
};
const publicFactSource = z.object({
  schemaVersion: z.literal("public-fact-source@1"),
  factKey: z.literal("si-city-safety"),
  status: z.enum(["green", "red", "yellow"]),
  publisherName: z.string().min(1).nullable(),
  sourceUrl: canonicalHttpsUrl.nullable(),
  checkedAt: instant.nullable(),
}).strict().superRefine((value, context) => {
  const allNull = value.publisherName === null && value.sourceUrl === null && value.checkedAt === null;
  const allPresent = value.publisherName !== null && value.sourceUrl !== null && value.checkedAt !== null;
  if (value.status === "yellow" ? !allNull : !allPresent) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_public_fact_source" });
  }
});
const activatedEvent = z.object({
  ...eventBase,
  type: z.literal("city_activated"),
  cityId: nonEmptyString,
  rank: positiveInteger,
}).strict();
const progressWithoutUrl = z.object({
  ...eventBase,
  type: z.literal("city_progress"),
  cityId: nonEmptyString,
  stage: z.enum([
    "source_started:si-city-safety",
    "source_started:si-city-long-term-rent",
    "source_started:si-city-urban-transit",
    "source_started:si-city-fixed-broadband",
    "evidence_verified",
    "knowledge_published",
  ]),
}).strict();
const safetyCompletedProgress = z.object({
  ...eventBase,
  type: z.literal("city_progress"),
  cityId: nonEmptyString,
  stage: z.literal("source_completed:si-city-safety"),
  sourceUrl: webUrl.optional(),
}).strict();
const completedProgress = z.object({
  ...eventBase,
  type: z.literal("city_progress"),
  cityId: nonEmptyString,
  stage: z.enum([
    "source_completed:si-city-long-term-rent",
    "source_completed:si-city-urban-transit",
    "source_completed:si-city-fixed-broadband",
  ]),
  sourceUrl: webUrl,
}).strict();
const committedEvent = z.object({
  ...eventBase,
  type: z.literal("city_revision_committed"),
  marker,
  revision,
}).strict();
const completionEvent = z.object({
  ...eventBase,
  type: z.literal("city_continuation_completed"),
  readModel,
}).strict();
const recoveryStartedEvent = z.object({ ...eventBase, type: z.literal("source_recovery_started"), cityId: nonEmptyString }).strict();
const recoveryYellowEvent = z.object({
  ...eventBase, type: z.literal("source_recovery_yellow"), cityId: nonEmptyString,
  reason: z.literal("official_source_unavailable"), source: publicFactSource,
}).strict().refine(({ source }) => source.status === "yellow", "invalid_yellow_source");
const replacementEvent = z.object({
  ...eventBase, type: z.literal("official_source_replaced"), cityId: nonEmptyString, source: publicFactSource,
}).strict().refine(({ source }) => source.status !== "yellow", "invalid_replacement_source");
const event = z.union([
  activatedEvent,
  progressWithoutUrl,
  safetyCompletedProgress,
  completedProgress,
  recoveryStartedEvent,
  recoveryYellowEvent,
  replacementEvent,
  committedEvent,
  completionEvent,
]);

export interface CityFrontierStreamResponse {
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly stream: ReadableStream<Uint8Array>;
}

export type CityFrontierStreamHandoff = FiniteStreamHandoff;

function freezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(copy);
  return copy;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function factLinksAreConsistent(fact: z.infer<typeof committedFact>): boolean {
  if (fact.criterionId === "safety") {
    const acceptedAreValid = fact.evidenceLinks.every((link) =>
      fact.outcome.kind === "verified" && fact.referencePeriod !== null &&
      /^\d+$/.test(fact.referencePeriod) &&
      link.referenceYear === Number(fact.referencePeriod));
    const reviewedAreValid = fact.manualCheckLinks.every((link) =>
      link.rejectionReason !== undefined);
    return acceptedAreValid && reviewedAreValid;
  }
  return fact.manualCheckLinks.every((link) =>
    link.rejectionReason === undefined && link.referenceYear === undefined);
}

function assertMarker(markerValue: z.infer<typeof marker>, model: z.infer<typeof readModel>): void {
  const ranked = model.ranking.ordered[markerValue.rank - 1];
  const expectedCriterionIds = model.criteria.criteria.map(({ criterionId: id }) => id);
  const expectedUnknownBasis = markerValue.facts.flatMap((fact) =>
    fact.outcome.kind === "unknown"
      ? [{
          criterionId: fact.criterionId,
          definitionId: fact.definitionId,
          reason: fact.outcome.reason,
        }]
      : []);
  const expectedVisualStatus = markerValue.status === "excluded"
    ? "red"
    : expectedUnknownBasis.length === 0 ? "green" : "yellow";
  if (ranked?.cityId !== markerValue.cityId ||
    markerValue.facts.some((fact, index) =>
      fact.criterionId !== expectedCriterionIds[index] ||
      fact.definitionId !== model.criteria.criteria[index]?.definitionId ||
      !factLinksAreConsistent(fact)) ||
    !unique(markerValue.unknownBasis.map(({ criterionId: id }) => id)) ||
    !unique(markerValue.requiredMismatches.map(({ criterionId: id }) => id)) ||
    (markerValue.status === "selectable" && markerValue.requiredMismatches.length !== 0) ||
    (markerValue.status === "excluded" && markerValue.requiredMismatches.length === 0) ||
    !sameValue(markerValue.unknownBasis, expectedUnknownBasis) ||
    markerValue.visualStatus !== expectedVisualStatus) {
    throw new Error("invalid_city_marker");
  }
}

function assertRevision(
  revisionValue: z.infer<typeof revision>,
  model: z.infer<typeof readModel>,
): void {
  if (revisionValue.runId !== model.runId ||
    revisionValue.rankingSnapshotId !== model.ranking.id ||
    revisionValue.nextUncheckedRank !== revisionValue.markers.length + 1 ||
    !unique(revisionValue.markers.map(({ cityId }) => cityId))) {
    throw new Error("invalid_city_revision");
  }
  for (const [index, markerValue] of revisionValue.markers.entries()) {
    if (markerValue.rank !== index + 1 ||
      model.ranking.ordered[index]?.cityId !== markerValue.cityId) {
      throw new Error("invalid_city_marker_order");
    }
    assertMarker(markerValue, model);
  }
  const selectable = revisionValue.markers.filter(({ status }) => status === "selectable");
  if (revisionValue.markers.length > 10 || selectable.length > 3) {
    throw new Error("invalid_city_revision_budget");
  }
  const expected = selectable.length === 3
    ? { kind: "terminal" as const, stopCondition: "three_selectable" as const }
    : revisionValue.markers.length === model.ranking.ordered.length
      ? { kind: "terminal" as const, stopCondition: "catalog_exhausted" as const }
      : revisionValue.markers.length === 10
        ? { kind: "terminal" as const, stopCondition: "live_candidate_limit_reached" as const }
        : { kind: "working" as const };
  if (revisionValue.kind !== expected.kind) throw new Error("invalid_city_revision_state");
  if (revisionValue.kind === "working") return;
  if (revisionValue.stopCondition !== expected.stopCondition ||
    revisionValue.entries.length !== selectable.length ||
    revisionValue.entries.some((entry, index) => {
      const source = selectable[index];
      return source === undefined || entry.cityId !== source.cityId || entry.rank !== source.rank ||
        entry.knowledgeRevisionId !== source.knowledgeRevisionId ||
        entry.evidenceSnapshotId !== source.evidenceSnapshotId ||
        !sameValue(entry.unknownBasis, source.unknownBasis);
    })) {
    throw new Error("invalid_city_terminal_revision");
  }
}

function assertSelectionHistory(model: z.infer<typeof readModel>): void {
  if (model.selections.length === 0) return;
  if (model.revision.kind !== "terminal") throw new Error("invalid_city_selection_history");
  if (!unique(model.selections.map(({ selection }) => selection.id)) ||
    !unique(model.selections.map(({ selection }) => selection.commandId)) ||
    !unique(model.selections.map(({ commit }) => commit.id))) {
    throw new Error("invalid_city_selection_history");
  }

  for (const { selection, commit } of model.selections) {
    const markers = model.revision.markers.filter(({ cityId }) => cityId === selection.cityId);
    const entries = model.revision.entries.filter(({ cityId }) => cityId === selection.cityId);
    const markerValue = markers[0];
    const entry = entries[0];
    const registryCity = model.registry.entries.find(({ cityId }) => cityId === selection.cityId);
    const warningCopyVersion = "warningCopyVersion" in selection
      ? selection.warningCopyVersion
      : undefined;
    const warningIsValid = markerValue?.visualStatus === "green"
      ? warningCopyVersion === undefined
      : markerValue?.visualStatus === "yellow" &&
        warningCopyVersion === "city-unknown-risk@1";
    if (markers.length !== 1 || entries.length !== 1 || markerValue === undefined ||
      entry === undefined || markerValue.status !== "selectable" || !warningIsValid ||
      registryCity?.countryCode !== model.countryCode ||
      selection.runId !== model.runId ||
      selection.terminalRevisionId !== model.revision.id ||
      selection.countryCode !== model.countryCode ||
      selection.profileSnapshotId !== model.ranking.profileSnapshotId ||
      selection.preferenceProfileSnapshotId !== model.ranking.preferenceProfileSnapshotId ||
      selection.resolvedCountryShortlistRevisionId !==
        model.ranking.resolvedCountryShortlistRevisionId ||
      selection.criteriaSnapshotId !== model.ranking.criteriaSnapshotId ||
      selection.rankingSnapshotId !== model.ranking.id ||
      selection.preCityBranchCommitId !== model.ranking.preCityBranchCommitId ||
      selection.selectedMarkerDigest !== entry.markerDigest ||
      selection.knowledgeRevisionId !== markerValue.knowledgeRevisionId ||
      selection.knowledgeRevisionId !== entry.knowledgeRevisionId ||
      selection.evidenceSnapshotId !== markerValue.evidenceSnapshotId ||
      selection.evidenceSnapshotId !== entry.evidenceSnapshotId ||
      !sameValue(selection.unknownBasis, markerValue.unknownBasis) ||
      !sameValue(selection.unknownBasis, entry.unknownBasis) ||
      selection.createdAt < model.revision.createdAt ||
      commit.parentId !== model.ranking.preCityBranchCommitId ||
      commit.forkedFrom !== model.ranking.preCityBranchCommitId ||
      commit.citySelectionSnapshotId !== selection.id ||
      commit.cityId !== selection.cityId || commit.countryCode !== selection.countryCode ||
      commit.createdAt !== selection.createdAt) {
      throw new Error("invalid_city_selection_history");
    }
  }
}

export function normalizeCityFrontierReadModel(value: unknown): CityFrontierReadModel {
  const parsed = readModel.parse(value);
  const orderedIds = parsed.ranking.ordered.map(({ cityId }) => cityId);
  const excludedIds = parsed.ranking.screenedExclusions.map(({ cityId }) => cityId);
  const registryIds = parsed.registry.entries.map(({ cityId }) => cityId);
  const catalogIds = parsed.catalog.members.map(({ cityId }) => cityId);
  const criteriaIds = parsed.criteria.criteria.map(({ criterionId: id }) => id);
  if (parsed.runId !== parsed.ranking.runId ||
    parsed.assessmentAt !== parsed.ranking.assessmentAt ||
    parsed.resolvedCountryShortlistRevisionId !==
      parsed.ranking.resolvedCountryShortlistRevisionId ||
    parsed.countryCode !== parsed.registry.countryCode ||
    parsed.countryCode !== parsed.catalog.countryCode ||
    parsed.countryCode !== parsed.ranking.countryCode ||
    parsed.registry.entries.some(({ countryCode: entryCountryCode }) =>
      entryCountryCode !== parsed.countryCode) ||
    parsed.preCityBranchCommitId !== parsed.ranking.preCityBranchCommitId ||
    parsed.registry.id !== parsed.catalog.registryRevisionId ||
    parsed.registry.id !== parsed.ranking.registryRevisionId ||
    parsed.catalog.id !== parsed.ranking.catalogRevisionId ||
    parsed.criteria.id !== parsed.ranking.criteriaSnapshotId ||
    parsed.registry.packageId !== parsed.catalog.packageId ||
    parsed.registry.packageId !== parsed.ranking.packageId ||
    parsed.registry.packageSchemaVersion !== parsed.catalog.packageSchemaVersion ||
    parsed.registry.packageSchemaVersion !== parsed.ranking.packageSchemaVersion ||
    parsed.ranking.installedPackageContext.countryCode !== parsed.countryCode ||
    parsed.ranking.installedPackageContext.packageId !== parsed.ranking.packageId ||
    parsed.ranking.installedPackageContext.packageSchemaVersion !==
      parsed.ranking.packageSchemaVersion ||
    parsed.ranking.installedPackageContext.catalogRevisionId !== parsed.catalog.id ||
    !unique(registryIds) || !unique(catalogIds) || !unique(orderedIds) ||
    !unique(excludedIds) || orderedIds.some((cityId) => excludedIds.includes(cityId)) ||
    catalogIds.some((cityId) => !registryIds.includes(cityId)) ||
    [...orderedIds, ...excludedIds].some((cityId) => !catalogIds.includes(cityId)) ||
    catalogIds.some((cityId) =>
      !orderedIds.includes(cityId) && !excludedIds.includes(cityId)) ||
    parsed.ranking.ordered.some(({ rank }, index) => rank !== index + 1) ||
    Object.keys(parsed.ranking.knowledgeRevisionIds).length !== catalogIds.length ||
    catalogIds.some((cityId) => !(cityId in parsed.ranking.knowledgeRevisionIds)) ||
    !sameValue(criteriaIds, [
      "safety", "long_term_rent", "urban_transit", "fixed_broadband",
    ])) {
    throw new Error("invalid_city_read_model");
  }
  assertRevision(parsed.revision, parsed);
  assertSelectionHistory(parsed);
  return freezeCopy(parsed) as unknown as CityFrontierReadModel;
}

function normalizeRevision(
  value: unknown,
  model: CityFrontierReadModel,
): CityFrontierRevision {
  const parsed = revision.parse(value);
  const envelope = readModel.parse({ ...model, revision: parsed });
  assertRevision(parsed, envelope);
  return freezeCopy(parsed) as unknown as CityFrontierRevision;
}

function normalizeEvent(value: unknown): CityFrontierEvent {
  return freezeCopy(event.parse(value)) as unknown as CityFrontierEvent;
}

export interface CityFrontierEventState {
  readonly runId: string;
  readonly baseRevisionId: string;
  readonly lastSequence: number;
  readonly active?: { readonly cityId: string; readonly rank: number };
  readonly progress?: readonly CityFrontierEvent[];
  readonly committedRevisionId?: string;
  readonly terminal?: CityFrontierReadModel;
  readonly currentSource?: import("../application/city-frontier-contracts").PublicFactSourceV1;
  readonly sourceReplaced?: boolean;
  readonly recoveryStarted?: boolean;
  readonly yellowSource?: import("../application/city-frontier-contracts").PublicFactSourceV1;
}

export function initialCityFrontierEventState(
  readModelValue: CityFrontierReadModel,
): CityFrontierEventState {
  const normalized = normalizeCityFrontierReadModel(readModelValue);
  return freezeCopy({
    runId: normalized.runId,
    baseRevisionId: normalized.revision.id,
    lastSequence: 0,
  });
}

export function reduceCityFrontierEvent(
  state: CityFrontierEventState,
  rawEvent: CityFrontierEvent,
  predecessorReadModel: CityFrontierReadModel,
): CityFrontierEventState {
  const predecessorModel = normalizeCityFrontierReadModel(predecessorReadModel);
  const parsedEvent = normalizeEvent(rawEvent);
  if (state.terminal !== undefined || state.yellowSource !== undefined) throw new Error("event_after_continuation_completion");
  if (state.runId !== predecessorModel.runId || parsedEvent.runId !== state.runId) {
    throw new Error("changed_city_frontier_run_id");
  }
  if (parsedEvent.baseRevisionId !== state.baseRevisionId) {
    throw new Error("changed_city_frontier_base_revision_id");
  }
  if (parsedEvent.sequence !== state.lastSequence + 1) throw new Error("invalid_event_sequence");
  if (predecessorModel.revision.kind === "terminal" &&
    parsedEvent.type !== "city_continuation_completed") {
    throw new Error("event_after_terminal_city_revision");
  }
  if (state.committedRevisionId !== undefined &&
    parsedEvent.type !== "city_continuation_completed") {
    throw new Error("event_after_city_revision_commit");
  }

  if (parsedEvent.type === "city_activated") {
    const ranked = predecessorModel.ranking.ordered[
      predecessorModel.revision.nextUncheckedRank - 1
    ];
    if (state.active !== undefined || ranked === undefined ||
      parsedEvent.cityId !== ranked.cityId || parsedEvent.rank !== ranked.rank) {
      throw new Error("invalid_city_activation");
    }
    return freezeCopy({
      runId: state.runId,
      baseRevisionId: state.baseRevisionId,
      lastSequence: parsedEvent.sequence,
      active: { cityId: parsedEvent.cityId, rank: parsedEvent.rank },
      ...(state.progress === undefined ? {} : { progress: state.progress }),
      ...(state.currentSource === undefined ? {} : { currentSource: state.currentSource }),
      ...(state.sourceReplaced === undefined ? {} : { sourceReplaced: state.sourceReplaced }),
      ...(state.recoveryStarted === undefined ? {} : { recoveryStarted: state.recoveryStarted }),
    });
  }

  if (parsedEvent.type === "city_progress") {
    if (state.active?.cityId !== parsedEvent.cityId || state.progress?.some((progressEvent) =>
      progressEvent.type === "city_progress" && progressEvent.stage === parsedEvent.stage)) {
      throw new Error("invalid_city_progress");
    }
    return freezeCopy({
      runId: state.runId,
      baseRevisionId: state.baseRevisionId,
      lastSequence: parsedEvent.sequence,
      active: state.active,
      progress: [...(state.progress ?? []), parsedEvent],
      ...(state.currentSource === undefined ? {} : { currentSource: state.currentSource }),
      ...(state.sourceReplaced === undefined ? {} : { sourceReplaced: state.sourceReplaced }),
      ...(state.recoveryStarted === undefined ? {} : { recoveryStarted: state.recoveryStarted }),
    });
  }

  if (parsedEvent.type === "source_recovery_started") {
    if (state.active?.cityId !== parsedEvent.cityId || state.recoveryStarted === true) {
      throw new Error("invalid_source_recovery_start");
    }
    return freezeCopy({ ...state, lastSequence: parsedEvent.sequence, recoveryStarted: true });
  }

  if (parsedEvent.type === "official_source_replaced") {
    if (state.active?.cityId !== parsedEvent.cityId || state.recoveryStarted !== true ||
      state.sourceReplaced === true) {
      throw new Error("invalid_source_replacement");
    }
    return freezeCopy({ ...state, lastSequence: parsedEvent.sequence, active: state.active,
      ...(state.progress === undefined ? {} : { progress: state.progress }),
      recoveryStarted: true, currentSource: parsedEvent.source, sourceReplaced: true });
  }

  if (parsedEvent.type === "source_recovery_yellow") {
    if (state.active?.cityId !== parsedEvent.cityId || state.recoveryStarted !== true ||
      state.sourceReplaced === true) {
      throw new Error("invalid_source_recovery_yellow");
    }
    return freezeCopy({ ...state, lastSequence: parsedEvent.sequence, active: state.active,
      ...(state.progress === undefined ? {} : { progress: state.progress }),
      recoveryStarted: true, currentSource: parsedEvent.source, yellowSource: parsedEvent.source });
  }

  if (parsedEvent.type === "city_revision_committed") {
    const predecessor = predecessorModel.revision;
    const successor = normalizeRevision(parsedEvent.revision, predecessorModel);
    const historicalPrefixMatches = successor.markers.length === predecessor.markers.length + 1 &&
      predecessor.markers.every((historical, index) =>
        sameValue(historical, successor.markers[index]));
    if (state.active === undefined || parsedEvent.marker.cityId !== state.active.cityId ||
      parsedEvent.marker.rank !== state.active.rank ||
      !sameValue(successor.markers.at(-1), parsedEvent.marker) ||
      !historicalPrefixMatches || successor.predecessorRevisionId !== predecessor.id ||
      successor.id === predecessor.id ||
      successor.operation.kind !== "city_completed" ||
      successor.operation.expectedHeadRevisionId !== predecessor.id ||
      successor.operation.cityId !== state.active.cityId) {
      throw new Error("invalid_city_commit");
    }
    return freezeCopy({
      runId: state.runId,
      baseRevisionId: state.baseRevisionId,
      lastSequence: parsedEvent.sequence,
      ...(state.progress === undefined ? {} : { progress: state.progress }),
      committedRevisionId: successor.id,
      ...(state.currentSource === undefined ? {} : { currentSource: state.currentSource }),
      ...(state.sourceReplaced === undefined ? {} : { sourceReplaced: state.sourceReplaced }),
      ...(state.recoveryStarted === undefined ? {} : { recoveryStarted: state.recoveryStarted }),
    });
  }

  const completedReadModel = normalizeCityFrontierReadModel(parsedEvent.readModel);
  if (state.active !== undefined || !sameValue(completedReadModel, predecessorModel)) {
    throw new Error("invalid_city_continuation_completion");
  }
  return freezeCopy({
    runId: state.runId,
    baseRevisionId: state.baseRevisionId,
    lastSequence: parsedEvent.sequence,
    ...(state.progress === undefined ? {} : { progress: state.progress }),
    ...(state.committedRevisionId === undefined
      ? {}
      : { committedRevisionId: state.committedRevisionId }),
    ...(state.currentSource === undefined ? {} : { currentSource: state.currentSource }),
    ...(state.sourceReplaced === undefined ? {} : { sourceReplaced: state.sourceReplaced }),
    terminal: completedReadModel,
  });
}

function exactHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (value === null || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid_${name}`);
  return value;
}

export function createCityFrontierStreamHandoff(
  stream: ReadableStream<Uint8Array>,
): CityFrontierStreamHandoff {
  return createFiniteStreamHandoff(stream);
}

export function openCityFrontierStreamResponse(
  response: Response,
  expected?: { readonly runId: string; readonly baseRevisionId: string },
): CityFrontierStreamResponse {
  try {
    if (!response.ok) throw new Error("city_frontier_request_failed");
    if (response.headers.get("content-type") !== "application/x-ndjson; charset=utf-8") {
      throw new Error("invalid_city_frontier_content_type");
    }
    const runId = exactHeader(response, "x-life-run-id");
    const baseRevisionId = exactHeader(response, "x-life-base-revision-id");
    if (expected !== undefined &&
      (runId !== expected.runId || baseRevisionId !== expected.baseRevisionId)) {
      throw new Error("changed_city_frontier_identity");
    }
    if (response.body === null) throw new Error("missing_city_frontier_body");
    return Object.freeze({ runId, baseRevisionId, stream: response.body });
  } catch (validationError) {
    if (response.body !== null) {
      cancelStreamWithoutMasking(response.body, validationError);
    }
    throw validationError;
  }
}

export async function* decodeCityFrontierStream(
  stream: ReadableStream<Uint8Array>,
  initialReadModel: CityFrontierReadModel,
  signal?: AbortSignal,
): AsyncGenerator<CityFrontierEvent> {
  let currentReadModel = normalizeCityFrontierReadModel(initialReadModel);
  if (currentReadModel.revision.kind !== "working") {
    throw new Error("terminal_city_frontier_cannot_continue");
  }
  let state = initialCityFrontierEventState(currentReadModel);
  let pendingCompletion: CityFrontierEvent | undefined;

  for await (const value of readFiniteNdjson(stream, signal)) {
    const parsedEvent = normalizeEvent(value);
    if (pendingCompletion !== undefined) throw new Error("event_after_continuation_completion");
    state = reduceCityFrontierEvent(state, parsedEvent, currentReadModel);
    if (parsedEvent.type === "city_revision_committed") {
      currentReadModel = normalizeCityFrontierReadModel({
        ...currentReadModel,
        revision: parsedEvent.revision,
      });
      yield parsedEvent;
      continue;
    }
    if (parsedEvent.type === "city_continuation_completed") {
      pendingCompletion = freezeCopy({
        ...parsedEvent,
        readModel: state.terminal!,
      }) as CityFrontierEvent;
      continue;
    }
    yield parsedEvent;
  }

  if (pendingCompletion !== undefined) {
    yield pendingCompletion;
    return;
  }
  if (state.yellowSource === undefined) throw new Error("missing_city_continuation_completion");
}
