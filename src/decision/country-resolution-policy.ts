import type {
  FormalEvidenceReference,
  FormalMarker,
  FormalResidenceVerdict,
} from "./formal-residence-verdict";

export const COUNTRY_RESOLUTION_RULES_VERSION = "country-resolution@1" as const;
export const YELLOW_RISK_WARNING_VERSION = "yellow-risk@1" as const;

export type YellowDecisionKind = "accepted_at_own_risk" | "rejected";
export type EffectiveCountryStatus = "green" | "yellow" | "red";
export type CountryResolutionPhase = "awaiting_decision" | "replacement_required";
export type ResolutionStopCondition = "five_effective_green" | "ranking_exhausted";

export interface YellowUncertaintyReason {
  readonly code: string;
  readonly claimIds: readonly string[];
  readonly evidence: readonly FormalEvidenceReference[];
  readonly navigation: readonly { readonly sourceId: string; readonly url: string; readonly label: string }[];
}

export interface YellowUncertaintyBasis {
  readonly unknownRoutes: readonly {
    readonly routeId: string;
    readonly reasons: readonly YellowUncertaintyReason[];
  }[];
  readonly catalogCompletenessUnprovable?: YellowUncertaintyReason;
}

export interface ResolutionMarkerProjection {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalStatus: FormalMarker;
  readonly formalMarkerDigest: string;
  readonly expectedUncertaintyBasis?: YellowUncertaintyBasis;
}

export interface YellowDecision {
  readonly countryCode: string;
  readonly decision: YellowDecisionKind;
  readonly formalMarkerDigest: string;
  readonly uncertaintyBasis: YellowUncertaintyBasis;
  readonly warningCopyVersion: "yellow-risk@1";
  readonly decidedAt: string;
  readonly commandId: string;
}

export interface CountryResolutionProjection {
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly resolvedCountryCodes: readonly string[];
  readonly nextUncheckedRank: number;
  readonly currentPromptCountryCode?: string;
  readonly phase?: CountryResolutionPhase;
  readonly terminal?: {
    readonly resolvedEntries: readonly {
      readonly countryCode: string;
      readonly rank: number;
      readonly formalMarkerDigest: string;
    }[];
    readonly stopCondition: ResolutionStopCondition;
  };
}

export interface CountryResolutionSemanticState {
  readonly kind: "working" | "resolved";
  readonly decisions: readonly YellowDecision[];
  readonly markerProjections: readonly ResolutionMarkerProjection[];
  readonly nextUncheckedRank: number;
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly resolvedEntries: readonly {
    readonly countryCode: string;
    readonly rank: number;
    readonly formalMarkerDigest: string;
  }[];
  readonly phase?: CountryResolutionPhase;
  readonly stopCondition?: ResolutionStopCondition;
}

const SLOT_LIMIT = 5;

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
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

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function hasSameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function copyUncertaintyReason(reason: {
  readonly code: string;
  readonly claimIds: readonly string[];
  readonly evidence: readonly FormalEvidenceReference[];
  readonly navigation: readonly { readonly sourceId: string; readonly url: string; readonly label: string }[];
}): YellowUncertaintyReason {
  return {
    code: reason.code,
    claimIds: [...reason.claimIds],
    evidence: reason.evidence.map((reference) => ({ ...reference })),
    navigation: reason.navigation.map((navigation) => ({ ...navigation })),
  };
}

export function deriveYellowUncertaintyBasis(
  verdict: FormalResidenceVerdict,
): YellowUncertaintyBasis {
  const unknownRoutes = verdict.routeOutcomes
    .filter((route) => route.status === "unknown")
    .map((route) => ({
      routeId: route.routeId,
      reasons: route.reasons.map(copyUncertaintyReason),
    }));
  const catalogCompleteness = verdict.catalogCompleteness;
  const catalogReason = catalogCompleteness.status === "unproven"
    ? verdict.reasons.find(({ code }) => code === catalogCompleteness.reasonCode)
    : undefined;

  return immutableCopy({
    unknownRoutes,
    ...(catalogCompleteness.status === "unproven"
      ? {
          catalogCompletenessUnprovable: catalogReason === undefined
            ? {
                code: catalogCompleteness.reasonCode,
                claimIds: [],
                evidence: [],
                navigation: [],
              }
            : copyUncertaintyReason(catalogReason),
        }
      : {}),
  });
}

export function effectiveCountryStatus(
  formalStatus: FormalMarker,
  decision?: YellowDecisionKind,
): EffectiveCountryStatus {
  if (formalStatus === "green") return "green";
  if (formalStatus === "red") return "red";
  if (decision === "accepted_at_own_risk") return "green";
  if (decision === "rejected") return "red";
  return "yellow";
}

function assertStringArray(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) integrityMismatch();
}

function assertUncertaintyReason(value: unknown): asserts value is YellowUncertaintyReason {
  if (!isRecord(value) || !hasExactKeys(value, ["code", "claimIds", "evidence", "navigation"]) ||
    !isNonEmptyString(value.code)) integrityMismatch();
  assertStringArray(value.claimIds);
  if (!Array.isArray(value.evidence) || !Array.isArray(value.navigation)) integrityMismatch();
  for (const reference of value.evidence) {
    if (!isRecord(reference) || !hasExactKeys(reference, [
      "evidenceSnapshotId", "artifactId", "sourceId", "navigationUrl", "resolvedEvidenceUrl",
      "sourcePeriod", "locator", "excerptSha256", "validatorVersion",
    ]) || !Object.values(reference).every(isNonEmptyString)) integrityMismatch();
  }
  for (const navigation of value.navigation) {
    if (!isRecord(navigation) || !hasExactKeys(navigation, ["sourceId", "url", "label"]) ||
      !Object.values(navigation).every(isNonEmptyString)) integrityMismatch();
  }
}

function assertUncertaintyBasis(value: unknown): asserts value is YellowUncertaintyBasis {
  if (!isRecord(value) || !Array.isArray(value.unknownRoutes) ||
    !hasExactKeys(value, [
      "unknownRoutes",
      ...(value.catalogCompletenessUnprovable === undefined ? [] : ["catalogCompletenessUnprovable"]),
    ])) integrityMismatch();
  for (const route of value.unknownRoutes) {
    if (!isRecord(route) || !hasExactKeys(route, ["routeId", "reasons"]) ||
      !isNonEmptyString(route.routeId) || !Array.isArray(route.reasons)) integrityMismatch();
    route.reasons.forEach(assertUncertaintyReason);
  }
  if (value.catalogCompletenessUnprovable !== undefined) {
    assertUncertaintyReason(value.catalogCompletenessUnprovable);
  }
  if (value.unknownRoutes.length === 0 && value.catalogCompletenessUnprovable === undefined) {
    integrityMismatch();
  }
}

function assertOrderedCountryCodes(orderedCountryCodes: unknown): asserts orderedCountryCodes is readonly string[] {
  assertStringArray(orderedCountryCodes);
  if (new Set(orderedCountryCodes).size !== orderedCountryCodes.length) integrityMismatch();
}

function assertMarkerProjections(
  orderedCountryCodes: readonly string[],
  markers: unknown,
): asserts markers is readonly ResolutionMarkerProjection[] {
  if (!Array.isArray(markers)) integrityMismatch();
  for (const [index, marker] of markers.entries()) {
    if (!isRecord(marker) || !hasExactKeys(marker, [
      "countryCode", "rank", "formalStatus", "formalMarkerDigest",
      ...(marker.expectedUncertaintyBasis === undefined ? [] : ["expectedUncertaintyBasis"]),
    ]) || !isNonEmptyString(marker.countryCode) || marker.rank !== index + 1 ||
      marker.countryCode !== orderedCountryCodes[index] || !isNonEmptyString(marker.formalMarkerDigest) ||
      (marker.formalStatus !== "green" && marker.formalStatus !== "yellow" && marker.formalStatus !== "red")) {
      integrityMismatch();
    }
    if (marker.formalStatus === "yellow") {
      if (marker.expectedUncertaintyBasis === undefined) integrityMismatch();
      assertUncertaintyBasis(marker.expectedUncertaintyBasis);
    } else if (marker.expectedUncertaintyBasis !== undefined) {
      integrityMismatch();
    }
  }
}

function assertDecisions(
  markers: readonly ResolutionMarkerProjection[],
  decisions: unknown,
): asserts decisions is readonly YellowDecision[] {
  if (!Array.isArray(decisions)) integrityMismatch();
  const markerByCountry = new Map(markers.map((marker) => [marker.countryCode, marker]));
  const countries = new Set<string>();
  const commandIds = new Set<string>();
  for (const decision of decisions) {
    if (!isRecord(decision) || !hasExactKeys(decision, [
      "countryCode", "decision", "formalMarkerDigest", "uncertaintyBasis", "warningCopyVersion",
      "decidedAt", "commandId",
    ]) || !isNonEmptyString(decision.countryCode) || !isNonEmptyString(decision.formalMarkerDigest) ||
      !isNonEmptyString(decision.commandId) || !isCanonicalInstant(decision.decidedAt) ||
      decision.warningCopyVersion !== YELLOW_RISK_WARNING_VERSION ||
      (decision.decision !== "accepted_at_own_risk" && decision.decision !== "rejected") ||
      countries.has(decision.countryCode) || commandIds.has(decision.commandId)) integrityMismatch();
    const marker = markerByCountry.get(decision.countryCode);
    if (marker?.formalStatus !== "yellow" || marker.formalMarkerDigest !== decision.formalMarkerDigest ||
      marker.expectedUncertaintyBasis === undefined) integrityMismatch();
    assertUncertaintyBasis(decision.uncertaintyBasis);
    if (!hasSameCanonicalValue(decision.uncertaintyBasis, marker.expectedUncertaintyBasis)) {
      integrityMismatch();
    }
    countries.add(decision.countryCode);
    commandIds.add(decision.commandId);
  }
}

function resolveProjection(
  orderedCountryCodes: readonly string[],
  markers: readonly ResolutionMarkerProjection[],
  decisions: readonly YellowDecision[],
): CountryResolutionProjection {
  const decisionByCountry = new Map(decisions.map((decision) => [decision.countryCode, decision]));
  const unresolvedCountryCodes = markers
    .filter((marker) => marker.formalStatus === "yellow" && !decisionByCountry.has(marker.countryCode))
    .map((marker) => marker.countryCode);
  const slotMarkers = markers.filter((marker) =>
    effectiveCountryStatus(marker.formalStatus, decisionByCountry.get(marker.countryCode)?.decision) !== "red");
  if (slotMarkers.length > SLOT_LIMIT) integrityMismatch();
  const resolvedMarkers = markers.filter((marker) =>
    effectiveCountryStatus(marker.formalStatus, decisionByCountry.get(marker.countryCode)?.decision) === "green");
  const nextUncheckedRank = markers.length + 1;
  const isExhausted = nextUncheckedRank === orderedCountryCodes.length + 1;

  if (slotMarkers.length < SLOT_LIMIT && !isExhausted) {
    return {
      unresolvedCountryCodes,
      slotCountryCodes: slotMarkers.map((marker) => marker.countryCode),
      resolvedCountryCodes: resolvedMarkers.map((marker) => marker.countryCode),
      nextUncheckedRank,
      phase: "replacement_required",
    };
  }
  if (unresolvedCountryCodes.length > 0) {
    return {
      unresolvedCountryCodes,
      slotCountryCodes: slotMarkers.map((marker) => marker.countryCode),
      resolvedCountryCodes: resolvedMarkers.map((marker) => marker.countryCode),
      nextUncheckedRank,
      currentPromptCountryCode: unresolvedCountryCodes[0],
      phase: "awaiting_decision",
    };
  }
  return {
    unresolvedCountryCodes: [],
    slotCountryCodes: slotMarkers.map((marker) => marker.countryCode),
    resolvedCountryCodes: resolvedMarkers.map((marker) => marker.countryCode),
    nextUncheckedRank,
    terminal: {
      resolvedEntries: resolvedMarkers.map((marker) => ({
        countryCode: marker.countryCode,
        rank: marker.rank,
        formalMarkerDigest: marker.formalMarkerDigest,
      })),
      stopCondition: slotMarkers.length === SLOT_LIMIT ? "five_effective_green" : "ranking_exhausted",
    },
  };
}

export function reconstructCountryResolution(input: {
  readonly orderedCountryCodes: readonly string[];
  readonly markers: readonly ResolutionMarkerProjection[];
  readonly decisions: readonly YellowDecision[];
  readonly persisted?: Pick<CountryResolutionProjection,
    "unresolvedCountryCodes" | "slotCountryCodes" | "resolvedCountryCodes" |
    "nextUncheckedRank" | "currentPromptCountryCode" | "phase" | "terminal">;
}): CountryResolutionProjection {
  assertOrderedCountryCodes(input.orderedCountryCodes);
  assertMarkerProjections(input.orderedCountryCodes, input.markers);
  assertDecisions(input.markers, input.decisions);
  const projection = resolveProjection(input.orderedCountryCodes, input.markers, input.decisions);
  if (input.persisted !== undefined && !hasSameCanonicalValue(projection, input.persisted)) {
    integrityMismatch();
  }
  return immutableCopy(projection);
}

function assertSemanticState(
  state: CountryResolutionSemanticState,
  orderedCountryCodes: readonly string[],
): void {
  if (!isRecord(state) || !hasExactKeys(state, [
    "kind", "decisions", "markerProjections", "nextUncheckedRank", "unresolvedCountryCodes",
    "slotCountryCodes", "resolvedEntries", ...(state.phase === undefined ? [] : ["phase"]),
    ...(state.stopCondition === undefined ? [] : ["stopCondition"]),
  ]) || (state.kind !== "working" && state.kind !== "resolved")) integrityMismatch();
  const projection = reconstructCountryResolution({
    orderedCountryCodes,
    markers: state.markerProjections,
    decisions: state.decisions,
  });
  if (state.kind === "working") {
    if (projection.terminal !== undefined || state.phase !== projection.phase ||
      state.stopCondition !== undefined || state.resolvedEntries.length !== 0 ||
      !hasSameCanonicalValue(state.unresolvedCountryCodes, projection.unresolvedCountryCodes) ||
      !hasSameCanonicalValue(state.slotCountryCodes, projection.slotCountryCodes) ||
      state.nextUncheckedRank !== projection.nextUncheckedRank) integrityMismatch();
    return;
  }
  if (projection.terminal === undefined || state.phase !== undefined ||
    state.stopCondition !== projection.terminal.stopCondition ||
    !hasSameCanonicalValue(state.resolvedEntries, projection.terminal.resolvedEntries) ||
    !hasSameCanonicalValue(state.unresolvedCountryCodes, projection.unresolvedCountryCodes) ||
    !hasSameCanonicalValue(state.slotCountryCodes, projection.slotCountryCodes) ||
    state.nextUncheckedRank !== projection.nextUncheckedRank) integrityMismatch();
}

function isOneAppendedEntry<T>(
  predecessor: readonly T[],
  successor: readonly T[],
): boolean {
  return successor.length === predecessor.length + 1 &&
    predecessor.every((entry, index) => hasSameCanonicalValue(entry, successor[index]));
}

export function assertCountryResolutionTransition(input: {
  readonly predecessor?: CountryResolutionSemanticState;
  readonly successor: CountryResolutionSemanticState;
  readonly orderedCountryCodes: readonly string[];
}): void {
  assertSemanticState(input.successor, input.orderedCountryCodes);
  if (input.predecessor === undefined) return;
  assertSemanticState(input.predecessor, input.orderedCountryCodes);
  if (input.predecessor.kind === "resolved") integrityMismatch();
  const addedDecision = isOneAppendedEntry(input.predecessor.decisions, input.successor.decisions) &&
    hasSameCanonicalValue(input.predecessor.markerProjections, input.successor.markerProjections);
  const addedMarker = isOneAppendedEntry(
    input.predecessor.markerProjections,
    input.successor.markerProjections,
  ) && hasSameCanonicalValue(input.predecessor.decisions, input.successor.decisions);
  if (addedDecision) {
    const appendedDecision = input.successor.decisions[input.predecessor.decisions.length];
    if (input.predecessor.phase !== "awaiting_decision" ||
      appendedDecision?.countryCode !== input.predecessor.unresolvedCountryCodes[0]) {
      integrityMismatch();
    }
    return;
  }
  if (addedMarker) {
    if (input.predecessor.phase !== "replacement_required") integrityMismatch();
    return;
  }
  integrityMismatch();
}
