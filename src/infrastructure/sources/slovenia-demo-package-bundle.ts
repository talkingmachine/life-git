import { types } from "node:util";

import type {
  CityPackageAvailabilityResolver,
  InstallCityPackageInput,
} from "../../application/install-city-package";
import { reconstructVerifiedCityCatalog, type CityCatalogRevision } from "../../decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  reconstructInstalledCityCriteriaDefaults,
  reconstructInstalledCityCriterionDefinitionsStructure,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../decision/city-criteria";
import {
  getSloveniaDemoCityBehaviorPolicy,
  getSloveniaDemoCityEvaluatorRegistry,
  getSloveniaDemoCityPackageDefinition,
  SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS,
  SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS,
} from "../../decision/slovenia-demo-city-policy";
import {
  reconstructCityFixedSourcePlan,
  type CityFixedClaimContract,
  type CityFixedRoute,
  type SloveniaCityFixedSourceId,
} from "../../research/city-evidence";
import { reconstructCitySafetySourcePlan, reconstructOfficialAuthorityDirectory } from "../../research/city-safety-source-plan";
import { canonicalJson, sha256Text } from "../integrity";
import { createEvidenceIntegrity } from "../integrity";
import type {
  InstalledCityPackageBehaviorRegistry,
  InstalledCityPackageBehaviorRegistryEntry,
  InstalledCityPackageBehaviorVersionKey,
} from "./installed-city-packages";
import {
  reconstructSloveniaDemoPackagePolicyLock,
} from "./slovenia-demo-package-policy-lock";

export interface SloveniaDemoPackageManifest {
  readonly packageId: "si-demo-city-package";
  readonly packageSchemaVersion: "si-demo-city-package@1";
  readonly evidenceRulesVersion: "si-demo-city-evidence@1";
  readonly catalogScopePolicy: "subjective-relocation-demo@1";
  readonly cityIds: readonly ["ljubljana"];
  readonly captures: readonly SloveniaDemoCaptureBinding[];
  readonly relationView: SloveniaDemoPackageRelationView;
}

/** Closed, derived-only projection of every relation which authorizes install. */
export interface SloveniaDemoPackageRelationView {
  readonly city: SloveniaDemoCityRelation;
  readonly publishers: readonly SloveniaDemoPublisherRelation[];
  readonly safety: SloveniaDemoSafetyRelation;
  readonly fixedPlans: readonly [SloveniaDemoFixedRelation, SloveniaDemoFixedRelation, SloveniaDemoFixedRelation];
  readonly criteria: SloveniaDemoCriteriaRelation;
}
export type SloveniaDemoCaptureAuthorityTrace =
  | { readonly kind: "direct_allowed_host" }
  | {
    readonly kind: "delegated_document";
    readonly parentArtifactId: string;
    readonly edgeKind: "link" | "redirect";
  };
export interface SloveniaDemoCaptureBinding {
  readonly artifactId: string;
  readonly publisherId: string;
  readonly sourceUrl: string;
  readonly sha256: string;
  readonly capturedAt: string;
  readonly authorityTrace: SloveniaDemoCaptureAuthorityTrace;
}
export interface SloveniaDemoCityRelation { readonly cityId: string; readonly officialName: string; readonly coordinate: { readonly lat: number; readonly lng: number }; readonly administrativeType: string; readonly administrativeTerritory: string; readonly capitalRoles: readonly string[]; readonly evidenceReferenceIds: readonly string[]; readonly settlementCode: string; readonly municipalityCode: string; readonly municipality: { readonly cityId: string; readonly settlementCode: string; readonly municipalityCode: string; readonly officialCityNames: readonly string[]; readonly officialMunicipalityNames: readonly string[]; readonly publisherId: string; readonly officialHost: string }; readonly requiredPublisherIds: { readonly police: string; readonly gov: string; readonly opsi: string; readonly surs: string }; readonly populationDefinition: CityCatalogRevision["populationDefinition"]; readonly candidateBasis: CityCatalogRevision["candidateBasis"]; readonly members: CityCatalogRevision["members"]; readonly coverage: { readonly status: "incomplete"; readonly reasons: readonly "official_universe_partial"[] }; readonly catalogRulesVersion: "city-catalog@2"; }
export interface SloveniaDemoPublisherRelation { readonly publisherId: string; readonly authorityKind: string; readonly navigationUrl: string; readonly allowedHosts: readonly string[]; readonly delegatedDocumentHosts: readonly string[]; readonly allowedMediaTypes: readonly string[]; readonly maxBytes: number; readonly redirectPolicyVersion: "official-chain@1"; readonly documentLocatorPolicyId: string; readonly retentionPolicyId: string; readonly retentionMode: string; }
export interface SloveniaDemoSafetyRelation { readonly sourcePlanId: string; readonly authorityDirectoryId: string; readonly queryTemplateVersion: string; readonly definitionId: string; readonly freshnessPolicyVersion: string; readonly discoveryRulesVersion: string; readonly routes: readonly { readonly publisherId: string; readonly navigationUrl: string; readonly resolvedEvidenceUrl?: string }[]; }
export interface SloveniaDemoFixedRelation {
  readonly sourceId: SloveniaCityFixedSourceId;
  readonly planId: string;
  readonly parserVersion: string;
  readonly rulesVersion: string;
  readonly valuePolicyVersion: string;
  readonly sourcePeriodPolicyVersion: string;
  readonly criterionId: string;
  readonly definitionId: string;
  readonly claimContract: CityFixedClaimContract<SloveniaCityFixedSourceId>;
  readonly routes: readonly CityFixedRoute[];
}
export interface SloveniaDemoCriteriaRelation {
  readonly defaults: InstalledCityCriteriaDefaults;
  readonly definitions: InstalledCityCriterionDefinitionTuple;
  readonly behaviorVersion: InstalledCityPackageBehaviorVersionKey;
  readonly fixedPolicyVersionsBySourceId:
    InstalledCityPackageBehaviorRegistryEntry["fixedPolicyVersionsBySourceId"];
}

export interface SloveniaDemoPackageAcquisitionBundle {
  readonly schemaVersion: "si-demo-city-acquisition-bundle@1";
  readonly manifest: SloveniaDemoPackageManifest;
  /** Staging-derived graph, hash-bound in full by the independent lock. */
  readonly installInput: InstallCityPackageInput;
}

export interface SealedSloveniaDemoPackageBundle {
  readonly manifest: SloveniaDemoPackageManifest;
  readonly manifestSha256: string;
  readonly installInput: InstallCityPackageInput;
}

export interface SloveniaDemoCityInstallationPolicy {
  readonly resolveAvailability: CityPackageAvailabilityResolver;
  readonly approvedDefaults: typeof SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS;
  readonly behaviors: InstalledCityPackageBehaviorRegistry;
  readonly evaluators: CityCriterionEvaluatorRegistry;
  readonly defaults: InstalledCityCriteriaDefaults;
}

function mismatch(): never { throw new Error("integrity_mismatch"); }
function own<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) mismatch(); return value; }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    const descriptors = Object.getOwnPropertyDescriptors(value); active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(descriptors).length !== value.length + 1) mismatch();
        return value.map((item, index) => { const d = descriptors[String(index)]; if (!d || !("value" in d) || !d.enumerable) mismatch(); return visit(item); });
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) mismatch();
      return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => {
        if (key === "__proto__" || !("value" in d) || !d.enumerable) mismatch(); return [key, visit(d.value)];
      }));
    } finally { active.delete(value); }
  };
  return visit(borrowed) as T;
}
function freeze<T>(value: T): T { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

const checkedInBundles = new WeakSet<SealedSloveniaDemoPackageBundle>();

function buildSloveniaDemoCityInstallationPolicy(): SloveniaDemoCityInstallationPolicy {
  const behavior = getSloveniaDemoCityBehaviorPolicy();
  const ready = freeze({
    definition: getSloveniaDemoCityPackageDefinition(),
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness: { status: "ready" as const, issues: [] as const },
  });
  const resolveAvailability: CityPackageAvailabilityResolver = freeze(function resolve(
    this: void,
    countryCode: string,
  ) {
    return countryCode === "SI" ? ready : undefined;
  });
  return freeze({
    resolveAvailability,
    approvedDefaults: SLOVENIA_DEMO_CITY_APPROVED_DEFAULTS,
    behaviors: {
      schemaVersion: "installed-city-package-behavior-registry@1",
      entries: [behavior],
    },
    evaluators: getSloveniaDemoCityEvaluatorRegistry(),
    defaults: SLOVENIA_DEMO_CITY_CRITERIA_DEFAULTS,
  });
}

/** Runtime readiness is granted only to the exact object returned by the checked-in loader. */
export function createSloveniaDemoCityInstallationPolicy(
  checkedInBundle: SealedSloveniaDemoPackageBundle,
): SloveniaDemoCityInstallationPolicy {
  if (checkedInBundle === null || typeof checkedInBundle !== "object" ||
    types.isProxy(checkedInBundle) || !checkedInBundles.has(checkedInBundle)) mismatch();
  return buildSloveniaDemoCityInstallationPolicy();
}

function normalizeCaptureAuthorityTrace(value: unknown): SloveniaDemoCaptureAuthorityTrace {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  const trace = value as Record<string, unknown>;
  if (trace.kind === "direct_allowed_host") {
    if (Object.keys(trace).length !== 1) mismatch();
    return freeze({ kind: "direct_allowed_host" as const });
  }
  if (trace.kind !== "delegated_document" ||
    Object.keys(trace).sort().join(",") !== "edgeKind,kind,parentArtifactId" ||
    typeof trace.parentArtifactId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(trace.parentArtifactId) ||
    (trace.edgeKind !== "link" && trace.edgeKind !== "redirect")) mismatch();
  return freeze({
    kind: "delegated_document" as const,
    parentArtifactId: trace.parentArtifactId,
    edgeKind: trace.edgeKind,
  });
}

function normalizeManifest(borrowed: unknown): SloveniaDemoPackageManifest {
  const manifest = own(borrowed) as Record<string, unknown>;
  const required = ["packageId", "packageSchemaVersion", "evidenceRulesVersion", "catalogScopePolicy", "cityIds", "captures", "relationView"];
  if (Object.keys(manifest).length !== required.length || Object.keys(manifest).sort().some((key, index) => key !== required.sort()[index]) ||
    manifest.packageId !== "si-demo-city-package" || manifest.packageSchemaVersion !== "si-demo-city-package@1" ||
    manifest.evidenceRulesVersion !== "si-demo-city-evidence@1" || manifest.catalogScopePolicy !== "subjective-relocation-demo@1" ||
    !Array.isArray(manifest.cityIds) || manifest.cityIds.length !== 1 || manifest.cityIds[0] !== "ljubljana" || !Array.isArray(manifest.captures)) mismatch();
  const captures = manifest.captures.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch(); const item = value as Record<string, unknown>; const keys = ["artifactId", "publisherId", "sourceUrl", "sha256", "capturedAt", "authorityTrace"];
    let canonicalDate = false;
    try { canonicalDate = typeof item.capturedAt === "string" && new Date(item.capturedAt).toISOString() === item.capturedAt; } catch { canonicalDate = false; }
    if (Object.keys(item).length !== keys.length || Object.keys(item).sort().some((key, index) => key !== keys.sort()[index]) || typeof item.artifactId !== "string" || typeof item.publisherId !== "string" || typeof item.sourceUrl !== "string" || !/^https:\/\//.test(item.sourceUrl) || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !canonicalDate) mismatch();
    return freeze({
      artifactId: item.artifactId,
      publisherId: item.publisherId,
      sourceUrl: item.sourceUrl,
      sha256: item.sha256,
      capturedAt: item.capturedAt,
      authorityTrace: normalizeCaptureAuthorityTrace(item.authorityTrace),
    } as SloveniaDemoCaptureBinding);
  });
  if (new Set(captures.map(({ artifactId }) => artifactId)).size !== captures.length) mismatch();
  return freeze({
    packageId: "si-demo-city-package",
    packageSchemaVersion: "si-demo-city-package@1",
    evidenceRulesVersion: "si-demo-city-evidence@1",
    catalogScopePolicy: "subjective-relocation-demo@1",
    cityIds: ["ljubljana"] as const,
    captures: Object.freeze([...captures].sort((a, b) => a.artifactId.localeCompare(b.artifactId))),
    relationView: own(manifest.relationView) as SloveniaDemoPackageRelationView,
  });
}

function lockedView(manifest: SloveniaDemoPackageManifest): unknown {
  return {
    packageId: manifest.packageId,
    packageSchemaVersion: manifest.packageSchemaVersion,
    evidenceRulesVersion: manifest.evidenceRulesVersion,
    cityIds: manifest.cityIds,
    captures: manifest.captures,
    relationView: manifest.relationView,
  };
}

/** Canonical relation view. It owns caller data before freezing the projection. */
export function deriveSloveniaDemoPackageRelationView(
  borrowedInput: InstallCityPackageInput,
): SloveniaDemoPackageRelationView {
  const input = own(borrowedInput);
  const { registry, catalog } = input.catalogProjection;
  const directory = input.officialAuthorityDirectory;
  const safety = input.safetySourcePlan;
  const fixed = input.fixedPlansByCityId.ljubljana;
  const policy = buildSloveniaDemoCityInstallationPolicy();
  const behavior = policy.behaviors.entries[0];
  if (catalog.rulesVersion !== "city-catalog@2" ||
    catalog.coverage.status !== "incomplete" ||
    catalog.coverage.reasons.length !== 1 ||
    catalog.coverage.reasons[0] !== "official_universe_partial" ||
    fixed === undefined || fixed.length !== 3 || behavior === undefined) mismatch();
  return freeze({
    city: {
      cityId: registry.entries[0]?.cityId,
      officialName: registry.entries[0]?.officialName,
      coordinate: registry.entries[0]?.coordinate,
      administrativeType: registry.entries[0]?.administrativeType,
      administrativeTerritory: registry.entries[0]?.administrativeTerritory,
      capitalRoles: registry.entries[0]?.capitalRoles,
      evidenceReferenceIds: registry.entries[0]?.evidenceReferenceIds,
      settlementCode: directory.municipalities[0]?.settlementCode,
      municipalityCode: directory.municipalities[0]?.municipalityCode,
      municipality: { ...directory.municipalities[0]! },
      requiredPublisherIds: directory.requiredPublisherIds,
      populationDefinition: catalog.populationDefinition,
      candidateBasis: catalog.candidateBasis,
      members: catalog.members,
      coverage: { status: "incomplete" as const, reasons: ["official_universe_partial"] as const },
      catalogRulesVersion: "city-catalog@2" as const,
    },
    publishers: directory.publishers.map((publisher) => ({
      publisherId: publisher.publisherId, authorityKind: publisher.authorityKind,
      navigationUrl: publisher.navigationUrl, allowedHosts: publisher.allowedHosts,
      delegatedDocumentHosts: publisher.delegatedDocumentHosts, allowedMediaTypes: publisher.allowedMediaTypes,
      maxBytes: publisher.maxBytes, redirectPolicyVersion: publisher.redirectPolicyVersion,
      documentLocatorPolicyId: publisher.documentLocatorPolicyId, retentionPolicyId: publisher.retentionPolicyId,
      retentionMode: publisher.retentionMode,
    })),
    safety: {
      sourcePlanId: safety.id, authorityDirectoryId: safety.authorityDirectoryId,
      queryTemplateVersion: safety.queryTemplateVersion, definitionId: safety.definitionId,
      freshnessPolicyVersion: safety.freshnessPolicyVersion, discoveryRulesVersion: safety.discoveryRulesVersion,
      routes: safety.entries[0]?.configuredRoutes.map((route) => ({ ...route })),
    },
    fixedPlans: fixed.map((plan) => ({
      sourceId: plan.sourceId, planId: plan.planId, parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion, valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      criterionId: plan.criterionId, definitionId: plan.definitionId, claimContract: plan.claimContract,
      routes: plan.routes.map((route) => ({ ...route })),
    })) as unknown as [SloveniaDemoFixedRelation, SloveniaDemoFixedRelation, SloveniaDemoFixedRelation],
    criteria: {
      defaults: input.criteriaDefaults,
      definitions: input.criterionDefinitions,
      behaviorVersion: {
        ...behavior.versionKey,
        evaluatorVersionIds: { ...behavior.versionKey.evaluatorVersionIds },
      },
      fixedPolicyVersionsBySourceId: Object.fromEntries(
        Object.entries(behavior.fixedPolicyVersionsBySourceId).map(([sourceId, versions]) => [
          sourceId,
          { ...versions },
        ]),
      ) as InstalledCityPackageBehaviorRegistryEntry["fixedPolicyVersionsBySourceId"],
    },
  });
}

function reconstructInstallInput(borrowed: unknown): InstallCityPackageInput {
  try {
  const input = own(borrowed) as InstallCityPackageInput;
  const keys = ["countryCode", "installedAt", "catalogProjection", "fixedPlansByCityId", "safetySourcePlan", "officialAuthorityDirectory", "criteriaDefaults", "criterionDefinitions"];
  if (input === null || typeof input !== "object" || Object.keys(input).length !== keys.length || Object.keys(input).sort().some((key, index) => key !== [...keys].sort()[index]) || input.countryCode !== "SI" || typeof input.installedAt !== "string" || new Date(input.installedAt).toISOString() !== input.installedAt) mismatch();
  const integrity = createEvidenceIntegrity("si-demo-reconstruction-only");
  const catalogProjection = reconstructVerifiedCityCatalog(input.catalogProjection, integrity);
  const { registry, catalog } = catalogProjection;
  if (registry.packageId !== "si-demo-city-package" || registry.packageSchemaVersion !== "si-demo-city-package@1" ||
    catalog.packageId !== registry.packageId || catalog.packageSchemaVersion !== registry.packageSchemaVersion ||
    catalog.members.length !== 1 || catalog.members[0]?.cityId !== "ljubljana" ||
    catalog.rulesVersion !== "city-catalog@2" || catalog.coverage.status !== "incomplete" || catalog.coverage.reasons.length !== 1 || catalog.coverage.reasons[0] !== "official_universe_partial") mismatch();
  const directory = reconstructOfficialAuthorityDirectory(input.officialAuthorityDirectory, catalog, integrity);
  const safetySourcePlan = reconstructCitySafetySourcePlan(input.safetySourcePlan, catalog, directory, integrity);
  const policy = buildSloveniaDemoCityInstallationPolicy();
  const behavior = policy.behaviors.entries[0];
  if (behavior === undefined ||
    safetySourcePlan.definitionId !== policy.evaluators.safety.definition.definitionId ||
    safetySourcePlan.freshnessPolicyVersion !==
      policy.evaluators.safety.definition.freshnessPolicyVersion) mismatch();
  const expectedDefinitionIds = Object.fromEntries(CITY_CRITERION_IDS.map((id, index) => [id, policy.defaults.criteria[index]!.definitionId])) as Record<typeof CITY_CRITERION_IDS[number], string>;
  const criterionDefinitions = reconstructInstalledCityCriterionDefinitionsStructure(input.criterionDefinitions, expectedDefinitionIds);
  const criteriaDefaults = reconstructInstalledCityCriteriaDefaults(input.criteriaDefaults, policy.defaults.mappingVersion, criterionDefinitions, policy.evaluators);
  if (canonicalJson(criteriaDefaults) !== canonicalJson(policy.defaults)) mismatch();
  const plans = input.fixedPlansByCityId;
  if (Object.keys(plans).length !== 1 || !Object.hasOwn(plans, "ljubljana") || !Array.isArray(plans.ljubljana) || plans.ljubljana.length !== 3) mismatch();
  const fixedPlansByCityId = Object.freeze({
    ljubljana: Object.freeze([
      reconstructCityFixedSourcePlan(plans.ljubljana[0], "si-city-long-term-rent"),
      reconstructCityFixedSourcePlan(plans.ljubljana[1], "si-city-urban-transit"),
      reconstructCityFixedSourcePlan(plans.ljubljana[2], "si-city-fixed-broadband"),
    ]) as InstallCityPackageInput["fixedPlansByCityId"][string],
  });
  for (const plan of fixedPlansByCityId.ljubljana) {
    const expectedPolicy = behavior.fixedPolicyVersionsBySourceId[plan.sourceId];
    const expectedDefinition = policy.evaluators[plan.criterionId].definition;
    if (plan.definitionId !== expectedDefinition.definitionId ||
      plan.claimContract.definitionId !== expectedDefinition.definitionId ||
      plan.claimContract.unit !== expectedDefinition.unit ||
      plan.claimContract.denominator !== expectedDefinition.denominator ||
      plan.claimContract.freshnessPolicyVersion !== expectedDefinition.freshnessPolicyVersion ||
      plan.claimContract.valuePolicyVersion !== expectedPolicy.valuePolicyVersion ||
      plan.claimContract.sourcePeriodPolicyVersion !==
        expectedPolicy.sourcePeriodPolicyVersion) mismatch();
  }
  return freeze({ ...input, catalogProjection, officialAuthorityDirectory: directory, safetySourcePlan, criteriaDefaults, criterionDefinitions, fixedPlansByCityId });
  } catch { return mismatch(); }
}

/**
 * Pure reconstruction seam used by offline tests.  It is deliberately unable
 * to invent a lock or make an acquisition bundle authoritative by itself.
 */
export function reconstructSealedSloveniaDemoPackageBundle(
  borrowedBundle: unknown,
  borrowedLock: unknown,
): SealedSloveniaDemoPackageBundle {
  const bundle = own(borrowedBundle) as Record<string, unknown>;
  if (Object.keys(bundle).length !== 3 || !Object.hasOwn(bundle, "schemaVersion") || !Object.hasOwn(bundle, "manifest") || !Object.hasOwn(bundle, "installInput") || bundle.schemaVersion !== "si-demo-city-acquisition-bundle@1") mismatch();
  const manifest = normalizeManifest(bundle.manifest);
  const lock = reconstructSloveniaDemoPackagePolicyLock(borrowedLock);
  const digest = sha256Text(canonicalJson(manifest));
  if (digest !== lock.bundleManifestSha256 || !same(lockedView(manifest), {
    packageId: lock.packageId, packageSchemaVersion: lock.packageSchemaVersion,
    evidenceRulesVersion: lock.evidenceRulesVersion, cityIds: lock.cityIds,
    captures: lock.captures,
    relationView: lock.relationView,
  })) mismatch();
  const installInput = reconstructInstallInput(bundle.installInput);
  if (sha256Text(canonicalJson(installInput)) !== lock.installInputSha256) mismatch();
  const relationView = deriveSloveniaDemoPackageRelationView(installInput);
  if (!same(manifest.relationView, relationView) || !same(lock.relationView, relationView)) mismatch();
  if (manifest.captures.length === 0 || !same(manifest.captures, lock.captures)) mismatch();
  const publishers = new Map(relationView.publishers.map((publisher) => [publisher.publisherId, publisher]));
  const capturePublishersByUrl = new Map<string, Set<string>>();
  const bindCaptureUrl = (sourceUrl: string, publisherId: string) => {
    const bound = capturePublishersByUrl.get(sourceUrl) ?? new Set<string>();
    bound.add(publisherId);
    capturePublishersByUrl.set(sourceUrl, bound);
  };
  for (const publisher of relationView.publishers) {
    bindCaptureUrl(publisher.navigationUrl, publisher.publisherId);
  }
  for (const route of relationView.safety.routes) {
    bindCaptureUrl(route.navigationUrl, route.publisherId);
    if (route.resolvedEvidenceUrl !== undefined) {
      bindCaptureUrl(route.resolvedEvidenceUrl, route.publisherId);
    }
  }
  for (const route of relationView.fixedPlans.flatMap((plan) => plan.routes)) {
    let host: string;
    try {
      host = new URL(route.navigationUrl).hostname;
    } catch {
      return mismatch();
    }
    const owners = relationView.publishers.filter((publisher) =>
      publisher.allowedHosts.includes(host));
    if (owners.length === 1) bindCaptureUrl(route.navigationUrl, owners[0]!.publisherId);
  }
  const capturesById = new Map(manifest.captures.map((capture) => [capture.artifactId, capture]));
  const canonicalHttpsUrl = (sourceUrl: string): URL => {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      return mismatch();
    }
    if (url.protocol !== "https:" || url.href !== sourceUrl) mismatch();
    return url;
  };
  for (const capture of manifest.captures) {
    const publisher = publishers.get(capture.publisherId);
    if (publisher === undefined) mismatch();
    const url = canonicalHttpsUrl(capture.sourceUrl);
    if (capture.authorityTrace.kind === "direct_allowed_host") {
      if (!publisher.allowedHosts.includes(url.hostname) ||
        !capturePublishersByUrl.get(capture.sourceUrl)?.has(capture.publisherId)) mismatch();
      continue;
    }
    const parent = capturesById.get(capture.authorityTrace.parentArtifactId);
    if (parent === undefined || parent.artifactId === capture.artifactId ||
      parent.publisherId !== capture.publisherId ||
      parent.authorityTrace.kind !== "direct_allowed_host" ||
      !publisher.delegatedDocumentHosts.includes(url.hostname)) mismatch();
    const parentUrl = canonicalHttpsUrl(parent.sourceUrl);
    if (!publisher.allowedHosts.includes(parentUrl.hostname) ||
      !capturePublishersByUrl.get(parent.sourceUrl)?.has(parent.publisherId)) mismatch();
  }
  return freeze({ manifest, manifestSha256: digest, installInput });
}

/** No checked-in reviewed lock exists before M8C, so production loading fails closed. */
export function loadCheckedInSloveniaDemoPackage(): never {
  throw new Error("si_demo_package_policy_lock_unavailable");
}
