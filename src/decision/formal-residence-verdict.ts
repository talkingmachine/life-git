export type FormalMarker = "green" | "yellow" | "red";

export interface FormalEvidenceReference {
  readonly evidenceSnapshotId: string;
  readonly artifactId: string;
  readonly sourceId: string;
  readonly navigationUrl: string;
  readonly resolvedEvidenceUrl: string;
  readonly sourcePeriod: string;
  readonly locator: string;
  readonly excerptSha256: string;
  readonly validatorVersion: string;
}

export interface FormalReason {
  readonly code: string;
  readonly summary: string;
  readonly claimIds: readonly string[];
  readonly evidence: readonly FormalEvidenceReference[];
  readonly navigation: readonly {
    readonly sourceId: string;
    readonly url: string;
    readonly label: string;
  }[];
}

interface ResidenceRouteOutcomeBase {
  readonly routeId: string;
  readonly reasons: readonly FormalReason[];
  readonly evidenceSnapshotIds: readonly string[];
  readonly proceduralActions: readonly {
    readonly kind: "insurance" | "registration" | "document_submission";
    readonly completed: false;
  }[];
  readonly contingentActions: readonly {
    readonly kind: "job_offer" | "admission";
    readonly eligibility: "verified";
    readonly acquired: false;
  }[];
}

export type ResidenceRouteOutcome =
  | (ResidenceRouteOutcomeBase & {
      readonly status: "viable" | "impossible";
      readonly ruleEffectiveFrom: string;
      readonly ruleEffectiveTo?: string;
      readonly evidenceSnapshotIds: readonly [string, ...string[]];
    })
  | (ResidenceRouteOutcomeBase & {
      readonly status: "unknown";
      readonly ruleEffectiveFrom?: string;
      readonly ruleEffectiveTo?: string;
    });

export type CatalogRouteCoverage =
  | {
      readonly routeId: string;
      readonly applicability: "applicable";
      readonly evidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
    }
  | {
      readonly routeId: string;
      readonly applicability: "excluded";
      readonly exclusionCode: string;
      readonly claimIds: readonly [string, ...string[]];
      readonly evidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
    };

export interface CatalogCompletenessAttestation {
  readonly catalogRevisionId: string;
  readonly jurisdiction: string;
  readonly authority: string;
  readonly scopeKind: "all_long_term_residence_routes_for_profile";
  readonly profileSnapshotId: string;
  readonly catalogRoutes: readonly [CatalogRouteCoverage, ...CatalogRouteCoverage[]];
  readonly validatorVersion: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly evidenceSnapshotId: string;
  readonly catalogEvidence: readonly [FormalEvidenceReference, ...FormalEvidenceReference[]];
}

export interface FormalResidenceVerdict {
  readonly rulesVersion: "formal-residence@1";
  readonly marker: FormalMarker;
  readonly verdictAsOf: string;
  readonly routeOutcomes: readonly ResidenceRouteOutcome[];
  readonly reasons: readonly FormalReason[];
  readonly catalogCompleteness:
    | {
        readonly status: "verified";
        readonly attestation: CatalogCompletenessAttestation;
      }
    | {
        readonly status: "unproven";
        readonly reasonCode: "catalog_completeness_unprovable";
      };
}

interface FormalResidenceInput {
  readonly profileSnapshotId: string;
  readonly verdictAsOf: string;
  readonly routes: readonly ResidenceRouteOutcome[];
  readonly completeness?: CatalogCompletenessAttestation;
}

const RULES_VERSION = "formal-residence@1" as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isCanonicalDay(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)
  ) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isCurrentInterval(
  effectiveFrom: unknown,
  effectiveTo: unknown,
  verdictAsOf: string,
): boolean {
  return isCanonicalDay(effectiveFrom) &&
    (effectiveTo === undefined || isCanonicalDay(effectiveTo)) &&
    effectiveFrom <= verdictAsOf &&
    (effectiveTo === undefined || verdictAsOf <= effectiveTo) &&
    (effectiveTo === undefined || effectiveFrom <= effectiveTo);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasUniqueNonEmptyStrings(values: readonly string[]): boolean {
  return values.every(isNonEmpty) && new Set(values).size === values.length;
}

function isSealedEvidenceReference(
  reference: FormalEvidenceReference,
  evidenceSnapshotId?: string,
): boolean {
  return hasExactKeys(reference, [
    "evidenceSnapshotId",
    "artifactId",
    "sourceId",
    "navigationUrl",
    "resolvedEvidenceUrl",
    "sourcePeriod",
    "locator",
    "excerptSha256",
    "validatorVersion",
  ]) &&
    isNonEmpty(reference.evidenceSnapshotId) &&
    (evidenceSnapshotId === undefined || reference.evidenceSnapshotId === evidenceSnapshotId) &&
    isNonEmpty(reference.artifactId) &&
    isNonEmpty(reference.sourceId) &&
    isHttpUrl(reference.navigationUrl) &&
    isHttpUrl(reference.resolvedEvidenceUrl) &&
    isNonEmpty(reference.sourcePeriod) &&
    isNonEmpty(reference.locator) &&
    /^[a-f0-9]{64}$/.test(reference.excerptSha256) &&
    isNonEmpty(reference.validatorVersion);
}

function routeEvidence(route: ResidenceRouteOutcome): readonly FormalEvidenceReference[] {
  return route.reasons.flatMap(({ evidence }) => evidence);
}

function hasDeterminingProof(reason: FormalReason): boolean {
  return isNonEmpty(reason.code) &&
    isNonEmpty(reason.summary) &&
    reason.claimIds.length > 0 &&
    hasUniqueNonEmptyStrings(reason.claimIds) &&
    reason.evidence.length > 0 &&
    reason.evidence.every((reference) => isSealedEvidenceReference(reference));
}

function hasCurrentVerifiedRouteProof(
  route: ResidenceRouteOutcome,
  verdictAsOf: string,
): boolean {
  if (route.status === "unknown") return true;
  const references = routeEvidence(route);
  const referencedSnapshotIds = [...new Set(
    references.map(({ evidenceSnapshotId }) => evidenceSnapshotId),
  )];
  return isNonEmpty(route.routeId) &&
    isCurrentInterval(route.ruleEffectiveFrom, route.ruleEffectiveTo, verdictAsOf) &&
    route.evidenceSnapshotIds.length > 0 &&
    hasUniqueNonEmptyStrings(route.evidenceSnapshotIds) &&
    route.reasons.length > 0 &&
    route.reasons.every(hasDeterminingProof) &&
    references.length > 0 &&
    references.every((reference) => isSealedEvidenceReference(reference)) &&
    referencedSnapshotIds.length === route.evidenceSnapshotIds.length &&
    referencedSnapshotIds.every((snapshotId) => route.evidenceSnapshotIds.includes(snapshotId));
}

function copyReference(reference: FormalEvidenceReference): FormalEvidenceReference {
  return { ...reference };
}

function copyReason(reason: FormalReason): FormalReason {
  return {
    ...reason,
    claimIds: [...reason.claimIds],
    evidence: reason.evidence.map(copyReference),
    navigation: reason.navigation.map((navigation) => ({ ...navigation })),
  };
}

function copyRoute(route: ResidenceRouteOutcome): ResidenceRouteOutcome {
  const copy = {
    ...route,
    reasons: route.reasons.map(copyReason),
    proceduralActions: route.proceduralActions.map((action) => ({ ...action })),
    contingentActions: route.contingentActions.map((action) => ({ ...action })),
  };
  return route.status === "unknown"
    ? { ...copy, status: route.status, evidenceSnapshotIds: [...route.evidenceSnapshotIds] }
    : {
        ...copy,
        status: route.status,
        ruleEffectiveFrom: route.ruleEffectiveFrom,
        ...(route.ruleEffectiveTo === undefined
          ? {}
          : { ruleEffectiveTo: route.ruleEffectiveTo }),
        evidenceSnapshotIds: [...route.evidenceSnapshotIds] as [string, ...string[]],
      };
}

function normalizeRoutes(
  routes: readonly ResidenceRouteOutcome[],
  verdictAsOf: string,
): readonly ResidenceRouteOutcome[] {
  const routeCounts = new Map<string, number>();
  for (const route of routes) {
    routeCounts.set(route.routeId, (routeCounts.get(route.routeId) ?? 0) + 1);
  }
  return routes.map((route) => {
    const copied = copyRoute(route);
    if (
      routeCounts.get(route.routeId) === 1 &&
      hasCurrentVerifiedRouteProof(copied, verdictAsOf)
    ) return copied;
    return { ...copied, status: "unknown" };
  });
}

function copyCompleteness(
  completeness: CatalogCompletenessAttestation,
): CatalogCompletenessAttestation {
  return {
    ...completeness,
    catalogRoutes: completeness.catalogRoutes.map((coverage) => coverage.applicability === "applicable"
      ? { ...coverage, evidence: coverage.evidence.map(copyReference) }
      : {
          ...coverage,
          claimIds: [...coverage.claimIds],
          evidence: coverage.evidence.map(copyReference),
        }) as unknown as CatalogCompletenessAttestation["catalogRoutes"],
    catalogEvidence: completeness.catalogEvidence.map(copyReference) as
      unknown as CatalogCompletenessAttestation["catalogEvidence"],
  };
}

function isCatalogCoverageValid(
  coverage: CatalogRouteCoverage,
  evidenceSnapshotId: string,
): boolean {
  if (
    !isNonEmpty(coverage.routeId) ||
    !Array.isArray(coverage.evidence) ||
    coverage.evidence.length === 0 ||
    !coverage.evidence.every((reference) =>
      isSealedEvidenceReference(reference, evidenceSnapshotId)
    )
  ) return false;
  if (coverage.applicability === "applicable") {
    return hasExactKeys(coverage, ["routeId", "applicability", "evidence"]);
  }
  return coverage.applicability === "excluded" &&
    hasExactKeys(coverage, [
      "routeId",
      "applicability",
      "exclusionCode",
      "claimIds",
      "evidence",
    ]) &&
    isNonEmpty(coverage.exclusionCode) &&
    Array.isArray(coverage.claimIds) &&
    coverage.claimIds.length > 0 &&
    hasUniqueNonEmptyStrings(coverage.claimIds);
}

function isCurrentExactCompleteness(
  input: FormalResidenceInput,
  routes: readonly ResidenceRouteOutcome[],
): input is FormalResidenceInput & { readonly completeness: CatalogCompletenessAttestation } {
  const completeness = input.completeness;
  if (
    completeness === undefined ||
    !hasExactKeys(completeness, [
      "catalogRevisionId",
      "jurisdiction",
      "authority",
      "scopeKind",
      "profileSnapshotId",
      "catalogRoutes",
      "validatorVersion",
      "effectiveFrom",
      ...(completeness.effectiveTo === undefined ? [] : ["effectiveTo"]),
      "evidenceSnapshotId",
      "catalogEvidence",
    ]) ||
    !isNonEmpty(completeness.catalogRevisionId) ||
    !isNonEmpty(completeness.jurisdiction) ||
    !isNonEmpty(completeness.authority) ||
    completeness.scopeKind !== "all_long_term_residence_routes_for_profile" ||
    completeness.profileSnapshotId !== input.profileSnapshotId ||
    !isNonEmpty(completeness.validatorVersion) ||
    !isNonEmpty(completeness.evidenceSnapshotId) ||
    !isCurrentInterval(completeness.effectiveFrom, completeness.effectiveTo, input.verdictAsOf) ||
    !Array.isArray(completeness.catalogRoutes) ||
    completeness.catalogRoutes.length === 0 ||
    !Array.isArray(completeness.catalogEvidence) ||
    completeness.catalogEvidence.length === 0 ||
    !completeness.catalogEvidence.every((reference) =>
      isSealedEvidenceReference(reference, completeness.evidenceSnapshotId)
    )
  ) return false;

  const catalogRouteIds = completeness.catalogRoutes.map(({ routeId }) => routeId);
  if (
    new Set(catalogRouteIds).size !== catalogRouteIds.length ||
    !completeness.catalogRoutes.every((coverage) =>
      isCatalogCoverageValid(coverage, completeness.evidenceSnapshotId)
    )
  ) return false;

  const applicableRouteIds = completeness.catalogRoutes
    .filter(({ applicability }) => applicability === "applicable")
    .map(({ routeId }) => routeId)
    .sort();
  const outcomeRouteIds = routes.map(({ routeId }) => routeId).sort();
  return applicableRouteIds.length === outcomeRouteIds.length &&
    applicableRouteIds.every((routeId, index) => routeId === outcomeRouteIds[index]) &&
    routes.every((route) => route.status === "unknown" ||
      route.evidenceSnapshotIds.includes(completeness.evidenceSnapshotId));
}

function markerFor(
  routes: readonly ResidenceRouteOutcome[],
  hasCurrentExactCompleteness: boolean,
): FormalMarker {
  if (routes.some((route) => route.status === "viable")) return "green";
  if (routes.some((route) => route.status === "unknown")) return "yellow";
  if (!hasCurrentExactCompleteness) return "yellow";
  return routes.every((route) => route.status === "impossible") ? "red" : "yellow";
}

function catalogUnprovenReason(): FormalReason {
  return {
    code: "catalog_completeness_unprovable",
    summary: "Полнота каталога формальных маршрутов не подтверждена.",
    claimIds: [],
    evidence: [],
    navigation: [],
  };
}

export function assessFormalResidence(input: FormalResidenceInput): FormalResidenceVerdict {
  if (!isNonEmpty(input.profileSnapshotId) || !isCanonicalDay(input.verdictAsOf)) {
    throw new Error("integrity_mismatch");
  }
  const routes = normalizeRoutes(input.routes, input.verdictAsOf);
  const hasCompleteness = isCurrentExactCompleteness(input, routes);
  const marker = markerFor(routes, hasCompleteness);
  const reasons = routes.flatMap(({ reasons }) => reasons.map(copyReason));
  if (marker !== "green" && routes.length > 0 && !hasCompleteness) {
    reasons.push(catalogUnprovenReason());
  }
  return deepFreeze({
    rulesVersion: RULES_VERSION,
    marker,
    verdictAsOf: input.verdictAsOf,
    routeOutcomes: routes,
    reasons,
    catalogCompleteness: hasCompleteness
      ? { status: "verified", attestation: copyCompleteness(input.completeness) }
      : { status: "unproven", reasonCode: "catalog_completeness_unprovable" },
  });
}
