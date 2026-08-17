import type Database from "better-sqlite3";

import {
  cityEvidenceContextHash,
  type CityEvidenceContext,
  type CityEvidenceExpectations,
  type CityEvidencePackageReplayPort,
  type CityEvidencePayload,
  type CityEvidenceSealInput,
  type CityEvidenceSnapshot,
  type CityFixedAttemptLedgerTuple,
  type CityPackageEvidenceReplayContract,
  type VerifiedCityEvidence,
} from "../../application/city-data-contracts";
import {
  CITY_CATALOG_RULES_VERSION,
  reconstructVerifiedCityCatalog,
  type CityCatalogProjection,
} from "../../decision/city-catalog";
import type { LiveCapturedArtifact } from "../../research/contracts";
import {
  citySafetyTerminalEntry,
  reconstructCityFixedAttemptLedger,
  reconstructCityFixedSourcePlan,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  type CityEvidenceClaim,
  type CityFixedAttemptLedger,
  type CityFixedSourcePlan,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../../research/city-evidence";
import { reconstructCitySafetyArtifactBridge } from "../../research/city-safety-artifact-bridge";
import {
  reconstructCitySafetyAttemptLedger,
  type CitySafetyAttemptLedger,
  type CitySafetyPreviousAcceptedReference,
} from "../../research/city-safety-evidence";
import {
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
} from "../../research/city-safety-source-plan";
import type { InstalledCityPackageExactKey } from "../../research/city-package";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../research/slovenia-city-plan";
import {
  evidenceArtifactProvenance,
  type EvidenceIntegrity,
  type EvidenceManifest,
  type SealedEvidence,
} from "../../research/research-plan";
import {
  createCityDecisionIntegrityView,
  createCityEvidenceReplayIntegrity,
  secureHexEqual,
} from "../integrity";
import {
  insertLiveArtifact,
  insertSealedEvidence,
  loadVerifiedEvidenceBundle,
  verifySealedEvidenceForInsert,
} from "./evidence-store";

interface CityEvidenceRow {
  readonly id: string;
  readonly city_check_run_id: string;
  readonly frontier_run_id: string;
  readonly city_id: string;
  readonly country_code: string;
  readonly package_id: string;
  readonly package_schema_version: string;
  readonly catalog_revision_id: string;
  readonly criteria_snapshot_id: string;
  readonly ranking_snapshot_id: string;
  readonly evidence_rules_version: string;
  readonly context_hash: string;
  readonly assessment_at: string;
  readonly completed_at: string;
  readonly canonical_payload: string;
  readonly payload_hash: string;
  readonly hmac: string;
}

interface GenericStoredBundle {
  readonly snapshot: SealedEvidence<SloveniaCityFactSourceId, CityEvidenceClaim>["snapshot"];
  readonly manifest: EvidenceManifest<SloveniaCityFactSourceId, CityEvidenceClaim>;
  readonly entries: readonly import("../../research/contracts").CapturedEntry<SloveniaCityFactSourceId>[];
}

interface VerifiedReplayContract {
  readonly definition: CityPackageEvidenceReplayContract["definition"];
  readonly catalog: CityCatalogProjection;
  readonly fixedPlansByCityId: CityPackageEvidenceReplayContract["fixedPlansByCityId"];
  readonly safetySourcePlan: CityPackageEvidenceReplayContract["safetySourcePlan"];
  readonly officialAuthorityDirectory: CityPackageEvidenceReplayContract["officialAuthorityDirectory"];
  readonly validateValue: CityPackageEvidenceReplayContract["validateValue"];
  readonly validateSourcePeriod: CityPackageEvidenceReplayContract["validateSourcePeriod"];
}

interface SemanticReplay {
  readonly fixedAttemptLedgers: CityFixedAttemptLedgerTuple;
  readonly safetyAttemptLedger: CitySafetyAttemptLedger;
}

const SEAL_INPUT_KEYS = [
  "schemaVersion", "cityCheckRunId", "frontierRunId", "cityId", "countryCode", "packageId",
  "packageSchemaVersion", "catalogRevisionId", "criteriaSnapshotId", "rankingSnapshotId",
  "definitionIds", "evidenceRulesVersion", "assessmentAt", "completedAt", "genericEvidence",
  "artifacts", "fixedAttemptLedgers", "safetyAttemptLedger",
] as const;
const CONTEXT_KEYS = SEAL_INPUT_KEYS.slice(0, 14);
const PAYLOAD_KEYS = [
  "schemaVersion", "id", "cityCheckRunId", "frontierRunId", "cityId", "countryCode",
  "packageId", "packageSchemaVersion", "catalogRevisionId", "criteriaSnapshotId",
  "rankingSnapshotId", "definitionIds", "evidenceRulesVersion", "assessmentAt",
  "fixedAttemptLedgers", "safetyAttemptLedger", "contextHash", "completedAt",
] as const;
const CONTRACT_KEYS = [
  "installedPackageManifest", "definition", "catalogProjection", "fixedPlansByCityId",
  "safetySourcePlan", "officialAuthorityDirectory", "validateValue", "validateSourcePeriod",
] as const;
const FIXED_SOURCE_IDS = SLOVENIA_CITY_FACT_SOURCE_IDS.slice(1) as unknown as readonly [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
];
const SHA256 = /^[a-f0-9]{64}$/;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function constraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    (error as { readonly code: string }).code.startsWith("SQLITE_CONSTRAINT");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return true;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const actual = Object.getOwnPropertyNames(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => {
    if (key !== wanted[index]) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function ownSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" || value === undefined) return value;
    if (typeof value !== "object") mismatch();
    if (value instanceof Uint8Array) {
      if (typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer) {
        mismatch();
      }
      const keys = Reflect.ownKeys(value);
      if (Object.getPrototypeOf(value) !== Uint8Array.prototype || keys.length !== value.length ||
        !keys.every((key, index) => {
          if (key !== String(index)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
        })) mismatch();
      return new Uint8Array(value);
    }
    if (active.has(value)) mismatch();
    active.add(value);
    try {
      const symbols = Object.getOwnPropertySymbols(value);
      if (symbols.length !== 0) mismatch();
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || !denseArray(value)) mismatch();
        const names = Object.getOwnPropertyNames(value);
        const expectedNames = [...Array.from({ length: value.length }, (_, index) => String(index)), "length"];
        if (!sameStrings(names.sort(), expectedNames.sort())) mismatch();
        const copy: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
          copy.push(visit(descriptor.value));
        }
        return copy;
      }
      if (!plainRecord(value)) mismatch();
      const copy = Object.create(null) as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };
  return visit(borrowed) as T;
}

function sameCanonical(left: unknown, right: unknown, integrity: EvidenceIntegrity): boolean {
  try {
    return integrity.canonical(left) === integrity.canonical(right);
  } catch {
    return false;
  }
}

function contextFrom(value: Record<string, unknown>): CityEvidenceContext {
  if (value.schemaVersion !== "city-evidence-context@1") mismatch();
  const context: CityEvidenceContext = {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: value.cityCheckRunId as string,
    frontierRunId: value.frontierRunId as string,
    cityId: value.cityId as string,
    countryCode: value.countryCode as string,
    packageId: value.packageId as string,
    packageSchemaVersion: value.packageSchemaVersion as string,
    catalogRevisionId: value.catalogRevisionId as string,
    criteriaSnapshotId: value.criteriaSnapshotId as string,
    rankingSnapshotId: value.rankingSnapshotId as string,
    definitionIds: value.definitionIds as CityEvidenceContext["definitionIds"],
    evidenceRulesVersion: value.evidenceRulesVersion as string,
    assessmentAt: value.assessmentAt as string,
    completedAt: value.completedAt as string,
  };
  return context;
}

function exactKey(context: CityEvidenceContext): InstalledCityPackageExactKey {
  return {
    countryCode: context.countryCode,
    packageId: context.packageId,
    packageSchemaVersion: context.packageSchemaVersion,
    catalogRevisionId: context.catalogRevisionId,
    evidenceRulesVersion: context.evidenceRulesVersion,
  };
}

function descriptorsAreData(value: object, expected: readonly string[]): boolean {
  if (!plainRecord(value) || !exactKeys(value, expected)) return false;
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
  });
}

function verifyReplayContractUnchecked(
  borrowed: CityPackageEvidenceReplayContract,
  context: CityEvidenceContext,
  integrity: EvidenceIntegrity,
): VerifiedReplayContract {
  if (!descriptorsAreData(borrowed, CONTRACT_KEYS)) mismatch();
  const requestedKey = exactKey(context);
  const borrowedManifest = borrowed.installedPackageManifest;
  if (!descriptorsAreData(borrowedManifest, ["id", "key"]) ||
    !Object.isFrozen(borrowedManifest) || !Object.isFrozen(borrowedManifest.key) ||
    !identifier(borrowedManifest.id) || !descriptorsAreData(borrowedManifest.key, [
      "countryCode", "packageId", "packageSchemaVersion", "catalogRevisionId",
      "evidenceRulesVersion",
    ]) || !sameCanonical(borrowedManifest.key, requestedKey, integrity)) mismatch();
  const definition = ownSnapshot(borrowed.definition);
  const catalogProjection = ownSnapshot(borrowed.catalogProjection);
  const fixedPlansByCityId = ownSnapshot(borrowed.fixedPlansByCityId);
  const safetySourcePlan = ownSnapshot(borrowed.safetySourcePlan);
  const officialAuthorityDirectory = ownSnapshot(borrowed.officialAuthorityDirectory);
  const validateValue = borrowed.validateValue;
  const validateSourcePeriod = borrowed.validateSourcePeriod;
  if (typeof validateValue !== "function" || typeof validateSourcePeriod !== "function" ||
    !descriptorsAreData(definition, [
      "packageId", "packageSchemaVersion", "countryCode", "evidenceRulesVersion", "sourceIds",
    ]) || definition.packageId !== context.packageId ||
    definition.packageSchemaVersion !== context.packageSchemaVersion ||
    definition.countryCode !== context.countryCode ||
    definition.evidenceRulesVersion !== context.evidenceRulesVersion ||
    !denseArray(definition.sourceIds) ||
    !sameStrings(definition.sourceIds, SLOVENIA_CITY_FACT_SOURCE_IDS)) mismatch();

  const decisionIntegrity = createCityDecisionIntegrityView(integrity);
  const catalog = reconstructVerifiedCityCatalog(catalogProjection, decisionIntegrity);
  if (catalog.catalog.rulesVersion !== CITY_CATALOG_RULES_VERSION) {
    throw new Error("city_catalog_upgrade_required");
  }
  if (catalog.catalog.id !== context.catalogRevisionId ||
    catalog.registry.countryCode !== context.countryCode ||
    catalog.catalog.countryCode !== context.countryCode ||
    catalog.registry.packageId !== context.packageId || catalog.catalog.packageId !== context.packageId ||
    catalog.registry.packageSchemaVersion !== context.packageSchemaVersion ||
    catalog.catalog.packageSchemaVersion !== context.packageSchemaVersion) mismatch();
  const memberIds = catalog.catalog.members.map(({ cityId }) => cityId).sort();
  if (!memberIds.includes(context.cityId) || !plainRecord(fixedPlansByCityId) ||
    !sameStrings(Object.keys(fixedPlansByCityId).sort(), memberIds)) mismatch();

  const reconstructedPlans = Object.create(null) as Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>;
  for (const cityId of memberIds) {
    const tuple = fixedPlansByCityId[cityId];
    if (!denseArray(tuple) || tuple.length !== 3) mismatch();
    const plans = [
      reconstructCityFixedSourcePlan(tuple[0], "si-city-long-term-rent"),
      reconstructCityFixedSourcePlan(tuple[1], "si-city-urban-transit"),
      reconstructCityFixedSourcePlan(tuple[2], "si-city-fixed-broadband"),
    ] as const;
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]!;
      const sourceId = FIXED_SOURCE_IDS[index]!;
      const criterionId = sourceId === "si-city-long-term-rent"
        ? "long_term_rent"
        : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
      if (plan.cityId !== cityId || plan.sourceId !== sourceId || plan.criterionId !== criterionId ||
        plan.definitionId !== context.definitionIds[criterionId] ||
        plan.claimContract.definitionId !== context.definitionIds[criterionId] ||
        plan.parserVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion ||
        plan.rulesVersion !== SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion) mismatch();
    }
    reconstructedPlans[cityId] = plans;
  }
  const directory = reconstructOfficialAuthorityDirectory(
    officialAuthorityDirectory,
    catalog.catalog,
    decisionIntegrity,
  );
  const safetyPlan = reconstructCitySafetySourcePlan(
    safetySourcePlan,
    catalog.catalog,
    directory,
    decisionIntegrity,
  );
  if (safetyPlan.definitionId !== context.definitionIds.safety ||
    safetyPlan.discoveryRulesVersion !==
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].rulesVersion) mismatch();
  return {
    definition,
    catalog,
    fixedPlansByCityId: reconstructedPlans,
    safetySourcePlan: safetyPlan,
    officialAuthorityDirectory: directory,
    validateValue,
    validateSourcePeriod,
  };
}

function verifyReplayContract(
  borrowed: CityPackageEvidenceReplayContract,
  context: CityEvidenceContext,
  integrity: EvidenceIntegrity,
): VerifiedReplayContract {
  try {
    return verifyReplayContractUnchecked(borrowed, context, integrity);
  } catch (error) {
    if (error instanceof Error && error.message === "city_catalog_upgrade_required") throw error;
    mismatch();
  }
}

function captureReplayContract(
  port: CityEvidencePackageReplayPort,
  context: CityEvidenceContext,
  integrity: EvidenceIntegrity,
): VerifiedReplayContract {
  const key = exactKey(context);
  const borrowed = port.loadExactReplayContract(key);
  if (borrowed === undefined) throw new Error("city_package_revision_not_installed");
  return verifyReplayContract(borrowed, context, integrity);
}

function verifyGenericBundle(
  context: CityEvidenceContext,
  sealed: SealedEvidence<SloveniaCityFactSourceId, CityEvidenceClaim>,
  artifacts: readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[],
  integrity: EvidenceIntegrity,
): void {
  verifySealedEvidenceForInsert(sealed, integrity);
  const expectedId = `${context.cityCheckRunId}:evidence`;
  if (sealed.snapshot.id !== expectedId || sealed.manifest.snapshot.id !== expectedId ||
    sealed.snapshot.assessmentDate !== context.assessmentAt.slice(0, 10) ||
    sealed.snapshot.rulesVersion !== context.evidenceRulesVersion ||
    sealed.snapshot.contextHash !== cityEvidenceContextHash(context, integrity) ||
    sealed.snapshot.knowledgeBaselineRevisionId !== undefined ||
    !sameStrings(sealed.manifest.entries.map(({ sourceId }) => sourceId),
      SLOVENIA_CITY_FACT_SOURCE_IDS) ||
    !sameStrings(Object.keys(sealed.snapshot.parserVersions).sort(),
      [...SLOVENIA_CITY_FACT_SOURCE_IDS].sort()) ||
    !denseArray(artifacts) || artifacts.length !== sealed.manifest.artifacts.length) mismatch();
  const replayIntegrity = createCityEvidenceReplayIntegrity(integrity);
  const seen = new Set<string>();
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]!;
    const provenance = sealed.manifest.artifacts[index]!;
    if (seen.has(artifact.artifactId) || artifact.runId !== context.cityCheckRunId ||
      artifact.origin !== "live" || !(artifact.bytes instanceof Uint8Array) ||
      replayIntegrity.hashBytes(new Uint8Array(artifact.bytes)) !== artifact.sha256 ||
      !sameCanonical(evidenceArtifactProvenance(artifact), provenance, integrity)) mismatch();
    seen.add(artifact.artifactId);
  }
}

function artifactUnion(bundle: GenericStoredBundle): readonly LiveCapturedArtifact<SloveniaCityFactSourceId>[] {
  return bundle.entries.flatMap(({ artifacts }) => artifacts);
}

function artifactTimes(
  bundle: GenericStoredBundle,
): ReadonlyMap<string, LiveCapturedArtifact<SloveniaCityFactSourceId>> {
  return new Map(artifactUnion(bundle).map((artifact) => [artifact.artifactId, artifact]));
}

function exactArtifactIds(left: readonly string[], right: readonly string[]): boolean {
  return sameStrings(left, right) && new Set(left).size === left.length;
}

function validateFixedClaim(
  claim: CityEvidenceClaim,
  plan: CityFixedSourcePlan<SloveniaCityFixedSourceId>,
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
  entryArtifactIds: readonly string[],
): void {
  if (!plainRecord(claim) || !exactKeys(claim, [
    "claimId", "sourceId", "value", "scope", "sourcePeriod", "anchor", "status", "criterionId",
    "definitionId", "officialAreaId", "geoScope", "unit", "denominator",
    "freshnessPolicyVersion",
  ]) || claim.sourceId !== plan.sourceId || claim.criterionId !== plan.criterionId ||
    claim.definitionId !== plan.definitionId || claim.scope !== plan.claimContract.scope ||
    claim.officialAreaId !== plan.claimContract.officialAreaId ||
    claim.geoScope !== plan.claimContract.geoScope || claim.unit !== plan.claimContract.unit ||
    claim.denominator !== plan.claimContract.denominator ||
    claim.freshnessPolicyVersion !== plan.claimContract.freshnessPolicyVersion ||
    claim.status !== "verified" || !identifier(claim.claimId) ||
    typeof claim.sourcePeriod !== "string" || claim.sourcePeriod.length === 0 ||
    claim.sourcePeriod.trim() !== claim.sourcePeriod || !plainRecord(claim.value) ||
    !exactKeys(claim.value, ["kind", "value"]) || claim.value.kind !== "canonical_scalar" ||
    typeof claim.value.value !== "string" || claim.value.value.length === 0 ||
    claim.value.value.trim() !== claim.value.value || !plainRecord(claim.anchor) ||
    !exactKeys(claim.anchor, ["artifactId", "locator", "excerptSha256"]) ||
    !entryArtifactIds.includes(claim.anchor.artifactId) ||
    typeof claim.anchor.locator !== "string" || claim.anchor.locator.length === 0 ||
    claim.anchor.locator.trim() !== claim.anchor.locator || !SHA256.test(claim.anchor.excerptSha256)) {
    mismatch();
  }
  try {
    const validatedValue = replay.validateValue({
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      policyVersion: plan.claimContract.valuePolicyVersion,
      value: claim.value.value,
      unit: plan.claimContract.unit,
      denominator: plan.claimContract.denominator,
    });
    if (validatedValue !== claim.value.value || replay.validateSourcePeriod({
      sourceId: plan.sourceId,
      policyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      sourcePeriod: claim.sourcePeriod,
      assessmentAt: context.assessmentAt,
    }) !== "fresh") mismatch();
  } catch {
    mismatch();
  }
}

function validateFixedTerminal(
  ledger: CityFixedAttemptLedger,
  plan: CityFixedSourcePlan<SloveniaCityFixedSourceId>,
  bundle: GenericStoredBundle,
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
): void {
  const entry = bundle.manifest.entries.find(({ sourceId }) => sourceId === plan.sourceId);
  if (entry === undefined || bundle.snapshot.parserVersions[plan.sourceId] !== plan.parserVersion ||
    entry.indexedSourceUrl !== undefined || entry.versionHint !== plan.parserVersion) mismatch();
  const ledgerArtifactIds = ledger.attempts.flatMap(({ artifactIds }) => artifactIds);
  if (!exactArtifactIds(ledgerArtifactIds, entry.artifactIds)) mismatch();
  const claims = bundle.snapshot.claims.filter(({ sourceId }) => sourceId === plan.sourceId);
  const blockers = bundle.snapshot.blockers.filter(({ sourceId }) => sourceId === plan.sourceId);
  if (ledger.result.kind === "verified") {
    const accepted = ledger.attempts.at(-1);
    if (accepted?.disposition !== "accepted" || entry.navigationUrl !== accepted.navigationUrl ||
      entry.resolvedEvidenceUrl !== accepted.resolvedEvidenceUrl) mismatch();
    if (bundle.snapshot.coverage[plan.sourceId] !== "verified" || blockers.length !== 0 ||
      claims.length !== ledger.result.claimIds.length ||
      !sameStrings(claims.map(({ claimId }) => claimId), ledger.result.claimIds)) mismatch();
    claims.forEach((claim) => validateFixedClaim(claim, plan, replay, context, accepted.artifactIds));
  } else {
    const terminal = ledger.attempts.at(-1);
    if (terminal === undefined || entry.navigationUrl !== terminal.navigationUrl ||
      entry.resolvedEvidenceUrl !== (terminal.resolvedEvidenceUrl ?? terminal.navigationUrl)) mismatch();
    if (bundle.snapshot.coverage[plan.sourceId] !== "unavailable" || claims.length !== 0 ||
      blockers.length !== 1 || blockers[0]!.kind !== ledger.result.reason ||
      blockers[0]!.navigationUrl !== entry.navigationUrl ||
      blockers[0]!.resolvedUrl !== entry.resolvedEvidenceUrl ||
      !exactArtifactIds(blockers[0]!.artifactIds, entry.artifactIds)) mismatch();
  }
}

function validateSafetyTerminal(
  ledger: CitySafetyAttemptLedger,
  bundle: GenericStoredBundle,
  replay: VerifiedReplayContract,
  context: CityEvidenceContext,
  integrity: EvidenceIntegrity,
): void {
  const storedEntry = bundle.manifest.entries.find(({ sourceId }) => sourceId === "si-city-safety");
  const captured = bundle.entries.find(({ sourceId }) => sourceId === "si-city-safety");
  if (storedEntry === undefined || captured === undefined ||
    bundle.snapshot.parserVersions["si-city-safety"] !==
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion) mismatch();
  const terminal = citySafetyTerminalEntry({
    cityCheckRunId: context.cityCheckRunId,
    ledger,
    artifacts: captured.artifacts as unknown as readonly LiveCapturedArtifact<"si-city-safety">[],
    sourcePlan: replay.safetySourcePlan,
    authorityDirectory: replay.officialAuthorityDirectory,
  });
  if (terminal.coverage !== bundle.snapshot.coverage["si-city-safety"] ||
    terminal.parserEntry.navigationUrl !== storedEntry.navigationUrl ||
    terminal.parserEntry.resolvedEvidenceUrl !== storedEntry.resolvedEvidenceUrl ||
    terminal.parserEntry.versionHint !== storedEntry.versionHint ||
    !exactArtifactIds(
      terminal.parserEntry.artifacts.map(({ artifactId }) => artifactId),
      storedEntry.artifactIds,
    )) mismatch();
  const claims = bundle.snapshot.claims.filter(({ sourceId }) => sourceId === "si-city-safety");
  const blockers = bundle.snapshot.blockers.filter(({ sourceId }) => sourceId === "si-city-safety");
  if (terminal.coverage === "verified") {
    if (blockers.length !== 0 || !sameCanonical(terminal.claims, claims, integrity)) mismatch();
  } else if (claims.length !== 0 || blockers.length !== 1 ||
    !sameCanonical(terminal.blocker, blockers[0], integrity)) mismatch();
}

function validateChronology(
  context: CityEvidenceContext,
  fixedLedgers: CityFixedAttemptLedgerTuple,
  safetyLedger: CitySafetyAttemptLedger,
  bundle: GenericStoredBundle,
): void {
  const artifacts = artifactTimes(bundle);
  for (const ledger of fixedLedgers) {
    if (ledger.assessmentAt !== context.assessmentAt || ledger.completedAt < context.assessmentAt ||
      ledger.completedAt > context.completedAt) mismatch();
    for (const attempt of ledger.attempts) {
      if (attempt.attemptedAt < context.assessmentAt || attempt.attemptedAt > ledger.completedAt) mismatch();
      for (const artifactId of attempt.artifactIds) {
        const artifact = artifacts.get(artifactId);
        if (artifact === undefined || artifact.sourceId !== ledger.sourceId ||
          !instant(artifact.capturedAt) ||
          artifact.capturedAt < attempt.attemptedAt || artifact.capturedAt > ledger.completedAt) mismatch();
      }
    }
  }
  if (safetyLedger.assessmentAt !== context.assessmentAt ||
    safetyLedger.completedAt < context.assessmentAt ||
    safetyLedger.completedAt > context.completedAt) mismatch();
  let previousSearchAt = context.assessmentAt;
  const searchTimes = new Map<string, string>();
  for (const query of safetyLedger.queries) {
    if (!instant(query.searchedAt) || query.searchedAt < previousSearchAt ||
      query.searchedAt > safetyLedger.completedAt) mismatch();
    searchTimes.set(query.queryId, query.searchedAt);
    previousSearchAt = query.searchedAt;
  }
  const acquired = new Set<string>();
  for (const candidate of safetyLedger.candidates) {
    const originAt = candidate.origin.kind === "search"
      ? searchTimes.get(candidate.origin.queryId)
      : context.assessmentAt;
    if (originAt === undefined) mismatch();
    for (const reference of candidate.artifactRefs) {
      const artifact = artifacts.get(reference.artifactId);
      if (artifact === undefined || artifact.sourceId !== "si-city-safety" ||
        artifact.capturedAt > safetyLedger.completedAt) mismatch();
      if (!acquired.has(reference.artifactId) && artifact.capturedAt < originAt) mismatch();
      acquired.add(reference.artifactId);
    }
  }
}

function previousReference(
  verified: SemanticReplay,
  snapshot: CityEvidenceSnapshot,
): CitySafetyPreviousAcceptedReference {
  const ledger = verified.safetyAttemptLedger;
  if (ledger.result.kind !== "verified") mismatch();
  const accepted = ledger.candidates[ledger.result.acceptedCandidateIndex];
  if (accepted?.disposition !== "usable") mismatch();
  return {
    cityId: ledger.cityId,
    municipalityCode: ledger.municipalityCode,
    sourcePlanId: ledger.sourcePlanId,
    definitionId: ledger.definitionId,
    publisherId: accepted.publisherId,
    navigationUrl: accepted.publisherNavigationUrl,
    resolvedEvidenceUrl: accepted.resolvedEvidenceUrl,
    referenceYear: accepted.referenceYear,
    evidenceSnapshotId: snapshot.id,
  };
}

function validateGenericReplayContext(
  context: CityEvidenceContext,
  bundle: GenericStoredBundle,
  integrity: EvidenceIntegrity,
): void {
  if (bundle.snapshot.id !== `${context.cityCheckRunId}:evidence` ||
    bundle.snapshot.assessmentDate !== context.assessmentAt.slice(0, 10) ||
    bundle.snapshot.rulesVersion !== context.evidenceRulesVersion ||
    bundle.snapshot.contextHash !== cityEvidenceContextHash(context, integrity) ||
    bundle.snapshot.knowledgeBaselineRevisionId !== undefined ||
    !sameStrings(bundle.manifest.entries.map(({ sourceId }) => sourceId),
      SLOVENIA_CITY_FACT_SOURCE_IDS) ||
    !sameStrings(bundle.entries.map(({ sourceId }) => sourceId), SLOVENIA_CITY_FACT_SOURCE_IDS) ||
    !sameStrings(Object.keys(bundle.snapshot.parserVersions).sort(),
      [...SLOVENIA_CITY_FACT_SOURCE_IDS].sort())) mismatch();
  const manifestById = new Map(bundle.manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const seen = new Set<string>();
  for (const entry of bundle.entries) {
    for (const artifact of entry.artifacts) {
      const manifestArtifact = manifestById.get(artifact.artifactId);
      if (seen.has(artifact.artifactId) || artifact.runId !== context.cityCheckRunId ||
        artifact.sourceId !== entry.sourceId || manifestArtifact?.sourceId !== entry.sourceId ||
        !sameCanonical(evidenceArtifactProvenance(artifact), manifestArtifact, integrity)) mismatch();
      seen.add(artifact.artifactId);
    }
  }
  if (seen.size !== bundle.manifest.artifacts.length) mismatch();
}

function replaySemantics(
  context: CityEvidenceContext,
  rawFixed: CityFixedAttemptLedgerTuple,
  rawSafety: CitySafetyAttemptLedger,
  bundle: GenericStoredBundle,
  packagePort: CityEvidencePackageReplayPort,
  integrity: EvidenceIntegrity,
  previousAccepted?: CitySafetyPreviousAcceptedReference,
): SemanticReplay {
  if (!denseArray(rawFixed) || rawFixed.length !== FIXED_SOURCE_IDS.length) mismatch();
  validateGenericReplayContext(context, bundle, integrity);
  const replay = captureReplayContract(packagePort, context, integrity);
  const selectedPlans = replay.fixedPlansByCityId[context.cityId];
  if (selectedPlans === undefined) mismatch();
  const reconstructed = selectedPlans.map((plan, index) => reconstructCityFixedAttemptLedger(
    rawFixed[index],
    {
      cityCheckRunId: context.cityCheckRunId,
      cityId: context.cityId,
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      planId: plan.planId,
      definitionId: plan.definitionId,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      routes: plan.routes,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      assessmentAt: context.assessmentAt,
      notAfterAt: context.completedAt,
    },
  )) as unknown as CityFixedAttemptLedgerTuple;
  const decisionIntegrity = createCityDecisionIntegrityView(integrity);
  const replayIntegrity = createCityEvidenceReplayIntegrity(integrity);
  const safety = reconstructCitySafetyAttemptLedger(rawSafety, {
    runId: context.cityCheckRunId,
    catalog: replay.catalog.catalog,
    integrity: decisionIntegrity,
    sourcePlan: replay.safetySourcePlan,
    authorityDirectory: replay.officialAuthorityDirectory,
    ...(previousAccepted === undefined ? {} : { previousAccepted }),
  });
  if (safety.cityId !== context.cityId) mismatch();
  const safetyEntry = bundle.entries.find(({ sourceId }) => sourceId === "si-city-safety");
  if (safetyEntry === undefined) mismatch();
  reconstructCitySafetyArtifactBridge({
    cityCheckRunId: context.cityCheckRunId,
    catalog: replay.catalog.catalog,
    sourcePlan: replay.safetySourcePlan,
    authorityDirectory: replay.officialAuthorityDirectory,
    ledger: safety,
    artifacts: safetyEntry.artifacts as unknown as readonly LiveCapturedArtifact<"si-city-safety">[],
    ...(previousAccepted === undefined ? {} : { previousAccepted }),
  }, replayIntegrity);
  for (let index = 0; index < reconstructed.length; index += 1) {
    validateFixedTerminal(
      reconstructed[index],
      selectedPlans[index] as CityFixedSourcePlan<SloveniaCityFixedSourceId>,
      bundle,
      replay,
      context,
    );
  }
  validateSafetyTerminal(safety, bundle, replay, context, integrity);
  validateChronology(context, reconstructed, safety, bundle);
  return { fixedAttemptLedgers: reconstructed, safetyAttemptLedger: safety };
}

function payloadFrom(
  context: CityEvidenceContext,
  ledgers: SemanticReplay,
  contextHash: string,
): CityEvidencePayload {
  return {
    schemaVersion: "city-evidence@1",
    id: `${context.cityCheckRunId}:evidence`,
    cityCheckRunId: context.cityCheckRunId,
    frontierRunId: context.frontierRunId,
    cityId: context.cityId,
    countryCode: context.countryCode,
    packageId: context.packageId,
    packageSchemaVersion: context.packageSchemaVersion,
    catalogRevisionId: context.catalogRevisionId,
    criteriaSnapshotId: context.criteriaSnapshotId,
    rankingSnapshotId: context.rankingSnapshotId,
    definitionIds: context.definitionIds,
    evidenceRulesVersion: context.evidenceRulesVersion,
    assessmentAt: context.assessmentAt,
    fixedAttemptLedgers: ledgers.fixedAttemptLedgers,
    safetyAttemptLedger: ledgers.safetyAttemptLedger,
    contextHash,
    completedAt: context.completedAt,
  };
}

function rowById(database: Database.Database, id: string): CityEvidenceRow | undefined {
  return database.prepare(`
    SELECT id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
           package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
           evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
           payload_hash, hmac
    FROM city_evidence_snapshots WHERE id = ?
  `).get(id) as CityEvidenceRow | undefined;
}

function rowByCheckRunId(database: Database.Database, runId: string): CityEvidenceRow | undefined {
  return database.prepare(`
    SELECT id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
           package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
           evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
           payload_hash, hmac
    FROM city_evidence_snapshots WHERE city_check_run_id = ?
  `).get(runId) as CityEvidenceRow | undefined;
}

function contextFromPayload(payload: CityEvidencePayload): CityEvidenceContext {
  return {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: payload.cityCheckRunId,
    frontierRunId: payload.frontierRunId,
    cityId: payload.cityId,
    countryCode: payload.countryCode,
    packageId: payload.packageId,
    packageSchemaVersion: payload.packageSchemaVersion,
    catalogRevisionId: payload.catalogRevisionId,
    criteriaSnapshotId: payload.criteriaSnapshotId,
    rankingSnapshotId: payload.rankingSnapshotId,
    definitionIds: payload.definitionIds,
    evidenceRulesVersion: payload.evidenceRulesVersion,
    assessmentAt: payload.assessmentAt,
    completedAt: payload.completedAt,
  };
}

function parseRow(
  row: CityEvidenceRow,
  integrity: EvidenceIntegrity,
): { readonly payload: CityEvidencePayload; readonly snapshot: CityEvidenceSnapshot; readonly context: CityEvidenceContext } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.canonical_payload);
  } catch {
    mismatch();
  }
  if (!plainRecord(parsed) || !exactKeys(parsed, PAYLOAD_KEYS) ||
    parsed.schemaVersion !== "city-evidence@1") mismatch();
  const payload = parsed as unknown as CityEvidencePayload;
  const context = contextFromPayload(payload);
  const contextHash = cityEvidenceContextHash(context, integrity);
  const canonicalPayload = integrity.canonical(payload);
  if (canonicalPayload !== row.canonical_payload || payload.id !== row.id ||
    payload.id !== `${payload.cityCheckRunId}:evidence` || row.city_check_run_id !== payload.cityCheckRunId ||
    row.frontier_run_id !== payload.frontierRunId || row.city_id !== payload.cityId ||
    row.country_code !== payload.countryCode || row.package_id !== payload.packageId ||
    row.package_schema_version !== payload.packageSchemaVersion ||
    row.catalog_revision_id !== payload.catalogRevisionId ||
    row.criteria_snapshot_id !== payload.criteriaSnapshotId ||
    row.ranking_snapshot_id !== payload.rankingSnapshotId ||
    row.evidence_rules_version !== payload.evidenceRulesVersion ||
    row.context_hash !== payload.contextHash || payload.contextHash !== contextHash ||
    row.assessment_at !== payload.assessmentAt || row.completed_at !== payload.completedAt ||
    !SHA256.test(row.payload_hash) || !SHA256.test(row.hmac)) mismatch();
  return {
    payload,
    context,
    snapshot: { ...payload, payloadHash: row.payload_hash, hmac: row.hmac },
  };
}

function verifyRowSignature(
  row: CityEvidenceRow,
  payload: CityEvidencePayload,
  integrity: EvidenceIntegrity,
): void {
  const canonicalPayload = integrity.canonical(payload);
  if (canonicalPayload !== row.canonical_payload ||
    !secureHexEqual(row.payload_hash, integrity.hash(canonicalPayload)) ||
    !secureHexEqual(row.hmac, integrity.sign(canonicalPayload))) mismatch();
}

function expectedMatches(
  actual: CityEvidenceContext,
  expected: CityEvidenceExpectations | undefined,
  integrity: EvidenceIntegrity,
): boolean {
  return expected === undefined || sameCanonical(actual, expected, integrity);
}

function insertOverlay(
  database: Database.Database,
  snapshot: CityEvidenceSnapshot,
  canonicalPayload: string,
): void {
  database.prepare(`
    INSERT INTO city_evidence_snapshots (
      id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
      package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
      evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
      payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.cityCheckRunId,
    snapshot.frontierRunId,
    snapshot.cityId,
    snapshot.countryCode,
    snapshot.packageId,
    snapshot.packageSchemaVersion,
    snapshot.catalogRevisionId,
    snapshot.criteriaSnapshotId,
    snapshot.rankingSnapshotId,
    snapshot.evidenceRulesVersion,
    snapshot.contextHash,
    snapshot.assessmentAt,
    snapshot.completedAt,
    canonicalPayload,
    snapshot.payloadHash,
    snapshot.hmac,
  );
}

function exactStoredOverlay(
  database: Database.Database,
  snapshot: CityEvidenceSnapshot,
  canonicalPayload: string,
  integrity: EvidenceIntegrity,
): CityEvidenceSnapshot | undefined {
  const byId = rowById(database, snapshot.id);
  const byRun = rowByCheckRunId(database, snapshot.cityCheckRunId);
  if (byId === undefined && byRun === undefined) return undefined;
  if (byId === undefined || byRun === undefined || byId.id !== byRun.id ||
    byId.canonical_payload !== canonicalPayload ||
    !secureHexEqual(byId.payload_hash, snapshot.payloadHash) ||
    !secureHexEqual(byId.hmac, snapshot.hmac)) mismatch();
  const parsedRow = parseRow(byId, integrity);
  verifyRowSignature(byId, parsedRow.payload, integrity);
  const parsed = parsedRow.snapshot;
  if (!sameCanonical(parsed, snapshot, integrity)) mismatch();
  return parsed;
}

function previousEvidenceId(ledger: CitySafetyAttemptLedger): string | undefined {
  if (!plainRecord(ledger) || !denseArray(ledger.candidates)) mismatch();
  const ids: string[] = [];
  for (const candidate of ledger.candidates) {
    if (!plainRecord(candidate) || !plainRecord(candidate.origin)) mismatch();
    const origin = candidate.origin;
    if (origin.kind !== "previous") continue;
    if (!exactKeys(origin, ["kind", "priorSourcePlanId", "priorEvidenceSnapshotId"]) ||
      !identifier(origin.priorSourcePlanId) || !identifier(origin.priorEvidenceSnapshotId)) mismatch();
    ids.push(origin.priorEvidenceSnapshotId);
  }
  const distinct = [...new Set(ids)];
  if (distinct.length > 1) mismatch();
  return distinct[0];
}

interface VerifiedStoredNode {
  readonly verified: VerifiedCityEvidence;
  readonly replayed: SemanticReplay;
  readonly context: CityEvidenceContext;
}

function verifyStoredNode(
  database: Database.Database,
  row: CityEvidenceRow,
  packageReplay: CityEvidencePackageReplayPort,
  integrity: EvidenceIntegrity,
  previousAccepted?: CitySafetyPreviousAcceptedReference,
): VerifiedStoredNode {
  const parsed = parseRow(row, integrity);
  const generic = loadVerifiedEvidenceBundle<SloveniaCityFactSourceId, CityEvidenceClaim>(
    database,
    parsed.snapshot.id,
    integrity,
    {
      assessmentDate: parsed.context.assessmentAt.slice(0, 10),
      rulesVersion: parsed.context.evidenceRulesVersion,
    },
  );
  if (generic.snapshot.contextHash !== parsed.snapshot.contextHash) mismatch();
  const replayed = replaySemantics(
    parsed.context,
    parsed.payload.fixedAttemptLedgers,
    parsed.payload.safetyAttemptLedger,
    generic,
    packageReplay,
    integrity,
    previousAccepted,
  );
  if (!sameCanonical(replayed.fixedAttemptLedgers, parsed.payload.fixedAttemptLedgers, integrity) ||
    !sameCanonical(replayed.safetyAttemptLedger, parsed.payload.safetyAttemptLedger, integrity)) mismatch();
  verifyRowSignature(row, parsed.payload, integrity);
  return {
    context: parsed.context,
    replayed,
    verified: { snapshot: parsed.snapshot, genericEvidence: generic },
  };
}

function validatePriorChain(
  database: Database.Database,
  currentId: string,
  currentAssessmentAt: string,
  currentLedger: CitySafetyAttemptLedger,
  packageReplay: CityEvidencePackageReplayPort,
  integrity: EvidenceIntegrity,
): CitySafetyPreviousAcceptedReference | undefined {
  let nextId = previousEvidenceId(currentLedger);
  if (nextId === undefined) return undefined;
  const visited = new Set([currentId]);
  const chain: { readonly row: CityEvidenceRow; readonly parsed: ReturnType<typeof parseRow> }[] = [];
  while (nextId !== undefined) {
    if (visited.has(nextId)) mismatch();
    visited.add(nextId);
    const row = rowById(database, nextId);
    if (row === undefined) mismatch();
    const parsed = parseRow(row, integrity);
    chain.push({ row, parsed });
    nextId = previousEvidenceId(parsed.payload.safetyAttemptLedger);
  }

  let accepted: CitySafetyPreviousAcceptedReference | undefined;
  let previousCompletedAt: string | undefined;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]!;
    if (previousCompletedAt !== undefined &&
      previousCompletedAt > node.parsed.context.assessmentAt) mismatch();
    const verified = verifyStoredNode(
      database,
      node.row,
      packageReplay,
      integrity,
      accepted,
    );
    accepted = previousReference(verified.replayed, verified.verified.snapshot);
    previousCompletedAt = verified.context.completedAt;
  }
  if (accepted === undefined || previousCompletedAt === undefined ||
    previousCompletedAt > currentAssessmentAt) mismatch();
  return accepted;
}

export class SqliteCityEvidenceStore {
  constructor(
    private readonly database: Database.Database,
    private readonly integrity: EvidenceIntegrity,
    private readonly packageReplay: CityEvidencePackageReplayPort,
  ) {}

  seal(borrowedInput: CityEvidenceSealInput): CityEvidenceSnapshot {
    const input = ownSnapshot(borrowedInput);
    if (!plainRecord(input) || !exactKeys(input, SEAL_INPUT_KEYS)) mismatch();
    const context = contextFrom(input);
    const contextHash = cityEvidenceContextHash(context, this.integrity);
    verifyGenericBundle(context, input.genericEvidence, input.artifacts, this.integrity);
    const suppliedBundle: GenericStoredBundle = {
      snapshot: input.genericEvidence.snapshot,
      manifest: input.genericEvidence.manifest,
      entries: input.genericEvidence.manifest.entries.map((entry) => ({
        sourceId: entry.sourceId,
        navigationUrl: entry.navigationUrl,
        ...(entry.indexedSourceUrl === undefined ? {} : { indexedSourceUrl: entry.indexedSourceUrl }),
        resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
        artifacts: entry.artifactIds.map((artifactId) => {
          const matches = input.artifacts.filter((artifact) => artifact.artifactId === artifactId);
          if (matches.length !== 1) mismatch();
          return matches[0]!;
        }),
        ...(entry.versionHint === undefined ? {} : { versionHint: entry.versionHint }),
      })),
    };
    const previousAccepted = validatePriorChain(
      this.database,
      `${context.cityCheckRunId}:evidence`,
      context.assessmentAt,
      input.safetyAttemptLedger,
      this.packageReplay,
      this.integrity,
    );
    const ledgers = replaySemantics(
      context,
      input.fixedAttemptLedgers,
      input.safetyAttemptLedger,
      suppliedBundle,
      this.packageReplay,
      this.integrity,
      previousAccepted,
    );
    const payload = payloadFrom(context, ledgers, contextHash);
    const canonicalPayload = this.integrity.canonical(payload);
    const snapshot: CityEvidenceSnapshot = {
      ...payload,
      payloadHash: this.integrity.hash(canonicalPayload),
      hmac: this.integrity.sign(canonicalPayload),
    };
    const persistenceIntegrity = createCityDecisionIntegrityView(this.integrity);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const artifact of input.artifacts) {
        insertLiveArtifact(this.database, artifact, persistenceIntegrity);
      }
      const existingOverlayById = rowById(this.database, snapshot.id);
      const existingOverlayByRun = rowByCheckRunId(this.database, snapshot.cityCheckRunId);
      let storedGeneric: GenericStoredBundle | undefined;
      try {
        storedGeneric = loadVerifiedEvidenceBundle<SloveniaCityFactSourceId, CityEvidenceClaim>(
          this.database,
          snapshot.id,
          this.integrity,
          {
            assessmentDate: context.assessmentAt.slice(0, 10),
            parserVersions: input.genericEvidence.snapshot.parserVersions,
            rulesVersion: context.evidenceRulesVersion,
          },
        );
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "evidence_not_found") throw error;
      }
      if (storedGeneric === undefined &&
        (existingOverlayById !== undefined || existingOverlayByRun !== undefined)) mismatch();
      if (storedGeneric === undefined) {
        insertSealedEvidence(this.database, input.genericEvidence, this.integrity);
      } else if (!sameCanonical(storedGeneric.snapshot, input.genericEvidence.snapshot, this.integrity) ||
        !sameCanonical(storedGeneric.manifest, input.genericEvidence.manifest, this.integrity)) mismatch();
      let storedOverlay = exactStoredOverlay(
        this.database,
        snapshot,
        canonicalPayload,
        this.integrity,
      );
      if (storedOverlay === undefined) {
        try {
          insertOverlay(this.database, snapshot, canonicalPayload);
        } catch (error) {
          if (!constraint(error)) throw error;
        }
        storedOverlay = exactStoredOverlay(
          this.database,
          snapshot,
          canonicalPayload,
          this.integrity,
        );
        if (storedOverlay === undefined) mismatch();
      }
      this.database.exec("COMMIT");
      return storedOverlay;
    } catch (error) {
      if (this.database.inTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
  }

  loadVerified(
    borrowedId: string,
    borrowedExpected?: CityEvidenceExpectations,
  ): VerifiedCityEvidence {
    const owned = ownSnapshot({ id: borrowedId, expected: borrowedExpected });
    if (!identifier(owned.id)) mismatch();
    const expected = owned.expected;
    if (expected !== undefined) {
      if (!plainRecord(expected) || !exactKeys(expected, CONTEXT_KEYS)) mismatch();
      cityEvidenceContextHash(expected, this.integrity);
    }
    const read = this.database.transaction(() => {
      const row = rowById(this.database, owned.id);
      if (row === undefined) throw new Error("city_evidence_not_found");
      const parsed = parseRow(row, this.integrity);
      if (!expectedMatches(parsed.context, expected, this.integrity)) mismatch();
      const previousAccepted = validatePriorChain(
        this.database,
        parsed.snapshot.id,
        parsed.context.assessmentAt,
        parsed.payload.safetyAttemptLedger,
        this.packageReplay,
        this.integrity,
      );
      const verified = verifyStoredNode(
        this.database,
        row,
        this.packageReplay,
        this.integrity,
        previousAccepted,
      );
      return verified.verified;
    });
    return ownSnapshot(read());
  }

  findVerifiedByCheckRunId(borrowedRunId: string): VerifiedCityEvidence | undefined {
    const runId = ownSnapshot(borrowedRunId);
    if (!identifier(runId)) mismatch();
    const row = rowByCheckRunId(this.database, runId);
    return row === undefined ? undefined : this.loadVerified(row.id);
  }
}
