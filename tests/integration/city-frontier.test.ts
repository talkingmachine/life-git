import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";

import {
  createCityFrontierApplication,
  type CityFrontierApplication,
  type CityFrontierApplicationAssembly,
  type CityFrontierApplicationPorts,
  type CityFrontierFixedRoutePorts,
  type CityFrontierPrepared,
  type CityFrontierProfileReadPort,
  type CityFrontierResolvedCountryReadPort,
  type CityFrontierSelectionAuthorityPort,
  type CityFrontierSetupReadModel,
  type PrepareCityFrontierContinuationInput,
  type StartCityFrontierInput,
  type VerifiedCityTerminalSelectionAuthority,
} from "../../src/application/city-frontier";
import {
  type CitySelectionApplication,
  type CitySelectionApplicationPorts,
} from "../../src/application/city-selection";
import type {
  CityCatalogStorePort,
  CityEvidenceReplayPorts,
  CityEvidenceStorePort,
  CityKnowledgeStorePort,
  InstalledCityCatalogReadPort,
  InstalledCityPackageManifestStorePort,
  InstalledCityPackageLookupPort,
  InstalledCityPackageManifestAppendInput,
} from "../../src/application/city-data-contracts";
import {
  cityEvidenceContextHash,
  cityCriteriaPayloadHash,
  cityFrontierRunId,
  type CityEvidenceContext,
  type CityEvidencePayload,
  type CityEvidenceSealInput,
  type CityCriteriaCommandPayload,
} from "../../src/application/city-data-contracts";
import { installCityPackage } from "../../src/application/install-city-package";
import { sealCityPackageAdministrativeEvidence } from
  "../../src/application/seal-administrative-evidence";
import type { ApprovedCityCriteriaDefaultsRegistry } from
  "../../src/decision/approved-city-criteria-defaults";
import type {
  CitySelectionSnapshotPayload,
  CityBranchReadPort,
  CityCriteriaReadPort,
  CityFrontierAppendPort,
  CityFrontierEvent,
  CityFrontierRevision,
  CityFrontierReadModel,
  CityFrontierReadPort,
  CityFrontierStartWriterPort,
  CityFrontierStartPublication,
  CityRankingReadPort,
  CityRankingSnapshot,
  CitySelectionHistoryReadPort,
  CitySelectionWithBranch,
  TerminalCityShortlistSnapshot,
} from "../../src/application/city-frontier-contracts";
import {
  createCitySelectionWithBranch,
  reconstructCityFrontierRevision,
  reconstructCityRankingSnapshot,
  reconstructCitySelectionSnapshot,
  reconstructCitySelectionWithBranch,
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
} from "../../src/application/city-frontier-contracts";
import type {
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "../../src/application/city-safety-contracts";
import {
  createCityBranchCommit,
  createPreCityBranchCommit,
  replayCityBranchCommit,
  replayPreCityBranchCommit,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../../src/branch/city";
import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogRevision,
} from "../../src/decision/city-catalog";
import {
  CITY_CRITERION_IDS,
  confirmCityCriteria,
  type CityCriterionDraft,
  type CityCriteriaSnapshot,
  type CityCriterionEvaluation,
  type CityCriterionEvaluationInput,
  type CityCriterionEvaluatorRegistry,
  type InstalledCityCriteriaDefaults,
  type InstalledCityCriterionDefinitionTuple,
} from "../../src/decision/city-criteria";
import {
  rankCities,
  type CityKnowledgeRankingProjection,
  type CityRankingResult,
} from "../../src/decision/city-ranker";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type {
  CityCommittedFactProjection,
  CityCommittedFactProjectionTuple,
  CityMarkerBinding,
  CityMarkerAuthorityProjection,
  CityFrontierVerificationBudget,
  ReconstructCityFrontierInput,
} from "../../src/decision/city-frontier-policy";
import {
  reconstructCityFrontier,
  reconstructCityLiveMarker,
  type CityLiveMarker,
} from "../../src/decision/city-frontier-policy";
import { reconstructCitySelection } from "../../src/decision/city-selection";
import { confirmPreferenceProfile } from "../../src/decision/preference-profile";
import { confirmRelocationProfile } from "../../src/decision/relocation-profile";
import {
  createCityFrontierComposition,
  type CityFrontierCompositionOptions,
  type CityFrontierFixedTiming,
  type CityFrontierLiveSourceConfiguration,
} from "../../src/infrastructure/city-frontier-composition";
import { createCitySafetySearchPort } from
  "../../src/infrastructure/sources/city-safety-search-adapter";
import { SqliteCitySelectionWriter } from
  "../../src/infrastructure/sqlite/city-selection-writer";
import {
  createHttpCitySafetySearchStep,
  type CitySafetySearchHttpRequest,
} from "../../src/infrastructure/sources/http-city-safety-search-step";
import { createSloveniaCitySafetyAdapter } from
  "../../src/infrastructure/sources/slovenia-city-safety-adapter";
import {
  createConfirmedLifeComposition,
  type ConfirmedLifeCompositionOptions,
} from "../../src/infrastructure/composition-root";
import {
  getCityResearchPackageAvailability,
  type InstalledCityPackageManifest,
  type InstalledCityPackageManifestPayload,
  type InstalledCityResearchPackage,
  type InstalledCityPackageExactKey,
} from "../../src/research/city-package";
import {
  type CityFixedDeadlineScheduler,
  type CityFixedAttemptLedger,
  type CityEvidenceClaim,
  type CityFixedEvidenceClaim,
  type CityFixedRoutePort,
  type CityFixedSourceRunInput,
  type CityFixedSourcePlan,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
} from "../../src/research/city-evidence";
import type { LiveCapturedArtifact, ParserEntry } from "../../src/research/contracts";
import {
  buildCityKnowledgeRevision,
  projectCityKnowledgeForRanking,
  type CityKnowledgeFactContractTuple,
  type CityKnowledgeRevision,
} from "../../src/research/city-knowledge";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import { SLOVENIA_CITY_FACT_VERSIONS } from "../../src/research/slovenia-city-plan";
import type { ResolvedCountryShortlistSnapshot } from "../../src/application/country-resolution-contracts";
import {
  createCityDecisionIntegrityView,
  createCityEvidenceReplayIntegrity,
  createEvidenceIntegrity,
} from "../../src/infrastructure/integrity";
import {
  InstalledCityPackages,
  type InstalledCityPackageBehaviorRegistry,
} from "../../src/infrastructure/sources/installed-city-packages";
import { SqliteCityCatalogStore } from "../../src/infrastructure/sqlite/city-catalog-store";
import { SqliteCityEvidenceStore } from "../../src/infrastructure/sqlite/city-evidence-store";
import { SqliteCityKnowledgeStore } from "../../src/infrastructure/sqlite/city-knowledge-store";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";
import {
  insertSealedEvidence,
  SqliteAdministrativeEvidenceStore,
} from "../../src/infrastructure/sqlite/evidence-store";
import { SqliteCityPackageManifestStore } from
  "../../src/infrastructure/sqlite/city-package-manifest-store";
import {
  sealEvidencePlan,
  type EvidenceIntegrity,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";
import type { CitySafetyAttemptLedger } from "../../src/research/city-safety-evidence";

const fixedRunnerHarness = vi.hoisted(() => ({
  inputs: [] as unknown[],
  promises: [] as Promise<unknown>[],
  aroundDelegate: undefined as ((delegate: () => unknown) => unknown) | undefined,
  onInput: undefined as (() => void) | undefined,
}));
const safetyRunnerHarness = vi.hoisted(() => ({ promises: [] as Promise<unknown>[] }));
const genericSealHarness = vi.hoisted(() => ({
  calls: 0,
  promises: [] as Promise<unknown>[],
  beforeReturn: undefined as (() => void) | undefined,
}));
const planGateHarness = vi.hoisted(() => ({
  fixed: [] as Array<{ readonly value: unknown; readonly expectedSourceId: string }>,
  directories: [] as Array<readonly unknown[]>,
  safetyPlans: [] as Array<readonly unknown[]>,
  definitionStructures: [] as Array<readonly unknown[]>,
  defaults: [] as Array<readonly unknown[]>,
  definitions: [] as Array<readonly unknown[]>,
  semanticEntries: [] as Array<{
    readonly args: readonly unknown[];
    readonly fixedCount: number;
    readonly directoryCount: number;
    readonly safetyPlanCount: number;
    readonly defaultsCount: number;
    readonly definitionsCount: number;
    readonly preSemantic: unknown;
    readonly gateSnapshot: {
      readonly fixed: Array<{ readonly value: unknown; readonly expectedSourceId: string }>;
      readonly directories: Array<readonly unknown[]>;
      readonly safetyPlans: Array<readonly unknown[]>;
      readonly defaults: Array<readonly unknown[]>;
      readonly definitions: Array<readonly unknown[]>;
      readonly order: string[];
    };
  }>,
  beforeSemantic: undefined as (() => unknown) | undefined,
  order: [] as string[],
}));
const infrastructurePlanGateRead = vi.hoisted(() => ({ depth: 0 }));
const compositionHarness = vi.hoisted(() => ({
  enabled: false,
  captureReceiverCalls: false,
  applicationFactoryPorts: [] as unknown[],
  selectionApplicationFactoryPorts: [] as unknown[],
  selectionWriters: [] as unknown[],
  selectionWriterDependencies: [] as unknown[],
  manifestStores: [] as unknown[],
  installedPackageReceivers: [] as unknown[],
  manifestLoadReceivers: [] as unknown[],
  currentLoadReceivers: [] as unknown[],
  httpSearchFactoryArgs: [] as unknown[],
  httpSearchFactoryResults: [] as unknown[],
  searchPortFactoryArgs: [] as unknown[],
  searchPortFactoryResults: [] as unknown[],
  sourceFactoryOrder: [] as string[],
  rootCompositionEnabled: false,
  rootCompositionArgs: [] as unknown[],
  rootCompositionResults: [] as unknown[],
  profileReceiverCallsEnabled: false,
  profileStores: [] as unknown[],
  profileRelocationReceivers: [] as unknown[],
  profileRelocationArgs: [] as unknown[],
  profilePreferenceReceivers: [] as unknown[],
  profilePreferenceArgs: [] as unknown[],
}));
const selectionReplayHarness = vi.hoisted(() => ({
  enabled: false,
  pureInputs: [] as unknown[],
  pairInputs: [] as unknown[],
  order: [] as string[],
  onPhase: undefined as ((phase: string) => void) | undefined,
}));

vi.mock("../../src/application/city-frontier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/application/city-frontier")>();
  return {
    ...actual,
    createCityFrontierApplication: (
      ...args: Parameters<typeof actual.createCityFrontierApplication>
    ) => {
      if (compositionHarness.enabled) compositionHarness.applicationFactoryPorts.push(args[0]);
      return actual.createCityFrontierApplication(...args);
    },
  };
});

vi.mock("../../src/application/city-selection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/application/city-selection")>();
  return {
    ...actual,
    createCitySelectionApplication: (
      ...args: Parameters<typeof actual.createCitySelectionApplication>
    ) => {
      if (compositionHarness.enabled) {
        compositionHarness.selectionApplicationFactoryPorts.push(args[0]);
      }
      return actual.createCitySelectionApplication(...args);
    },
  };
});

vi.mock("../../src/infrastructure/sqlite/city-selection-writer", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sqlite/city-selection-writer")
  >();
  class ObservedSelectionWriter extends actual.SqliteCitySelectionWriter {
    constructor(...args: ConstructorParameters<typeof actual.SqliteCitySelectionWriter>) {
      super(...args);
      if (compositionHarness.enabled) {
        compositionHarness.selectionWriters.push(this);
        compositionHarness.selectionWriterDependencies.push(args[2]);
      }
    }
  }
  return { ...actual, SqliteCitySelectionWriter: ObservedSelectionWriter };
});

vi.mock("../../src/infrastructure/city-frontier-composition", async (importOriginal) => {
  const actual = await importOriginal<{
    readonly createCityFrontierComposition: typeof createCityFrontierComposition;
  }>();
  return {
    ...actual,
    createCityFrontierComposition: (
      ...args: Parameters<typeof actual.createCityFrontierComposition>
    ) => {
      if (compositionHarness.rootCompositionEnabled) {
        compositionHarness.rootCompositionArgs.push(args[0]);
      }
      const result = actual.createCityFrontierComposition(...args);
      if (compositionHarness.rootCompositionEnabled) {
        compositionHarness.rootCompositionResults.push(result);
      }
      return result;
    },
  };
});

vi.mock("../../src/infrastructure/sqlite/city-package-manifest-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sqlite/city-package-manifest-store")
  >();
  class ObservedManifestStore extends actual.SqliteCityPackageManifestStore {
    constructor(...args: ConstructorParameters<typeof actual.SqliteCityPackageManifestStore>) {
      super(...args);
      if (compositionHarness.enabled) compositionHarness.manifestStores.push(this);
    }

    override loadVerified(
      ...args: Parameters<SqliteCityPackageManifestStore["loadVerified"]>
    ): ReturnType<SqliteCityPackageManifestStore["loadVerified"]> {
      if (compositionHarness.captureReceiverCalls) {
        compositionHarness.manifestLoadReceivers.push(this);
      }
      return super.loadVerified(...args);
    }

    override loadCurrentVerified(
      ...args: Parameters<SqliteCityPackageManifestStore["loadCurrentVerified"]>
    ): ReturnType<SqliteCityPackageManifestStore["loadCurrentVerified"]> {
      if (compositionHarness.captureReceiverCalls) {
        compositionHarness.currentLoadReceivers.push(this);
      }
      return super.loadCurrentVerified(...args);
    }
  }
  return { ...actual, SqliteCityPackageManifestStore: ObservedManifestStore };
});

vi.mock("../../src/infrastructure/sqlite/profile-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sqlite/profile-store")
  >();
  class ObservedProfileStore extends actual.SqliteProfileStore {
    constructor(...args: ConstructorParameters<typeof actual.SqliteProfileStore>) {
      super(...args);
      if (compositionHarness.rootCompositionEnabled) compositionHarness.profileStores.push(this);
    }

    override loadRelocationAnyVerified(
      ...args: Parameters<SqliteProfileStore["loadRelocationAnyVerified"]>
    ): ReturnType<SqliteProfileStore["loadRelocationAnyVerified"]> {
      if (compositionHarness.profileReceiverCallsEnabled) {
        compositionHarness.profileRelocationReceivers.push(this);
        compositionHarness.profileRelocationArgs.push(args);
      }
      return super.loadRelocationAnyVerified(...args);
    }

    override loadPreferenceForRankingVerified(
      ...args: Parameters<SqliteProfileStore["loadPreferenceForRankingVerified"]>
    ): ReturnType<SqliteProfileStore["loadPreferenceForRankingVerified"]> {
      if (compositionHarness.profileReceiverCallsEnabled) {
        compositionHarness.profilePreferenceReceivers.push(this);
        compositionHarness.profilePreferenceArgs.push(args);
      }
      return super.loadPreferenceForRankingVerified(...args);
    }
  }
  return { ...actual, SqliteProfileStore: ObservedProfileStore };
});

vi.mock("../../src/infrastructure/sources/installed-city-packages", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sources/installed-city-packages")
  >();
  class ObservedInstalledCityPackages extends actual.InstalledCityPackages {
    constructor(...args: ConstructorParameters<typeof actual.InstalledCityPackages>) {
      super(...args);
      if (compositionHarness.enabled) compositionHarness.installedPackageReceivers.push(args[0]);
    }
  }
  return { ...actual, InstalledCityPackages: ObservedInstalledCityPackages };
});

vi.mock("../../src/infrastructure/sources/http-city-safety-search-step", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sources/http-city-safety-search-step")
  >();
  return {
    ...actual,
    createHttpCitySafetySearchStep: (
      ...args: Parameters<typeof actual.createHttpCitySafetySearchStep>
    ) => {
      if (compositionHarness.enabled) {
        compositionHarness.httpSearchFactoryArgs.push(args);
        compositionHarness.sourceFactoryOrder.push("http.attempt");
      }
      const result = actual.createHttpCitySafetySearchStep(...args);
      if (compositionHarness.enabled) {
        compositionHarness.httpSearchFactoryResults.push(result);
        compositionHarness.sourceFactoryOrder.push("http.result");
      }
      return result;
    },
  };
});

vi.mock("../../src/infrastructure/sources/city-safety-search-adapter", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/infrastructure/sources/city-safety-search-adapter")
  >();
  return {
    ...actual,
    createCitySafetySearchPort: (
      ...args: Parameters<typeof actual.createCitySafetySearchPort>
    ) => {
      if (compositionHarness.enabled) {
        compositionHarness.searchPortFactoryArgs.push(args);
        compositionHarness.sourceFactoryOrder.push("search.attempt");
      }
      const result = actual.createCitySafetySearchPort(...args);
      if (compositionHarness.enabled) {
        compositionHarness.searchPortFactoryResults.push(result);
        compositionHarness.sourceFactoryOrder.push("search.result");
      }
      return result;
    },
  };
});

vi.mock("../../src/research/city-evidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/research/city-evidence")>();
  return {
    ...actual,
    reconstructCityFixedSourcePlan: (
      ...args: Parameters<typeof actual.reconstructCityFixedSourcePlan>
    ) => {
      const [value, expectedSourceId] = args;
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.fixed.push({ value, expectedSourceId });
        const cityId = value !== null && typeof value === "object" && "cityId" in value
          ? String(value.cityId)
          : "invalid";
        planGateHarness.order.push(`fixed:${cityId}:${expectedSourceId}`);
      }
      return actual.reconstructCityFixedSourcePlan(...args);
    },
    runCityFixedSourcePlan: (...args: Parameters<typeof actual.runCityFixedSourcePlan>) => {
      fixedRunnerHarness.inputs.push(args[0]);
      fixedRunnerHarness.onInput?.();
      const delegate = () => actual.runCityFixedSourcePlan(...args);
      const promise = (fixedRunnerHarness.aroundDelegate?.(delegate) ?? delegate()) as
        ReturnType<typeof actual.runCityFixedSourcePlan>;
      fixedRunnerHarness.promises.push(promise);
      return promise;
    },
  };
});

vi.mock("../../src/research/city-safety-source-plan", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/research/city-safety-source-plan")
  >();
  return {
    ...actual,
    reconstructOfficialAuthorityDirectory: (
      ...args: Parameters<typeof actual.reconstructOfficialAuthorityDirectory>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.directories.push(args);
        planGateHarness.order.push("directory");
      }
      return actual.reconstructOfficialAuthorityDirectory(...args);
    },
    reconstructCitySafetySourcePlan: (
      ...args: Parameters<typeof actual.reconstructCitySafetySourcePlan>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.safetyPlans.push(args);
        planGateHarness.order.push("safety-plan");
      }
      return actual.reconstructCitySafetySourcePlan(...args);
    },
  };
});

vi.mock("../../src/decision/city-criteria", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/decision/city-criteria")>();
  return {
    ...actual,
    reconstructInstalledCityCriterionDefinitionsStructure: (
      ...args: Parameters<typeof actual.reconstructInstalledCityCriterionDefinitionsStructure>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.definitionStructures.push(args);
      }
      return actual.reconstructInstalledCityCriterionDefinitionsStructure(...args);
    },
    reconstructInstalledCityCriteriaDefaults: (
      ...args: Parameters<typeof actual.reconstructInstalledCityCriteriaDefaults>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.defaults.push(args);
        planGateHarness.order.push("defaults");
      }
      return actual.reconstructInstalledCityCriteriaDefaults(...args);
    },
    reconstructInstalledCityCriterionDefinitions: (
      ...args: Parameters<typeof actual.reconstructInstalledCityCriterionDefinitions>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.definitions.push(args);
        planGateHarness.order.push("definitions");
      }
      return actual.reconstructInstalledCityCriterionDefinitions(...args);
    },
  };
});

vi.mock("../../src/application/city-frontier-contracts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/application/city-frontier-contracts")
  >();
  return {
    ...actual,
    verifyCityRankingSnapshotSemantics: (
      ...args: Parameters<typeof actual.verifyCityRankingSnapshotSemantics>
    ) => {
      if (infrastructurePlanGateRead.depth === 0) {
        planGateHarness.semanticEntries.push({
          args,
          fixedCount: planGateHarness.fixed.length,
          directoryCount: planGateHarness.directories.length,
          safetyPlanCount: planGateHarness.safetyPlans.length,
          defaultsCount: planGateHarness.defaults.length,
          definitionsCount: planGateHarness.definitions.length,
          preSemantic: planGateHarness.beforeSemantic?.(),
          gateSnapshot: {
            fixed: planGateHarness.fixed.slice(),
            directories: planGateHarness.directories.map((entry) => entry.slice()),
            safetyPlans: planGateHarness.safetyPlans.map((entry) => entry.slice()),
            defaults: planGateHarness.defaults.map((entry) => entry.slice()),
            definitions: planGateHarness.definitions.map((entry) => entry.slice()),
            order: [...planGateHarness.order, "semantic-verifier"],
          },
        });
        planGateHarness.order.push("semantic-verifier");
      }
      if (selectionReplayHarness.enabled) selectionReplayHarness.order.push("semantic-verifier");
      return actual.verifyCityRankingSnapshotSemantics(...args);
    },
    reconstructCitySelectionWithBranch: (
      ...args: Parameters<typeof actual.reconstructCitySelectionWithBranch>
    ) => {
      if (selectionReplayHarness.enabled) {
        selectionReplayHarness.pairInputs.push(args);
        selectionReplayHarness.order.push("selection-wrapper");
        selectionReplayHarness.onPhase?.("selection-wrapper");
      }
      return actual.reconstructCitySelectionWithBranch(...args);
    },
  };
});

vi.mock("../../src/decision/city-selection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/decision/city-selection")>();
  return {
    ...actual,
    reconstructCitySelection: (...args: Parameters<typeof actual.reconstructCitySelection>) => {
      if (selectionReplayHarness.enabled) {
        selectionReplayHarness.pureInputs.push(args);
        selectionReplayHarness.order.push("pure-selection");
        selectionReplayHarness.onPhase?.("pure-selection");
      }
      return actual.reconstructCitySelection(...args);
    },
  };
});

vi.mock("../../src/application/run-city-safety-discovery", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/application/run-city-safety-discovery")
  >();
  return {
    ...actual,
    runCitySafetyDiscovery: (...args: Parameters<typeof actual.runCitySafetyDiscovery>) => {
      const promise = actual.runCitySafetyDiscovery(...args);
      safetyRunnerHarness.promises.push(promise);
      return promise;
    },
  };
});

vi.mock("../../src/research/research-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/research/research-plan")>();
  return {
    ...actual,
    sealEvidencePlan(...args: Parameters<typeof actual.sealEvidencePlan>) {
      genericSealHarness.calls += 1;
      const promise = actual.sealEvidencePlan(...args).then((result) => {
        const action = genericSealHarness.beforeReturn;
        genericSealHarness.beforeReturn = undefined;
        action?.();
        return result;
      });
      genericSealHarness.promises.push(promise);
      return promise;
    },
  };
});

const NEVER = (): never => { throw new Error("unexpected_callback"); };
const DIGEST = "a".repeat(64);
const EVIDENCE_INTEGRITY = createEvidenceIntegrity("task-14-city-frontier-test-key-at-least-32-bytes");
const DECISION_INTEGRITY = createCityDecisionIntegrityView(EVIDENCE_INTEGRITY);
const START_AT = "2026-08-25T12:00:00.000Z";
const PARENT_AT = "2026-08-24T12:00:00.000Z";
type GatedResearchSourceId = SloveniaCityFixedSourceId | "si-city-safety";
const databases: Database.Database[] = [];
const VALID_DRAFT: StartCityFrontierInput["criteriaDraft"] = [
  { criterionId: "safety", definitionId: "si-municipal-police-offences-per-100000@1", mode: "required", importance: 5, target: "2" },
  { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 4, target: "900" },
  { criterionId: "urban_transit", definitionId: "transit@1", mode: "weighted", importance: 3, target: "0.7" },
  { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "weighted", importance: 2, target: "100" },
];
const DERIVED_V1_DRAFT: StartCityFrontierInput["criteriaDraft"] = [
  { criterionId: "safety", definitionId: "si-municipal-police-offences-per-100000@1", mode: "weighted", importance: 3, target: "2" },
  { criterionId: "long_term_rent", definitionId: "rent@1", mode: "weighted", importance: 4, target: "900" },
  { criterionId: "urban_transit", definitionId: "transit@1", mode: "required", importance: 4, target: "0.7" },
  { criterionId: "fixed_broadband", definitionId: "broadband@1", mode: "required", importance: 4, target: "100" },
];

type MutableRecord = Record<PropertyKey, unknown>;

function withInfrastructurePlanGateRead<T>(read: () => T): T {
  infrastructurePlanGateRead.depth += 1;
  try {
    return read();
  } finally {
    infrastructurePlanGateRead.depth -= 1;
  }
}

async function withInfrastructurePlanGateReadAsync<T>(
  read: () => Promise<T>,
): Promise<T> {
  infrastructurePlanGateRead.depth += 1;
  try {
    return await read();
  } finally {
    infrastructurePlanGateRead.depth -= 1;
  }
}

afterEach(() => {
  infrastructurePlanGateRead.depth = 0;
  fixedRunnerHarness.inputs.splice(0);
  fixedRunnerHarness.promises.splice(0);
  fixedRunnerHarness.aroundDelegate = undefined;
  fixedRunnerHarness.onInput = undefined;
  safetyRunnerHarness.promises.splice(0);
  genericSealHarness.calls = 0;
  genericSealHarness.promises.splice(0);
  genericSealHarness.beforeReturn = undefined;
  planGateHarness.fixed.splice(0);
  planGateHarness.directories.splice(0);
  planGateHarness.safetyPlans.splice(0);
  planGateHarness.definitionStructures.splice(0);
  planGateHarness.defaults.splice(0);
  planGateHarness.definitions.splice(0);
  planGateHarness.semanticEntries.splice(0);
  planGateHarness.beforeSemantic = undefined;
  planGateHarness.order.splice(0);
  compositionHarness.enabled = false;
  compositionHarness.captureReceiverCalls = false;
  compositionHarness.applicationFactoryPorts.splice(0);
  compositionHarness.selectionApplicationFactoryPorts.splice(0);
  compositionHarness.selectionWriters.splice(0);
  compositionHarness.selectionWriterDependencies.splice(0);
  compositionHarness.manifestStores.splice(0);
  compositionHarness.installedPackageReceivers.splice(0);
  compositionHarness.manifestLoadReceivers.splice(0);
  compositionHarness.currentLoadReceivers.splice(0);
  compositionHarness.httpSearchFactoryArgs.splice(0);
  compositionHarness.httpSearchFactoryResults.splice(0);
  compositionHarness.searchPortFactoryArgs.splice(0);
  compositionHarness.searchPortFactoryResults.splice(0);
  compositionHarness.sourceFactoryOrder.splice(0);
  compositionHarness.rootCompositionEnabled = false;
  compositionHarness.rootCompositionArgs.splice(0);
  compositionHarness.rootCompositionResults.splice(0);
  compositionHarness.profileReceiverCallsEnabled = false;
  compositionHarness.profileStores.splice(0);
  compositionHarness.profileRelocationReceivers.splice(0);
  compositionHarness.profileRelocationArgs.splice(0);
  compositionHarness.profilePreferenceReceivers.splice(0);
  compositionHarness.profilePreferenceArgs.splice(0);
  selectionReplayHarness.enabled = false;
  selectionReplayHarness.pureInputs.splice(0);
  selectionReplayHarness.pairInputs.splice(0);
  selectionReplayHarness.order.splice(0);
  selectionReplayHarness.onPhase = undefined;
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

function freezeDeep<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) freezeDeep(descriptor.value, seen);
  }
  return Object.freeze(value);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) { resolvePromise?.(value); },
    reject(reason) { rejectPromise?.(reason); },
  };
}

async function awaitBarrierOrEarlySettlement(
  barrier: Promise<unknown>,
  callerPromises: readonly Promise<unknown>[],
): Promise<void> {
  const earlySettlement = Promise.race(callerPromises.map((caller) => caller.then(
    () => { throw new Error("caller_settled_before_barrier"); },
    (reason: unknown) => { throw reason; },
  )));
  await Promise.race([barrier, earlySettlement]);
}

async function nextEventLoopTurn(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve); });
}

function recursivelyNotAliased(left: unknown, right: unknown, seen = new Set<object>()): void {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object" ||
    seen.has(left)) return;
  seen.add(left);
  if (left instanceof Uint8Array && right instanceof Uint8Array &&
    Object.getPrototypeOf(left) === Uint8Array.prototype &&
    Object.getPrototypeOf(right) === Uint8Array.prototype) {
    expect(left).not.toBe(right);
    expect(left.buffer).not.toBe(right.buffer);
    return;
  }
  expect(left).not.toBe(right);
  for (const key of Reflect.ownKeys(left)) {
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (leftDescriptor !== undefined && rightDescriptor !== undefined &&
      "value" in leftDescriptor && "value" in rightDescriptor) {
      recursivelyNotAliased(leftDescriptor.value, rightDescriptor.value, seen);
    }
  }
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  cityId = "ljubljana",
  officialAreaId = cityId === "ljubljana" ? "061" : "070",
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  const definitionId = criterionId === "long_term_rent" ? "rent@1" :
    criterionId === "urban_transit" ? "transit@1" : "broadband@1";
  return {
    planId: `${cityId}:${sourceId}:plan@1`,
    sourceId,
    cityId,
    criterionId,
    definitionId,
    claimContract: {
      sourceId,
      criterionId,
      definitionId,
      scope: `municipality:${cityId}`,
      officialAreaId,
      geoScope: "municipality",
      unit: "unit",
      denominator: "municipality",
      freshnessPolicyVersion: "annual@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: ["primary", "secondary"].map((route) => ({
      routeId: `${cityId}:${sourceId}:${route}`,
      navigationUrl: `https://official.example/${cityId}/${sourceId}/${route}`,
    })),
    parserVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].parserVersion,
    rulesVersion: SLOVENIA_CITY_FACT_VERSIONS[sourceId].rulesVersion,
  } as unknown as CityFixedSourcePlan<S>;
}

interface SyntheticPolicyCalls {
  readonly canonicalTargets: Array<{ readonly criterionId: string; readonly target: unknown }>;
  readonly evaluations: Array<{ readonly criterionId: string; readonly input: CityCriterionEvaluationInput }>;
  readonly values: unknown[];
  readonly sourcePeriods: unknown[];
}

function evaluatorRegistry(calls: SyntheticPolicyCalls): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [criterionId, {
    definition: {
      criterionId,
      definitionId: criterionId === "long_term_rent" ? "rent@1" :
        criterionId === "urban_transit" ? "transit@1" :
          criterionId === "fixed_broadband" ? "broadband@1" :
            "si-municipal-police-offences-per-100000@1",
      direction: criterionId === "safety" || criterionId === "long_term_rent"
        ? "at_most" as const
        : "at_least" as const,
      unit: criterionId === "safety" ? "offences_per_100000_residents" : "unit",
      denominator: criterionId === "safety"
        ? "municipality_population_january_1"
        : "municipality",
      compatibleGeoScopes: ["municipality"],
      freshnessPolicyVersion: criterionId === "safety"
        ? "municipal-annual-july-boundary@1"
        : "annual@1",
      evaluatorVersion: `${criterionId}-evaluator@1`,
    },
    canonicalizeTarget(target: unknown): string {
      calls.canonicalTargets.push({ criterionId, target: structuredClone(target) });
      if (typeof target !== "string" || !/^\d+(?:\.\d+)?$/.test(target)) {
        throw new Error("invalid_target");
      }
      return target;
    },
    evaluate(input: CityCriterionEvaluationInput): CityCriterionEvaluation {
      calls.evaluations.push({ criterionId, input: structuredClone(input) });
      return input.fact.outcome.kind === "unknown"
        ? {
            state: "unknown",
            factor: "0",
            targetComparison: "unknown",
            unknownReason: input.fact.outcome.reason,
          }
        : { state: "verified", factor: "1", targetComparison: "matches" };
    },
  }])) as unknown as CityCriterionEvaluatorRegistry;
}

interface SyntheticAuthorityFixture {
  readonly database: Database.Database;
  readonly ready: NonNullable<ReturnType<typeof getCityResearchPackageAvailability>>;
  readonly installed: InstalledCityResearchPackage;
  readonly catalog: { readonly registry: InstalledCityResearchPackage["registry"]; readonly catalog: CityCatalogRevision };
  readonly resolved: ResolvedCountryShortlistSnapshot;
  readonly relocation: ReturnType<typeof confirmRelocationProfile>;
  readonly preference: ReturnType<typeof confirmPreferenceProfile>;
  readonly alternateResolved: ResolvedCountryShortlistSnapshot;
  readonly alternateRelocation: ReturnType<typeof confirmRelocationProfile>;
  readonly alternatePreference: ReturnType<typeof confirmPreferenceProfile>;
  readonly installedPackages: InstalledCityPackages;
  readonly manifestStore: SqliteCityPackageManifestStore;
  readonly writerInstalledPackages: InstalledCityPackages;
  readonly writerManifestStore: SqliteCityPackageManifestStore;
  readonly catalogStore: SqliteCityCatalogStore;
  readonly evidenceStore: SqliteCityEvidenceStore;
  readonly knowledgeStore: SqliteCityKnowledgeStore;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly behaviors: InstalledCityPackageBehaviorRegistry;
  readonly policyCalls: SyntheticPolicyCalls;
  installLaterPackage(): Promise<InstalledCityResearchPackage>;
  installLaterRouteOnlyPackage(): Promise<InstalledCityResearchPackage>;
}

interface SyntheticAuthorityFixtureOptions {
  readonly installDefaults?: InstalledCityCriteriaDefaults;
  readonly readerApproval?: "writer" | "canonical" | "empty";
  readonly authorityAt?: string;
  readonly municipalPublisherNavigationMatchesRoute?: boolean;
}

async function syntheticAuthorityFixture(
  options: SyntheticAuthorityFixtureOptions = {},
): Promise<SyntheticAuthorityFixture> {
  const catalogCreatedAt = options.authorityAt ?? "2026-08-23T00:00:00.000Z";
  const installedAt = options.authorityAt ?? "2026-08-24T00:00:00.000Z";
  const profileCreatedAt = options.authorityAt ?? "2026-08-22T00:00:00.000Z";
  const resolvedAt = options.authorityAt ?? PARENT_AT;
  const definition = structuredClone(getCityResearchPackageAvailability("SI")!.definition);
  const registry = buildCityRegistryRevision({
    packageId: definition.packageId,
    packageSchemaVersion: definition.packageSchemaVersion,
    countryCode: definition.countryCode,
    evidenceSnapshotId: "catalog-evidence:task14",
    entries: [{
      cityId: "ljubljana",
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.0569, lng: 14.5058 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: ["catalog-evidence:task14"],
    }, {
      cityId: "maribor",
      countryCode: "SI",
      officialName: "Maribor",
      coordinate: { lat: 46.5547, lng: 15.6459 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Maribor",
      capitalRoles: [],
      evidenceReferenceIds: ["catalog-evidence:task14"],
    }],
    createdAt: catalogCreatedAt,
  }, DECISION_INTEGRITY);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: registry.evidenceSnapshotId,
    populationDefinition: { definitionId: "population@1", geoScope: "settlement", unit: "people" },
    candidateBasis: [{
      cityId: "ljubljana",
      comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2025" },
    }, {
      cityId: "maribor",
      comparablePopulation: { kind: "verified", value: "114000", referencePeriod: "2025" },
    }],
    coverage: { status: "complete" },
    createdAt: catalogCreatedAt,
  }, DECISION_INTEGRITY);
  const fixedPlans = [
    fixedPlan("si-city-long-term-rent"),
    fixedPlan("si-city-urban-transit"),
    fixedPlan("si-city-fixed-broadband"),
  ] as const;
  const mariborFixedPlans = [
    fixedPlan("si-city-long-term-rent", "maribor", "070"),
    fixedPlan("si-city-urban-transit", "maribor", "070"),
    fixedPlan("si-city-fixed-broadband", "maribor", "070"),
  ] as const;
  const publisher = (
    publisherId: string,
    authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality",
    navigationUrl: string,
  ) => ({
    publisherId,
    authorityKind,
    navigationUrl,
    allowedHosts: [new URL(navigationUrl).hostname],
    delegatedDocumentHosts: [],
    allowedMediaTypes: ["application/pdf"],
    maxBytes: 1_000_000,
    redirectPolicyVersion: "official-chain@1" as const,
    documentLocatorPolicyId: `${publisherId}-locator@1`,
    retentionPolicyId: `${publisherId}-retention@1`,
    retentionMode: "seal_raw_artifact" as const,
  });
  const officialAuthorityDirectory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      publisher("municipality-ljubljana", "municipality",
        options.municipalPublisherNavigationMatchesRoute === true
          ? "https://ljubljana.si/safety"
          : "https://ljubljana.si/"),
      publisher("municipality-maribor", "municipality",
        options.municipalPublisherNavigationMatchesRoute === true
          ? "https://maribor.si/safety"
          : "https://maribor.si/"),
      publisher("police", "police", "https://policija.si/"),
      publisher("gov", "government", "https://gov.si/"),
      publisher("opsi", "open_data", "https://podatki.gov.si/"),
      publisher("surs", "statistics", "https://pxweb.stat.si/"),
    ],
    municipalities: [{
      cityId: "ljubljana",
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherId: "municipality-ljubljana",
      officialHost: "ljubljana.si",
    }, {
      cityId: "maribor",
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherId: "municipality-maribor",
      officialHost: "maribor.si",
    }],
    rulesVersion: "slovenia-official-authorities@1",
  }, DECISION_INTEGRITY);
  const safetySourcePlan = buildCitySafetySourcePlan({
    catalog,
    directory: officialAuthorityDirectory,
    entries: [{
      cityId: "ljubljana",
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherIds: ["municipality-ljubljana", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-ljubljana",
        navigationUrl: "https://ljubljana.si/safety",
      }],
    }, {
      cityId: "maribor",
      settlementCode: "070001",
      municipalityCode: "070",
      officialCityNames: ["Maribor"],
      officialMunicipalityNames: ["Mestna občina Maribor"],
      publisherIds: ["municipality-maribor", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-maribor",
        navigationUrl: "https://maribor.si/safety",
      }],
    }],
  }, DECISION_INTEGRITY);
  const policyCalls: SyntheticPolicyCalls = {
    canonicalTargets: [],
    evaluations: [],
    values: [],
    sourcePeriods: [],
  };
  const evaluators = evaluatorRegistry(policyCalls);
  const criterionDefinitions = CITY_CRITERION_IDS.map((criterionId) => ({
    ...evaluators[criterionId].definition,
    compatibleGeoScopes: [...evaluators[criterionId].definition.compatibleGeoScopes],
  })) as unknown as InstalledCityCriterionDefinitionTuple;
  const canonicalCriteriaDefaults: InstalledCityCriteriaDefaults = {
    schemaVersion: "city-criteria-defaults@1",
    mappingVersion: "task14-defaults@1",
    criteria: structuredClone(VALID_DRAFT),
  };
  const criteriaDefaults = freezeDeep(structuredClone(
    options.installDefaults ?? canonicalCriteriaDefaults,
  ));
  const key = freezeDeep({
    countryCode: "SI",
    packageId: definition.packageId,
    packageSchemaVersion: definition.packageSchemaVersion,
    catalogRevisionId: catalog.id,
    evidenceRulesVersion: definition.evidenceRulesVersion,
  });
  const ready = freezeDeep({
    definition,
    sourceContractStatus: "bounded_verified_or_unknown" as const,
    readiness: { status: "ready" as const, issues: [] as const },
  });
  const approvedFor = {
    countryCode: key.countryCode,
    packageId: key.packageId,
    packageSchemaVersion: key.packageSchemaVersion,
    evidenceRulesVersion: key.evidenceRulesVersion,
  } as const;
  const approvedDefaultsFor = (
    defaults: InstalledCityCriteriaDefaults,
  ): ApprovedCityCriteriaDefaultsRegistry => ({
    schemaVersion: "approved-city-criteria-defaults-registry@1",
    byMappingVersion: {
      [defaults.mappingVersion]: {
        mappingVersion: defaults.mappingVersion,
        approvedFor,
        defaults,
      },
    },
  });
  const writerApprovedDefaults = approvedDefaultsFor(criteriaDefaults);
  const readerApprovedDefaults = options.readerApproval === "empty"
    ? {
        schemaVersion: "approved-city-criteria-defaults-registry@1" as const,
        byMappingVersion: {},
      }
    : options.readerApproval === "canonical"
      ? approvedDefaultsFor(canonicalCriteriaDefaults)
      : writerApprovedDefaults;
  const behaviors: InstalledCityPackageBehaviorRegistry = {
    schemaVersion: "installed-city-package-behavior-registry@1",
    entries: [{
      approvedFor,
      versionKey: {
        evaluatorRegistryVersionId: "task14-evaluator-registry@1",
        evaluatorVersionIds: Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => [
          criterionId,
          evaluators[criterionId].definition.evaluatorVersion,
        ])) as InstalledCityPackageBehaviorRegistry["entries"][number]["versionKey"]["evaluatorVersionIds"],
        valueValidatorVersionId: "task14-value-validator@1",
        sourcePeriodValidatorVersionId: "task14-period-validator@1",
      },
      fixedPolicyVersionsBySourceId: Object.fromEntries(fixedPlans.map((plan) => [
        plan.sourceId,
        {
          valuePolicyVersion: plan.claimContract.valuePolicyVersion,
          sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
        },
      ])) as InstalledCityPackageBehaviorRegistry["entries"][number]["fixedPolicyVersionsBySourceId"],
      evaluatorRegistry: evaluators,
      validateValue: (input) => {
        policyCalls.values.push(structuredClone(input));
        return input.value;
      },
      validateSourcePeriod: (input) => {
        policyCalls.sourcePeriods.push(structuredClone(input));
        return "fresh";
      },
    }],
  };
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  const catalogStore = new SqliteCityCatalogStore(database, EVIDENCE_INTEGRITY);
  const writerManifestStore = new SqliteCityPackageManifestStore(
    database,
    EVIDENCE_INTEGRITY,
    writerApprovedDefaults,
    behaviors,
  );
  const writerInstalledPackages = new InstalledCityPackages(writerManifestStore);
  const administrativeEvidence = new SqliteAdministrativeEvidenceStore(
    database,
    EVIDENCE_INTEGRITY,
  );
  const installed = await installCityPackage({
    countryCode: "SI",
    installedAt,
    catalogProjection: { registry, catalog },
    fixedPlansByCityId: { ljubljana: fixedPlans, maribor: mariborFixedPlans },
    safetySourcePlan,
    officialAuthorityDirectory,
    criteriaDefaults,
    criterionDefinitions,
  }, {
    resolveAvailability: () => structuredClone(ready),
    catalog: catalogStore,
    administrativeEvidence,
    manifests: writerManifestStore,
    installedPackages: writerInstalledPackages,
    approvedDefaults: writerApprovedDefaults,
    integrity: EVIDENCE_INTEGRITY,
  });
  const manifestStore = options.readerApproval === undefined || options.readerApproval === "writer"
    ? writerManifestStore
    : new SqliteCityPackageManifestStore(
        database,
        EVIDENCE_INTEGRITY,
        readerApprovedDefaults,
        behaviors,
      );
  const installedPackages = options.readerApproval === undefined || options.readerApproval === "writer"
    ? writerInstalledPackages
    : new InstalledCityPackages(manifestStore);
  const evidenceStore = new SqliteCityEvidenceStore(
    database,
    EVIDENCE_INTEGRITY,
    installedPackages,
  );
  const knowledgeStore = new SqliteCityKnowledgeStore(
    database,
    EVIDENCE_INTEGRITY,
    installedPackages,
  );
  const profileAt = () => new Date(profileCreatedAt);
  const relocation = confirmRelocationProfile({
    currentCountryCode: "RU",
    citizenships: ["RU"],
    monthlyIncome: { amount: "200000", currency: "RUB", basis: "net" },
    remoteWork: { relation: "foreign_employment", legallyAllowed: true },
    education: "higher",
    relevantExperienceYears: 6,
    passportValidUntil: "2030-01-01",
    healthInsurance: "confirmed",
    companions: [],
  }, profileAt);
  const preference = confirmPreferenceProfile({ criteria: [
    { id: "personal_safety", mode: "weighted", importance: 3, target: "maximize" },
    { id: "infrastructure", mode: "required", importance: 4, target: "required_true" },
  ] }, profileAt);
  const alternateProfileAt = () => new Date(Date.parse(profileCreatedAt) + 1_000);
  const alternateRelocation = confirmRelocationProfile({
    currentCountryCode: "RU",
    citizenships: ["RU"],
    monthlyIncome: { amount: "200000", currency: "RUB", basis: "net" },
    remoteWork: { relation: "foreign_employment", legallyAllowed: true },
    education: "higher",
    relevantExperienceYears: 6,
    passportValidUntil: "2030-01-01",
    healthInsurance: "confirmed",
    companions: [],
  }, alternateProfileAt);
  const alternatePreference = confirmPreferenceProfile({ criteria: [
    { id: "personal_safety", mode: "weighted", importance: 3, target: "maximize" },
    { id: "infrastructure", mode: "required", importance: 4, target: "required_true" },
  ] }, alternateProfileAt);
  const resolved: ResolvedCountryShortlistSnapshot = {
    schemaVersion: "country-resolution@1",
    rulesVersion: "country-resolution@1",
    id: "country-resolution:task14",
    resolutionRunId: "country-resolution-run:task14",
    automaticShortlistSnapshotId: "place-shortlist:task14",
    rankingSnapshotId: "place-ranking:task14",
    profileSnapshotId: relocation.id,
    preferenceProfileSnapshotId: preference.id,
    decisions: [],
    replacementMarkers: [],
    nextUncheckedRank: 2,
    unresolvedCountryCodes: [],
    slotCountryCodes: ["SI"],
    contextHash: "c".repeat(64),
    createdAt: resolvedAt,
    kind: "resolved",
    resolvedEntries: [{ countryCode: "SI", rank: 1, formalMarkerDigest: "d".repeat(64) }],
    stopCondition: "ranking_exhausted",
  };
  const alternateResolved = freezeDeep({
    ...structuredClone(resolved),
    id: "country-resolution:task14:alternate",
    resolutionRunId: "country-resolution-run:task14:alternate",
    automaticShortlistSnapshotId: "place-shortlist:task14:alternate",
    rankingSnapshotId: "place-ranking:task14:alternate",
    profileSnapshotId: alternateRelocation.id,
    preferenceProfileSnapshotId: alternatePreference.id,
    contextHash: "e".repeat(64),
  });
  return {
    database,
    ready,
    installed,
    catalog: catalogStore.loadVerified(catalog.id),
    resolved: freezeDeep(resolved),
    relocation,
    preference,
    alternateResolved,
    alternateRelocation,
    alternatePreference,
    installedPackages,
    manifestStore,
    writerInstalledPackages,
    writerManifestStore,
    catalogStore,
    evidenceStore,
    knowledgeStore,
    approvedDefaults: readerApprovedDefaults,
    behaviors,
    policyCalls,
    async installLaterPackage() {
      const laterRegistry = buildCityRegistryRevision({
        packageId: definition.packageId,
        packageSchemaVersion: definition.packageSchemaVersion,
        countryCode: definition.countryCode,
        evidenceSnapshotId: "catalog-evidence:task14:later",
        entries: registry.entries.map((entry) => ({
          ...structuredClone(entry),
          evidenceReferenceIds: ["catalog-evidence:task14:later"],
        })),
        createdAt: "2026-08-25T00:00:00.000Z",
      }, DECISION_INTEGRITY);
      const laterCatalog = buildCityCatalogRevision({
        registry: laterRegistry,
        evidenceSnapshotId: laterRegistry.evidenceSnapshotId,
        populationDefinition: structuredClone(catalog.populationDefinition),
        candidateBasis: catalog.candidateBasis.map((basis) => ({
          ...structuredClone(basis),
          comparablePopulation: basis.comparablePopulation.kind === "verified"
            ? {
                ...structuredClone(basis.comparablePopulation),
                value: basis.cityId === "ljubljana" ? "300100" : "114100",
              }
            : structuredClone(basis.comparablePopulation),
        })),
        coverage: structuredClone(catalog.coverage),
        createdAt: "2026-08-25T00:00:00.000Z",
      }, DECISION_INTEGRITY);
      const laterPlan = <S extends SloveniaCityFixedSourceId>(
        sourceId: S,
        cityId: string,
        officialAreaId: string,
      ): CityFixedSourcePlan<S> => {
        const plan = fixedPlan(sourceId, cityId, officialAreaId);
        return {
          ...structuredClone(plan),
          planId: `${plan.planId}:later`,
          routes: plan.routes.map((route) => ({
            ...route,
            routeId: `${route.routeId}:later`,
            navigationUrl: `${route.navigationUrl}/later`,
          })),
        } as CityFixedSourcePlan<S>;
      };
      const laterFixedPlans = [
        laterPlan("si-city-long-term-rent", "ljubljana", "061"),
        laterPlan("si-city-urban-transit", "ljubljana", "061"),
        laterPlan("si-city-fixed-broadband", "ljubljana", "061"),
      ] as const;
      const laterMariborFixedPlans = [
        laterPlan("si-city-long-term-rent", "maribor", "070"),
        laterPlan("si-city-urban-transit", "maribor", "070"),
        laterPlan("si-city-fixed-broadband", "maribor", "070"),
      ] as const;
      const laterDirectory = buildOfficialAuthorityDirectory({
        schemaVersion: "official-authority-directory@1",
        countryCode: "SI",
        catalogRevisionId: laterCatalog.id,
        requiredPublisherIds: structuredClone(officialAuthorityDirectory.requiredPublisherIds),
        publishers: structuredClone(officialAuthorityDirectory.publishers),
        municipalities: structuredClone(officialAuthorityDirectory.municipalities),
        rulesVersion: officialAuthorityDirectory.rulesVersion,
      }, DECISION_INTEGRITY);
      const laterSafetyPlan = buildCitySafetySourcePlan({
        catalog: laterCatalog,
        directory: laterDirectory,
        entries: safetySourcePlan.entries.map((entry) => ({
          cityId: entry.cityId,
          settlementCode: entry.settlementCode,
          municipalityCode: entry.municipalityCode,
          officialCityNames: [...entry.officialCityNames],
          officialMunicipalityNames: [...entry.officialMunicipalityNames],
          publisherIds: [...entry.publisherIds],
          configuredRoutes: entry.configuredRoutes.map((route) => ({
            ...route,
            navigationUrl: `${route.navigationUrl}/later`,
          })),
        })),
      }, DECISION_INTEGRITY);
      return withInfrastructurePlanGateReadAsync(() => installCityPackage({
        countryCode: "SI",
        installedAt: "2026-08-25T00:00:00.000Z",
        catalogProjection: { registry: laterRegistry, catalog: laterCatalog },
        fixedPlansByCityId: {
          ljubljana: laterFixedPlans,
          maribor: laterMariborFixedPlans,
        },
        safetySourcePlan: laterSafetyPlan,
        officialAuthorityDirectory: laterDirectory,
        criteriaDefaults,
        criterionDefinitions,
      }, {
        resolveAvailability: () => structuredClone(ready),
        catalog: catalogStore,
        administrativeEvidence,
        manifests: manifestStore,
        installedPackages,
        approvedDefaults: writerApprovedDefaults,
        integrity: EVIDENCE_INTEGRITY,
      }));
    },
    async installLaterRouteOnlyPackage() {
      const routeOnlyRegistry = buildCityRegistryRevision({
        packageId: definition.packageId,
        packageSchemaVersion: definition.packageSchemaVersion,
        countryCode: definition.countryCode,
        evidenceSnapshotId: "catalog-evidence:task14:route-only",
        entries: registry.entries.map((entry) => ({
          ...structuredClone(entry),
          evidenceReferenceIds: ["catalog-evidence:task14:route-only"],
        })),
        createdAt: "2026-08-25T00:00:01.000Z",
      }, DECISION_INTEGRITY);
      const routeOnlyCatalog = buildCityCatalogRevision({
        registry: routeOnlyRegistry,
        evidenceSnapshotId: routeOnlyRegistry.evidenceSnapshotId,
        populationDefinition: structuredClone(catalog.populationDefinition),
        candidateBasis: catalog.candidateBasis.map((basis) => structuredClone(basis)),
        coverage: structuredClone(catalog.coverage),
        createdAt: "2026-08-25T00:00:01.000Z",
      }, DECISION_INTEGRITY);
      const routeOnlyMariborBroadband = {
        ...structuredClone(mariborFixedPlans[2]),
        routes: mariborFixedPlans[2].routes.map((route, routeIndex) => routeIndex === 0
          ? {
              ...structuredClone(route),
              navigationUrl: `${route.navigationUrl}/route-only`,
            }
          : structuredClone(route)),
      } as CityFixedSourcePlan<"si-city-fixed-broadband">;
      const routeOnlyDirectory = buildOfficialAuthorityDirectory({
        schemaVersion: "official-authority-directory@1",
        countryCode: "SI",
        catalogRevisionId: routeOnlyCatalog.id,
        requiredPublisherIds: structuredClone(officialAuthorityDirectory.requiredPublisherIds),
        publishers: structuredClone(officialAuthorityDirectory.publishers),
        municipalities: structuredClone(officialAuthorityDirectory.municipalities),
        rulesVersion: officialAuthorityDirectory.rulesVersion,
      }, DECISION_INTEGRITY);
      const routeOnlySafetyPlan = buildCitySafetySourcePlan({
        catalog: routeOnlyCatalog,
        directory: routeOnlyDirectory,
        entries: safetySourcePlan.entries.map((entry) => ({
          cityId: entry.cityId,
          settlementCode: entry.settlementCode,
          municipalityCode: entry.municipalityCode,
          officialCityNames: [...entry.officialCityNames],
          officialMunicipalityNames: [...entry.officialMunicipalityNames],
          publisherIds: [...entry.publisherIds],
          configuredRoutes: entry.configuredRoutes.map((route) => structuredClone(route)),
        })),
      }, DECISION_INTEGRITY);
      return withInfrastructurePlanGateReadAsync(() => installCityPackage({
        countryCode: "SI",
        installedAt: "2026-08-25T00:00:01.000Z",
        catalogProjection: { registry: routeOnlyRegistry, catalog: routeOnlyCatalog },
        fixedPlansByCityId: {
          ljubljana: fixedPlans,
          maribor: [
            mariborFixedPlans[0],
            mariborFixedPlans[1],
            routeOnlyMariborBroadband,
          ],
        },
        safetySourcePlan: routeOnlySafetyPlan,
        officialAuthorityDirectory: routeOnlyDirectory,
        criteriaDefaults,
        criterionDefinitions,
      }, {
        resolveAvailability: () => structuredClone(ready),
        catalog: catalogStore,
        administrativeEvidence,
        manifests: manifestStore,
        installedPackages,
        approvedDefaults: writerApprovedDefaults,
        integrity: EVIDENCE_INTEGRITY,
      }));
    },
  };
}

function legacyInstalledPackage(
  fixture: SyntheticAuthorityFixture,
): InstalledCityResearchPackage {
  const current = fixture.installed;
  const { id: _catalogId, ...catalogBase } = structuredClone(current.catalog);
  void _catalogId;
  const catalogPayload = {
    ...catalogBase,
    members: current.catalog.candidateBasis.map(({ cityId }) => ({
      cityId,
      inclusionReasons: [
        "population_threshold" as const,
        ...(current.registry.entries.find((entry) => entry.cityId === cityId)?.capitalRoles
          .includes("national") === true ? ["national_capital" as const] : []),
      ],
    })),
    rulesVersion: "city-catalog@1" as const,
  };
  const catalog = {
    id: `city-catalog:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(catalogPayload))}`,
    ...catalogPayload,
  };
  const { id: _directoryId, ...directoryBase } = structuredClone(
    current.officialAuthorityDirectory,
  );
  void _directoryId;
  const directoryPayload = { ...directoryBase, catalogRevisionId: catalog.id };
  const officialAuthorityDirectory = {
    id: `official-authority-directory:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(directoryPayload),
    )}`,
    ...directoryPayload,
  };
  const { id: _sourcePlanId, ...sourcePlanBase } = structuredClone(current.safetySourcePlan);
  void _sourcePlanId;
  const sourcePlanPayload = {
    ...sourcePlanBase,
    catalogRevisionId: catalog.id,
    authorityDirectoryId: officialAuthorityDirectory.id,
  };
  const safetySourcePlan = {
    id: `city-safety-source-plan:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(sourcePlanPayload),
    )}`,
    ...sourcePlanPayload,
  };
  return freezeDeep({
    ...current,
    installedPackageManifest: {
      id: `${current.installedPackageManifest.id}:legacy`,
      key: {
        ...current.installedPackageManifest.key,
        catalogRevisionId: catalog.id,
      },
    },
    catalog,
    safetySourcePlan,
    officialAuthorityDirectory,
  } as InstalledCityResearchPackage);
}

interface AuthenticLegacyHistory {
  readonly legacy: InstalledCityResearchPackage;
  readonly manifest: InstalledCityPackageManifest;
  readonly current: InstalledCityResearchPackage;
}

async function installAuthenticLegacyHistory(
  fixture: SyntheticAuthorityFixture,
): Promise<AuthenticLegacyHistory> {
  const database = fixture.database;
  const legacyProjection = legacyInstalledPackage(fixture);
  const currentManifest = withInfrastructurePlanGateRead(() =>
    fixture.manifestStore.loadVerified(
      fixture.installed.installedPackageManifest.key,
    ))!;
  const key = freezeDeep({
    ...legacyProjection.installedPackageManifest.key,
  });
  const installedAt = "2026-08-24T10:00:00.000Z";
  const administrativeEvidence = await sealCityPackageAdministrativeEvidence({
    key,
    installedAt,
    catalogMemberIds: legacyProjection.catalog.members.map(({ cityId }) => cityId),
    fixedPlansByCityId: legacyProjection.fixedPlansByCityId,
    safetySourcePlan: legacyProjection.safetySourcePlan,
    officialAuthorityDirectory: legacyProjection.officialAuthorityDirectory,
    criteriaDefaults: legacyProjection.criteriaDefaults,
    criterionDefinitions: legacyProjection.criterionDefinitions,
  }, {
    store: new SqliteAdministrativeEvidenceStore(database, EVIDENCE_INTEGRITY),
    integrity: EVIDENCE_INTEGRITY,
  });
  const input: InstalledCityPackageManifestAppendInput = {
    ready: {
      definition: structuredClone(legacyProjection.definition),
      sourceContractStatus: legacyProjection.sourceContractStatus,
      readiness: structuredClone(legacyProjection.readiness),
    },
    catalog: {
      registry: legacyProjection.registry,
      catalog: legacyProjection.catalog,
    },
    administrativeEvidence,
    fixedPlansByCityId: legacyProjection.fixedPlansByCityId,
    safetySourcePlan: legacyProjection.safetySourcePlan,
    officialAuthorityDirectory: legacyProjection.officialAuthorityDirectory,
    criteriaDefaults: legacyProjection.criteriaDefaults,
    criterionDefinitions: legacyProjection.criterionDefinitions,
    installedAt,
  };
  const memberIds = legacyProjection.catalog.members.map(({ cityId }) => cityId);
  const bindings = administrativeEvidence.bindings;
  const fixedPlansByCityId = Object.fromEntries(memberIds.map((cityId, memberIndex) => [
    cityId,
    input.fixedPlansByCityId[cityId]!.map((plan, sourceIndex) => ({
      sourceId: plan.sourceId,
      cityId: plan.cityId,
      planId: plan.planId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      planArtifact: bindings[memberIndex * 3 + sourceIndex]!,
    })),
  ])) as unknown as InstalledCityPackageManifestPayload["fixedPlansByCityId"];
  const singletonOffset = memberIds.length * 3;
  const payload: InstalledCityPackageManifestPayload = {
    schemaVersion: "installed-city-package-manifest@1",
    key,
    definition: input.ready.definition,
    sourceContractStatus: input.ready.sourceContractStatus,
    readiness: input.ready.readiness,
    catalogRoot: {
      registryRevisionId: legacyProjection.registry.id,
      catalogRevisionId: legacyProjection.catalog.id,
    },
    fixedPlansByCityId,
    safety: {
      sourcePlanId: input.safetySourcePlan.id,
      sourcePlanSchemaVersion: input.safetySourcePlan.schemaVersion,
      authorityDirectoryId: input.safetySourcePlan.authorityDirectoryId,
      queryTemplateVersion: input.safetySourcePlan.queryTemplateVersion,
      definitionId: input.safetySourcePlan.definitionId,
      freshnessPolicyVersion: input.safetySourcePlan.freshnessPolicyVersion,
      discoveryRulesVersion: input.safetySourcePlan.discoveryRulesVersion,
      sourcePlanArtifact: bindings[singletonOffset] as
        InstalledCityPackageManifestPayload["safety"]["sourcePlanArtifact"],
      authorityDirectoryArtifact: bindings[singletonOffset + 1] as
        InstalledCityPackageManifestPayload["safety"]["authorityDirectoryArtifact"],
    },
    criteria: {
      defaultsMappingVersion: input.criteriaDefaults.mappingVersion,
      definitionIds: Object.fromEntries(input.criterionDefinitions.map((definition) => [
        definition.criterionId,
        definition.definitionId,
      ])) as InstalledCityPackageManifestPayload["criteria"]["definitionIds"],
      evaluatorRegistryVersionId: currentManifest.criteria.evaluatorRegistryVersionId,
      evaluatorVersionIds: currentManifest.criteria.evaluatorVersionIds,
      defaultsArtifact: bindings[singletonOffset + 2] as
        InstalledCityPackageManifestPayload["criteria"]["defaultsArtifact"],
      definitionsArtifact: bindings[singletonOffset + 3] as
        InstalledCityPackageManifestPayload["criteria"]["definitionsArtifact"],
    },
    valueValidatorVersionId: currentManifest.valueValidatorVersionId,
    sourcePeriodValidatorVersionId: currentManifest.sourcePeriodValidatorVersionId,
    predecessorManifestId: null,
    installedAt,
  };
  const catalogBundle = {
    registry: legacyProjection.registry,
    catalog: legacyProjection.catalog,
  };
  const canonicalCatalog = EVIDENCE_INTEGRITY.canonical(catalogBundle);
  database.prepare(`
    INSERT INTO city_catalog_revisions (
      id, registry_revision_id, country_code, package_id, package_schema_version,
      registry_evidence_snapshot_id, catalog_evidence_snapshot_id, rules_version,
      created_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    legacyProjection.catalog.id,
    legacyProjection.registry.id,
    legacyProjection.catalog.countryCode,
    legacyProjection.catalog.packageId,
    legacyProjection.catalog.packageSchemaVersion,
    legacyProjection.registry.evidenceSnapshotId,
    legacyProjection.catalog.evidenceSnapshotId,
    legacyProjection.catalog.rulesVersion,
    legacyProjection.catalog.createdAt,
    canonicalCatalog,
    EVIDENCE_INTEGRITY.hash(canonicalCatalog),
    EVIDENCE_INTEGRITY.sign(canonicalCatalog),
  );
  const deleteTrigger = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
  ).pluck().get("installed_city_package_manifests_no_delete") as string;
  database.exec("DROP TRIGGER installed_city_package_manifests_no_delete");
  try {
    database.prepare("DELETE FROM installed_city_package_heads WHERE country_code = ?")
      .run(key.countryCode);
    database.prepare("DELETE FROM installed_city_package_manifests WHERE id = ?")
      .run(currentManifest.id);
  } finally {
    database.exec(deleteTrigger);
  }
  const canonical = EVIDENCE_INTEGRITY.canonical(payload);
  const payloadHash = EVIDENCE_INTEGRITY.hash(canonical);
  const id = `installed-city-package-manifest:${payloadHash}`;
  database.prepare(`
    INSERT INTO installed_city_package_manifests (
      id, country_code, package_id, package_schema_version, catalog_revision_id,
      evidence_rules_version, predecessor_manifest_id, administrative_evidence_snapshot_id,
      installed_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    key.countryCode,
    key.packageId,
    key.packageSchemaVersion,
    key.catalogRevisionId,
    key.evidenceRulesVersion,
    null,
    administrativeEvidence.evidenceId,
    installedAt,
    canonical,
    payloadHash,
    EVIDENCE_INTEGRITY.sign(canonical),
  );
  database.prepare(`
    INSERT INTO installed_city_package_heads (country_code, current_manifest_id) VALUES (?, ?)
  `).run(key.countryCode, id);
  const manifest = withInfrastructurePlanGateRead(() => fixture.manifestStore.loadVerified(key))!;
  const legacy = withInfrastructurePlanGateRead(() => fixture.installedPackages.findExact(key))!;
  const current = await fixture.installLaterPackage();
  return { legacy, manifest, current };
}

function legacyUnavailableEntry(
  sourceId: SloveniaCityFactSourceId,
  navigationUrl: string,
  versionHint: string,
): TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim> {
  return {
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl,
      resolvedEvidenceUrl: navigationUrl,
      artifacts: [],
      versionHint,
    },
    coverage: "unavailable",
    blocker: {
      sourceId,
      kind: "not_found",
      navigationUrl,
      resolvedUrl: navigationUrl,
      artifactIds: [],
    },
  };
}

function legacyUnknownFixedLedger<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  context: CityEvidenceContext,
  completedOffset: number,
): CityFixedAttemptLedger<S> {
  return {
    schemaVersion: "city-fixed-attempt-ledger@1",
    cityCheckRunId: context.cityCheckRunId,
    cityId: context.cityId,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt: context.assessmentAt,
    attempts: plan.routes.map((route, index) => ({
      cityCheckRunId: context.cityCheckRunId,
      sourceId: plan.sourceId,
      index,
      routeId: route.routeId,
      navigationUrl: route.navigationUrl,
      attemptedAt: new Date(Date.parse(context.assessmentAt) + index).toISOString(),
      disposition: "rejected" as const,
      reason: "http_not_found" as const,
      artifactIds: [],
    })),
    result: { kind: "unknown", reason: "not_found" },
    completedAt: new Date(Date.parse(context.assessmentAt) + completedOffset).toISOString(),
  };
}

async function legacyEvidenceInput(
  installed: InstalledCityResearchPackage,
  ranking: CityRankingSnapshot,
  criteria: CityCriteriaSnapshot,
  cityId: string,
  rank: number,
  cityCheckRunIdOverride?: string,
): Promise<CityEvidenceSealInput> {
  const plans = installed.fixedPlansByCityId[cityId]!;
  const safetyEntry = installed.safetySourcePlan.entries.find((entry) => entry.cityId === cityId)!;
  const cityCheckRunId = cityCheckRunIdOverride ??
    `city-check:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical({
      schemaVersion: "city-check-run@1",
      runId: ranking.runId,
      cityId,
      rankingSnapshotId: ranking.id,
    }))}`;
  const completedAt = new Date(Date.parse(ranking.assessmentAt) + rank * 10_000).toISOString();
  const context: CityEvidenceContext = {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId,
    frontierRunId: ranking.runId,
    cityId,
    countryCode: ranking.countryCode,
    packageId: ranking.packageId,
    packageSchemaVersion: ranking.packageSchemaVersion,
    catalogRevisionId: ranking.catalogRevisionId,
    criteriaSnapshotId: criteria.id,
    rankingSnapshotId: ranking.id,
    definitionIds: {
      safety: installed.safetySourcePlan.definitionId,
      long_term_rent: plans[0].definitionId,
      urban_transit: plans[1].definitionId,
      fixed_broadband: plans[2].definitionId,
    },
    evidenceRulesVersion: ranking.installedPackageContext.evidenceRulesVersion,
    assessmentAt: ranking.assessmentAt,
    completedAt,
  };
  const safetyUrl = safetyEntry.configuredRoutes[0]!.navigationUrl;
  const entries: readonly TerminalEvidenceEntry<SloveniaCityFactSourceId, CityEvidenceClaim>[] = [
    legacyUnavailableEntry(
      "si-city-safety",
      safetyUrl,
      SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
    ),
    legacyUnavailableEntry(
      plans[0].sourceId,
      plans[0].routes.at(-1)!.navigationUrl,
      plans[0].parserVersion,
    ),
    legacyUnavailableEntry(
      plans[1].sourceId,
      plans[1].routes.at(-1)!.navigationUrl,
      plans[1].parserVersion,
    ),
    legacyUnavailableEntry(
      plans[2].sourceId,
      plans[2].routes.at(-1)!.navigationUrl,
      plans[2].parserVersion,
    ),
  ];
  const genericEvidence = await sealEvidencePlan({
    id: `${cityCheckRunId}:evidence`,
    assessmentDate: ranking.assessmentAt.slice(0, 10),
    entries,
    sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
    parserVersions: {
      "si-city-safety": SLOVENIA_CITY_FACT_VERSIONS["si-city-safety"].parserVersion,
      "si-city-long-term-rent": plans[0].parserVersion,
      "si-city-urban-transit": plans[1].parserVersion,
      "si-city-fixed-broadband": plans[2].parserVersion,
    },
    rulesVersion: context.evidenceRulesVersion,
    contextHash: cityEvidenceContextHash(context, DECISION_INTEGRITY),
  }, EVIDENCE_INTEGRITY);
  const queries = buildCitySafetyQueries(
    safetyEntry,
    installed.officialAuthorityDirectory,
    ranking.assessmentAt,
    installed.catalog,
    DECISION_INTEGRITY,
  );
  const safetyAttemptLedger: CitySafetyAttemptLedger = {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: installed.catalog.id,
    authorityDirectoryId: installed.officialAuthorityDirectory.id,
    sourcePlanId: installed.safetySourcePlan.id,
    cityId,
    municipalityCode: safetyEntry.municipalityCode,
    assessmentAt: ranking.assessmentAt,
    definitionId: installed.safetySourcePlan.definitionId,
    freshnessPolicyVersion: installed.safetySourcePlan.freshnessPolicyVersion,
    discoveryRulesVersion: installed.safetySourcePlan.discoveryRulesVersion,
    queries: queries.map((query, index) => ({
      index,
      queryId: `city-safety-query:${cityCheckRunId}:${index + 1}`,
      queryTemplateVersion: installed.safetySourcePlan.queryTemplateVersion,
      providerId: "synthetic-search",
      query,
      searchedAt: new Date(Date.parse(ranking.assessmentAt) + (index + 1) * 100).toISOString(),
      outcome: { kind: "completed", returnedUrls: [] },
    })),
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: safetyUrl,
      officialTrace: {
        initialUrl: safetyUrl,
        edges: [],
        lastTrustedUrl: safetyUrl,
        officialHops: 0,
        failure: { captureKind: "http_error", responseStatus: 404, responseUrl: safetyUrl },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "http_not_found",
    }],
    counters: { queries: queries.length, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "unknown", reason: "not_found" },
    completedAt: new Date(Date.parse(ranking.assessmentAt) + 500).toISOString(),
  };
  return {
    ...context,
    genericEvidence,
    artifacts: [],
    fixedAttemptLedgers: [
      legacyUnknownFixedLedger(plans[0], context, 100),
      legacyUnknownFixedLedger(plans[1], context, 200),
      legacyUnknownFixedLedger(plans[2], context, 300),
    ],
    safetyAttemptLedger,
  };
}

function insertLegacyEvidence(
  database: Database.Database,
  input: CityEvidenceSealInput,
): CityEvidencePayload {
  insertSealedEvidence(database, input.genericEvidence, EVIDENCE_INTEGRITY);
  const context: CityEvidenceContext = {
    schemaVersion: "city-evidence-context@1",
    cityCheckRunId: input.cityCheckRunId,
    frontierRunId: input.frontierRunId,
    cityId: input.cityId,
    countryCode: input.countryCode,
    packageId: input.packageId,
    packageSchemaVersion: input.packageSchemaVersion,
    catalogRevisionId: input.catalogRevisionId,
    criteriaSnapshotId: input.criteriaSnapshotId,
    rankingSnapshotId: input.rankingSnapshotId,
    definitionIds: structuredClone(input.definitionIds),
    evidenceRulesVersion: input.evidenceRulesVersion,
    assessmentAt: input.assessmentAt,
    completedAt: input.completedAt,
  };
  const payload: CityEvidencePayload = {
    schemaVersion: "city-evidence@1",
    id: `${input.cityCheckRunId}:evidence`,
    cityCheckRunId: input.cityCheckRunId,
    frontierRunId: input.frontierRunId,
    cityId: input.cityId,
    countryCode: input.countryCode,
    packageId: input.packageId,
    packageSchemaVersion: input.packageSchemaVersion,
    catalogRevisionId: input.catalogRevisionId,
    criteriaSnapshotId: input.criteriaSnapshotId,
    rankingSnapshotId: input.rankingSnapshotId,
    definitionIds: structuredClone(input.definitionIds),
    evidenceRulesVersion: input.evidenceRulesVersion,
    assessmentAt: input.assessmentAt,
    fixedAttemptLedgers: structuredClone(input.fixedAttemptLedgers),
    safetyAttemptLedger: structuredClone(input.safetyAttemptLedger),
    contextHash: cityEvidenceContextHash(context, DECISION_INTEGRITY),
    completedAt: input.completedAt,
  };
  const canonical = EVIDENCE_INTEGRITY.canonical(payload);
  database.prepare(`
    INSERT INTO city_evidence_snapshots (
      id, city_check_run_id, frontier_run_id, city_id, country_code, package_id,
      package_schema_version, catalog_revision_id, criteria_snapshot_id, ranking_snapshot_id,
      evidence_rules_version, context_hash, assessment_at, completed_at, canonical_payload,
      payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.id, payload.cityCheckRunId, payload.frontierRunId, payload.cityId,
    payload.countryCode, payload.packageId, payload.packageSchemaVersion,
    payload.catalogRevisionId, payload.criteriaSnapshotId, payload.rankingSnapshotId,
    payload.evidenceRulesVersion, payload.contextHash, payload.assessmentAt,
    payload.completedAt, canonical, EVIDENCE_INTEGRITY.hash(canonical),
    EVIDENCE_INTEGRITY.sign(canonical),
  );
  return payload;
}

function legacyKnowledgeContracts(
  installed: InstalledCityResearchPackage,
  cityId: string,
): CityKnowledgeFactContractTuple {
  const plans = installed.fixedPlansByCityId[cityId]!;
  const safety = installed.safetySourcePlan.entries.find((entry) => entry.cityId === cityId)!;
  return [
    {
      sourceId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.sourceId,
      criterionId: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.criterionId,
      definitionId: installed.safetySourcePlan.definitionId,
      scope: `municipality:${safety.municipalityCode}`,
      geoScope: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.geoScope,
      officialAreaId: safety.municipalityCode,
      unit: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.unit,
      denominator: SLOVENIA_CITY_SAFETY_FACT_CONTRACT.denominator,
      freshnessPolicyVersion: installed.safetySourcePlan.freshnessPolicyVersion,
    },
    ...plans.map((plan) => ({
      sourceId: plan.claimContract.sourceId,
      criterionId: plan.claimContract.criterionId,
      definitionId: plan.claimContract.definitionId,
      scope: plan.claimContract.scope,
      geoScope: plan.claimContract.geoScope,
      officialAreaId: plan.claimContract.officialAreaId,
      unit: plan.claimContract.unit,
      denominator: plan.claimContract.denominator,
      freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
    })),
  ] as unknown as CityKnowledgeFactContractTuple;
}

function insertLegacyKnowledge(
  database: Database.Database,
  revision: CityKnowledgeRevision,
): void {
  const canonical = EVIDENCE_INTEGRITY.canonical(revision);
  database.prepare(`
    INSERT INTO city_knowledge_revisions (
      id, city_id, country_code, package_id, package_schema_version, rules_version,
      predecessor_id, evidence_snapshot_id, last_checked_at, knowledge_updated_at,
      created_at, payload_json, payload_hash, hmac
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revision.id, revision.cityId, revision.countryCode, revision.packageId,
    revision.packageSchemaVersion, revision.rulesVersion,
    revision.predecessorRevisionId ?? null, revision.evidenceSnapshotId,
    revision.lastCheckedAt, revision.knowledgeUpdatedAt, revision.createdAt,
    canonical, EVIDENCE_INTEGRITY.hash(canonical), EVIDENCE_INTEGRITY.sign(canonical),
  );
}

function invalidCatalogInstalledPackage(
  fixture: SyntheticAuthorityFixture,
  variant: "unknown-rules" | "future-schema",
): InstalledCityResearchPackage {
  const current = fixture.installed;
  const { id: _catalogId, ...catalogBase } = structuredClone(current.catalog);
  void _catalogId;
  const catalogPayload = {
    ...catalogBase,
    ...(variant === "unknown-rules"
      ? { rulesVersion: "city-catalog@999" }
      : { schemaVersion: "city-catalog@2" }),
  };
  const catalog = {
    id: `city-catalog:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(catalogPayload))}`,
    ...catalogPayload,
  };
  const { id: _directoryId, ...directoryBase } = structuredClone(
    current.officialAuthorityDirectory,
  );
  void _directoryId;
  const directoryPayload = { ...directoryBase, catalogRevisionId: catalog.id };
  const officialAuthorityDirectory = {
    id: `official-authority-directory:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(directoryPayload),
    )}`,
    ...directoryPayload,
  };
  const { id: _sourcePlanId, ...sourcePlanBase } = structuredClone(current.safetySourcePlan);
  void _sourcePlanId;
  const sourcePlanPayload = {
    ...sourcePlanBase,
    catalogRevisionId: catalog.id,
    authorityDirectoryId: officialAuthorityDirectory.id,
  };
  const safetySourcePlan = {
    id: `city-safety-source-plan:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(sourcePlanPayload),
    )}`,
    ...sourcePlanPayload,
  };
  return freezeDeep({
    ...current,
    installedPackageManifest: {
      id: `${current.installedPackageManifest.id}:${variant}`,
      key: {
        ...current.installedPackageManifest.key,
        catalogRevisionId: catalog.id,
      },
    },
    catalog,
    safetySourcePlan,
    officialAuthorityDirectory,
  } as unknown as InstalledCityResearchPackage);
}

async function hostileInvalidCatalogAuthority(
  fixture: SyntheticAuthorityFixture,
  variant: "unknown-rules" | "future-schema",
): Promise<{
  readonly installed: InstalledCityResearchPackage;
  readonly manifest: InstalledCityPackageManifest;
}> {
  const invalid = invalidCatalogInstalledPackage(fixture, variant);
  const authentic = withInfrastructurePlanGateRead(() =>
    fixture.manifestStore.loadVerified(
      fixture.installed.installedPackageManifest.key,
    ))!;
  const key = freezeDeep(structuredClone(invalid.installedPackageManifest.key));
  const administrativeEvidence = await sealCityPackageAdministrativeEvidence({
    key,
    installedAt: authentic.installedAt,
    catalogMemberIds: invalid.catalog.members.map(({ cityId }) => cityId),
    fixedPlansByCityId: invalid.fixedPlansByCityId,
    safetySourcePlan: invalid.safetySourcePlan,
    officialAuthorityDirectory: invalid.officialAuthorityDirectory,
    criteriaDefaults: invalid.criteriaDefaults,
    criterionDefinitions: invalid.criterionDefinitions,
  }, {
    store: new SqliteAdministrativeEvidenceStore(fixture.database, EVIDENCE_INTEGRITY),
    integrity: EVIDENCE_INTEGRITY,
  });
  const memberIds = invalid.catalog.members.map(({ cityId }) => cityId);
  const bindings = administrativeEvidence.bindings;
  const fixedPlansByCityId = Object.fromEntries(memberIds.map((cityId, memberIndex) => [
    cityId,
    invalid.fixedPlansByCityId[cityId]!.map((plan, sourceIndex) => ({
      sourceId: plan.sourceId,
      cityId: plan.cityId,
      planId: plan.planId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      planArtifact: bindings[memberIndex * 3 + sourceIndex]!,
    })),
  ])) as unknown as InstalledCityPackageManifestPayload["fixedPlansByCityId"];
  const singletonOffset = memberIds.length * 3;
  const payload: InstalledCityPackageManifestPayload = {
    schemaVersion: "installed-city-package-manifest@1",
    key,
    definition: invalid.definition,
    sourceContractStatus: invalid.sourceContractStatus,
    readiness: invalid.readiness,
    catalogRoot: {
      registryRevisionId: invalid.registry.id,
      catalogRevisionId: invalid.catalog.id,
    },
    fixedPlansByCityId,
    safety: {
      sourcePlanId: invalid.safetySourcePlan.id,
      sourcePlanSchemaVersion: invalid.safetySourcePlan.schemaVersion,
      authorityDirectoryId: invalid.officialAuthorityDirectory.id,
      queryTemplateVersion: invalid.safetySourcePlan.queryTemplateVersion,
      definitionId: invalid.safetySourcePlan.definitionId,
      freshnessPolicyVersion: invalid.safetySourcePlan.freshnessPolicyVersion,
      discoveryRulesVersion: invalid.safetySourcePlan.discoveryRulesVersion,
      sourcePlanArtifact: bindings[singletonOffset] as
        InstalledCityPackageManifestPayload["safety"]["sourcePlanArtifact"],
      authorityDirectoryArtifact: bindings[singletonOffset + 1] as
        InstalledCityPackageManifestPayload["safety"]["authorityDirectoryArtifact"],
    },
    criteria: {
      defaultsMappingVersion: invalid.criteriaDefaults.mappingVersion,
      definitionIds: Object.fromEntries(invalid.criterionDefinitions.map((definition) => [
        definition.criterionId,
        definition.definitionId,
      ])) as InstalledCityPackageManifestPayload["criteria"]["definitionIds"],
      evaluatorRegistryVersionId: authentic.criteria.evaluatorRegistryVersionId,
      evaluatorVersionIds: authentic.criteria.evaluatorVersionIds,
      defaultsArtifact: bindings[singletonOffset + 2] as
        InstalledCityPackageManifestPayload["criteria"]["defaultsArtifact"],
      definitionsArtifact: bindings[singletonOffset + 3] as
        InstalledCityPackageManifestPayload["criteria"]["definitionsArtifact"],
    },
    valueValidatorVersionId: authentic.valueValidatorVersionId,
    sourcePeriodValidatorVersionId: authentic.sourcePeriodValidatorVersionId,
    predecessorManifestId: authentic.predecessorManifestId,
    installedAt: authentic.installedAt,
  };
  const canonical = EVIDENCE_INTEGRITY.canonical(payload);
  const payloadHash = EVIDENCE_INTEGRITY.hash(canonical);
  const manifest = freezeDeep({
    ...payload,
    id: `installed-city-package-manifest:${payloadHash}`,
    payloadHash,
    hmac: EVIDENCE_INTEGRITY.sign(canonical),
  });
  return {
    installed: freezeDeep({
      ...invalid,
      installedPackageManifest: { id: manifest.id, key: manifest.key },
    }),
    manifest,
  };
}

function expectAdministrativeManifestBindings(
  manifest: InstalledCityPackageManifest,
  installed: InstalledCityResearchPackage,
): void {
  const planBindings = installed.catalog.members.flatMap(({ cityId }) =>
    manifest.fixedPlansByCityId[cityId]!);
  const plans = installed.catalog.members.flatMap(({ cityId }) =>
    installed.fixedPlansByCityId[cityId]!);
  expect(planBindings.map((binding) => ({
    sourceId: binding.sourceId,
    cityId: binding.cityId,
    planId: binding.planId,
    criterionId: binding.criterionId,
    definitionId: binding.definitionId,
    parserVersion: binding.parserVersion,
    rulesVersion: binding.rulesVersion,
    freshnessPolicyVersion: binding.freshnessPolicyVersion,
    valuePolicyVersion: binding.valuePolicyVersion,
    sourcePeriodPolicyVersion: binding.sourcePeriodPolicyVersion,
  }))).toEqual(plans.map((plan) => ({
    sourceId: plan.sourceId,
    cityId: plan.cityId,
    planId: plan.planId,
    criterionId: plan.criterionId,
    definitionId: plan.definitionId,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
  })));
  const artifactBindings = [
    ...planBindings.map(({ planArtifact }) => planArtifact),
    manifest.safety.sourcePlanArtifact,
    manifest.safety.authorityDirectoryArtifact,
    manifest.criteria.defaultsArtifact,
    manifest.criteria.definitionsArtifact,
  ];
  const values = administrativeArtifactValues(installed);
  expect(artifactBindings.map(({ sha256 }) => sha256)).toEqual(values.map((value) =>
    EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(value))));
  expect({
    catalogRoot: manifest.catalogRoot,
    sourcePlanId: manifest.safety.sourcePlanId,
    sourcePlanSchemaVersion: manifest.safety.sourcePlanSchemaVersion,
    authorityDirectoryId: manifest.safety.authorityDirectoryId,
    queryTemplateVersion: manifest.safety.queryTemplateVersion,
    safetyDefinitionId: manifest.safety.definitionId,
    freshnessPolicyVersion: manifest.safety.freshnessPolicyVersion,
    discoveryRulesVersion: manifest.safety.discoveryRulesVersion,
    defaultsMappingVersion: manifest.criteria.defaultsMappingVersion,
    definitionIds: manifest.criteria.definitionIds,
  }).toEqual({
    catalogRoot: {
      registryRevisionId: installed.registry.id,
      catalogRevisionId: installed.catalog.id,
    },
    sourcePlanId: installed.safetySourcePlan.id,
    sourcePlanSchemaVersion: installed.safetySourcePlan.schemaVersion,
    authorityDirectoryId: installed.officialAuthorityDirectory.id,
    queryTemplateVersion: installed.safetySourcePlan.queryTemplateVersion,
    safetyDefinitionId: installed.safetySourcePlan.definitionId,
    freshnessPolicyVersion: installed.safetySourcePlan.freshnessPolicyVersion,
    discoveryRulesVersion: installed.safetySourcePlan.discoveryRulesVersion,
    defaultsMappingVersion: installed.criteriaDefaults.mappingVersion,
    definitionIds: Object.fromEntries(installed.criterionDefinitions.map((definition) => [
      definition.criterionId,
      definition.definitionId,
    ])),
  });
}

function syntheticMarker(): CityLiveMarker {
  const facts = VALID_DRAFT.map((criterion: CityCriterionDraft) => ({
    criterionId: criterion.criterionId,
    definitionId: criterion.definitionId,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "annual@1",
    unit: "unit",
    denominator: "municipality",
    outcome: {
      kind: "verified" as const,
      basis: { kind: "canonical_scalar" as const, value: "1" },
    },
    evidenceLinks: [{
      sourceId: `${criterion.criterionId}-source`,
      disposition: "accepted" as const,
      navigationUrl: `https://official.example/${criterion.criterionId}`,
      resolvedEvidenceUrl: `https://official.example/${criterion.criterionId}/evidence`,
      ...(criterion.criterionId === "safety" ? { referenceYear: 2025 } : {}),
    }],
    manualCheckLinks: [],
  })) as unknown as CityLiveMarker["facts"];
  return {
    cityId: "ljubljana",
    rank: 1,
    status: "selectable",
    visualStatus: "green",
    knowledgeRevisionId: "city-knowledge:task14",
    evidenceSnapshotId: "city-evidence:task14",
    lastCheckedAt: "2026-08-25T12:00:10.000Z",
    requiredMismatches: [],
    unknownBasis: [],
    verificationCoverage: "1",
    facts,
  };
}

function liveArtifact<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  runId: string,
  attemptedAt: string,
  navigationUrl: string,
): LiveCapturedArtifact<S> {
  const bytes = new TextEncoder().encode(`${sourceId}:${navigationUrl}`);
  return {
    artifactId: `${runId}:${sourceId}:artifact`,
    runId,
    sourceId,
    role: "source",
    origin: "live",
    capturedAt: attemptedAt,
    responseStatus: 200,
    responseUrl: `${navigationUrl}/resolved`,
    request: { method: "GET", url: navigationUrl },
    url: `${navigationUrl}/resolved`,
    mediaType: "application/json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function fixedParserEntry<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  navigationUrl: string,
  parserVersion: string,
  artifacts: readonly LiveCapturedArtifact<S>[],
): ParserEntry<S> {
  return {
    sourceId,
    navigationUrl,
    resolvedEvidenceUrl: `${navigationUrl}/resolved`,
    artifacts,
    versionHint: parserVersion,
  };
}

function fixedRoutePort<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  disposition: "second_verified" | "all_rejected" | "first_verified",
  calls: Array<Parameters<CityFixedRoutePort<S, CityFixedEvidenceClaim<S>>["inspect"]>[0]>,
): CityFixedRoutePort<S, CityFixedEvidenceClaim<S>> {
  return {
    async inspect(input) {
      calls.push(input);
      const verified = disposition === "first_verified" && input.routeIndex === 0 ||
        disposition === "second_verified" && input.routeIndex === 1;
      if (!verified) {
        return {
          kind: "rejected",
          attempt: {
            cityCheckRunId: input.cityCheckRunId,
            sourceId: input.sourceId,
            index: input.routeIndex,
            routeId: input.route.routeId,
            navigationUrl: input.route.navigationUrl,
            resolvedEvidenceUrl: `${input.route.navigationUrl}/resolved`,
            attemptedAt: input.attemptedAt,
            disposition: "rejected",
            reason: "http_not_found",
            artifactIds: [],
          },
          parserEntry: fixedParserEntry(
            input.sourceId,
            input.route.navigationUrl,
            plan.parserVersion,
            [],
          ),
        };
      }
      const artifact = liveArtifact(
        input.sourceId,
        input.cityCheckRunId,
        input.attemptedAt,
        input.route.navigationUrl,
      );
      const claim: CityFixedEvidenceClaim<S> = {
        claimId: `${input.cityCheckRunId}:${input.sourceId}:claim`,
        sourceId: input.sourceId,
        value: { kind: "canonical_scalar", value: "1" },
        scope: plan.claimContract.scope,
        sourcePeriod: "2025",
        anchor: {
          artifactId: artifact.artifactId,
          locator: artifact.url,
          excerptSha256: artifact.sha256,
        },
        status: "verified",
        criterionId: plan.criterionId,
        definitionId: plan.definitionId,
        officialAreaId: plan.claimContract.officialAreaId,
        geoScope: plan.claimContract.geoScope,
        unit: plan.claimContract.unit,
        denominator: plan.claimContract.denominator,
        freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
      };
      return {
        kind: "verified",
        attempt: {
          cityCheckRunId: input.cityCheckRunId,
          sourceId: input.sourceId,
          index: input.routeIndex,
          routeId: input.route.routeId,
          navigationUrl: input.route.navigationUrl,
          resolvedEvidenceUrl: artifact.url,
          attemptedAt: input.attemptedAt,
          disposition: "accepted",
          artifactIds: [artifact.artifactId],
          claimIds: [claim.claimId],
        },
        parserEntry: fixedParserEntry(
          input.sourceId,
          input.route.navigationUrl,
          plan.parserVersion,
          [artifact],
        ),
        claims: [claim],
      };
    },
  };
}

function recursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype) {
    expect(value.buffer).toBeInstanceOf(ArrayBuffer);
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(value.buffer).not.toBeInstanceOf(SharedArrayBuffer);
    }
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) recursivelyFrozen(descriptor.value, seen);
  }
}

function manifestPayload(manifest: InstalledCityPackageManifest): unknown {
  const {
    id: _id,
    payloadHash: _payloadHash,
    hmac: _hmac,
    ...payload
  } = manifest;
  void _id;
  void _payloadHash;
  void _hmac;
  return payload;
}

function expectManifestAuthority(
  manifest: InstalledCityPackageManifest,
  key: InstalledCityPackageExactKey,
  auditId: string,
): void {
  recursivelyFrozen(manifest);
  expect(manifest.key).toEqual(key);
  expect(manifest.key).not.toBe(key);
  expect(manifest.id).toBe(auditId);
  const payloadHash = EVIDENCE_INTEGRITY.hash(
    EVIDENCE_INTEGRITY.canonical(manifestPayload(manifest)),
  );
  expect(manifest.payloadHash).toBe(payloadHash);
  expect(manifest.id).toBe(`installed-city-package-manifest:${payloadHash}`);
}

function administrativeArtifactValues(
  installed: InstalledCityResearchPackage,
): readonly unknown[] {
  return [
    ...installed.catalog.members.flatMap(({ cityId }) => installed.fixedPlansByCityId[cityId]!),
    installed.safetySourcePlan,
    installed.officialAuthorityDirectory,
    installed.criteriaDefaults,
    installed.criterionDefinitions,
  ];
}

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("expected_error");
}

function requireError(value: unknown): Error {
  if (value instanceof Error) return value;
  throw new Error("expected_error");
}

function unavailablePorts(callback: () => never = NEVER): CityFrontierApplicationPorts {
  const read = {
    loadVerified: callback,
    findVerifiedByCheckRunId: callback,
  };
  return {
    resolveAvailability: getCityResearchPackageAvailability,
    resolvedCountries: { requireResolvedCountryShortlistForCity: callback },
    profiles: {
      loadRelocationAnyVerified: callback,
      loadPreferenceForRankingVerified: callback,
    },
    installedPackages: { findReady: callback, findExact: callback },
    installedPackageManifests: { loadVerified: callback },
    latestInstalledCatalog: { latestInstalledVerified: callback },
    historicalCatalogs: { loadVerified: callback },
    criteria: { loadCriteriaVerified: callback },
    branches: {
      loadPreCityBranchVerified: callback,
      findPreCityBranchBySourceVerified: callback,
    },
    rankings: { loadRankingVerified: callback },
    frontierRead: {
      loadRevisionVerified: callback,
      loadHeadVerified: callback,
      loadChainVerified: callback,
      findCommandVerified: callback,
    },
    frontierAppend: { appendRevision: callback },
    startWriter: { publishStart: callback },
    selectionHistory: { listSelectionsWithBranchesVerified: callback },
    evidence: { ...read, seal: callback },
    evidenceReplay: {
      read,
      integrity: { canonical: callback, hash: callback, hashBytes: callback },
      package: { loadExactReplayContract: callback },
    },
    knowledge: {
      publishFromEvidence: callback,
      latestVerified: callback,
      loadVerified: callback,
      findByEvidenceVerified: callback,
    },
    fixedRoutes: {
      "si-city-long-term-rent": { inspect: callback },
      "si-city-urban-transit": { inspect: callback },
      "si-city-fixed-broadband": { inspect: callback },
    },
    fixedDeadlineScheduler: { schedule: callback },
    safetySearch: { search: callback },
    safetyDocuments: { inspect: callback },
    decisionIntegrity: { canonical: JSON.stringify, hash: () => DIGEST },
    evidenceIntegrity: { canonical: JSON.stringify, hash: () => DIGEST, sign: () => DIGEST },
    clock: () => new Date("2026-08-25T00:00:00.000Z"),
    fixedSourceDeadlineAt: (now: Date) => new Date(now.valueOf() + 45_000),
  } as unknown as CityFrontierApplicationPorts;
}

interface SyntheticApplicationHarness {
  readonly assembly: Readonly<CityFrontierApplicationAssembly>;
  readonly fixture: SyntheticAuthorityFixture;
  readonly capabilities: {
    readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
    readonly clock: () => Date;
    readonly installedPackageManifests: Pick<
      InstalledCityPackageManifestStorePort,
      "loadVerified"
    >;
  };
  readonly gates: {
    readonly researchEntered: Promise<void>;
    readonly allResearchSignalsEntered: Promise<void>;
    readonly allFinalResearchResultsEntered: Promise<void>;
    releaseResearch(): void;
    releaseFinalResearchResult(sourceId: GatedResearchSourceId): void;
  };
  readonly calls: {
    readonly source: string[];
    readonly resolvedCountryIds: string[];
    readonly relocationProfileIds: string[];
    readonly preferenceProfileIds: string[];
    readonly selectionHistory: string[];
    readonly publications: CityFrontierStartPublication[];
    readonly clocks: string[];
    readonly rankingReads: string[];
    readonly rankingResults: CityRankingSnapshot[];
    readonly catalogReads: string[];
    readonly readyPackageCountries: string[];
    readonly exactPackageKeys: InstalledCityPackageExactKey[];
    readonly reloads: string[];
    readonly authorityOrder: string[];
    readonly fixedRouteInputs: unknown[];
    readonly gatedFixedRouteInputs: unknown[];
    readonly gatedFixedRoutePromises: Promise<unknown>[];
    readonly finalResearchResultsEntered: GatedResearchSourceId[];
    readonly finalResearchResultsReturned: GatedResearchSourceId[];
    readonly deadlinePolicyDates: Date[];
    readonly scheduledDeadlines: string[];
    readonly evidenceSeals: unknown[];
    readonly knowledgePublishes: Array<{ readonly evidenceSnapshotId: string; readonly createdAt: string }>;
    readonly appends: CityFrontierRevision[];
    readonly safetySearchInputs: unknown[];
    readonly safetyDocumentInputs: unknown[];
    readonly fixedRouteOutputs: unknown[];
    readonly safetySearchOutputs: unknown[];
    readonly safetyDocumentOutputs: unknown[];
    readonly appendAuthorityOffsets: number[];
    readonly appendEntryAuthorityCounts: Array<Readonly<Record<string, number>>>;
    readonly installedPackageResults: InstalledCityResearchPackage[];
    readonly manifestKeys: InstalledCityPackageExactKey[];
    readonly manifestResults: unknown[];
    readonly evidenceCanonicals: Array<{ readonly value: unknown; readonly result: string }>;
    readonly evidenceHashes: Array<{ readonly value: string; readonly result: string }>;
    readonly evidenceSigns: Array<{ readonly value: string; readonly result: string }>;
    readonly decisionCanonicals: Array<{ readonly value: unknown; readonly result: string }>;
    readonly decisionHashes: Array<{ readonly value: string; readonly result: string }>;
    readonly forbiddenPrepareCallbacks: string[];
    readonly flightIdentityCanonicals: unknown[];
  };
  readonly state: {
    root(): CityFrontierRevision;
    chain(): readonly CityFrontierRevision[];
    artifacts(): {
      readonly criteria: CityCriteriaSnapshot;
      readonly branch: PreCityBranchCommit;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    };
    replaceChain(revisions: readonly CityFrontierRevision[]): void;
    addRevision(revision: CityFrontierRevision): void;
    failRevisionLoad(id: string, error: Error): void;
    overrideCommandResult(commandId: string, value: unknown): void;
    overrideExactPackageResult(
      mode: "missing" | "visible-key-drift" | "hidden-key-drift",
      alternate: InstalledCityResearchPackage,
      visibleField?: keyof InstalledCityPackageExactKey,
    ): void;
    overrideManifestResult(
      mode: "missing" | "malformed" | "alternate" | "joint-forged",
      alternate?: InstalledCityPackageManifest,
    ): void;
    failManifestLoad(error: Error): void;
    overrideFinalMemberBroadbandPlan(alternate: InstalledCityResearchPackage): void;
    overrideFinalMemberBroadbandPlanValue(value: unknown): void;
    overrideFixedPlansByCityIdValue(value: unknown): void;
    overrideInstalledArtifactValue(
      kind: "safety" | "directory" | "defaults" | "definitions",
      value: unknown,
    ): void;
    collideEvidenceDigest(value: unknown, digest: string): void;
    discriminateEvidenceAuthority(values: readonly unknown[]): void;
    overrideHistoricalCatalogResult(bundle: {
      readonly registry: InstalledCityResearchPackage["registry"];
      readonly catalog: InstalledCityResearchPackage["catalog"];
    }): void;
    overrideReloadDrift(
      value: "criteria" | "ranking" | "root" | undefined,
    ): void;
    collideCheckIdentities(values: readonly unknown[]): void;
    replaceSemanticStart(input: {
      readonly criteria: CityCriteriaSnapshot;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    }): void;
    overrideEvaluatorRegistry(value: CityCriterionEvaluatorRegistry | undefined): void;
    overrideFixedDisposition(
      sourceId: SloveniaCityFixedSourceId,
      disposition: "second_verified" | "all_rejected" | "first_verified" | undefined,
    ): void;
    failCompletedEvidenceRead(error: Error | undefined): void;
    overrideCompletedEvidenceProbe(value: unknown): void;
    bindLegacyStart(): Promise<{
      readonly installed: InstalledCityResearchPackage;
      readonly manifest: InstalledCityPackageManifest;
      readonly current: InstalledCityResearchPackage;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    }>;
    bindInvalidCatalogStart(variant: "unknown-rules" | "future-schema"): Promise<{
      readonly installed: InstalledCityResearchPackage;
      readonly manifest: InstalledCityPackageManifest;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    }>;
    bindPackageSchemaDriftStart(): {
      readonly installed: InstalledCityResearchPackage;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    };
  };
}

function nonStructuralEffects(harness: SyntheticApplicationHarness): Readonly<Record<string, number>> {
  return {
    selectionHistory: harness.calls.selectionHistory.length,
    publications: harness.calls.publications.length,
    clocks: harness.calls.clocks.length,
    rankingReads: harness.calls.rankingReads.length,
    catalogReads: harness.calls.catalogReads.length,
    criteriaReads: harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length,
    branchReads: harness.calls.reloads.filter((value) => value.startsWith("branch:")).length,
    source: harness.calls.source.length,
    fixedInputs: harness.calls.fixedRouteInputs.length,
    fixedOutputs: harness.calls.fixedRouteOutputs.length,
    safetySearchInputs: harness.calls.safetySearchInputs.length,
    safetySearchOutputs: harness.calls.safetySearchOutputs.length,
    safetyDocumentInputs: harness.calls.safetyDocumentInputs.length,
    safetyDocumentOutputs: harness.calls.safetyDocumentOutputs.length,
    deadlines: harness.calls.deadlinePolicyDates.length,
    scheduled: harness.calls.scheduledDeadlines.length,
    evidenceSeals: harness.calls.evidenceSeals.length,
    knowledgePublishes: harness.calls.knowledgePublishes.length,
    appends: harness.calls.appends.length,
    canonicalTargets: harness.fixture.policyCalls.canonicalTargets.length,
    evaluations: harness.fixture.policyCalls.evaluations.length,
    values: harness.fixture.policyCalls.values.length,
    sourcePeriods: harness.fixture.policyCalls.sourcePeriods.length,
    installedPackages: harness.calls.installedPackageResults.length,
    manifestReads: harness.calls.manifestKeys.length,
    evidenceCanonicals: harness.calls.evidenceCanonicals.length,
    evidenceHashes: harness.calls.evidenceHashes.length,
    evidenceSigns: harness.calls.evidenceSigns.length,
    forbiddenPrepareCallbacks: harness.calls.forbiddenPrepareCallbacks.length,
  };
}

function claimedBaseClassificationEffects(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    ...nonStructuralEffects(harness),
    evidenceReads: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("evidence.")).length,
    knowledgeReads: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("knowledge.")).length,
    flightIdentities: harness.calls.flightIdentityCanonicals.length,
    genericSeals: genericSealHarness.calls,
    fixedRunnerInputs: fixedRunnerHarness.inputs.length,
  };
}

function exactPackageBoundaryEffects(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    historicalCatalogs: harness.calls.catalogReads.filter((value) =>
      value.startsWith("catalog.historical:")).length,
    latestCatalogs: harness.calls.catalogReads.filter((value) =>
      value.startsWith("catalog.latest:")).length,
    findReady: harness.calls.readyPackageCountries.length,
    manifestReads: harness.calls.manifestKeys.length,
    evidenceCanonicals: harness.calls.evidenceCanonicals.length,
    evidenceHashes: harness.calls.evidenceHashes.length,
    evidenceSigns: harness.calls.evidenceSigns.length,
    forbiddenCallbacks: harness.calls.forbiddenPrepareCallbacks.length,
    criteria: harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length,
    branch: harness.calls.reloads.filter((value) => value.startsWith("branch:")).length,
    evidence: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("evidence.")).length,
    knowledge: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("knowledge.")).length,
    evaluations: harness.fixture.policyCalls.evaluations.length,
    values: harness.fixture.policyCalls.values.length,
    sourcePeriods: harness.fixture.policyCalls.sourcePeriods.length,
    selection: harness.calls.selectionHistory.length,
    clocks: harness.calls.clocks.length,
    deadlinePolicy: harness.calls.deadlinePolicyDates.length,
    scheduled: harness.calls.scheduledDeadlines.length,
    flightIdentities: harness.calls.flightIdentityCanonicals.length,
    source: harness.calls.source.length,
    fixed: harness.calls.fixedRouteInputs.length,
    safetySearch: harness.calls.safetySearchInputs.length,
    safetyDocument: harness.calls.safetyDocumentInputs.length,
    genericSeals: genericSealHarness.calls,
    evidenceSeals: harness.calls.evidenceSeals.length,
    knowledgePublishes: harness.calls.knowledgePublishes.length,
    appends: harness.calls.appends.length,
  };
}

function manifestBoundaryDownstreamEffects(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  const {
    manifestReads: _allowedManifestReads,
    evidenceCanonicals: _allowedCanonicals,
    evidenceHashes: _allowedHashes,
    evidenceSigns: _allowedSigns,
    ...downstream
  } = exactPackageBoundaryEffects(harness);
  void _allowedManifestReads;
  void _allowedCanonicals;
  void _allowedHashes;
  void _allowedSigns;
  return downstream;
}

function planGateDownstreamEffects(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  const {
    historicalCatalogs: _allowedHistoricalCatalogs,
    manifestReads: _allowedManifestReads,
    evidenceCanonicals: _allowedCanonicals,
    evidenceHashes: _allowedHashes,
    evidenceSigns: _allowedSigns,
    ...downstream
  } = exactPackageBoundaryEffects(harness);
  void _allowedHistoricalCatalogs;
  void _allowedManifestReads;
  void _allowedCanonicals;
  void _allowedHashes;
  void _allowedSigns;
  return downstream;
}

function resetPlanGateObservations(): void {
  planGateHarness.fixed.splice(0);
  planGateHarness.directories.splice(0);
  planGateHarness.safetyPlans.splice(0);
  planGateHarness.definitionStructures.splice(0);
  planGateHarness.defaults.splice(0);
  planGateHarness.definitions.splice(0);
  planGateHarness.semanticEntries.splice(0);
  planGateHarness.order.splice(0);
  planGateHarness.beforeSemantic = undefined;
}

function planGateCounts(): Readonly<Record<string, number>> {
  return {
    fixed: planGateHarness.fixed.length,
    directories: planGateHarness.directories.length,
    safetyPlans: planGateHarness.safetyPlans.length,
    definitionStructures: planGateHarness.definitionStructures.length,
    defaults: planGateHarness.defaults.length,
    definitions: planGateHarness.definitions.length,
    semanticEntries: planGateHarness.semanticEntries.length,
  };
}

interface SyntheticHarnessOptions {
  readonly writerResultDrift?: "criteria" | "branch" | "ranking" | "root";
  readonly reloadDrift?: "criteria" | "branch" | "ranking" | "catalog" | "root";
  readonly discriminatingClock?: boolean;
  readonly fixedSourceDeadlineAt?: (now: Date) => unknown;
  readonly fixedDeadlineScheduler?: CityFixedDeadlineScheduler;
  readonly runnerNow?: () => unknown;
  readonly appendResultDrift?: boolean;
  readonly gateResearch?: boolean;
  readonly blockFixedBroadbandRoute?: boolean;
  readonly gateFinalResearchResults?: boolean;
  readonly fixedBroadbandFault?:
    | { readonly kind: "protocol"; readonly output: unknown }
    | { readonly kind: "native"; readonly error: Error };
  readonly assessmentAt?: string;
  readonly safetySearch?: CitySafetySearchPort;
  readonly safetyDocuments?: CitySafetyOfficialDocumentPort;
  readonly afterSafetyDocumentReturn?: () => void;
  readonly afterClock?: (callCount: number) => void;
  readonly preserveRuns?: boolean;
  readonly failKnowledgePublishOnce?: Error;
  readonly mapKnowledgePublishResult?: (revision: CityKnowledgeRevision) => unknown;
  readonly beforeKnowledgeFindReturn?: () => void;
  readonly failAppendBeforePersistenceOnce?: Error;
  readonly installedPackagesFactory?: (
    fixture: SyntheticAuthorityFixture,
  ) => InstalledCityPackages;
  readonly selectionHistory?: CitySelectionHistoryReadPort;
  readonly authorityFixtureOptions?: SyntheticAuthorityFixtureOptions;
}

async function syntheticApplicationHarness(
  options: SyntheticHarnessOptions = {},
): Promise<SyntheticApplicationHarness> {
  const fixture = await withInfrastructurePlanGateReadAsync(() =>
    syntheticAuthorityFixture(options.authorityFixtureOptions));
  const collidingCheckCanonicals = new Set<string>();
  const discriminatingEvidenceCanonicals = new Set<string>();
  const evidenceHashOverrides = new Map<string, string>();
  const flightIdentityCanonicals: unknown[] = [];
  const decisionCanonicals: Array<{ readonly value: unknown; readonly result: string }> = [];
  const decisionHashes: Array<{ readonly value: string; readonly result: string }> = [];
  const applicationIntegrity: CityDecisionIntegrity = {
    canonical(value) {
      if (value !== null && typeof value === "object" &&
        Reflect.ownKeys(value).map(String).sort().join("\0") === [
          "assessmentAt",
          "baseRevisionId",
          "cityCheckRunId",
          "cityId",
          "installedPackageContext",
          "rankingSnapshotId",
          "runId",
        ].sort().join("\0")) {
        flightIdentityCanonicals.push(structuredClone(value));
      }
      const canonical = DECISION_INTEGRITY.canonical(value);
      const result = discriminatingEvidenceCanonicals.has(canonical)
        ? `decision-authority:${canonical}`
        : canonical;
      decisionCanonicals.push({ value: structuredClone(value), result });
      return result;
    },
    hash(value) {
      const result = typeof value === "string" && collidingCheckCanonicals.has(value)
        ? "c".repeat(64)
        : DECISION_INTEGRITY.hash(value);
      decisionHashes.push({ value, result });
      return result;
    },
  };
  const researchEntered = deferred<void>();
  const researchRelease = deferred<void>();
  const allResearchSignalsEntered = deferred<void>();
  const finalResearchResultGates: Record<GatedResearchSourceId, {
    readonly entered: Deferred<void>;
    readonly release: Deferred<void>;
  }> = {
    "si-city-safety": { entered: deferred<void>(), release: deferred<void>() },
    "si-city-long-term-rent": { entered: deferred<void>(), release: deferred<void>() },
    "si-city-urban-transit": { entered: deferred<void>(), release: deferred<void>() },
    "si-city-fixed-broadband": { entered: deferred<void>(), release: deferred<void>() },
  };
  const fixedInputOffset = fixedRunnerHarness.inputs.length;
  let researchGateClaimed = false;
  let knowledgePublishFailurePending = options.failKnowledgePublishOnce !== undefined;
  let appendFailurePending = options.failAppendBeforePersistenceOnce !== undefined;
  const calls = {
    source: [] as string[],
    resolvedCountryIds: [] as string[],
    relocationProfileIds: [] as string[],
    preferenceProfileIds: [] as string[],
    selectionHistory: [] as string[],
    publications: [] as CityFrontierStartPublication[],
    clocks: [] as string[],
    rankingReads: [] as string[],
    rankingResults: [] as CityRankingSnapshot[],
    catalogReads: [] as string[],
    readyPackageCountries: [] as string[],
    exactPackageKeys: [] as InstalledCityPackageExactKey[],
    reloads: [] as string[],
    authorityOrder: [] as string[],
    fixedRouteInputs: [] as unknown[],
    gatedFixedRouteInputs: [] as unknown[],
    gatedFixedRoutePromises: [] as Promise<unknown>[],
    finalResearchResultsEntered: [] as GatedResearchSourceId[],
    finalResearchResultsReturned: [] as GatedResearchSourceId[],
    deadlinePolicyDates: [] as Date[],
    scheduledDeadlines: [] as string[],
    evidenceSeals: [] as unknown[],
    knowledgePublishes: [] as Array<{
      readonly evidenceSnapshotId: string;
      readonly createdAt: string;
    }>,
    appends: [] as CityFrontierRevision[],
    safetySearchInputs: [] as unknown[],
    safetyDocumentInputs: [] as unknown[],
    fixedRouteOutputs: [] as unknown[],
    safetySearchOutputs: [] as unknown[],
    safetyDocumentOutputs: [] as unknown[],
    appendAuthorityOffsets: [] as number[],
    appendEntryAuthorityCounts: [] as Array<Readonly<Record<string, number>>>,
    installedPackageResults: [] as InstalledCityResearchPackage[],
    manifestKeys: [] as InstalledCityPackageExactKey[],
    manifestResults: [] as unknown[],
    evidenceCanonicals: [] as Array<{ readonly value: unknown; readonly result: string }>,
    evidenceHashes: [] as Array<{ readonly value: string; readonly result: string }>,
    evidenceSigns: [] as Array<{ readonly value: string; readonly result: string }>,
    decisionCanonicals,
    decisionHashes,
    forbiddenPrepareCallbacks: [] as string[],
    flightIdentityCanonicals,
  };
  const maybeResolveAllResearchSignals = (): void => {
    if (fixedRunnerHarness.inputs.length - fixedInputOffset >= 3 &&
      calls.safetySearchInputs.length >= 3 && calls.safetyDocumentInputs.length >= 1) {
      allResearchSignalsEntered.resolve(undefined);
    }
  };
  fixedRunnerHarness.onInput = maybeResolveAllResearchSignals;
  let criteria: CityCriteriaSnapshot | undefined;
  let branch: PreCityBranchCommit | undefined;
  let ranking: CityRankingSnapshot | undefined;
  let root: CityFrontierRevision | undefined;
  let chain: readonly CityFrontierRevision[] = [];
  let exactPackageOverride: InstalledCityResearchPackage | undefined;
  let adversarialExactPackageResult: {
    readonly mode: "missing" | "visible-key-drift" | "hidden-key-drift";
    readonly alternate: InstalledCityResearchPackage;
    readonly visibleField?: keyof InstalledCityPackageExactKey;
  } | undefined;
  let manifestResultOverride: {
    readonly mode: "missing" | "malformed" | "alternate" | "joint-forged";
    readonly alternate?: InstalledCityPackageManifest;
  } | undefined;
  let manifestLoadFailure: Error | undefined;
  let completedEvidenceReadFailure: Error | undefined;
  const noCompletedEvidenceProbeOverride = Symbol("no-completed-evidence-probe-override");
  let completedEvidenceProbeOverride: unknown = noCompletedEvidenceProbeOverride;
  let finalMemberBroadbandPlanOverride: unknown;
  let fixedPlansByCityIdOverride: unknown;
  let evaluatorRegistryOverride: CityCriterionEvaluatorRegistry | undefined;
  let reloadDrift = options.reloadDrift;
  const fixedDispositionOverrides = new Map<
    SloveniaCityFixedSourceId,
    "second_verified" | "all_rejected" | "first_verified"
  >();
  const installedArtifactOverrides = new Map<
    "safety" | "directory" | "defaults" | "definitions",
    unknown
  >();
  let historicalCatalogResultOverride: {
    readonly registry: InstalledCityResearchPackage["registry"];
    readonly catalog: InstalledCityResearchPackage["catalog"];
  } | undefined;
  const knownRevisions: CityFrontierRevision[] = [];
  const criteriaById = new Map<string, CityCriteriaSnapshot>();
  const branchesById = new Map<string, PreCityBranchCommit>();
  const branchSourcesById = new Map<string, PreCityBranchSourceProjection>();
  const rankingsById = new Map<string, CityRankingSnapshot>();
  const chainsByRun = new Map<string, readonly CityFrontierRevision[]>();
  const revisionLoadFailures = new Map<string, Error>();
  const commandResultOverrides = new Map<string, unknown>();
  const required = <T>(value: T | undefined, message: string): T => {
    if (value === undefined) throw new Error(message);
    return value;
  };
  const driftCriteria = (candidate: CityCriteriaSnapshot): CityCriteriaSnapshot => {
    const { id: _id, ...payload } = structuredClone(candidate);
    void _id;
    const changed = { ...payload, profileSnapshotId: `${payload.profileSnapshotId}:drift` };
    return {
      id: `city-criteria:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(changed))}`,
      ...changed,
    };
  };
  const driftBranch = (): PreCityBranchCommit => createPreCityBranchCommit({
    source: {
      profileSnapshotId: fixture.relocation.id,
      preferenceProfileSnapshotId: fixture.preference.id,
      resolvedCountryShortlistRevisionId: fixture.resolved.id,
      resolvedCountryEntry: fixture.resolved.resolvedEntries[0]!,
    },
    createdAt: "2026-08-24T12:00:00.001Z",
  }, DECISION_INTEGRITY);
  const driftRanking = (candidate: CityRankingSnapshot): CityRankingSnapshot => {
    const { id: _id, ...payload } = structuredClone(candidate);
    void _id;
    return sealCityRankingSnapshot({
      ...payload,
      profileSnapshotId: `${payload.profileSnapshotId}:drift`,
    }, DECISION_INTEGRITY);
  };
  const driftRoot = (candidate: CityFrontierRevision): CityFrontierRevision =>
    sealCityFrontierRevision({
      runId: candidate.runId,
      ...(candidate.predecessorRevisionId === undefined
        ? {}
        : { predecessorRevisionId: candidate.predecessorRevisionId }),
      rankingSnapshotId: candidate.rankingSnapshotId,
      markers: candidate.markers,
      projection: candidate.kind === "working"
        ? {
            kind: "working",
            nextUncheckedRank: candidate.nextUncheckedRank,
            selectableCityIds: candidate.markers
              .filter(({ status }) => status === "selectable")
              .map(({ cityId }) => cityId),
            phase: candidate.phase,
          }
        : {
            kind: "terminal",
            nextUncheckedRank: candidate.nextUncheckedRank,
            selectableCityIds: candidate.markers
              .filter(({ status }) => status === "selectable")
              .map(({ cityId }) => cityId),
            entries: candidate.entries,
            stopCondition: candidate.stopCondition,
          },
      operation: candidate.operation.kind === "start"
        ? { ...candidate.operation, criteriaPayloadHash: "f".repeat(64) }
        : { ...candidate.operation, cityCheckRunId: `city-check:${"f".repeat(64)}` },
      createdAt: candidate.createdAt,
    }, DECISION_INTEGRITY);
  const driftPresentationRoot = (candidate: CityFrontierRevision): CityFrontierRevision =>
    sealCityFrontierRevision({
      runId: candidate.runId,
      ...(candidate.predecessorRevisionId === undefined
        ? {}
        : { predecessorRevisionId: candidate.predecessorRevisionId }),
      rankingSnapshotId: `city-ranking:${"f".repeat(64)}`,
      markers: candidate.markers,
      projection: candidate.kind === "working"
        ? {
            kind: "working",
            nextUncheckedRank: candidate.nextUncheckedRank,
            selectableCityIds: candidate.markers
              .filter(({ status }) => status === "selectable")
              .map(({ cityId }) => cityId),
            phase: candidate.phase,
          }
        : {
            kind: "terminal",
            nextUncheckedRank: candidate.nextUncheckedRank,
            selectableCityIds: candidate.markers
              .filter(({ status }) => status === "selectable")
              .map(({ cityId }) => cityId),
            entries: candidate.entries,
            stopCondition: candidate.stopCondition,
          },
      operation: candidate.operation,
      createdAt: candidate.createdAt,
    }, DECISION_INTEGRITY);
  const ports = unavailablePorts() as unknown as MutableRecord;
  ports.resolveAvailability = () => {
    calls.forbiddenPrepareCallbacks.push("availability");
    return structuredClone(fixture.ready);
  };
  ports.resolvedCountries = {
    requireResolvedCountryShortlistForCity: async (id: string) => {
      calls.resolvedCountryIds.push(id);
      calls.forbiddenPrepareCallbacks.push("resolved-country");
      return structuredClone(id === fixture.alternateResolved.id
        ? fixture.alternateResolved
        : fixture.resolved);
    },
  };
  ports.profiles = {
    loadRelocationAnyVerified: async (id: string) => {
      calls.relocationProfileIds.push(id);
      calls.forbiddenPrepareCallbacks.push("relocation-profile");
      return structuredClone(id === fixture.alternateRelocation.id
        ? fixture.alternateRelocation
        : fixture.relocation);
    },
    loadPreferenceForRankingVerified: async (id: string) => {
      calls.preferenceProfileIds.push(id);
      calls.forbiddenPrepareCallbacks.push("preference-profile");
      return structuredClone(id === fixture.alternatePreference.id
        ? fixture.alternatePreference
        : fixture.preference);
    },
  };
  const applyInstalledArtifactOverrides = (
    borrowed: InstalledCityResearchPackage | undefined,
  ): InstalledCityResearchPackage | undefined => {
    if (borrowed === undefined) return undefined;
    let result = borrowed;
    if (fixedPlansByCityIdOverride !== undefined) {
      result = freezeDeep({
        ...result,
        fixedPlansByCityId: fixedPlansByCityIdOverride,
      } as unknown as InstalledCityResearchPackage);
    }
    if (finalMemberBroadbandPlanOverride !== undefined) {
      const finalMember = required(result.catalog.members.at(-1), "missing_final_catalog_member");
      const currentPlans = required(
        result.fixedPlansByCityId[finalMember.cityId],
        "missing_final_member_plans",
      );
      result = freezeDeep({
        ...result,
        fixedPlansByCityId: {
          ...result.fixedPlansByCityId,
          [finalMember.cityId]: [
            currentPlans[0],
            currentPlans[1],
            finalMemberBroadbandPlanOverride,
          ],
        },
      } as unknown as InstalledCityResearchPackage);
    }
    if (installedArtifactOverrides.size > 0) {
      result = freezeDeep({
        ...result,
        ...(installedArtifactOverrides.has("safety")
          ? { safetySourcePlan: installedArtifactOverrides.get("safety") }
          : {}),
        ...(installedArtifactOverrides.has("directory")
          ? { officialAuthorityDirectory: installedArtifactOverrides.get("directory") }
          : {}),
        ...(installedArtifactOverrides.has("defaults")
          ? { criteriaDefaults: installedArtifactOverrides.get("defaults") }
          : {}),
        ...(installedArtifactOverrides.has("definitions")
          ? { criterionDefinitions: installedArtifactOverrides.get("definitions") }
          : {}),
      } as unknown as InstalledCityResearchPackage);
    }
    if (evaluatorRegistryOverride !== undefined) {
      result = freezeDeep({
        ...result,
        evaluatorRegistry: evaluatorRegistryOverride,
      });
    }
    return result;
  };
  const installedPackageReader = options.installedPackagesFactory?.(fixture) ??
    fixture.installedPackages;
  ports.installedPackages = {
    findReady: (countryCode: string) => {
      calls.readyPackageCountries.push(countryCode);
      const result = applyInstalledArtifactOverrides(
        withInfrastructurePlanGateRead(() => installedPackageReader.findReady(countryCode)),
      );
      if (result !== undefined) calls.installedPackageResults.push(result);
      return result;
    },
    findExact: (key: InstalledCityPackageExactKey) => {
      calls.exactPackageKeys.push(key);
      calls.authorityOrder.push("package.exact");
      const requested = exactPackageOverride !== undefined && DECISION_INTEGRITY.canonical(key) ===
          DECISION_INTEGRITY.canonical(exactPackageOverride.installedPackageManifest.key)
        ? exactPackageOverride
        : withInfrastructurePlanGateRead(() => installedPackageReader.findExact(key));
      let result = requested;
      if (adversarialExactPackageResult?.mode === "missing") {
        result = undefined;
      } else if (adversarialExactPackageResult !== undefined) {
        const base = required(requested, "city_package_revision_not_installed");
        if (adversarialExactPackageResult.mode === "hidden-key-drift") {
          result = freezeDeep({
            ...base,
            installedPackageManifest: {
              id: base.installedPackageManifest.id,
              key: structuredClone(
                adversarialExactPackageResult.alternate.installedPackageManifest.key,
              ),
            },
          });
        } else if (adversarialExactPackageResult.visibleField === "catalogRevisionId") {
          result = freezeDeep({
            ...base,
            registry: adversarialExactPackageResult.alternate.registry,
            catalog: adversarialExactPackageResult.alternate.catalog,
          });
        } else {
          const visibleField = required(
            adversarialExactPackageResult.visibleField,
            "missing_visible_key_field",
          );
          const definition = { ...base.definition };
          if (visibleField === "countryCode") definition.countryCode = "AT";
          if (visibleField === "packageId") definition.packageId = `${definition.packageId}:drift`;
          if (visibleField === "packageSchemaVersion") {
            definition.packageSchemaVersion = `${definition.packageSchemaVersion}:drift`;
          }
          if (visibleField === "evidenceRulesVersion") {
            definition.evidenceRulesVersion = `${definition.evidenceRulesVersion}:drift`;
          }
          result = freezeDeep({ ...base, definition });
        }
      }
      result = applyInstalledArtifactOverrides(result);
      if (result !== undefined && manifestResultOverride?.mode === "joint-forged") {
        result = freezeDeep({
          ...result,
          installedPackageManifest: {
            id: `installed-city-package-manifest:${"f".repeat(64)}`,
            key: result.installedPackageManifest.key,
          },
        });
      }
      if (result !== undefined) calls.installedPackageResults.push(result);
      return result;
    },
  };
  const capturedManifestStoreLoad = fixture.manifestStore.loadVerified.bind(fixture.manifestStore);
  const manifestReadPort = freezeDeep({
    loadVerified: (key: InstalledCityPackageExactKey): InstalledCityPackageManifest | undefined => {
      calls.manifestKeys.push(key);
      calls.authorityOrder.push("manifest.exact");
      if (manifestLoadFailure !== undefined) throw manifestLoadFailure;
      const authentic = withInfrastructurePlanGateRead(() => capturedManifestStoreLoad(key));
      let result: unknown = authentic;
      if (manifestResultOverride?.mode === "missing") {
        result = undefined;
      } else if (manifestResultOverride?.mode === "malformed") {
        result = freezeDeep({ ...required(authentic, "missing_manifest_fixture"), extra: true });
      } else if (manifestResultOverride?.mode === "alternate") {
        result = required(manifestResultOverride.alternate, "missing_alternate_manifest");
      } else if (manifestResultOverride?.mode === "joint-forged") {
        result = freezeDeep({
          ...required(authentic, "missing_manifest_fixture"),
          id: `installed-city-package-manifest:${"f".repeat(64)}`,
          payloadHash: "f".repeat(64),
        });
      }
      if (result !== undefined) calls.manifestResults.push(result);
      return result as InstalledCityPackageManifest | undefined;
    },
  });
  ports.installedPackageManifests = manifestReadPort;
  ports.latestInstalledCatalog = {
    latestInstalledVerified: (countryCode: string) => {
      calls.catalogReads.push(`catalog.latest:${countryCode}`);
      calls.authorityOrder.push(`catalog.latest:${countryCode}`);
      return withInfrastructurePlanGateRead(() =>
        fixture.installedPackages.latestInstalledVerified(countryCode));
    },
  };
  ports.historicalCatalogs = {
    loadVerified: (id: string) => {
      calls.catalogReads.push(`catalog.historical:${id}`);
      calls.authorityOrder.push(`catalog.historical:${id}`);
      if (historicalCatalogResultOverride !== undefined) {
        return {
          registry: structuredClone(historicalCatalogResultOverride.registry),
          catalog: structuredClone(historicalCatalogResultOverride.catalog),
        };
      }
      if (exactPackageOverride?.catalog.id === id) {
        return {
          registry: structuredClone(exactPackageOverride.registry),
          catalog: structuredClone(exactPackageOverride.catalog),
        };
      }
      const candidate = fixture.catalogStore.loadVerified(id);
      if (reloadDrift !== "catalog") return candidate;
      return {
        registry: candidate.registry,
        catalog: buildCityCatalogRevision({
          registry: candidate.registry,
          evidenceSnapshotId: candidate.catalog.evidenceSnapshotId,
          populationDefinition: candidate.catalog.populationDefinition,
          candidateBasis: candidate.catalog.candidateBasis.map((basis) => basis.cityId === "ljubljana"
            ? {
                ...basis,
                comparablePopulation: { ...basis.comparablePopulation, value: "300001" },
              }
            : basis),
          coverage: candidate.catalog.coverage,
          createdAt: candidate.catalog.createdAt,
        }, DECISION_INTEGRITY),
      };
    },
  };
  ports.criteria = {
    loadCriteriaVerified: (id: string) => {
      calls.reloads.push(`criteria:${id}`);
      calls.authorityOrder.push(`criteria:${id}`);
      const candidate = required(options.preserveRuns === true ? criteriaById.get(id) : criteria,
        "city_criteria_not_found");
      if (reloadDrift !== "criteria") return structuredClone(candidate);
      return driftCriteria(candidate);
    },
  };
  ports.branches = {
    loadPreCityBranchVerified: (id: string) => {
      calls.reloads.push(`branch:${id}`);
      calls.authorityOrder.push(`branch:${id}`);
      const candidate = required(options.preserveRuns === true ? branchesById.get(id) : branch,
        "city_branch_not_found");
      return reloadDrift === "branch" ? driftBranch() : structuredClone(candidate);
    },
    findPreCityBranchBySourceVerified: (source: PreCityBranchSourceProjection) => {
      calls.forbiddenPrepareCallbacks.push("branch-source");
      if (options.preserveRuns === true) {
        const matches = [...branchesById.values()].filter((candidate) =>
          applicationIntegrity.canonical(branchSourcesById.get(candidate.id)) ===
            applicationIntegrity.canonical(source));
        if (matches.length > 1) throw new Error("integrity_mismatch");
        return matches[0] === undefined ? undefined : structuredClone(matches[0]);
      }
      return branch === undefined ? undefined : structuredClone(branch);
    },
  };
  ports.rankings = {
    loadRankingVerified: (id: string) => {
      calls.rankingReads.push(id);
      calls.reloads.push(`ranking:${id}`);
      calls.authorityOrder.push(`ranking:${id}`);
      const candidate = required(options.preserveRuns === true ? rankingsById.get(id) : ranking,
        "city_ranking_not_found");
      if (candidate.id !== id) throw new Error("city_ranking_not_found");
      const result = reloadDrift !== "ranking"
        ? freezeDeep(structuredClone(candidate))
        : driftRanking(candidate);
      calls.rankingResults.push(result);
      return result;
    },
  };
  const loadedRoot = (): CityFrontierRevision => {
    const candidate = required(root, "city_frontier_not_found");
    if (reloadDrift !== "root") return structuredClone(candidate);
    return options.reloadDrift === "root"
      ? driftRoot(candidate)
      : driftPresentationRoot(candidate);
  };
  ports.frontierRead = {
    loadRevisionVerified: (id: string) => {
      calls.reloads.push(`frontier.revision:${id}`);
      calls.authorityOrder.push(`frontier.revision:${id}`);
      const injectedFailure = revisionLoadFailures.get(id);
      if (injectedFailure !== undefined) throw injectedFailure;
      const candidates = knownRevisions.filter((revision) => revision.id === id);
      if (candidates.length !== 1) throw new Error("city_frontier_not_found");
      return candidates[0]!.id === root?.id ? loadedRoot() : structuredClone(candidates[0]!);
    },
    loadHeadVerified: (runId: string) => {
      calls.reloads.push(`frontier.head:${runId}`);
      calls.authorityOrder.push(`frontier.head:${runId}`);
      const candidate = required(options.preserveRuns === true
        ? chainsByRun.get(runId)?.at(-1)
        : root, "city_frontier_not_found");
      if (candidate.runId !== runId) throw new Error("city_frontier_not_found");
      return options.preserveRuns === true ? structuredClone(candidate) : loadedRoot();
    },
    loadChainVerified: (runId: string) => {
      calls.reloads.push(`frontier.chain:${runId}`);
      calls.authorityOrder.push(`frontier.chain:${runId}`);
      const selectedChain = options.preserveRuns === true ? chainsByRun.get(runId) ?? [] : chain;
      if (selectedChain.length === 0 || selectedChain.some((revision) => revision.runId !== runId)) {
        throw new Error("city_frontier_not_found");
      }
      return selectedChain.map((revision) => options.preserveRuns !== true && revision.id === root?.id
        ? loadedRoot()
        : structuredClone(revision));
    },
    findCommandVerified: (_runId: string, commandId: string) => {
      calls.reloads.push(`frontier.command:${_runId}:${commandId}`);
      calls.authorityOrder.push(`frontier.command:${_runId}:${commandId}`);
      if (commandResultOverrides.has(commandId)) {
        return structuredClone(commandResultOverrides.get(commandId)) as ReturnType<
          CityFrontierReadPort["findCommandVerified"]
        >;
      }
      const selectedChain = options.preserveRuns === true ? chainsByRun.get(_runId) ?? [] : chain;
      const matches = selectedChain.filter((revision) => revision.runId === _runId &&
        revision.operation.commandId === commandId);
      if (matches.length === 0) return undefined;
      if (matches.length !== 1) throw new Error("integrity_mismatch");
      const loaded = options.preserveRuns !== true && matches[0]!.id === root?.id
        ? loadedRoot()
        : structuredClone(matches[0]!);
      return { operation: loaded.operation, revision: loaded };
    },
  };
  ports.startWriter = {
    publishStart: (publication: CityFrontierStartPublication) => {
      calls.publications.push(structuredClone(publication));
      const persisted = structuredClone(publication);
      criteria = persisted.criteria;
      branch = persisted.preCityBranch;
      ranking = persisted.ranking;
      root = persisted.root;
      chain = [persisted.root];
      criteriaById.set(persisted.criteria.id, persisted.criteria);
      branchesById.set(persisted.preCityBranch.id, persisted.preCityBranch);
      branchSourcesById.set(persisted.preCityBranch.id, structuredClone(publication.preCitySource));
      rankingsById.set(persisted.ranking.id, persisted.ranking);
      chainsByRun.set(persisted.root.runId, [persisted.root]);
      if (options.preserveRuns === true) knownRevisions.push(persisted.root);
      else knownRevisions.splice(0, knownRevisions.length, persisted.root);
      const result = structuredClone({
        criteria: persisted.criteria,
        preCityBranch: persisted.preCityBranch,
        ranking: persisted.ranking,
        root: persisted.root,
      });
      switch (options.writerResultDrift) {
        case "criteria":
          result.criteria = driftCriteria(result.criteria);
          break;
        case "branch":
          result.preCityBranch = driftBranch();
          break;
        case "ranking":
          result.ranking = driftRanking(result.ranking);
          break;
        case "root":
          result.root = driftRoot(result.root);
          break;
      }
      return result;
    },
  };
  ports.frontierAppend = {
    appendRevision: (input: Parameters<CityFrontierAppendPort["appendRevision"]>[0]) => {
      calls.appendAuthorityOffsets.push(calls.authorityOrder.length);
      calls.appendEntryAuthorityCounts.push({
        ranking: calls.rankingReads.length,
        catalog: calls.catalogReads.filter((value) =>
          value.startsWith("catalog.historical:")).length,
        criteria: calls.reloads.filter((value) => value.startsWith("criteria:")).length,
        branch: calls.reloads.filter((value) => value.startsWith("branch:")).length,
        evidence: calls.authorityOrder.filter((value) => value.startsWith("evidence.")).length,
        knowledge: calls.authorityOrder.filter((value) => value.startsWith("knowledge.")).length,
      });
      const candidate = reconstructCityFrontierRevision(input.revision, applicationIntegrity);
      calls.appends.push(structuredClone(candidate));
      const rawChain = options.preserveRuns === true
        ? chainsByRun.get(candidate.runId) ?? []
        : chain;
      const rawCommandMatches = rawChain.filter((revision) =>
        revision.operation.commandId === candidate.operation.commandId);
      if (rawCommandMatches.length > 1) throw new Error("integrity_mismatch");
      const commandWinner = rawCommandMatches[0] === undefined
        ? undefined
        : reconstructCityFrontierRevision(rawCommandMatches[0], applicationIntegrity);
      if (commandWinner !== undefined &&
        applicationIntegrity.canonical(commandWinner.operation) !==
          applicationIntegrity.canonical(candidate.operation)) {
        throw new Error("integrity_mismatch");
      }
      const selectedChain = rawChain.map((revision) => reconstructCityFrontierRevision(
        revision,
        applicationIntegrity,
      ));
      if (selectedChain.length === 0 ||
        new Set(selectedChain.map(({ id }) => id)).size !== selectedChain.length ||
        new Set(selectedChain.map(({ operation }) => operation.commandId)).size !==
          selectedChain.length) {
        throw new Error("integrity_mismatch");
      }
      for (const [index, revision] of selectedChain.entries()) {
        if (revision.runId !== candidate.runId ||
          revision.rankingSnapshotId !== selectedChain[0]!.rankingSnapshotId ||
          revision.markers.some((marker, markerIndex) => marker.rank !== markerIndex + 1)) {
          throw new Error("integrity_mismatch");
        }
        if (index === 0) {
          if (revision.operation.kind !== "start" ||
            revision.predecessorRevisionId !== undefined || revision.markers.length !== 0) {
            throw new Error("integrity_mismatch");
          }
          continue;
        }
        const prior = selectedChain[index - 1]!;
        if (revision.predecessorRevisionId !== prior.id ||
          revision.rankingSnapshotId !== prior.rankingSnapshotId ||
          revision.createdAt < prior.createdAt ||
          revision.markers.length !== prior.markers.length + 1 ||
          applicationIntegrity.canonical(revision.markers.slice(0, -1)) !==
            applicationIntegrity.canonical(prior.markers)) {
          throw new Error("integrity_mismatch");
        }
      }
      const rankingId = selectedChain[0]!.rankingSnapshotId;
      const rankingCandidate = options.preserveRuns === true
        ? rankingsById.get(rankingId)
        : ranking;
      if (rankingCandidate === undefined) throw new Error("integrity_mismatch");
      const verifiedRanking = reconstructCityRankingSnapshot(
        rankingCandidate,
        applicationIntegrity,
      );
      let verifiedCatalog: ReturnType<typeof fixture.catalogStore.loadVerified>;
      try {
        verifiedCatalog = fixture.catalogStore.loadVerified(verifiedRanking.catalogRevisionId);
        if ((verifiedCatalog.catalog.rulesVersion !== "city-catalog@1" &&
            verifiedCatalog.catalog.rulesVersion !== "city-catalog@2") ||
          verifiedCatalog.catalog.id !== verifiedRanking.catalogRevisionId ||
          verifiedCatalog.catalog.registryRevisionId !== verifiedCatalog.registry.id ||
          verifiedCatalog.registry.id !== verifiedRanking.registryRevisionId ||
          verifiedCatalog.registry.countryCode !== verifiedRanking.countryCode ||
          verifiedCatalog.registry.packageId !== verifiedRanking.packageId ||
          verifiedCatalog.registry.packageSchemaVersion !== verifiedRanking.packageSchemaVersion ||
          verifiedCatalog.catalog.countryCode !== verifiedRanking.countryCode ||
          verifiedCatalog.catalog.packageId !== verifiedRanking.packageId ||
          verifiedCatalog.catalog.packageSchemaVersion !== verifiedRanking.packageSchemaVersion ||
          verifiedRanking.installedPackageContext.countryCode !== verifiedRanking.countryCode ||
          verifiedRanking.installedPackageContext.packageId !== verifiedRanking.packageId ||
          verifiedRanking.installedPackageContext.packageSchemaVersion !==
            verifiedRanking.packageSchemaVersion ||
          verifiedRanking.installedPackageContext.catalogRevisionId !==
            verifiedRanking.catalogRevisionId) {
          throw new Error("integrity_mismatch");
        }
      } catch {
        throw new Error("integrity_mismatch");
      }
      if (verifiedCatalog.catalog.rulesVersion === "city-catalog@1") {
        throw new Error("city_catalog_upgrade_required");
      }
      if (commandWinner !== undefined) {
        const replayedWinner = selectedChain.filter(({ id }) => id === commandWinner.id);
        if (replayedWinner.length !== 1) throw new Error("integrity_mismatch");
        return reconstructCityFrontierRevision(replayedWinner[0], applicationIntegrity);
      }
      const predecessorMatches = selectedChain.filter(({ id }) =>
        id === candidate.predecessorRevisionId);
      if (predecessorMatches.length !== 1 ||
        predecessorMatches[0]!.runId !== candidate.runId ||
        predecessorMatches[0]!.rankingSnapshotId !== candidate.rankingSnapshotId) {
        throw new Error("integrity_mismatch");
      }
      const predecessor = predecessorMatches[0]!;
      if (predecessor.id !== selectedChain.at(-1)?.id) {
        throw new Error("stale_city_frontier_head");
      }
      const appendedMarker = candidate.markers.at(-1);
      if (predecessor.kind === "terminal" || candidate.operation.kind !== "city_completed" ||
        candidate.predecessorRevisionId !== predecessor.id ||
        candidate.operation.expectedHeadRevisionId !== predecessor.id ||
        candidate.runId !== predecessor.runId ||
        candidate.rankingSnapshotId !== predecessor.rankingSnapshotId ||
        candidate.createdAt < predecessor.createdAt || appendedMarker === undefined ||
        appendedMarker.rank !== predecessor.markers.length + 1 ||
        appendedMarker.lastCheckedAt !== candidate.createdAt ||
        candidate.markers.length !== predecessor.markers.length + 1 ||
        applicationIntegrity.canonical(candidate.markers.slice(0, -1)) !==
          applicationIntegrity.canonical(predecessor.markers) ||
        candidate.markers.some((marker, markerIndex) => marker.rank !== markerIndex + 1) ||
        candidate.nextUncheckedRank !== candidate.markers.length + 1 ||
        (candidate.kind === "working" &&
          candidate.markers.length >= verifiedRanking.verificationBudget.liveCityCandidateLimit)) {
        throw new Error("integrity_mismatch");
      }
      if (appendFailurePending) {
        appendFailurePending = false;
        throw options.failAppendBeforePersistenceOnce!;
      }
      const persisted = structuredClone(candidate);
      chain = [...selectedChain, persisted];
      chainsByRun.set(candidate.runId, chain);
      root = persisted;
      knownRevisions.push(persisted);
      return options.appendResultDrift === true
        ? driftRoot(persisted)
        : structuredClone(persisted);
    },
  };
  ports.selectionHistory = options.selectionHistory ?? {
    listSelectionsWithBranchesVerified: async (runId: string) => {
      calls.selectionHistory.push(runId);
      calls.authorityOrder.push(`selection:${runId}`);
      return Object.freeze([]);
    },
  };
  ports.evidence = {
    seal: (input: Parameters<SqliteCityEvidenceStore["seal"]>[0]) => {
      calls.evidenceSeals.push(structuredClone(input));
      return withInfrastructurePlanGateRead(() => fixture.evidenceStore.seal(input));
    },
    loadVerified: (id: string) => {
      calls.authorityOrder.push(`evidence.load:${id}`);
      return withInfrastructurePlanGateRead(() => fixture.evidenceStore.loadVerified(id));
    },
    findVerifiedByCheckRunId: (id: string) => {
      calls.authorityOrder.push(`evidence.find:${id}`);
      if (completedEvidenceReadFailure !== undefined) throw completedEvidenceReadFailure;
      if (completedEvidenceProbeOverride !== noCompletedEvidenceProbeOverride) {
        return completedEvidenceProbeOverride as ReturnType<
          CityEvidenceStorePort["findVerifiedByCheckRunId"]
        >;
      }
      return withInfrastructurePlanGateRead(() =>
        fixture.evidenceStore.findVerifiedByCheckRunId(id));
    },
  };
  ports.evidenceReplay = {
    read: ports.evidence,
    integrity: createCityEvidenceReplayIntegrity(EVIDENCE_INTEGRITY),
    package: {
      loadExactReplayContract(key: InstalledCityPackageExactKey) {
        calls.forbiddenPrepareCallbacks.push("evidence-replay-package");
        return fixture.installedPackages.loadExactReplayContract(key);
      },
    },
  };
  ports.knowledge = {
    publishFromEvidence: (evidenceSnapshotId: string, createdAt: string) => {
      calls.authorityOrder.push(`knowledge.publish:${evidenceSnapshotId}`);
      calls.knowledgePublishes.push({ evidenceSnapshotId, createdAt });
      if (knowledgePublishFailurePending) {
        knowledgePublishFailurePending = false;
        throw options.failKnowledgePublishOnce!;
      }
      const published = withInfrastructurePlanGateRead(() =>
        fixture.knowledgeStore.publishFromEvidence(evidenceSnapshotId, createdAt));
      return (options.mapKnowledgePublishResult?.(published) ?? published) as CityKnowledgeRevision;
    },
    latestVerified: (cityId: string) => {
      calls.authorityOrder.push(`knowledge.latest:${cityId}`);
      return withInfrastructurePlanGateRead(() => fixture.knowledgeStore.latestVerified(cityId));
    },
    loadVerified: (id: string) => {
      calls.authorityOrder.push(`knowledge.load:${id}`);
      return withInfrastructurePlanGateRead(() => fixture.knowledgeStore.loadVerified(id));
    },
    findByEvidenceVerified: (id: string) => {
      calls.authorityOrder.push(`knowledge.find:${id}`);
      const found = withInfrastructurePlanGateRead(() =>
        fixture.knowledgeStore.findByEvidenceVerified(id));
      options.beforeKnowledgeFindReturn?.();
      return found;
    },
  };
  const dynamicFixedRoute = <S extends SloveniaCityFixedSourceId>(
    sourceId: S,
    sourceIndex: 0 | 1 | 2,
    disposition: "second_verified" | "all_rejected" | "first_verified",
  ): CityFixedRoutePort<S, CityFixedEvidenceClaim<S>> => ({
    async inspect(input) {
      const plan = fixture.installed.fixedPlansByCityId[input.cityId]?.[sourceIndex];
      if (plan?.sourceId !== sourceId) throw new Error("invalid_fixed_plan_fixture");
      if (options.fixedBroadbandFault !== undefined &&
        sourceId === "si-city-fixed-broadband" && input.routeIndex === 0) {
        calls.fixedRouteInputs.push(input);
        if (options.fixedBroadbandFault.kind === "native") {
          throw options.fixedBroadbandFault.error;
        }
        calls.fixedRouteOutputs.push(structuredClone({
          sourceId,
          output: options.fixedBroadbandFault.output,
        }));
        return options.fixedBroadbandFault.output as Awaited<ReturnType<
          CityFixedRoutePort<S, CityFixedEvidenceClaim<S>>["inspect"]
        >>;
      }
      const inspectVerifiedRoute = async (): Promise<Awaited<ReturnType<
        CityFixedRoutePort<S, CityFixedEvidenceClaim<S>>["inspect"]
      >>> => {
        const output = await fixedRoutePort(
          plan as CityFixedSourcePlan<S>,
          fixedDispositionOverrides.get(sourceId) ?? disposition,
          calls.fixedRouteInputs as Array<Parameters<CityFixedRoutePort<
            S,
            CityFixedEvidenceClaim<S>
          >["inspect"]>[0]>,
        ).inspect(input);
        const isFinalResult = sourceId === "si-city-long-term-rent" && input.routeIndex === 1 ||
          sourceId === "si-city-urban-transit" && input.routeIndex === 1 ||
          sourceId === "si-city-fixed-broadband" && input.routeIndex === 0;
        if (options.gateFinalResearchResults === true && isFinalResult) {
          calls.finalResearchResultsEntered.push(sourceId);
          finalResearchResultGates[sourceId].entered.resolve(undefined);
          await finalResearchResultGates[sourceId].release.promise;
          calls.finalResearchResultsReturned.push(sourceId);
        }
        calls.fixedRouteOutputs.push(structuredClone({ sourceId, output }));
        return output;
      };
      if (options.blockFixedBroadbandRoute === true && !researchGateClaimed &&
        sourceId === "si-city-fixed-broadband" && input.routeIndex === 0) {
        researchGateClaimed = true;
        calls.gatedFixedRouteInputs.push(input);
        researchEntered.resolve(undefined);
        const rawPromise = researchRelease.promise.then(inspectVerifiedRoute);
        calls.gatedFixedRoutePromises.push(rawPromise);
        return rawPromise;
      }
      if (options.gateResearch === true && !researchGateClaimed &&
        sourceId === "si-city-fixed-broadband" && input.routeIndex === 0) {
        researchGateClaimed = true;
        calls.gatedFixedRouteInputs.push(input);
        researchEntered.resolve(undefined);
        await Promise.race([
          researchRelease.promise,
          new Promise<never>((_resolve, reject) => {
            if (input.signal.aborted) reject(input.signal.reason);
            else input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
          }),
        ]);
      }
      return inspectVerifiedRoute();
    },
  });
  ports.fixedRoutes = {
    "si-city-long-term-rent": dynamicFixedRoute(
      "si-city-long-term-rent",
      0,
      "second_verified",
    ),
    "si-city-urban-transit": dynamicFixedRoute(
      "si-city-urban-transit",
      1,
      "all_rejected",
    ),
    "si-city-fixed-broadband": dynamicFixedRoute(
      "si-city-fixed-broadband",
      2,
      "first_verified",
    ),
  };
  const fixedDeadlineScheduler: CityFixedDeadlineScheduler = {
    schedule: (deadlineAt: string, onDeadline: () => void) => {
      calls.scheduledDeadlines.push(deadlineAt);
      return options.fixedDeadlineScheduler === undefined
        ? { cancel: () => undefined }
        : options.fixedDeadlineScheduler.schedule(deadlineAt, onDeadline);
    },
  };
  ports.fixedDeadlineScheduler = fixedDeadlineScheduler;
  ports.safetySearch = {
    search: async (input: unknown) => {
      calls.safetySearchInputs.push(input);
      maybeResolveAllResearchSignals();
      calls.source.push("search");
      const output = options.safetySearch === undefined
        ? { kind: "completed" as const, providerId: "synthetic-search", urls: [] }
        : await options.safetySearch.search(
            input as Parameters<CitySafetySearchPort["search"]>[0],
          );
      calls.safetySearchOutputs.push(structuredClone(output));
      return output;
    },
  };
  ports.safetyDocuments = {
    inspect: async (input: Parameters<CitySafetyOfficialDocumentPort["inspect"]>[0]) => {
      calls.safetyDocumentInputs.push(input);
      maybeResolveAllResearchSignals();
      calls.source.push(`document:${input.candidateUrl}`);
      if (options.safetyDocuments !== undefined) {
        const delegated = await options.safetyDocuments.inspect(input);
        calls.safetyDocumentOutputs.push(structuredClone(delegated));
        options.afterSafetyDocumentReturn?.();
        return delegated;
      }
      const bytes = new TextEncoder().encode(`safety-navigation:${input.candidateUrl}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const missingDocumentUrl = `${input.candidateUrl}/missing.pdf`;
      const publisherContext = required(
        input.publisherContext,
        "missing_synthetic_safety_publisher_context",
      );
      const artifact: LiveCapturedArtifact<"si-city-safety"> = {
        artifactId: `${input.runId}:si-city-safety:artifact`,
        runId: input.runId,
        sourceId: "si-city-safety",
        role: "municipal_source",
        origin: "live",
        capturedAt: input.assessmentAt,
        responseStatus: 200,
        responseUrl: input.candidateUrl,
        request: { method: "GET", url: input.candidateUrl },
        url: input.candidateUrl,
        mediaType: "application/pdf",
        sha256,
        bytes,
      };
      const output = {
        kind: "rejected",
        detail: {
          officialTrace: {
            initialUrl: input.candidateUrl,
            edges: [{
              kind: "confirmed_document_link",
              fromUrl: input.candidateUrl,
              toUrl: missingDocumentUrl,
            }],
            lastTrustedUrl: missingDocumentUrl,
            officialHops: 1,
            failure: {
              captureKind: "http_error",
              responseStatus: 404,
              responseUrl: missingDocumentUrl,
            },
          },
          artifactRefs: [{
            role: "municipal_source",
            documentRole: "navigation",
            artifactId: artifact.artifactId,
            artifactSha256: artifact.sha256,
            sourceSha256: artifact.sha256,
            locator: artifact.url,
          }],
          reviewedOfficial: {
            publisherId: publisherContext.publisherId,
            dataAuthorityId: "police",
            publisherNavigationUrl: publisherContext.publisherNavigationUrl,
          },
          mediaType: "application/pdf",
          retentionPolicyId: `${publisherContext.publisherId}-retention@1`,
          transientRawDeleted: false,
          disposition: "rejected",
          reason: "http_not_found",
        },
        artifacts: [artifact],
      } as const;
      if (options.gateFinalResearchResults === true) {
        calls.finalResearchResultsEntered.push("si-city-safety");
        finalResearchResultGates["si-city-safety"].entered.resolve(undefined);
        await finalResearchResultGates["si-city-safety"].release.promise;
        calls.finalResearchResultsReturned.push("si-city-safety");
      }
      calls.safetyDocumentOutputs.push(structuredClone(output));
      options.afterSafetyDocumentReturn?.();
      return output;
    },
  };
  ports.decisionIntegrity = applicationIntegrity;
  ports.evidenceIntegrity = {
    canonical(value: unknown): string {
      const canonical = EVIDENCE_INTEGRITY.canonical(value);
      const result = discriminatingEvidenceCanonicals.has(canonical)
        ? `evidence-authority:${canonical}`
        : canonical;
      calls.evidenceCanonicals.push({ value: structuredClone(value), result });
      return result;
    },
    hash(value: string): string {
      const canonical = value.startsWith("evidence-authority:")
        ? value.slice("evidence-authority:".length)
        : value;
      const result = evidenceHashOverrides.get(canonical) ?? EVIDENCE_INTEGRITY.hash(canonical);
      calls.evidenceHashes.push({ value, result });
      return result;
    },
    sign(value: string): string {
      const result = EVIDENCE_INTEGRITY.sign(value);
      calls.evidenceSigns.push({ value, result });
      return result;
    },
  } satisfies EvidenceIntegrity;
  let clockIndex = 0;
  let runnerNowProbeActive = false;
  const clock = (): Date => {
    const baseClockAt = options.assessmentAt ?? START_AT;
    const rawValue: unknown = runnerNowProbeActive && options.runnerNow !== undefined
      ? options.runnerNow()
      : options.discriminatingClock === true
        ? new Date(Date.parse(baseClockAt) + clockIndex)
        : new Date(baseClockAt);
    clockIndex += 1;
    let observed = "invalid_clock_result";
    if (rawValue instanceof Date) {
      try {
        observed = Date.prototype.toISOString.call(rawValue);
      } catch {
        observed = "invalid_clock_result";
      }
    }
    calls.clocks.push(observed);
    options.afterClock?.(calls.clocks.length);
    return rawValue as Date;
  };
  fixedRunnerHarness.aroundDelegate = options.runnerNow === undefined
    ? undefined
    : (delegate: () => unknown) => {
        runnerNowProbeActive = true;
        try {
          return delegate();
        } finally {
          runnerNowProbeActive = false;
        }
      };
  ports.clock = clock;
  ports.fixedSourceDeadlineAt = (now: Date) => {
    calls.deadlinePolicyDates.push(now);
    return (options.fixedSourceDeadlineAt === undefined
      ? new Date(now.valueOf() + 45_000)
      : options.fixedSourceDeadlineAt(now)) as Date;
  };
  const bindInstalledCatalogStart = (
    installed: InstalledCityResearchPackage,
    useExactPackageOverride = true,
  ) => {
    const currentCriteria = required(criteria, "city_criteria_not_found");
    const currentRanking = required(ranking, "city_ranking_not_found");
    const currentRoot = required(root, "city_frontier_not_found");
    exactPackageOverride = useExactPackageOverride ? installed : undefined;
    const { id: _rankingId, ...rankingPayload } = structuredClone(currentRanking);
    void _rankingId;
    const criteriaPayload: CityCriteriaCommandPayload = {
      schemaVersion: "city-criteria-command@1",
      profileSnapshotId: currentCriteria.profileSnapshotId,
      preferenceProfileSnapshotId: currentCriteria.preferenceProfileSnapshotId,
      criteria: currentCriteria.criteria,
      rulesVersion: currentCriteria.rulesVersion,
    };
    const criteriaPayloadHash = cityCriteriaPayloadHash(criteriaPayload, DECISION_INTEGRITY);
    const verificationBudget: CityFrontierVerificationBudget = currentRanking.verificationBudget;
    const runIdentity = {
      schemaVersion: "city-frontier-run@1" as const,
      resolvedCountryShortlistRevisionId: fixture.resolved.id,
      countryCode: "SI",
      registryRevisionId: installed.registry.id,
      installedPackageContext: installed.installedPackageManifest.key,
      criteriaPayloadHash,
      catalogRulesVersion: installed.catalog.rulesVersion,
      rankingRulesVersion: currentRanking.rulesVersion,
      verificationBudget,
    };
    const runId = installed.catalog.rulesVersion === "city-catalog@1" ||
        installed.catalog.rulesVersion === "city-catalog@2"
      ? cityFrontierRunId(
          runIdentity as Parameters<typeof cityFrontierRunId>[0],
          DECISION_INTEGRITY,
        )
      : `city-frontier:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(runIdentity))}`;
    const reboundRanking = sealCityRankingSnapshot({
      ...rankingPayload,
      runId,
      registryRevisionId: installed.registry.id,
      catalogRevisionId: installed.catalog.id,
      packageSchemaVersion: installed.installedPackageManifest.key.packageSchemaVersion,
      installedPackageContext: installed.installedPackageManifest.key,
    }, DECISION_INTEGRITY);
    const reboundRoot = sealCityFrontierRevision({
      runId,
      rankingSnapshotId: reboundRanking.id,
      markers: [],
      projection: {
        kind: "working",
        nextUncheckedRank: 1,
        selectableCityIds: [],
        phase: "verification_required",
      },
      operation: {
        kind: "start",
        commandId: currentRoot.operation.commandId,
        criteriaPayloadHash,
      },
      createdAt: currentRoot.createdAt,
    }, DECISION_INTEGRITY);
    ranking = reboundRanking;
    root = reboundRoot;
    chain = [reboundRoot];
    knownRevisions.splice(0, knownRevisions.length, reboundRoot);
    return { installed, ranking: reboundRanking, root: reboundRoot };
  };
  return {
    assembly: createCityFrontierApplication(ports as unknown as CityFrontierApplicationPorts),
    fixture,
    calls,
    capabilities: { fixedDeadlineScheduler, clock, installedPackageManifests: manifestReadPort },
    gates: {
      researchEntered: researchEntered.promise,
      allResearchSignalsEntered: allResearchSignalsEntered.promise,
      allFinalResearchResultsEntered: Promise.all(
        Object.values(finalResearchResultGates).map(({ entered }) => entered.promise),
      ).then(() => undefined),
      releaseResearch() { researchRelease.resolve(undefined); },
      releaseFinalResearchResult(sourceId) {
        finalResearchResultGates[sourceId].release.resolve(undefined);
      },
    },
    state: {
      root: () => required(root, "city_frontier_not_found"),
      chain: () => chain.map((revision) => structuredClone(revision)),
      artifacts: () => ({
        criteria: required(criteria, "city_criteria_not_found"),
        branch: required(branch, "city_branch_not_found"),
        ranking: required(ranking, "city_ranking_not_found"),
        root: required(root, "city_frontier_not_found"),
      }),
      replaceChain(revisions) {
        chain = revisions;
        root = revisions.at(-1);
        const runId = revisions[0]?.runId;
        if (runId !== undefined && revisions.every((revision) => revision.runId === runId)) {
          chainsByRun.set(runId, revisions);
        }
        for (const revision of revisions) {
          if (!knownRevisions.some(({ id }) => id === revision.id)) knownRevisions.push(revision);
        }
      },
      addRevision(revision) { knownRevisions.push(revision); },
      failRevisionLoad(id, error) { revisionLoadFailures.set(id, error); },
      overrideCommandResult(commandId, value) { commandResultOverrides.set(commandId, value); },
      overrideExactPackageResult(mode, alternate, visibleField) {
        adversarialExactPackageResult = { mode, alternate, ...(visibleField === undefined
          ? {}
          : { visibleField }) };
      },
      overrideManifestResult(mode, alternate) {
        manifestResultOverride = { mode, ...(alternate === undefined ? {} : { alternate }) };
      },
      failManifestLoad(error) { manifestLoadFailure = error; },
      overrideFinalMemberBroadbandPlan(alternate) {
        const finalMember = required(alternate.catalog.members.at(-1), "missing_final_member");
        finalMemberBroadbandPlanOverride = required(
          alternate.fixedPlansByCityId[finalMember.cityId]?.[2],
          "missing_final_member_broadband_plan",
        );
      },
      overrideFinalMemberBroadbandPlanValue(value) {
        finalMemberBroadbandPlanOverride = value;
      },
      overrideFixedPlansByCityIdValue(value) {
        fixedPlansByCityIdOverride = value;
      },
      overrideInstalledArtifactValue(kind, value) {
        installedArtifactOverrides.set(kind, value);
      },
      collideEvidenceDigest(value, digest) {
        evidenceHashOverrides.set(EVIDENCE_INTEGRITY.canonical(value), digest);
      },
      discriminateEvidenceAuthority(values) {
        discriminatingEvidenceCanonicals.clear();
        for (const value of values) {
          discriminatingEvidenceCanonicals.add(EVIDENCE_INTEGRITY.canonical(value));
        }
      },
      overrideHistoricalCatalogResult(bundle) { historicalCatalogResultOverride = bundle; },
      overrideReloadDrift(value) { reloadDrift = value; },
      collideCheckIdentities(values) {
        for (const value of values) {
          collidingCheckCanonicals.add(applicationIntegrity.canonical(value));
        }
      },
      replaceSemanticStart(input) {
        criteria = structuredClone(input.criteria);
        ranking = structuredClone(input.ranking);
        root = structuredClone(input.root);
        chain = [root];
        criteriaById.set(criteria.id, criteria);
        rankingsById.set(ranking.id, ranking);
        chainsByRun.set(root.runId, chain);
        knownRevisions.splice(0, knownRevisions.length, root);
      },
      overrideEvaluatorRegistry(value) { evaluatorRegistryOverride = value; },
      overrideFixedDisposition(sourceId, disposition) {
        if (disposition === undefined) fixedDispositionOverrides.delete(sourceId);
        else fixedDispositionOverrides.set(sourceId, disposition);
      },
      failCompletedEvidenceRead(error) { completedEvidenceReadFailure = error; },
      overrideCompletedEvidenceProbe(value) { completedEvidenceProbeOverride = value; },
      async bindLegacyStart() {
        const history = await withInfrastructurePlanGateReadAsync(() =>
          installAuthenticLegacyHistory(fixture));
        return {
          ...history,
          ...bindInstalledCatalogStart(history.legacy, false),
        };
      },
      async bindInvalidCatalogStart(variant) {
        const authority = await withInfrastructurePlanGateReadAsync(() =>
          hostileInvalidCatalogAuthority(fixture, variant));
        manifestResultOverride = { mode: "alternate", alternate: authority.manifest };
        return {
          ...authority,
          ...bindInstalledCatalogStart(authority.installed),
        };
      },
      bindPackageSchemaDriftStart() {
        const installed = freezeDeep({
          ...fixture.installed,
          installedPackageManifest: {
            id: fixture.installed.installedPackageManifest.id,
            key: {
              ...fixture.installed.installedPackageManifest.key,
              packageSchemaVersion: "city-catalog@2",
            },
          },
        } as InstalledCityResearchPackage);
        return bindInstalledCatalogStart(installed);
      },
    },
  };
}

function resetContinuationPreflightObservations(harness: SyntheticApplicationHarness): void {
  harness.calls.reloads.splice(0);
  harness.calls.rankingReads.splice(0);
  harness.calls.rankingResults.splice(0);
  harness.calls.catalogReads.splice(0);
  harness.calls.readyPackageCountries.splice(0);
  harness.calls.exactPackageKeys.splice(0);
  harness.calls.authorityOrder.splice(0);
  harness.calls.installedPackageResults.splice(0);
  harness.calls.manifestKeys.splice(0);
  harness.calls.manifestResults.splice(0);
  harness.calls.evidenceCanonicals.splice(0);
  harness.calls.evidenceHashes.splice(0);
  harness.calls.evidenceSigns.splice(0);
  harness.calls.flightIdentityCanonicals.splice(0);
}

function continuationPreflightCounts(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    command: harness.calls.reloads.filter((value) => value.startsWith("frontier.command:")).length,
    head: harness.calls.reloads.filter((value) => value.startsWith("frontier.head:")).length,
    ranking: harness.calls.rankingReads.length,
    exactPackage: harness.calls.installedPackageResults.length,
    exactManifest: harness.calls.manifestResults.length,
    historicalCatalog: harness.calls.catalogReads.filter((value) =>
      value.startsWith("catalog.historical:")).length,
    criteria: harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length,
    branch: harness.calls.reloads.filter((value) => value.startsWith("branch:")).length,
    evidence: harness.calls.authorityOrder.filter((value) => value.startsWith("evidence.find:")).length,
  };
}

function capturedResearchSignals(harness: SyntheticApplicationHarness): AbortSignal[] {
  return [
    ...(fixedRunnerHarness.inputs as Array<
      CityFixedSourceRunInput<SloveniaCityFixedSourceId>
    >).map(({ signal }) => signal),
    ...harness.calls.safetySearchInputs.map((value) =>
      (value as { readonly signal: AbortSignal }).signal),
    ...harness.calls.safetyDocumentInputs.map((value) =>
      (value as { readonly signal: AbortSignal }).signal),
  ];
}

function expectOpaqueSharedAbort(signals: readonly AbortSignal[], secret: Error): void {
  expect(signals.length).toBeGreaterThan(0);
  expect(new Set(signals).size).toBe(1);
  expect(signals.every(({ aborted }) => aborted)).toBe(true);
  const reason = signals[0]!.reason;
  expect(reason).not.toBe(secret);
  expect(reason).toBeInstanceOf(DOMException);
  expect((reason as DOMException).name).toBe("AbortError");
  expect((reason as DOMException).message).toBe("Aborted");
  expect((reason as DOMException).message).not.toContain(secret.message);
}

function expectPrivateSuccessfulTrace(
  events: readonly CityFrontierEvent[],
  result: CityFrontierReadModel,
  baseRevisionId: string,
  installed: InstalledCityResearchPackage,
): void {
  expect(events.map(({ type }) => type)).toEqual([
    "city_activated",
    ...Array.from({ length: 10 }, () => "city_progress" as const),
    "city_revision_committed",
    "city_continuation_completed",
  ]);
  expect(events.map(({ sequence }) => sequence)).toEqual(
    Array.from({ length: 13 }, (_, index) => index + 1),
  );
  expect(events.every(({ runId, baseRevisionId: base }) =>
    runId === result.runId && base === baseRevisionId)).toBe(true);
  expect(events[0]).toMatchObject({
    type: "city_activated",
    cityId: result.revision.markers.at(-1)!.cityId,
    rank: result.revision.markers.at(-1)!.rank,
  });
  const progress = events.filter((event) => event.type === "city_progress");
  expect(progress.map(({ stage }) => stage)).toEqual([
    "source_started:si-city-safety",
    "source_started:si-city-long-term-rent",
    "source_started:si-city-urban-transit",
    "source_started:si-city-fixed-broadband",
    "source_completed:si-city-safety",
    "source_completed:si-city-long-term-rent",
    "source_completed:si-city-urban-transit",
    "source_completed:si-city-fixed-broadband",
    "evidence_verified",
    "knowledge_published",
  ]);
  expect(progress.map((event) => "sourceUrl" in event ? event.sourceUrl : undefined)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    installed.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl,
    installed.fixedPlansByCityId.ljubljana![0]!.routes[1]!.navigationUrl,
    installed.fixedPlansByCityId.ljubljana![1]!.routes[1]!.navigationUrl,
    installed.fixedPlansByCityId.ljubljana![2]!.routes[0]!.navigationUrl,
    undefined,
    undefined,
  ]);
  for (const event of events) {
    const common = ["type", "runId", "baseRevisionId", "sequence", "occurredAt"];
    const keys = event.type === "city_activated"
      ? [...common, "cityId", "rank"]
      : event.type === "city_progress"
        ? [...common, "cityId", "stage", ...("sourceUrl" in event ? ["sourceUrl"] : [])]
        : event.type === "city_revision_committed"
          ? [...common, "marker", "revision"]
          : [...common, "readModel"];
    expect(Reflect.ownKeys(event).sort()).toEqual(keys.sort());
  }
  const committed = events.filter((event) => event.type === "city_revision_committed");
  expect(committed).toHaveLength(1);
  expect(committed[0]!.marker).toEqual(result.revision.markers.at(-1));
  expect(committed[0]!.revision).toEqual(result.revision);
  const completed = events.filter((event) => event.type === "city_continuation_completed");
  expect(completed).toHaveLength(1);
  expect(DECISION_INTEGRITY.canonical(completed[0]!.readModel))
    .toBe(DECISION_INTEGRITY.canonical(result));
}

function expectPrivateRecoveryTrace(
  events: readonly CityFrontierEvent[],
  result: CityFrontierReadModel,
  baseRevisionId: string,
): void {
  expect(events.map(({ type }) => type)).toEqual([
    "city_activated",
    "city_progress",
    "city_progress",
    "city_revision_committed",
    "city_continuation_completed",
  ]);
  expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5]);
  expect(events.every(({ runId, baseRevisionId: base }) =>
    runId === result.runId && base === baseRevisionId)).toBe(true);
  expect(events[0]).toMatchObject({
    type: "city_activated",
    cityId: result.revision.markers.at(-1)!.cityId,
    rank: result.revision.markers.at(-1)!.rank,
  });
  const progress = events.filter((event) => event.type === "city_progress");
  expect(progress.map(({ stage }) => stage)).toEqual([
    "evidence_verified",
    "knowledge_published",
  ]);
  expect(progress.every(({ cityId }) =>
    cityId === result.revision.markers.at(-1)!.cityId)).toBe(true);
  expect(progress.every((event) => !("sourceUrl" in event))).toBe(true);
  const times = events.map(({ occurredAt }) => occurredAt);
  expect(times.every((value) => value === new Date(value).toISOString())).toBe(true);
  expect(times.every((value, index) => index === 0 || times[index - 1]! <= value)).toBe(true);
  for (const event of events) {
    const common = ["type", "runId", "baseRevisionId", "sequence", "occurredAt"];
    const keys = event.type === "city_activated"
      ? [...common, "cityId", "rank"]
      : event.type === "city_progress"
        ? [...common, "cityId", "stage"]
        : event.type === "city_revision_committed"
          ? [...common, "marker", "revision"]
          : [...common, "readModel"];
    expect(Reflect.ownKeys(event).sort()).toEqual(keys.sort());
  }
  const committed = events.filter((event) => event.type === "city_revision_committed");
  expect(committed).toHaveLength(1);
  expect(committed[0]!.marker).toEqual(result.revision.markers.at(-1));
  expect(committed[0]!.revision).toEqual(result.revision);
  const completed = events.filter((event) => event.type === "city_continuation_completed");
  expect(completed).toHaveLength(1);
  expect(DECISION_INTEGRITY.canonical(completed[0]!.readModel))
    .toBe(DECISION_INTEGRITY.canonical(result));
}

function expectPrivateRecoveryPrefix(
  events: readonly CityFrontierEvent[],
  expected: {
    readonly runId: string;
    readonly baseRevisionId: string;
    readonly cityId: string;
    readonly rank: number;
  },
): void {
  expect(events.map(({ type }) => type)).toEqual([
    "city_activated",
    "city_progress",
  ]);
  expect(events.map(({ sequence }) => sequence)).toEqual([1, 2]);
  expect(events.every(({ runId, baseRevisionId }) =>
    runId === expected.runId && baseRevisionId === expected.baseRevisionId)).toBe(true);
  expect(events[0]).toMatchObject({
    type: "city_activated",
    cityId: expected.cityId,
    rank: expected.rank,
  });
  expect(events[1]).toMatchObject({
    type: "city_progress",
    cityId: expected.cityId,
    stage: "evidence_verified",
  });
  expect("sourceUrl" in events[1]!).toBe(false);
  expect(Reflect.ownKeys(events[0]!).sort()).toEqual([
    "type",
    "runId",
    "baseRevisionId",
    "sequence",
    "occurredAt",
    "cityId",
    "rank",
  ].sort());
  expect(Reflect.ownKeys(events[1]!).sort()).toEqual([
    "type",
    "runId",
    "baseRevisionId",
    "sequence",
    "occurredAt",
    "cityId",
    "stage",
  ].sort());
  const times = events.map(({ occurredAt }) => occurredAt);
  expect(times.every((value) => value === new Date(value).toISOString())).toBe(true);
  expect(times[0]! <= times[1]!).toBe(true);
}

function expectPrivateFlightPrefix(
  events: readonly CityFrontierEvent[],
  through: "evidence_verified" | "knowledge_published" | "city_revision_committed",
  expected: {
    readonly runId: string;
    readonly baseRevisionId: string;
    readonly cityId: string;
    readonly installed: InstalledCityResearchPackage;
  },
): void {
  const allStages = [
    "source_started:si-city-safety",
    "source_started:si-city-long-term-rent",
    "source_started:si-city-urban-transit",
    "source_started:si-city-fixed-broadband",
    "source_completed:si-city-safety",
    "source_completed:si-city-long-term-rent",
    "source_completed:si-city-urban-transit",
    "source_completed:si-city-fixed-broadband",
    "evidence_verified",
    "knowledge_published",
  ] as const;
  const allUrls = [
    undefined,
    undefined,
    undefined,
    undefined,
    expected.installed.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl,
    expected.installed.fixedPlansByCityId.ljubljana![0]!.routes[1]!.navigationUrl,
    expected.installed.fixedPlansByCityId.ljubljana![1]!.routes[1]!.navigationUrl,
    expected.installed.fixedPlansByCityId.ljubljana![2]!.routes[0]!.navigationUrl,
    undefined,
    undefined,
  ] as const;
  const progressCount = through === "evidence_verified" ? 9 : 10;
  expect(events.map(({ type }) => type)).toEqual([
    "city_activated",
    ...Array.from({ length: progressCount }, () => "city_progress" as const),
    ...(through === "city_revision_committed" ? ["city_revision_committed" as const] : []),
  ]);
  expect(events.map(({ sequence }) => sequence)).toEqual(
    Array.from({ length: events.length }, (_, index) => index + 1),
  );
  expect(events.every(({ runId, baseRevisionId }) =>
    runId === expected.runId && baseRevisionId === expected.baseRevisionId)).toBe(true);
  expect(events.filter((event) => "cityId" in event).every(({ cityId }) =>
    cityId === expected.cityId)).toBe(true);
  const progress = events.filter((event) => event.type === "city_progress");
  expect(progress.map(({ stage }) => stage)).toEqual(allStages.slice(0, progressCount));
  expect(progress.map((event) => "sourceUrl" in event ? event.sourceUrl : undefined))
    .toEqual(allUrls.slice(0, progressCount));
  const times = events.map(({ occurredAt }) => occurredAt);
  expect(times.every((value) => value === new Date(value).toISOString())).toBe(true);
  expect(times.every((value, index) => index === 0 || times[index - 1]! <= value)).toBe(true);
}

function researchAndPublicationCounts(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    fixed: harness.calls.fixedRouteInputs.length,
    safetySearch: harness.calls.safetySearchInputs.length,
    safetyDocument: harness.calls.safetyDocumentInputs.length,
    generic: genericSealHarness.calls,
    evidence: harness.calls.evidenceSeals.length,
    knowledge: harness.calls.knowledgePublishes.length,
    append: harness.calls.appends.length,
  };
}

function recoveryAuthorityCounts(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    ranking: harness.calls.rankingReads.length,
    catalog: harness.calls.catalogReads.filter((value) =>
      value.startsWith("catalog.historical:")).length,
    criteria: harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length,
    branch: harness.calls.reloads.filter((value) => value.startsWith("branch:")).length,
    evidence: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("evidence.")).length,
    knowledge: harness.calls.authorityOrder.filter((value) =>
      value.startsWith("knowledge.")).length,
  };
}

function expectEveryAuthorityChannelAdvanced(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): void {
  expect(Object.keys(before)).toEqual(Object.keys(after));
  expect(Object.entries(after).every(([key, value]) => value > before[key]!)).toBe(true);
}

interface SemanticAuthorityFixture {
  readonly criteria: CityCriteriaSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly root: CityFrontierRevision;
  readonly knowledge: readonly CityKnowledgeRankingProjection[];
}

async function seedCurrentSemanticKnowledge(
  harness: SyntheticApplicationHarness,
  suffix: string,
  resolvedCountryShortlistRevisionId = harness.fixture.resolved.id,
): Promise<{
  readonly started: CityFrontierReadModel;
  readonly head: CityFrontierReadModel;
  readonly templateRanking: CityRankingSnapshot;
  readonly criteria: CityCriteriaSnapshot;
  readonly knowledge: readonly CityKnowledgeRankingProjection[];
}> {
  const started = await harness.assembly.application.startCityFrontier({
    resolvedCountryShortlistRevisionId,
    countryCode: "SI",
    criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
    commandId: `start:semantic-authority:${suffix}`,
  });
  let head = started;
  for (const [index] of harness.fixture.installed.catalog.members.entries()) {
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: head.revision.id,
      commandId: `continue:semantic-authority:${suffix}:${index}`,
    });
    head = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
  }
  const knowledge = harness.fixture.installed.catalog.members.map(({ cityId }) => {
    const revision = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.latestVerified(cityId));
    if (revision === undefined) throw new Error(`missing_semantic_knowledge:${cityId}`);
    return projectCityKnowledgeForRanking(revision);
  });
  expect(knowledge.every(({ knowledgeRevisionId }) => knowledgeRevisionId !== null)).toBe(true);
  return {
    started,
    head,
    templateRanking: started.ranking,
    criteria: started.criteria,
    knowledge,
  };
}

function durableMarkerAuthority(
  harness: SyntheticApplicationHarness,
  marker: Pick<CityLiveMarker, "cityId" | "knowledgeRevisionId" | "evidenceSnapshotId">,
): CityMarkerAuthorityProjection {
  const knowledge = withInfrastructurePlanGateRead(() =>
    harness.fixture.knowledgeStore.loadVerified(marker.knowledgeRevisionId));
  const evidence = withInfrastructurePlanGateRead(() =>
    harness.fixture.evidenceStore.loadVerified(marker.evidenceSnapshotId));
  expect(knowledge.cityId).toBe(marker.cityId);
  expect(knowledge.evidenceSnapshotId).toBe(evidence.snapshot.id);
  const lastSafetyAttempt = evidence.snapshot.safetyAttemptLedger.candidates.at(-1);
  const projectedFacts = knowledge.facts.map((fact) => {
    const evidenceLinks = fact.evidenceRefs.filter((reference) => reference.kind === "claim")
      .map((reference) => ({
        sourceId: reference.sourceId,
        disposition: "accepted" as const,
        navigationUrl: reference.navigationUrl,
        resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
      }));
    const manualCheckLinks = fact.evidenceRefs.filter((reference) => reference.kind === "blocker")
      .map((reference) => ({
        sourceId: reference.sourceId,
        disposition: "reviewed_rejected" as const,
        navigationUrl: reference.navigationUrl,
        ...(reference.resolvedEvidenceUrl === undefined
          ? {}
          : { resolvedEvidenceUrl: reference.resolvedEvidenceUrl }),
        ...(fact.criterionId === "safety" && lastSafetyAttempt?.disposition === "rejected"
          ? { rejectionReason: lastSafetyAttempt.reason }
          : {}),
      }));
    return {
      criterionId: fact.criterionId,
      definitionId: fact.definitionId,
      geoScope: fact.geoScope.kind,
      referencePeriod: fact.referencePeriod,
      freshnessBasis: fact.freshnessBasis.policyVersion,
      unit: fact.unit,
      denominator: fact.denominator,
      outcome: fact.outcome,
      evidenceLinks,
      manualCheckLinks,
    } satisfies CityCommittedFactProjection;
  }) as unknown as CityCommittedFactProjectionTuple;
  return {
    cityId: knowledge.cityId,
    knowledgeRevisionId: knowledge.id,
    evidenceSnapshotId: evidence.snapshot.id,
    lastCheckedAt: knowledge.lastCheckedAt,
    facts: projectedFacts,
  };
}

function terminalFrontierAuthorityInput(
  harness: SyntheticApplicationHarness,
  terminal: TerminalCityShortlistSnapshot,
  ranking: CityRankingSnapshot,
  criteria: CityCriteriaSnapshot,
): ReconstructCityFrontierInput {
  const markerBindings: CityMarkerBinding[] = terminal.markers.map((marker) => ({
    marker: structuredClone(marker),
    markerDigest: DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(marker)),
    authority: durableMarkerAuthority(harness, marker),
  }));
  return {
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ranking.ordered.map(({ cityId }) => cityId),
      screenedExclusionCityIds: ranking.screenedExclusions.map(({ cityId }) => cityId),
    },
    criteria: structuredClone(criteria),
    evaluators: harness.fixture.installed.evaluatorRegistry,
    predecessorMarkers: terminal.markers.slice(0, -1).map((marker) => structuredClone(marker)),
    markerBindings,
    persisted: {
      kind: "terminal",
      nextUncheckedRank: terminal.nextUncheckedRank,
      selectableCityIds: terminal.markers
        .filter(({ status }) => status === "selectable")
        .map(({ cityId }) => cityId),
      entries: structuredClone(terminal.entries),
      stopCondition: terminal.stopCondition,
    },
  };
}

function structurallyRehashedSelectionPair(
  pair: CitySelectionWithBranch,
  parent: PreCityBranchCommit,
  mutate: (payload: CitySelectionSnapshotPayload) => CitySelectionSnapshotPayload,
): CitySelectionWithBranch {
  const { id: _selectionId, ...borrowedPayload } = structuredClone(pair.selection);
  void _selectionId;
  const payload = mutate(borrowedPayload);
  const selection = reconstructCitySelectionSnapshot({
    id: `city-selection:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(payload))}`,
    ...payload,
  }, DECISION_INTEGRITY);
  const branchProjection = {
    citySelectionSnapshotId: selection.id,
    preCityBranchCommitId: selection.preCityBranchCommitId,
    cityId: selection.cityId,
    countryCode: selection.countryCode,
    createdAt: selection.createdAt,
  };
  const commit = createCityBranchCommit(branchProjection, parent, DECISION_INTEGRITY);
  expect(replayCityBranchCommit(commit, branchProjection, parent, DECISION_INTEGRITY))
    .toEqual(commit);
  return freezeDeep({ selection, commit });
}

interface TestSelectionHistoryControl {
  port: CitySelectionHistoryReadPort;
  readonly runIds: string[];
  readonly returned: Array<readonly CitySelectionWithBranch[]>;
  pair: CitySelectionWithBranch | undefined;
  observe: ((runId: string) => void) | undefined;
}

interface TestCurrentSelectionAuthority {
  readonly readModel: CityFrontierReadModel;
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly ranking: CityRankingSnapshot;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly frontier: ReconstructCityFrontierInput;
}

function testSelectionHistoryControl(): TestSelectionHistoryControl {
  const control: TestSelectionHistoryControl = {
    runIds: [],
    returned: [],
    pair: undefined,
    observe: undefined,
    port: undefined as unknown as CitySelectionHistoryReadPort,
  };
  control.port = Object.freeze({
    listSelectionsWithBranchesVerified: async (runId: string) => {
      control.runIds.push(runId);
      control.observe?.(runId);
      const result = freezeDeep(control.pair === undefined
        ? []
        : [structuredClone(control.pair)]);
      control.returned.push(result);
      return result;
    },
  });
  return control;
}

async function currentYellowSelectionHistoryFixture(suffix: string): Promise<{
  readonly harness: SyntheticApplicationHarness;
  readonly seeded: Awaited<ReturnType<typeof seedCurrentSemanticKnowledge>>;
  readonly authority: TestCurrentSelectionAuthority;
  readonly marker: CityLiveMarker;
  readonly projection: ReturnType<typeof reconstructCitySelection>;
  readonly pair: CitySelectionWithBranch;
  readonly history: TestSelectionHistoryControl;
}> {
  const history = testSelectionHistoryControl();
  const harness = await syntheticApplicationHarness({ selectionHistory: history.port });
  history.observe = (runId) => {
    harness.calls.authorityOrder.push(`selection:${runId}`);
    if (selectionReplayHarness.enabled) selectionReplayHarness.order.push("selection-history");
  };
  const seeded = await seedCurrentSemanticKnowledge(harness, `selection-history:${suffix}`);
  if (seeded.head.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");
  const authority = await harness.assembly.selectionAuthority
    .loadCurrentTerminalSelectionAuthority(seeded.head.revision.id) as
      TestCurrentSelectionAuthority;
  const marker = authority.terminal.markers.find((candidate) =>
    candidate.status === "selectable" && candidate.visualStatus === "yellow" &&
    candidate.unknownBasis.length > 0 && candidate.facts.some(({ manualCheckLinks }) =>
      manualCheckLinks.length > 0));
  if (marker === undefined) throw new Error("expected_authentic_yellow_marker");
  expect(authority.terminal.entries.some(({ cityId }) => cityId === marker.cityId)).toBe(true);
  const projection = reconstructCitySelection({
    frontier: authority.frontier,
    request: {
      cityId: marker.cityId,
      warningCopyVersion: "city-unknown-risk@1",
    },
  });
  expect(projection.warningCopyVersion).toBe("city-unknown-risk@1");
  expect(projection.reviewedSourceLinks.length).toBeGreaterThan(0);
  const pair = createCitySelectionWithBranch({
    terminal: authority.terminal,
    ranking: authority.ranking,
    preCityBranch: authority.preCityBranch,
    commandId: `select:task14-history:${suffix}`,
    selection: projection,
    createdAt: authority.terminal.createdAt,
  }, DECISION_INTEGRITY);
  expect(reconstructCitySelectionWithBranch(pair, {
    terminal: authority.terminal,
    ranking: authority.ranking,
    preCityBranch: authority.preCityBranch,
  }, DECISION_INTEGRITY)).toEqual(pair);
  history.pair = pair;
  history.runIds.splice(0);
  history.returned.splice(0);
  return { harness, seeded, authority, marker, projection, pair, history };
}

interface AuthenticLegacyTerminalFixture extends AuthenticLegacyHistory {
  readonly chain: readonly CityFrontierRevision[];
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly evidence: readonly ReturnType<SqliteCityEvidenceStore["loadVerified"]>[];
  readonly knowledge: readonly CityKnowledgeRevision[];
}

async function authenticLegacyTerminal(
  harness: SyntheticApplicationHarness,
): Promise<AuthenticLegacyTerminalFixture> {
  await harness.assembly.application.startCityFrontier({
    resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
    countryCode: "SI",
    criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
    commandId: "start:legacy-terminal-authority",
  });
  const legacy = await harness.state.bindLegacyStart();
  expect(legacy.installed.catalog.rulesVersion).toBe("city-catalog@1");
  expect(legacy.installed.catalog.members).toHaveLength(2);
  expect(Object.values(legacy.ranking.knowledgeRevisionIds).every((id) => id === null)).toBe(true);
  const criteria = harness.state.artifacts().criteria;
  const chain: CityFrontierRevision[] = [legacy.root];
  const markers: CityLiveMarker[] = [];
  const loadedEvidence: Array<ReturnType<SqliteCityEvidenceStore["loadVerified"]>> = [];
  const loadedKnowledge: CityKnowledgeRevision[] = [];
  let predecessor = legacy.root;
  for (const [index, member] of legacy.installed.catalog.members.entries()) {
    const rank = index + 1;
    const input = await legacyEvidenceInput(
      legacy.installed,
      legacy.ranking,
      criteria,
      member.cityId,
      rank,
    );
    const insertedEvidence = insertLegacyEvidence(harness.fixture.database, input);
    const evidenceA = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(insertedEvidence.id));
    const evidenceB = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(insertedEvidence.id));
    expect(evidenceA).toEqual(evidenceB);
    expect(evidenceA).not.toBe(evidenceB);
    expect(evidenceA.snapshot).not.toBe(evidenceB.snapshot);
    recursivelyFrozen(evidenceA);
    const knowledgeCandidate = buildCityKnowledgeRevision({
      packageKey: legacy.installed.installedPackageManifest.key,
      evidence: evidenceA,
      factContracts: legacyKnowledgeContracts(legacy.installed, member.cityId),
      createdAt: input.completedAt,
    }, DECISION_INTEGRITY);
    insertLegacyKnowledge(harness.fixture.database, knowledgeCandidate);
    const knowledgeA = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.loadVerified(knowledgeCandidate.id));
    const knowledgeB = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.loadVerified(knowledgeCandidate.id));
    expect(knowledgeA).toEqual(knowledgeCandidate);
    expect(knowledgeB).toEqual(knowledgeA);
    expect(knowledgeA).not.toBe(knowledgeB);
    expect(knowledgeA.facts).not.toBe(knowledgeB.facts);
    recursivelyFrozen(knowledgeA);
    loadedEvidence.push(evidenceA);
    loadedKnowledge.push(knowledgeA);
    const authority = durableMarkerAuthority(harness, {
      cityId: member.cityId,
      knowledgeRevisionId: knowledgeA.id,
      evidenceSnapshotId: evidenceA.snapshot.id,
    });
    const marker = reconstructCityLiveMarker({
      assessmentAt: legacy.ranking.assessmentAt,
      criteria,
      evaluators: legacy.installed.evaluatorRegistry,
      rank,
      authority,
    });
    markers.push(marker);
    const markerDigest = DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(marker));
    const selectableMarkers = markers.filter(({ status }) => status === "selectable");
    const isTerminal = rank === legacy.installed.catalog.members.length;
    const successor = sealCityFrontierRevision({
      runId: legacy.root.runId,
      predecessorRevisionId: predecessor.id,
      rankingSnapshotId: legacy.ranking.id,
      markers,
      projection: isTerminal
        ? {
            kind: "terminal",
            nextUncheckedRank: rank + 1,
            selectableCityIds: selectableMarkers.map(({ cityId }) => cityId),
            entries: selectableMarkers.map((candidate) => ({
              cityId: candidate.cityId,
              rank: candidate.rank,
              markerDigest: DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(candidate)),
              knowledgeRevisionId: candidate.knowledgeRevisionId,
              evidenceSnapshotId: candidate.evidenceSnapshotId,
              unknownBasis: candidate.unknownBasis,
            })),
            stopCondition: "catalog_exhausted",
          }
        : {
            kind: "working",
            nextUncheckedRank: rank + 1,
            selectableCityIds: selectableMarkers.map(({ cityId }) => cityId),
            phase: "verification_required",
          },
      operation: {
        kind: "city_completed",
        commandId: `continue:legacy-terminal:${member.cityId}`,
        expectedHeadRevisionId: predecessor.id,
        cityId: member.cityId,
        cityCheckRunId: input.cityCheckRunId,
      },
      createdAt: input.completedAt,
    }, DECISION_INTEGRITY);
    expect(successor.markers.at(-1)).toEqual(marker);
    if (isTerminal) {
      expect(successor.kind).toBe("terminal");
      if (successor.kind === "terminal" && marker.status === "selectable") {
        expect(successor.entries.find(({ cityId }) => cityId === marker.cityId)?.markerDigest)
          .toBe(markerDigest);
      }
    } else {
      expect(successor.kind).toBe("working");
    }
    chain.push(successor);
    predecessor = successor;
  }
  const terminal = chain.at(-1)!;
  expect(chain).toHaveLength(3);
  expect(chain[1]?.kind).toBe("working");
  if (terminal.kind !== "terminal") throw new Error("expected_legacy_terminal_fixture");
  for (const [index, revision] of chain.entries()) {
    expect(reconstructCityFrontierRevision(revision, DECISION_INTEGRITY)).toEqual(revision);
    if (index > 0) {
      expect(revision.predecessorRevisionId).toBe(chain[index - 1]!.id);
      expect(revision.markers.slice(0, -1)).toEqual(chain[index - 1]!.markers);
    }
  }
  harness.state.replaceChain(chain);
  return {
    legacy: legacy.installed,
    manifest: legacy.manifest,
    current: legacy.current,
    chain,
    terminal,
    evidence: loadedEvidence,
    knowledge: loadedKnowledge,
  };
}

function sealSemanticAuthority(
  harness: SyntheticApplicationHarness,
  input: {
    readonly commandId: string;
    readonly templateRanking: CityRankingSnapshot;
    readonly criteria: CityCriteriaSnapshot;
    readonly knowledge: readonly CityKnowledgeRankingProjection[];
    readonly rankingResult: CityRankingResult;
  },
): SemanticAuthorityFixture {
  const installed = harness.fixture.installed;
  const criteriaPayload: CityCriteriaCommandPayload = {
    schemaVersion: "city-criteria-command@1",
    profileSnapshotId: input.criteria.profileSnapshotId,
    preferenceProfileSnapshotId: input.criteria.preferenceProfileSnapshotId,
    criteria: input.criteria.criteria,
    rulesVersion: input.criteria.rulesVersion,
  };
  const criteriaPayloadHash = cityCriteriaPayloadHash(criteriaPayload, DECISION_INTEGRITY);
  const runId = cityFrontierRunId({
    schemaVersion: "city-frontier-run@1",
    resolvedCountryShortlistRevisionId: input.templateRanking.resolvedCountryShortlistRevisionId,
    countryCode: input.templateRanking.countryCode,
    registryRevisionId: installed.registry.id,
    installedPackageContext: installed.installedPackageManifest.key,
    criteriaPayloadHash,
    catalogRulesVersion: installed.catalog.rulesVersion,
    rankingRulesVersion: input.templateRanking.rulesVersion,
    verificationBudget: input.templateRanking.verificationBudget,
  }, DECISION_INTEGRITY);
  const { id: _rankingId, ...templatePayload } = structuredClone(input.templateRanking);
  void _rankingId;
  const ranking = sealCityRankingSnapshot({
    ...templatePayload,
    runId,
    registryRevisionId: installed.registry.id,
    catalogRevisionId: installed.catalog.id,
    installedPackageContext: installed.installedPackageManifest.key,
    criteriaSnapshotId: input.criteria.id,
    knowledgeRevisionIds: Object.fromEntries(input.knowledge.map((projection) => [
      projection.cityId,
      projection.knowledgeRevisionId,
    ])),
    ordered: input.rankingResult.ordered,
    screenedExclusions: input.rankingResult.screenedExclusions,
    rulesVersion: input.rankingResult.rulesVersion,
  }, DECISION_INTEGRITY);
  const root = sealCityFrontierRevision({
    runId,
    rankingSnapshotId: ranking.id,
    markers: [],
    projection: {
      kind: "working",
      nextUncheckedRank: 1,
      selectableCityIds: [],
      phase: "verification_required",
    },
    operation: {
      kind: "start",
      commandId: input.commandId,
      criteriaPayloadHash,
    },
    createdAt: input.templateRanking.createdAt,
  }, DECISION_INTEGRITY);
  harness.state.replaceSemanticStart({ criteria: input.criteria, ranking, root });
  return { criteria: input.criteria, ranking, root, knowledge: input.knowledge };
}

function rankSemanticAuthority(
  harness: SyntheticApplicationHarness,
  templateRanking: CityRankingSnapshot,
  criteria: CityCriteriaSnapshot,
  knowledge: readonly CityKnowledgeRankingProjection[],
  evaluators: CityCriterionEvaluatorRegistry = harness.fixture.installed.evaluatorRegistry,
): CityRankingResult {
  return rankCities({
    assessmentAt: templateRanking.assessmentAt,
    registry: harness.fixture.installed.registry,
    catalog: harness.fixture.installed.catalog,
    criteria,
    knowledge,
    evaluators,
  });
}

function resetSemanticGateObservations(harness: SyntheticApplicationHarness): void {
  resetContinuationPreflightObservations(harness);
  harness.calls.source.splice(0);
  harness.calls.selectionHistory.splice(0);
  harness.calls.publications.splice(0);
  harness.calls.clocks.splice(0);
  harness.calls.fixedRouteInputs.splice(0);
  harness.calls.gatedFixedRouteInputs.splice(0);
  harness.calls.gatedFixedRoutePromises.splice(0);
  harness.calls.finalResearchResultsEntered.splice(0);
  harness.calls.finalResearchResultsReturned.splice(0);
  harness.calls.deadlinePolicyDates.splice(0);
  harness.calls.scheduledDeadlines.splice(0);
  harness.calls.evidenceSeals.splice(0);
  harness.calls.knowledgePublishes.splice(0);
  harness.calls.appends.splice(0);
  harness.calls.safetySearchInputs.splice(0);
  harness.calls.safetyDocumentInputs.splice(0);
  harness.calls.fixedRouteOutputs.splice(0);
  harness.calls.safetySearchOutputs.splice(0);
  harness.calls.safetyDocumentOutputs.splice(0);
  harness.calls.forbiddenPrepareCallbacks.splice(0);
  harness.fixture.policyCalls.canonicalTargets.splice(0);
  harness.fixture.policyCalls.evaluations.splice(0);
  harness.fixture.policyCalls.values.splice(0);
  harness.fixture.policyCalls.sourcePeriods.splice(0);
  fixedRunnerHarness.inputs.splice(0);
  fixedRunnerHarness.promises.splice(0);
  safetyRunnerHarness.promises.splice(0);
  genericSealHarness.calls = 0;
  genericSealHarness.promises.splice(0);
  genericSealHarness.beforeReturn = undefined;
  resetPlanGateObservations();
}

function semanticDownstreamEffects(
  harness: SyntheticApplicationHarness,
): Readonly<Record<string, number>> {
  return {
    publications: harness.calls.publications.length,
    selection: harness.calls.selectionHistory.length,
    clocks: harness.calls.clocks.length,
    deadlines: harness.calls.deadlinePolicyDates.length,
    scheduled: harness.calls.scheduledDeadlines.length,
    source: harness.calls.source.length,
    fixed: harness.calls.fixedRouteInputs.length,
    safetySearch: harness.calls.safetySearchInputs.length,
    safetyDocuments: harness.calls.safetyDocumentInputs.length,
    fixedRunnerInputs: fixedRunnerHarness.inputs.length,
    fixedRunnerPromises: fixedRunnerHarness.promises.length,
    safetyRunnerPromises: safetyRunnerHarness.promises.length,
    generic: genericSealHarness.calls,
    evidenceSeals: harness.calls.evidenceSeals.length,
    knowledgePublishes: harness.calls.knowledgePublishes.length,
    appends: harness.calls.appends.length,
    selectionReads: harness.calls.selectionHistory.length,
    flight: harness.calls.flightIdentityCanonicals.length,
  };
}

function expectSemanticPrepareOnly(
  harness: SyntheticApplicationHarness,
  authority: SemanticAuthorityFixture,
  commandId: string,
): void {
  expect(harness.calls.reloads).toEqual([
    `frontier.command:${authority.root.runId}:${commandId}`,
    `frontier.head:${authority.root.runId}`,
  ]);
  expect(harness.calls.authorityOrder).toEqual(harness.calls.reloads);
  expect(harness.calls.rankingResults).toEqual([]);
  expect(harness.calls.installedPackageResults).toEqual([]);
  expect(harness.calls.manifestResults).toEqual([]);
  expect(harness.calls.catalogReads).toEqual([]);
  expect(planGateCounts()).toEqual({
    fixed: 0,
    directories: 0,
    safetyPlans: 0,
    definitionStructures: 0,
    defaults: 0,
    definitions: 0,
    semanticEntries: 0,
  });
}

function expectSemanticGateEntry(
  harness: SyntheticApplicationHarness,
  entry: (typeof planGateHarness.semanticEntries)[number],
  expected: SemanticAuthorityFixture,
  rankingResult: CityRankingSnapshot,
  installed: InstalledCityResearchPackage = harness.fixture.installed,
): void {
  const manifest = harness.calls.manifestResults.at(-1) as InstalledCityPackageManifest;
  const expectedPlans = installed.catalog.members.flatMap(({ cityId }) =>
    installed.fixedPlansByCityId[cityId]!);
  const expectedOrder = installed.catalog.members.flatMap(({ cityId }) => [
    `fixed:${cityId}:si-city-long-term-rent`,
    `fixed:${cityId}:si-city-urban-transit`,
    `fixed:${cityId}:si-city-fixed-broadband`,
  ]);
  expect(entry.gateSnapshot.order).toEqual([
    ...expectedOrder,
    "directory",
    "safety-plan",
    "definitions",
    "defaults",
    "semantic-verifier",
  ]);
  expect(entry.gateSnapshot.fixed.map(({ value }) => value)).toEqual(expectedPlans);
  expect(entry.gateSnapshot.directories[0]![0]).toEqual(installed.officialAuthorityDirectory);
  expect(entry.gateSnapshot.safetyPlans[0]![0]).toEqual(installed.safetySourcePlan);
  expect(entry.gateSnapshot.definitions[0]![0]).toEqual(installed.criterionDefinitions);
  expect(entry.gateSnapshot.defaults[0]![0]).toEqual(installed.criteriaDefaults);
  const args = entry.args as readonly [
    CityRankingSnapshot,
    {
      readonly registry: InstalledCityResearchPackage["registry"];
      readonly catalog: InstalledCityResearchPackage["catalog"];
      readonly criteria: CityCriteriaSnapshot;
      readonly knowledge: readonly CityKnowledgeRankingProjection[];
      readonly evaluators: CityCriterionEvaluatorRegistry;
    },
    CityDecisionIntegrity,
  ];
  expect(args[0]).toEqual(rankingResult);
  expect(args[1].registry).toEqual(installed.registry);
  expect(args[1].catalog).toEqual(installed.catalog);
  expect(args[1].criteria).toEqual(expected.criteria);
  expect(args[1].knowledge).toEqual(expected.knowledge);
  expect(args[1].knowledge.map(({ knowledgeRevisionId }) => knowledgeRevisionId))
    .toEqual(installed.catalog.members.map(({ cityId }) =>
      expected.ranking.knowledgeRevisionIds[cityId]));
  for (const criterionId of CITY_CRITERION_IDS) {
    const returned = harness.calls.installedPackageResults.at(-1)!;
    expect(args[1].evaluators[criterionId].canonicalizeTarget)
      .toBe(returned.evaluatorRegistry[criterionId].canonicalizeTarget);
    expect(args[1].evaluators[criterionId].evaluate)
      .toBe(returned.evaluatorRegistry[criterionId].evaluate);
  }
  const preSemantic = entry.preSemantic as {
    readonly evidenceCanonicals: typeof harness.calls.evidenceCanonicals;
    readonly evidenceHashes: typeof harness.calls.evidenceHashes;
    readonly evidenceSigns: typeof harness.calls.evidenceSigns;
  };
  const expectedAuthority = [
    manifestPayload(manifest),
    ...expectedPlans,
    installed.safetySourcePlan,
    installed.officialAuthorityDirectory,
    installed.criteriaDefaults,
    installed.criterionDefinitions,
  ];
  expect(preSemantic.evidenceCanonicals.map(({ value }) => value)).toEqual(expectedAuthority);
  expect(preSemantic.evidenceHashes.map(({ value }) => value))
    .toEqual(preSemantic.evidenceCanonicals.map(({ result }) => result));
  expect(preSemantic.evidenceHashes.map(({ result }) => result)).toEqual([
    manifest.payloadHash,
    ...expectedAuthority.slice(1).map((value) =>
      EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(value))),
  ]);
  expect(preSemantic.evidenceSigns).toEqual([]);
}

function changedEvaluatorRegistry(
  installed: InstalledCityResearchPackage,
  calls: CityCriterionEvaluationInput[],
): CityCriterionEvaluatorRegistry {
  return Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
    const original = installed.evaluatorRegistry[criterionId];
    return [criterionId, {
      definition: original.definition,
      canonicalizeTarget: original.canonicalizeTarget,
      evaluate: criterionId === "fixed_broadband"
        ? (input: CityCriterionEvaluationInput): CityCriterionEvaluation => {
            calls.push(structuredClone(input));
            return input.fact.outcome.kind === "unknown"
              ? {
                  state: "unknown",
                  factor: "0",
                  targetComparison: "unknown",
                  unknownReason: input.fact.outcome.reason,
                }
              : { state: "verified", factor: "0.5", targetComparison: "matches" };
          }
        : original.evaluate,
    }];
  })) as unknown as CityCriterionEvaluatorRegistry;
}

function driftSemanticRankingResult(
  result: CityRankingResult,
  kind: "order" | "factor" | "screened-exclusion",
): CityRankingResult {
  const cloned = structuredClone(result);
  if (kind === "order") {
    return freezeDeep({
      ...cloned,
      ordered: [...cloned.ordered].reverse().map((city, index) => ({
        ...city,
        rank: index + 1,
      })),
    });
  }
  const first = cloned.ordered[0];
  if (first === undefined) throw new Error("missing_semantic_ranked_city");
  if (kind === "factor") {
    const factors = structuredClone(first.factors) as unknown as Array<
      CityRankingSnapshot["ordered"][number]["factors"][number]
    >;
    const original = factors[0]!;
    factors[0] = {
      ...original,
      factor: original.factor === "0.5" ? "0.25" : "0.5",
      weightedContribution: original.weightedContribution === "0.5" ? "0.25" : "0.5",
    };
    const changedFactors = factors as unknown as typeof first.factors;
    return freezeDeep({
      ...cloned,
      ordered: cloned.ordered.map((city, index) => index === 0
        ? { ...city, factors: changedFactors }
        : city),
    });
  }
  return freezeDeep({
    ...cloned,
    ordered: cloned.ordered.slice(1).map((city, index) => ({ ...city, rank: index + 1 })),
    screenedExclusions: [
      ...cloned.screenedExclusions,
      {
        cityId: first.cityId,
        score: first.score,
        coverage: first.coverage,
        knowledgeRevisionId: first.knowledgeRevisionId,
        requiredMismatches: [],
        factors: first.factors,
      },
    ],
  });
}

describe("City Frontier Application public boundary", () => {
  test("compile-pins the exact closed DTO, assembly and least-authority port surfaces", () => {
    // Break caught: accepting client-derived run/package/time authority or exposing selection authority publicly.
    type ExpectedStart = {
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly criteriaDraft: readonly [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft];
      readonly commandId: string;
    };
    type ExpectedPrepare = {
      readonly runId: string;
      readonly expectedRevisionId: string;
      readonly commandId: string;
    };
    type ExpectedPrepared = {
      readonly schemaVersion: "city-frontier-prepared@1";
      readonly runId: string;
      readonly baseRevisionId: string;
      readonly rankingSnapshotId: string;
      readonly nextUncheckedRank: number;
      readonly commandId: string;
    };
    type ExpectedSetup = {
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly resolvedCountryEntry: PreCityBranchSourceProjection["resolvedCountryEntry"];
      readonly installedPackageContext: InstalledCityPackageExactKey;
      readonly registryRevisionId: string;
      readonly catalogMemberCount: number;
      readonly catalogCoverage: CityCatalogRevision["coverage"];
      readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
      readonly criteriaDraft: ExpectedStart["criteriaDraft"];
    };
    type ExpectedAuthority = {
      readonly readModel: CityFrontierReadModel;
      readonly terminal: TerminalCityShortlistSnapshot;
      readonly ranking: CityRankingSnapshot;
      readonly preCityBranch: PreCityBranchCommit;
      readonly preCitySource: PreCityBranchSourceProjection;
      readonly frontier: ReconstructCityFrontierInput;
    };
    type ExpectedApplication = {
      presentCityFrontierSetup(input: {
        readonly resolvedCountryShortlistRevisionId: string;
        readonly countryCode: string;
      }): Promise<CityFrontierSetupReadModel>;
      startCityFrontier(input: StartCityFrontierInput): Promise<CityFrontierReadModel>;
      prepareCityFrontierContinuation(input: PrepareCityFrontierContinuationInput): Promise<CityFrontierPrepared>;
      continueCityFrontier(
        prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => void | Promise<void>,
        signal: AbortSignal,
      ): Promise<CityFrontierReadModel>;
      continueCityFrontierWithSourceRecovery(
        prepared: CityFrontierPrepared,
        emit: (event: CityFrontierEvent) => void | Promise<void>,
        signal: AbortSignal,
      ): Promise<import("../../src/application/city-source-recovery").CitySourceRecoveryOutcome>;
      presentCityFrontier(runId: string): Promise<CityFrontierReadModel>;
    };
    type ExpectedSelectionAuthority = {
      loadCurrentTerminalSelectionAuthority(id: string): Promise<VerifiedCityTerminalSelectionAuthority>;
    };
    type ExpectedAssembly = {
      readonly application: Readonly<CityFrontierApplication>;
      readonly selectionAuthority: Readonly<CityFrontierSelectionAuthorityPort>;
    };
    type ExpectedPorts = {
      readonly resolveAvailability: typeof getCityResearchPackageAvailability;
      readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
      readonly profiles: CityFrontierProfileReadPort;
      readonly installedPackages: InstalledCityPackageLookupPort;
      readonly installedPackageManifests: Pick<InstalledCityPackageManifestStorePort, "loadVerified">;
      readonly latestInstalledCatalog: InstalledCityCatalogReadPort;
      readonly historicalCatalogs: Pick<CityCatalogStorePort, "loadVerified">;
      readonly criteria: CityCriteriaReadPort;
      readonly branches: CityBranchReadPort;
      readonly rankings: CityRankingReadPort;
      readonly frontierRead: CityFrontierReadPort;
      readonly frontierAppend: CityFrontierAppendPort;
      readonly startWriter: CityFrontierStartWriterPort;
      readonly selectionHistory: CitySelectionHistoryReadPort;
      readonly evidence: CityEvidenceStorePort;
      readonly evidenceReplay: CityEvidenceReplayPorts;
      readonly knowledge: CityKnowledgeStorePort;
      readonly fixedRoutes: CityFrontierFixedRoutePorts;
      readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
      readonly safetySearch: CitySafetySearchPort;
      readonly safetyDocuments: CitySafetyOfficialDocumentPort;
      readonly decisionIntegrity: CityDecisionIntegrity;
      readonly evidenceIntegrity: EvidenceIntegrity;
      readonly clock: () => Date;
      readonly fixedSourceDeadlineAt: (now: Date) => Date;
    };

    expectTypeOf<StartCityFrontierInput>().toEqualTypeOf<ExpectedStart>();
    expectTypeOf<PrepareCityFrontierContinuationInput>().toEqualTypeOf<ExpectedPrepare>();
    expectTypeOf<CityFrontierPrepared>().toEqualTypeOf<ExpectedPrepared>();
    expectTypeOf<CityFrontierSetupReadModel>().toEqualTypeOf<ExpectedSetup>();
    expectTypeOf<VerifiedCityTerminalSelectionAuthority>().toEqualTypeOf<ExpectedAuthority>();
    expectTypeOf<CityFrontierApplication>().toEqualTypeOf<ExpectedApplication>();
    expectTypeOf<CityFrontierSelectionAuthorityPort>().toEqualTypeOf<ExpectedSelectionAuthority>();
    expectTypeOf<CityFrontierApplicationAssembly>().toEqualTypeOf<ExpectedAssembly>();
    expectTypeOf<CityFrontierApplicationPorts>().toEqualTypeOf<ExpectedPorts>();
    expectTypeOf(createCityFrontierApplication)
      .toEqualTypeOf<(ports: CityFrontierApplicationPorts, recoveryCapability?: import("../../src/application/city-frontier").CityFrontierSourceRecoveryCapability) => Readonly<CityFrontierApplicationAssembly>>();
  });

  test("compile-pins configured and unconfigured composition without leaking infrastructure into Application", () => {
    // Break caught: partial HTTP configuration, public history authority, or a raw Application return.
    type ExpectedLiveSources =
      | { readonly kind: "unconfigured" }
      | {
          readonly kind: "configured";
          readonly fixedRoutes: CityFrontierFixedRoutePorts;
          readonly safetyDocuments: CitySafetyOfficialDocumentPort;
          readonly citySafetySearch?: Readonly<{
            readonly config: import("../../src/infrastructure/sources/http-city-safety-search-step").HttpCitySafetySearchConfig;
            readonly request: import("../../src/infrastructure/sources/http-city-safety-search-step").CitySafetySearchHttpRequest;
          }>;
        };
    type ExpectedTiming = {
      readonly fixedSourceDeadlineAt: (now: Date) => Date;
      readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
    };
    type ExpectedOptions = {
      readonly database: Database.Database;
      readonly hmacKey: string;
      readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
      readonly profiles: CityFrontierProfileReadPort;
      readonly liveSources: CityFrontierLiveSourceConfiguration;
      readonly resolveAvailability?: typeof getCityResearchPackageAvailability;
      readonly clock?: () => Date;
      readonly fixedTiming?: CityFrontierFixedTiming;
    };
    type OptionValue<T, K extends PropertyKey> = K extends keyof T
      ? T[K & keyof T]
      : never;
    type ActualRootDelta = {
      readonly cityFrontierLiveSources?: OptionValue<
        ConfirmedLifeCompositionOptions,
        "cityFrontierLiveSources"
      >;
      readonly cityFrontierResolveAvailability?: OptionValue<
        ConfirmedLifeCompositionOptions,
        "cityFrontierResolveAvailability"
      >;
      readonly cityFrontierFixedTiming?: OptionValue<
        ConfirmedLifeCompositionOptions,
        "cityFrontierFixedTiming"
      >;
    };
    type ExpectedRootDelta = {
      readonly cityFrontierLiveSources?: CityFrontierLiveSourceConfiguration;
      readonly cityFrontierResolveAvailability?: typeof getCityResearchPackageAvailability;
      readonly cityFrontierFixedTiming?: CityFrontierFixedTiming;
    };
    type ExpectedRootOptionKeys =
      | "database"
      | "hmacKey"
      | "source"
      | "requestStep"
      | "parsers"
      | "clock"
      | "nextId"
      | "deadlineAt"
      | keyof ExpectedRootDelta;
    type RootTaskMethodName =
      | "presentCityFrontierSetup"
      | "startCityFrontier"
      | "prepareCityFrontierContinuation"
      | "continueCityFrontier"
      | "presentCityFrontier"
      | "selectCity";

    expectTypeOf<CityFrontierLiveSourceConfiguration>().toEqualTypeOf<ExpectedLiveSources>();
    expectTypeOf<CityFrontierFixedTiming>().toEqualTypeOf<ExpectedTiming>();
    expectTypeOf<CityFrontierCompositionOptions>().toEqualTypeOf<ExpectedOptions>();
    expectTypeOf<ActualRootDelta>().toEqualTypeOf<ExpectedRootDelta>();
    expectTypeOf<keyof ConfirmedLifeCompositionOptions>()
      .toEqualTypeOf<ExpectedRootOptionKeys>();
    expectTypeOf(createCityFrontierComposition)
      .toEqualTypeOf<(options: CityFrontierCompositionOptions) =>
        Readonly<CityFrontierApplication & CitySelectionApplication>>();
    expectTypeOf<ReturnType<typeof createConfirmedLifeComposition>>()
      .toMatchTypeOf<Readonly<Record<RootTaskMethodName, unknown>>>();
    expectTypeOf<CityFixedSourceRunInput<"si-city-long-term-rent">["now"]>()
      .toEqualTypeOf<() => string>();
  });

  test("composition forwards configured source and timing capabilities through the exact HTTP factory chain", async () => {
    // Break caught: swapping configured inward ports or bypassing either half of the atomic search bundle.
    const rent = Object.freeze({ inspect: NEVER });
    const transit = Object.freeze({ inspect: NEVER });
    const broadband = Object.freeze({ inspect: NEVER });
    const safetyDocuments = Object.freeze({ inspect: NEVER });
    const fixedRoutes = Object.freeze({
      "si-city-long-term-rent": rent,
      "si-city-urban-transit": transit,
      "si-city-fixed-broadband": broadband,
    }) satisfies CityFrontierFixedRoutePorts;
    const config = {
      endpoint: "https://search.example.test/city-safety",
      providerId: "configured-city-safety",
      bearerToken: "composition-test-token",
      timeoutMs: 4_000,
      maxResponseBytes: 65536 as const,
    } satisfies import(
      "../../src/infrastructure/sources/http-city-safety-search-step"
    ).HttpCitySafetySearchConfig;
    const originalConfig = structuredClone(config);
    const requestInputs: Array<{
      readonly input: Parameters<CitySafetySearchHttpRequest>[0];
      readonly signal: AbortSignal;
    }> = [];
    const returnedUrl = "https://official.example.test/ljubljana-safety";
    const request: CitySafetySearchHttpRequest = async (input, signal) => {
      requestInputs.push({ input, signal });
      return {
        status: 200,
        mediaType: "application/json; charset=utf-8",
        bodyBytes: new TextEncoder().encode(JSON.stringify({ urls: [returnedUrl] })),
      };
    };
    const resolveAvailability = (countryCode: string) =>
      getCityResearchPackageAvailability(countryCode);
    const clock = () => new Date(START_AT);
    const fixedSourceDeadlineAt = (now: Date) => new Date(now.valueOf() + 60_000);
    const fixedDeadlineScheduler = Object.freeze({
      schedule: NEVER,
    }) satisfies CityFixedDeadlineScheduler;
    const database = openEvidenceDatabase(":memory:");
    databases.push(database);
    const factoryOffset = compositionHarness.applicationFactoryPorts.length;
    const httpOffset = compositionHarness.httpSearchFactoryArgs.length;
    const searchOffset = compositionHarness.searchPortFactoryArgs.length;
    const sourceFactoryOrderOffset = compositionHarness.sourceFactoryOrder.length;
    compositionHarness.enabled = true;
    try {
      createCityFrontierComposition({
        database,
        hmacKey: "task-14-configured-wiring-key-at-least-32-bytes",
        resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
        profiles: {
          loadRelocationAnyVerified: NEVER,
          loadPreferenceForRankingVerified: NEVER,
        },
        liveSources: {
          kind: "configured",
          fixedRoutes,
          safetyDocuments,
          citySafetySearch: { config, request },
        },
        resolveAvailability,
        clock,
        fixedTiming: { fixedSourceDeadlineAt, fixedDeadlineScheduler },
      });
    } finally {
      compositionHarness.enabled = false;
    }
    expect(compositionHarness.applicationFactoryPorts).toHaveLength(factoryOffset + 1);
    expect(compositionHarness.httpSearchFactoryArgs).toHaveLength(httpOffset + 1);
    expect(compositionHarness.httpSearchFactoryResults).toHaveLength(httpOffset + 1);
    expect(compositionHarness.searchPortFactoryArgs).toHaveLength(searchOffset + 1);
    expect(compositionHarness.searchPortFactoryResults).toHaveLength(searchOffset + 1);
    expect(compositionHarness.sourceFactoryOrder.slice(sourceFactoryOrderOffset)).toEqual([
      "http.attempt",
      "http.result",
      "search.attempt",
      "search.result",
    ]);
    const httpArgs = compositionHarness.httpSearchFactoryArgs[httpOffset] as readonly unknown[];
    expect(httpArgs).toHaveLength(2);
    expect(httpArgs[0]).toEqual(originalConfig);
    expect(httpArgs[1]).toBe(request);
    const step = compositionHarness.httpSearchFactoryResults[httpOffset];
    const searchArgs = compositionHarness.searchPortFactoryArgs[searchOffset] as
      readonly [{ readonly step: unknown; readonly providerId: string }];
    expect(searchArgs).toHaveLength(1);
    expect(Reflect.ownKeys(searchArgs[0]).sort()).toEqual(["providerId", "step"]);
    expect(searchArgs[0].step).toBe(step);
    expect(searchArgs[0].providerId).toBe(originalConfig.providerId);
    const searchPort = compositionHarness.searchPortFactoryResults[searchOffset];
    const ports = compositionHarness.applicationFactoryPorts[factoryOffset] as
      CityFrontierApplicationPorts;
    expect(ports.fixedRoutes["si-city-long-term-rent"]).toBe(rent);
    expect(ports.fixedRoutes["si-city-urban-transit"]).toBe(transit);
    expect(ports.fixedRoutes["si-city-fixed-broadband"]).toBe(broadband);
    expect(ports.safetyDocuments).toBe(safetyDocuments);
    expect(ports.safetySearch).toBe(searchPort);
    expect(ports.resolveAvailability).toBe(resolveAvailability);
    expect(ports.clock).toBe(clock);
    expect(ports.fixedSourceDeadlineAt).toBe(fixedSourceDeadlineAt);
    expect(ports.fixedDeadlineScheduler).toBe(fixedDeadlineScheduler);
    config.endpoint = "https://attacker.example.test/redirected";
    config.providerId = "attacker-provider";
    config.bearerToken = "attacker-token";
    vi.useFakeTimers();
    try {
      const timersBefore = vi.getTimerCount();
      const response = await ports.safetySearch.search({
        queryId: "city-safety-query:composition-wiring:1",
        query: "Ljubljana municipal safety annual report",
        resultLimit: 2,
        signal: new AbortController().signal,
      });
      expect(response).toEqual({
        kind: "completed",
        providerId: originalConfig.providerId,
        urls: [returnedUrl],
      });
      expect(requestInputs).toHaveLength(1);
      expect(requestInputs[0]!.input).toEqual({
        url: originalConfig.endpoint,
        method: "POST",
        redirectMode: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${originalConfig.bearerToken}`,
        },
        bodyBytes: expect.any(Uint8Array),
      });
      expect(JSON.parse(new TextDecoder().decode(requestInputs[0]!.input.bodyBytes))).toEqual({
        query: "Ljubljana municipal safety annual report",
        resultLimit: 2,
      });
      expect(requestInputs[0]!.signal).toBeInstanceOf(AbortSignal);
      expect(requestInputs[0]!.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(timersBefore);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }

    const defaultDatabase = openEvidenceDatabase(":memory:");
    databases.push(defaultDatabase);
    const defaultFactoryOffset = compositionHarness.applicationFactoryPorts.length;
    compositionHarness.enabled = true;
    try {
      createCityFrontierComposition({
        database: defaultDatabase,
        hmacKey: "task-14-default-availability-key-at-least-32-bytes",
        resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
        profiles: {
          loadRelocationAnyVerified: NEVER,
          loadPreferenceForRankingVerified: NEVER,
        },
        liveSources: { kind: "unconfigured" },
      });
    } finally {
      compositionHarness.enabled = false;
    }
    expect(compositionHarness.applicationFactoryPorts).toHaveLength(defaultFactoryOffset + 1);
    expect((compositionHarness.applicationFactoryPorts[defaultFactoryOffset] as
      CityFrontierApplicationPorts).resolveAvailability)
      .toBe(getCityResearchPackageAvailability);
    expect(compositionHarness.httpSearchFactoryArgs).toHaveLength(httpOffset + 1);
    expect(compositionHarness.searchPortFactoryArgs).toHaveLength(searchOffset + 1);
  });

  test("ConfirmedLife root constructs exactly one internal Task 14 assembly for default and explicit options", async () => {
    // Break caught: constructing a second graph, leaking internal authority, or substituting legacy timing.
    const taskMethodNames = [
      "presentCityFrontierSetup",
      "startCityFrontier",
      "prepareCityFrontierContinuation",
      "continueCityFrontier",
      "presentCityFrontier",
    ] as const;
    const compose = async (options: ConfirmedLifeCompositionOptions) => {
      const compositionOffset = compositionHarness.rootCompositionArgs.length;
      const assemblyOffset = compositionHarness.rootCompositionResults.length;
      const applicationOffset = compositionHarness.applicationFactoryPorts.length;
      const profileStoreOffset = compositionHarness.profileStores.length;
      compositionHarness.rootCompositionEnabled = true;
      compositionHarness.enabled = true;
      let returned: ReturnType<typeof createConfirmedLifeComposition>;
      try {
        returned = createConfirmedLifeComposition(options);
      } finally {
        compositionHarness.enabled = false;
        compositionHarness.rootCompositionEnabled = false;
      }
      expect(compositionHarness.rootCompositionArgs).toHaveLength(compositionOffset + 1);
      expect(compositionHarness.rootCompositionResults).toHaveLength(assemblyOffset + 1);
      expect(compositionHarness.applicationFactoryPorts).toHaveLength(applicationOffset + 1);
      expect(compositionHarness.profileStores).toHaveLength(profileStoreOffset + 1);
      const taskOptions = compositionHarness.rootCompositionArgs[compositionOffset] as
        CityFrontierCompositionOptions;
      const assembly = compositionHarness.rootCompositionResults[assemblyOffset] as
        Readonly<CityFrontierApplication & CitySelectionApplication>;
      const root = returned as unknown as Record<PropertyKey, unknown>;
      const application = assembly as unknown as Record<PropertyKey, unknown>;
      expect(taskOptions.database).toBe(options.database);
      expect(taskOptions.hmacKey).toBe(options.hmacKey);
      for (const methodName of taskMethodNames) {
        expect(root[methodName]).toBe(application[methodName]);
      }
      expect(Object.prototype.hasOwnProperty.call(root, "application")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(root, "selectionAuthority")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(
        root,
        "loadCurrentTerminalSelectionAuthority",
      )).toBe(false);
      expect(Reflect.ownKeys(taskOptions.resolvedCountries)).toEqual([
        "requireResolvedCountryShortlistForCity",
      ]);
      expect(Object.getPrototypeOf(taskOptions.resolvedCountries)).toBe(Object.prototype);
      expect(taskOptions.resolvedCountries.requireResolvedCountryShortlistForCity)
        .toBe(root.requireResolvedCountryShortlistForCity);
      expect(Reflect.ownKeys(taskOptions.profiles).sort()).toEqual([
        "loadPreferenceForRankingVerified",
        "loadRelocationAnyVerified",
      ]);
      expect(Object.getPrototypeOf(taskOptions.profiles)).toBe(Object.prototype);
      const rawProfileStore = compositionHarness.profileStores[profileStoreOffset] as
        SqliteProfileStore;
      const relocationId = `relocation-profile:root-absent:${profileStoreOffset}`;
      const preferenceId = `preference-profile:root-absent:${profileStoreOffset}`;
      const hostileRelocation = new Error("borrowed_relocation_method");
      const hostilePreference = new Error("borrowed_preference_method");
      Object.defineProperties(rawProfileStore, {
        loadRelocationAnyVerified: {
          configurable: true,
          value: () => Promise.reject(hostileRelocation),
        },
        loadPreferenceForRankingVerified: {
          configurable: true,
          value: () => Promise.reject(hostilePreference),
        },
      });
      const relocationOffset = compositionHarness.profileRelocationArgs.length;
      const preferenceOffset = compositionHarness.profilePreferenceArgs.length;
      compositionHarness.profileReceiverCallsEnabled = true;
      let relocationOutcome:
        | { readonly kind: "fulfilled"; readonly value: unknown }
        | { readonly kind: "rejected"; readonly error: unknown };
      let preferenceOutcome: typeof relocationOutcome;
      try {
        [relocationOutcome, preferenceOutcome] = await Promise.all([
          taskOptions.profiles.loadRelocationAnyVerified(relocationId).then(
            (value: unknown) => ({ kind: "fulfilled" as const, value }),
            (error: unknown) => ({ kind: "rejected" as const, error }),
          ),
          taskOptions.profiles.loadPreferenceForRankingVerified(preferenceId).then(
            (value: unknown) => ({ kind: "fulfilled" as const, value }),
            (error: unknown) => ({ kind: "rejected" as const, error }),
          ),
        ]);
      } finally {
        compositionHarness.profileReceiverCallsEnabled = false;
        delete (rawProfileStore as unknown as MutableRecord).loadRelocationAnyVerified;
        delete (rawProfileStore as unknown as MutableRecord).loadPreferenceForRankingVerified;
      }
      expect(relocationOutcome!.kind).toBe("rejected");
      expect(preferenceOutcome!.kind).toBe("rejected");
      const relocationError = (relocationOutcome as { readonly error: unknown }).error;
      const preferenceError = (preferenceOutcome as { readonly error: unknown }).error;
      expect(relocationError).toBeInstanceOf(Error);
      expect((relocationError as Error).message).toBe("profile_not_found");
      expect(relocationError).not.toBe(hostileRelocation);
      expect(preferenceError).toBeInstanceOf(Error);
      expect((preferenceError as Error).message).toBe("profile_not_found");
      expect(preferenceError).not.toBe(hostilePreference);
      expect(compositionHarness.profileRelocationReceivers).toHaveLength(relocationOffset + 1);
      expect(compositionHarness.profileRelocationReceivers[relocationOffset])
        .toBe(rawProfileStore);
      expect(compositionHarness.profileRelocationArgs.slice(relocationOffset))
        .toEqual([[relocationId]]);
      expect(compositionHarness.profilePreferenceReceivers).toHaveLength(preferenceOffset + 1);
      expect(compositionHarness.profilePreferenceReceivers[preferenceOffset])
        .toBe(rawProfileStore);
      expect(compositionHarness.profilePreferenceArgs.slice(preferenceOffset))
        .toEqual([[preferenceId]]);
      return { root, taskOptions, assembly };
    };

    const defaultDatabase = openEvidenceDatabase(":memory:");
    databases.push(defaultDatabase);
    const defaultResult = await compose({
      database: defaultDatabase,
      hmacKey: "task-14-confirmed-life-default-key-at-least-32-bytes",
    });
    expect(defaultResult.taskOptions.liveSources).toEqual({ kind: "unconfigured" });
    expect(Object.prototype.hasOwnProperty.call(
      defaultResult.taskOptions,
      "resolveAvailability",
    )).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(defaultResult.taskOptions, "fixedTiming"))
      .toBe(false);
    expect(Object.prototype.hasOwnProperty.call(defaultResult.taskOptions, "clock")).toBe(false);

    const fixedRoutes = Object.freeze({
      "si-city-long-term-rent": Object.freeze({ inspect: NEVER }),
      "si-city-urban-transit": Object.freeze({ inspect: NEVER }),
      "si-city-fixed-broadband": Object.freeze({ inspect: NEVER }),
    }) satisfies CityFrontierFixedRoutePorts;
    const safetyDocuments = Object.freeze({ inspect: NEVER }) satisfies
      CitySafetyOfficialDocumentPort;
    const liveSources = Object.freeze({
      kind: "configured" as const,
      fixedRoutes,
      safetyDocuments,
    }) satisfies CityFrontierLiveSourceConfiguration;
    const explicitCalls = {
      availability: 0,
      clock: 0,
      taskDeadline: 0,
      scheduler: 0,
      legacyDeadline: 0,
    };
    const resolveAvailability = (countryCode: string) => {
      explicitCalls.availability += 1;
      return getCityResearchPackageAvailability(countryCode);
    };
    const clock = () => {
      explicitCalls.clock += 1;
      return new Date(START_AT);
    };
    const fixedSourceDeadlineAt = (now: Date) => {
      explicitCalls.taskDeadline += 1;
      return new Date(now.valueOf() + 45_000);
    };
    const fixedDeadlineScheduler = Object.freeze({
      schedule: () => {
        explicitCalls.scheduler += 1;
        return { cancel: NEVER };
      },
    }) satisfies CityFixedDeadlineScheduler;
    const legacyDeadlineAt = (now: Date) => {
      explicitCalls.legacyDeadline += 1;
      return new Date(now.valueOf() + 90_000);
    };
    const explicitDatabase = openEvidenceDatabase(":memory:");
    databases.push(explicitDatabase);
    const explicitInput = {
      database: explicitDatabase,
      hmacKey: "task-14-confirmed-life-explicit-key-at-least-32-bytes",
      clock,
      deadlineAt: legacyDeadlineAt,
      cityFrontierLiveSources: liveSources,
      cityFrontierResolveAvailability: resolveAvailability,
      cityFrontierFixedTiming: { fixedSourceDeadlineAt, fixedDeadlineScheduler },
    };
    const explicitResult = await compose(
      explicitInput as unknown as ConfirmedLifeCompositionOptions,
    );
    expect(explicitCalls).toEqual({
      availability: 0,
      clock: 0,
      taskDeadline: 0,
      scheduler: 0,
      legacyDeadline: 0,
    });
    expect(explicitResult.taskOptions.liveSources).toBe(liveSources);
    expect(explicitResult.taskOptions.resolveAvailability).toBe(resolveAvailability);
    expect(explicitResult.taskOptions.clock).toBe(clock);
    expect(explicitResult.taskOptions.fixedTiming).toEqual({
      fixedSourceDeadlineAt,
      fixedDeadlineScheduler,
    });
    expect(explicitResult.taskOptions.fixedTiming?.fixedSourceDeadlineAt)
      .toBe(fixedSourceDeadlineAt);
    expect(explicitResult.taskOptions.fixedTiming?.fixedSourceDeadlineAt)
      .not.toBe(legacyDeadlineAt);
    expect(explicitResult.taskOptions.fixedTiming?.fixedDeadlineScheduler)
      .toBe(fixedDeadlineScheduler);

    const rootSource = readFileSync(
      new URL("../../src/infrastructure/composition-root.ts", import.meta.url),
      "utf8",
    );
    const literalSpecifiers = [
      ...rootSource.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...rootSource.matchAll(/\bimport\s*["']([^"']+)["']/g),
      ...rootSource.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...rootSource.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]!.replace(/\.(?:js|ts)$/, ""));
    expect(literalSpecifiers).toContain("./city-frontier-composition");
    const forbiddenTask14Specifiers = [
      "../application/city-frontier",
      "./sqlite/city-frontier-store",
      "./sqlite/city-ranking-store",
      "./sqlite/city-criteria-store",
      "./sqlite/city-knowledge-store",
      "./sqlite/city-evidence-store",
      "./sqlite/city-package-manifest-store",
      "./sqlite/city-catalog-store",
      "./sqlite/city-branch-store",
    ];
    expect(literalSpecifiers.filter((specifier) =>
      forbiddenTask14Specifiers.includes(specifier))).toEqual([]);
  });

  test("composition isolates each manifest store and owns one durable selection writer", async () => {
    // Break caught: constructing duplicate stores or retaining a module singleton.
    const assemblies = [0, 1].map((index) => {
      const database = openEvidenceDatabase(":memory:");
      databases.push(database);
      compositionHarness.enabled = true;
      try {
        const assembly = createCityFrontierComposition({
          database,
          hmacKey: `task-14-composition-manifest-key-${index}-at-least-32-bytes`,
          resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
          profiles: {
            loadRelocationAnyVerified: NEVER,
            loadPreferenceForRankingVerified: NEVER,
          },
          liveSources: { kind: "unconfigured" },
        });
        expect(compositionHarness.applicationFactoryPorts).toHaveLength(index + 1);
        expect(compositionHarness.manifestStores).toHaveLength(index + 1);
        expect(compositionHarness.installedPackageReceivers).toHaveLength(index + 1);
        return assembly;
      } finally {
        compositionHarness.enabled = false;
      }
    });

    const rawManifestStores = compositionHarness.manifestStores as
      SqliteCityPackageManifestStore[];
    const factoryPorts = compositionHarness.applicationFactoryPorts as
      CityFrontierApplicationPorts[];
    const selectionFactoryPorts = compositionHarness.selectionApplicationFactoryPorts as
      CitySelectionApplicationPorts[];
    const selectionWriters = compositionHarness.selectionWriters as
      SqliteCitySelectionWriter[];
    const selectionWriterDependencies = compositionHarness.selectionWriterDependencies as
      Array<{ readonly historicalPackages: unknown }>;
    const manifestReaders = factoryPorts.map(({ installedPackageManifests }) =>
      installedPackageManifests);
    const selectionHistoryReaders = factoryPorts.map(({ selectionHistory }) => selectionHistory);
    expect(selectionFactoryPorts).toHaveLength(2);
    expect(selectionWriters).toHaveLength(2);
    expect(selectionWriterDependencies).toHaveLength(2);
    expect(rawManifestStores[0]).not.toBe(rawManifestStores[1]);
    expect(manifestReaders[0]).not.toBe(manifestReaders[1]);
    expect(selectionHistoryReaders[0]).not.toBe(selectionHistoryReaders[1]);
    for (const index of [0, 1] as const) {
      expect(selectionHistoryReaders[index]).toBe(selectionWriters[index]);
      expect(selectionFactoryPorts[index]!.writer).toBe(selectionWriters[index]);
      expect(selectionWriterDependencies[index]!.historicalPackages)
        .toBe(rawManifestStores[index]);
      expect(selectionFactoryPorts[index]!.frontier).toBeDefined();
      expect(Reflect.ownKeys(assemblies[index]!)).not.toContain("selectionAuthority");
      expect(Reflect.ownKeys(assemblies[index]!)).not.toContain("writer");
    }
    for (const [index, manifestReader] of manifestReaders.entries()) {
      const rawManifestStore = rawManifestStores[index]!;
      expect(compositionHarness.installedPackageReceivers[index]).toBe(rawManifestStore);
      expect(manifestReader).not.toBe(rawManifestStore);
      expect(Reflect.ownKeys(manifestReader)).toEqual(["loadVerified"]);
      expect(Object.getPrototypeOf(manifestReader)).toBe(Object.prototype);
      expect("appendPrepared" in manifestReader).toBe(false);
      expect("latestVerified" in manifestReader).toBe(false);
      recursivelyFrozen(manifestReader);
      recursivelyFrozen(assemblies[index]);
      expect(Reflect.ownKeys(assemblies[index]!)).toEqual([
        "presentCityFrontierSetup",
        "startCityFrontier",
        "prepareCityFrontierContinuation",
        "continueCityFrontier",
        "continueCityFrontierWithSourceRecovery",
        "presentCityFrontier",
        "selectCity",
      ]);
    }
    for (const historyReader of selectionHistoryReaders) {
      expect(historyReader.listSelectionsWithBranchesVerified).toBeTypeOf("function");
      expect(rawManifestStores).not.toContain(historyReader);
      expect(compositionHarness.installedPackageReceivers).not.toContain(historyReader);
    }

    const emptyHistories = await Promise.all(selectionHistoryReaders.flatMap((historyReader) => [
      historyReader.listSelectionsWithBranchesVerified("city-frontier:history-a"),
      historyReader.listSelectionsWithBranchesVerified("city-frontier:history-b"),
    ]));
    expect(emptyHistories).toEqual([[], [], [], []]);
    for (const history of emptyHistories) recursivelyFrozen(history);
    expect(new Set(emptyHistories).size).toBe(4);

    const exactKey = freezeDeep({
      countryCode: "SI",
      packageId: "si-city-research",
      packageSchemaVersion: "slovenia-city-package@1",
      catalogRevisionId: `city-catalog:${"a".repeat(64)}`,
      evidenceRulesVersion: "evidence-rules@2",
    } as InstalledCityPackageExactKey);
    compositionHarness.captureReceiverCalls = true;
    for (const ports of factoryPorts) expect(ports.installedPackages.findReady("SI")).toBeUndefined();
    expect(compositionHarness.currentLoadReceivers).toEqual(rawManifestStores);
    for (const [index, rawManifestStore] of rawManifestStores.entries()) {
      Object.defineProperty(rawManifestStore, "loadVerified", {
        configurable: true,
        value: () => { throw new Error(`swapped_manifest_receiver:${index}`); },
      });
    }
    try {
      for (const manifestReader of manifestReaders) {
        expect(manifestReader.loadVerified(exactKey)).toBeUndefined();
      }
      expect(compositionHarness.manifestLoadReceivers).toEqual(rawManifestStores);
    } finally {
      compositionHarness.captureReceiverCalls = false;
      for (const rawManifestStore of rawManifestStores) {
        delete (rawManifestStore as unknown as MutableRecord).loadVerified;
      }
    }
  });

  test("composition supplies the exact default deadline policy and one-shot cancellable scheduler", () => {
    // Break caught: sharing deadline Dates, accepting ambiguous instants, or leaking timer callbacks.
    const systemNow = new Date("2026-08-25T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(systemNow);
    try {
      const database = openEvidenceDatabase(":memory:");
      databases.push(database);
      compositionHarness.enabled = true;
      try {
        createCityFrontierComposition({
          database,
          hmacKey: "task-14-default-timing-key-at-least-32-bytes",
          resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
          profiles: {
            loadRelocationAnyVerified: NEVER,
            loadPreferenceForRankingVerified: NEVER,
          },
          liveSources: { kind: "unconfigured" },
        });
      } finally {
        compositionHarness.enabled = false;
      }
      expect(compositionHarness.applicationFactoryPorts).toHaveLength(1);
      const ports = compositionHarness.applicationFactoryPorts[0] as
        CityFrontierApplicationPorts;
      const firstClock = ports.clock();
      const secondClock = ports.clock();
      for (const value of [firstClock, secondClock]) {
        expect(Object.getPrototypeOf(value)).toBe(Date.prototype);
        expect(Reflect.ownKeys(value).filter((key) => key !== "constructor")).toEqual([]);
        expect(value.valueOf()).toBe(systemNow.valueOf());
        expect(value).not.toBe(systemNow);
      }
      expect(firstClock).not.toBe(secondClock);
      firstClock.setTime(systemNow.valueOf() + 1);
      expect(firstClock.valueOf()).toBe(systemNow.valueOf() + 1);
      expect(secondClock.valueOf()).toBe(systemNow.valueOf());
      expect(systemNow.valueOf()).toBe(Date.parse("2026-08-25T00:00:00.000Z"));
      const policyInput = new Date(systemNow);
      const originalMillis = policyInput.valueOf();
      const firstDeadline = ports.fixedSourceDeadlineAt(policyInput);
      const secondDeadline = ports.fixedSourceDeadlineAt(policyInput);
      expect(policyInput.valueOf()).toBe(originalMillis);
      expect(firstDeadline.valueOf()).toBe(originalMillis + 45_000);
      expect(secondDeadline.valueOf()).toBe(originalMillis + 45_000);
      expect(firstDeadline).not.toBe(secondDeadline);
      expect(firstDeadline).not.toBe(policyInput);
      expect(secondDeadline).not.toBe(policyInput);
      for (const value of [firstDeadline, secondDeadline]) {
        expect(Object.getPrototypeOf(value)).toBe(Date.prototype);
        expect(Reflect.ownKeys(value).filter((key) => key !== "constructor")).toEqual([]);
      }

      const fired = vi.fn();
      const cancelled = vi.fn();
      const deadlineAt = new Date(originalMillis + 45_000).toISOString();
      const liveHandle = ports.fixedDeadlineScheduler.schedule(deadlineAt, fired);
      const cancelledHandle = ports.fixedDeadlineScheduler.schedule(deadlineAt, cancelled);
      expect(() => cancelledHandle.cancel()).not.toThrow();
      expect(() => cancelledHandle.cancel()).not.toThrow();
      vi.advanceTimersByTime(44_999);
      expect(fired).not.toHaveBeenCalled();
      expect(cancelled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fired).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(90_000);
      expect(fired).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
      expect(() => liveHandle.cancel()).not.toThrow();
      expect(() => liveHandle.cancel()).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
      vi.setSystemTime(systemNow);

      const invalidCalls: ReadonlyArray<readonly [string, unknown]> = [
        ["invalid", vi.fn()],
        ["2026-08-25T03:02:15+03:00", vi.fn()],
        [systemNow.toISOString(), vi.fn()],
        [new Date(originalMillis - 1).toISOString(), vi.fn()],
        [new Date(originalMillis + 45_000).toISOString(), null],
      ];
      for (const [invalidDeadline, callback] of invalidCalls) {
        const beforeTimers = vi.getTimerCount();
        const errors = [0, 1].map(() => captureError(() =>
          (ports.fixedDeadlineScheduler.schedule as unknown as (
            deadline: string,
            onDeadline: unknown,
          ) => unknown)(invalidDeadline, callback)));
        expect(errors[0].message).toBe("integrity_mismatch");
        expect(errors[1].message).toBe("integrity_mismatch");
        expect(errors[0]).not.toBe(errors[1]);
        expect(vi.getTimerCount()).toBe(beforeTimers);
        if (typeof callback === "function") expect(callback).not.toHaveBeenCalled();
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  test("composition rejects an external selection-history override", () => {
    // Break caught: caller-controlled history replacing the single durable Task 15 writer.
    const database = openEvidenceDatabase(":memory:");
    databases.push(database);
    expect(() => createCityFrontierComposition({
        database,
        hmacKey: "task-15-closed-history-key-at-least-32-bytes",
        resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
        profiles: {
          loadRelocationAnyVerified: NEVER,
          loadPreferenceForRankingVerified: NEVER,
        },
        liveSources: { kind: "unconfigured" },
        selectionHistory: {
          async listSelectionsWithBranchesVerified() {
            return [];
          },
        },
      } as unknown as CityFrontierCompositionOptions)).toThrowError("integrity_mismatch");
  });

  test("Application imports only inward contracts and never Task 15 or infrastructure implementations", () => {
    // Break caught: moving SQLite, HTTP, timers, composition, or Task 15 selection into the use case.
    const source = readFileSync(new URL("../../src/application/city-frontier.ts", import.meta.url), "utf8");
    const specifiers = [
      ...source.matchAll(/from\s+["']([^"']+)["']/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);

    expect(specifiers.every((specifier) => !specifier.startsWith("node:"))).toBe(true);
    expect(specifiers.every((specifier) => specifier !== "crypto" && specifier !== "sqlite3" &&
      specifier !== "better-sqlite3" && !specifier.startsWith("better-sqlite3/"))).toBe(true);
    expect(specifiers.every((specifier) => !specifier.includes("/infrastructure/"))).toBe(true);
    expect(specifiers.every((specifier) => !/^\.\/city-selection(?:-application)?$/.test(specifier) &&
      !/(?:^|\/)application\/city-selection(?:-application)?$/.test(specifier) &&
      !/(?:^|\/)infrastructure\/(?:sqlite\/)?city-selection-store$/.test(specifier)))
      .toBe(true);
    expect(source).not.toMatch(/\b(?:CitySelectionApplication|createCitySelectionApplication)\b/);

    const compositionSource = readFileSync(
      new URL("../../src/infrastructure/city-frontier-composition.ts", import.meta.url),
      "utf8",
    );
    const compositionSpecifiers = [
      ...compositionSource.matchAll(/from\s+["']([^"']+)["']/g),
      ...compositionSource.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...compositionSource.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...compositionSource.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    expect(compositionSpecifiers).toContain("../application/city-selection");
    expect(compositionSpecifiers).toContain("./sqlite/city-selection-writer");
    expect(compositionSource).toMatch(/\bcreateCitySelectionApplication\b/);
    expect(compositionSource).toMatch(/\bSqliteCitySelectionWriter\b/);
  });

  test("composition rejects partial, open and hostile live-source configurations before database access", () => {
    // Break caught: constructing a half-configured HTTP adapter or falling through to a database first.
    let databaseTraps = 0;
    let accessorReads = 0;
    let atomicAccessorReads = 0;
    let configAccessorReads = 0;
    const database = new Proxy({}, {
      get() { databaseTraps += 1; throw new Error("database_must_not_run"); },
      ownKeys() { databaseTraps += 1; throw new Error("database_must_not_run"); },
    }) as Database.Database;
    const base = {
      database,
      hmacKey: "task-14-composition-key-at-least-32-bytes",
      resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
      profiles: {
        loadRelocationAnyVerified: NEVER,
        loadPreferenceForRankingVerified: NEVER,
      },
    };
    const accessor = { kind: "configured" } as MutableRecord;
    Object.defineProperty(accessor, "fixedRoutes", {
      enumerable: true,
      get() { accessorReads += 1; return {}; },
    });
    const fixedRoutes = {
      "si-city-long-term-rent": { inspect: NEVER },
      "si-city-urban-transit": { inspect: NEVER },
      "si-city-fixed-broadband": { inspect: NEVER },
    } satisfies CityFrontierFixedRoutePorts;
    const safetyDocuments = { inspect: NEVER } satisfies CitySafetyOfficialDocumentPort;
    const searchConfig = {
      endpoint: "https://search.example.test/city-safety",
      providerId: "configured-city-safety",
      timeoutMs: 4_000,
      maxResponseBytes: 65536 as const,
    };
    const searchRequest: CitySafetySearchHttpRequest = async () => {
      throw new Error("search_request_must_not_run");
    };
    const atomicAccessor = { config: searchConfig } as MutableRecord;
    Object.defineProperty(atomicAccessor, "request", {
      enumerable: true,
      get() { atomicAccessorReads += 1; return searchRequest; },
    });
    const openAtomicPair = { config: searchConfig, request: searchRequest, extra: true };
    const inheritedAtomicPair = Object.assign(Object.create({ inherited: true }), {
      config: searchConfig,
      request: searchRequest,
    });
    const accessorConfig = { ...searchConfig } as MutableRecord;
    Object.defineProperty(accessorConfig, "endpoint", {
      enumerable: true,
      get() {
        configAccessorReads += 1;
        return searchConfig.endpoint;
      },
    });
    const configured = {
      kind: "configured" as const,
      fixedRoutes,
      safetyDocuments,
    };
    const invalid: unknown[] = [
      { ...base, liveSources: { kind: "configured", fixedRoutes: {} } },
      { ...base, liveSources: { kind: "unconfigured", citySafetySearch: {} } },
      { ...base, liveSources: accessor },
      { ...base, liveSources: { kind: "unconfigured" }, extra: true },
      { ...base, liveSources: { ...configured, citySafetySearch: { config: searchConfig } } },
      { ...base, liveSources: { ...configured, citySafetySearch: { request: searchRequest } } },
      { ...base, liveSources: { ...configured, citySafetySearch: atomicAccessor } },
      { ...base, liveSources: { ...configured, citySafetySearch: openAtomicPair } },
      { ...base, liveSources: { ...configured, citySafetySearch: inheritedAtomicPair } },
      {
        ...base,
        liveSources: {
          ...configured,
          citySafetySearch: { config: accessorConfig, request: searchRequest },
        },
      },
    ];

    const factoryOffset = compositionHarness.applicationFactoryPorts.length;
    const httpOffset = compositionHarness.httpSearchFactoryArgs.length;
    const searchOffset = compositionHarness.searchPortFactoryArgs.length;
    const sourceFactoryOrderOffset = compositionHarness.sourceFactoryOrder.length;
    compositionHarness.enabled = true;
    try {
      for (const options of invalid) {
        const first = captureError(() => createCityFrontierComposition(
          options as CityFrontierCompositionOptions,
        ));
        const second = captureError(() => createCityFrontierComposition(
          options as CityFrontierCompositionOptions,
        ));
        expect(first.message).toBe("integrity_mismatch");
        expect(second.message).toBe("integrity_mismatch");
        expect(first).not.toBe(second);
      }
    } finally {
      compositionHarness.enabled = false;
    }
    expect(databaseTraps).toBe(0);
    expect(accessorReads).toBe(0);
    expect(atomicAccessorReads).toBe(0);
    expect(configAccessorReads).toBe(0);
    expect(compositionHarness.applicationFactoryPorts).toHaveLength(factoryOffset);
    expect(compositionHarness.httpSearchFactoryArgs).toHaveLength(httpOffset);
    expect(compositionHarness.searchPortFactoryArgs).toHaveLength(searchOffset);
    expect(compositionHarness.sourceFactoryOrder).toHaveLength(sourceFactoryOrderOffset);
  });

  test("descriptor-owns and closes the complete port graph before its first callback", () => {
    // Break caught: borrowing accessors/proxies or reading one method after another callback mutates it.
    let callbacks = 0;
    let accessorReads = 0;
    let proxyTraps = 0;
    const callback = (): never => { callbacks += 1; throw new Error("callback_must_not_run"); };
    const base = unavailablePorts(callback);
    const accessor = { ...base } as MutableRecord;
    Object.defineProperty(accessor, "clock", {
      enumerable: true,
      get() { accessorReads += 1; return () => new Date(); },
    });
    const symbol = Object.assign({ ...base }, { [Symbol("extra")]: true });
    const inherited = Object.assign(Object.create({ inherited: true }), base);
    const proxy = new Proxy({ ...base }, {
      ownKeys() { proxyTraps += 1; throw new Error("proxy_trap"); },
      getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("proxy_trap"); },
    });
    const candidates = [{ ...base, extra: true }, accessor, symbol, inherited, proxy];

    for (const candidate of candidates) {
      const first = captureError(() => createCityFrontierApplication(candidate as CityFrontierApplicationPorts));
      const second = captureError(() => createCityFrontierApplication(candidate as CityFrontierApplicationPorts));
      expect(first.message).toBe("integrity_mismatch");
      expect(second.message).toBe("integrity_mismatch");
      expect(first).not.toBe(second);
    }
    expect(callbacks).toBe(0);
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  test("rejects nested hostile port graphs and captures later methods before readiness reentrancy", async () => {
    // Break caught: validating only the outer DTO or borrowing findReady after resolveAvailability runs.
    let nestedAccessorReads = 0;
    let nestedProxyTraps = 0;
    let behaviorCalls = 0;
    const base = unavailablePorts(() => { behaviorCalls += 1; throw new Error("must_not_run"); });
    const accessorInstalled = { findExact: NEVER } as MutableRecord;
    Object.defineProperty(accessorInstalled, "findReady", {
      enumerable: true,
      get() { nestedAccessorReads += 1; return NEVER; },
    });
    const proxyInstalled = new Proxy({ findReady: NEVER, findExact: NEVER }, {
      ownKeys() { nestedProxyTraps += 1; throw new Error("nested_proxy_trap"); },
      getOwnPropertyDescriptor() { nestedProxyTraps += 1; throw new Error("nested_proxy_trap"); },
    });
    const accessorManifests = {} as MutableRecord;
    Object.defineProperty(accessorManifests, "loadVerified", {
      enumerable: true,
      get() { nestedAccessorReads += 1; return NEVER; },
    });
    const proxyManifests = new Proxy({ loadVerified: NEVER }, {
      ownKeys() { nestedProxyTraps += 1; throw new Error("nested_proxy_trap"); },
      getOwnPropertyDescriptor() { nestedProxyTraps += 1; throw new Error("nested_proxy_trap"); },
    });
    const malformed = [
      { ...base, installedPackages: accessorInstalled },
      { ...base, installedPackages: proxyInstalled },
      { ...base, installedPackages: { findReady: "not_callable", findExact: NEVER } },
      { ...base, installedPackageManifests: accessorManifests },
      { ...base, installedPackageManifests: proxyManifests },
      { ...base, installedPackageManifests: { loadVerified: "not_callable" } },
      { ...base, installedPackageManifests: { loadVerified: NEVER, latestVerified: NEVER } },
      { ...base, profiles: { loadRelocationAnyVerified: NEVER } },
    ];

    for (const candidate of malformed) {
      expect(captureError(() => createCityFrontierApplication(
        candidate as unknown as CityFrontierApplicationPorts,
      )).message).toBe("integrity_mismatch");
    }
    expect(nestedAccessorReads).toBe(0);
    expect(nestedProxyTraps).toBe(0);
    expect(behaviorCalls).toBe(0);

    const current = getCityResearchPackageAvailability("SI")!;
    const ready = {
      definition: structuredClone(current.definition),
      sourceContractStatus: "bounded_verified_or_unknown" as const,
      readiness: { status: "ready" as const, issues: [] as const },
    };
    let originalFindReadyCalls = 0;
    const captured = unavailablePorts() as unknown as MutableRecord;
    const borrowedInstalled = {
      findReady: () => { originalFindReadyCalls += 1; return undefined; },
      findExact: NEVER,
    };
    captured.installedPackages = borrowedInstalled;
    captured.resolveAvailability = () => {
      borrowedInstalled.findReady = () => { throw new Error("swapped_find_ready"); };
      return ready;
    };
    const assembly = createCityFrontierApplication(captured as unknown as CityFrontierApplicationPorts);
    const error = requireError(await assembly.application.presentCityFrontierSetup({
      resolvedCountryShortlistRevisionId: "resolved:one",
      countryCode: "SI",
    }).catch((caught: unknown) => caught));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("city_package_not_installed");
    expect(originalFindReadyCalls).toBe(1);

    const fixture = await withInfrastructurePlanGateReadAsync(() =>
      syntheticAuthorityFixture());
    let originalManifestCalls = 0;
    const manifestCapturePorts = unavailablePorts() as unknown as MutableRecord;
    const borrowedManifests = {
      loadVerified: (key: InstalledCityPackageExactKey) => {
        originalManifestCalls += 1;
        return withInfrastructurePlanGateRead(() => fixture.manifestStore.loadVerified(key));
      },
    };
    manifestCapturePorts.installedPackageManifests = borrowedManifests;
    manifestCapturePorts.installedPackages = {
      findReady: () => fixture.installed,
      findExact: NEVER,
    };
    manifestCapturePorts.latestInstalledCatalog = {
      latestInstalledVerified: () => fixture.catalog,
    };
    manifestCapturePorts.decisionIntegrity = DECISION_INTEGRITY;
    manifestCapturePorts.evidenceIntegrity = EVIDENCE_INTEGRITY;
    manifestCapturePorts.resolveAvailability = () => {
      borrowedManifests.loadVerified = () => { throw new Error("swapped_manifest_load"); };
      return fixture.ready;
    };
    const manifestCaptureAssembly = createCityFrontierApplication(
      manifestCapturePorts as unknown as CityFrontierApplicationPorts,
    );
    const manifestCaptureError = requireError(await manifestCaptureAssembly.application.presentCityFrontierSetup({
      resolvedCountryShortlistRevisionId: fixture.resolved.id,
      countryCode: "SI",
    }).catch((caught: unknown) => caught));
    expect(manifestCaptureError).toBeInstanceOf(Error);
    expect(manifestCaptureError.message).not.toBe("swapped_manifest_load");
    expect(originalManifestCalls).toBe(1);
  });

  test("uses the captured readiness port first and fails Setup and Start with the exact current issues", async () => {
    // Break caught: direct-calling the imported readiness function or touching persistence/source ports first.
    const current = getCityResearchPackageAvailability("SI");
    const currentAgain = getCityResearchPackageAvailability("SI");
    const expected = {
      definition: current?.definition,
      sourceContractStatus: "bounded_verified_or_unknown",
      readiness: {
        status: "not_ready",
        issues: [
          "catalog_v2_projection_unsealed",
          "registry_coordinates_unsealed",
          "per_member_source_plan_artifacts_unsealed",
          "criteria_policy_unapproved",
        ],
      },
    };
    expect(current).toEqual(expected);
    expect(currentAgain).toEqual(expected);
    expect(currentAgain).not.toBe(current);
    expect(currentAgain?.definition).not.toBe(current?.definition);
    expect(currentAgain?.readiness).not.toBe(current?.readiness);
    expect(currentAgain?.readiness.issues).not.toBe(current?.readiness.issues);
    recursivelyFrozen(current);
    recursivelyFrozen(currentAgain);

    const order: string[] = [];
    const never = (): never => { order.push("later_port"); throw new Error("later_port"); };
    const ports = unavailablePorts(never) as unknown as MutableRecord;
    ports.resolveAvailability = vi.fn((countryCode: string) => {
      order.push(`availability:${countryCode}`);
      return structuredClone(current);
    });
    const assembly = createCityFrontierApplication(ports as unknown as CityFrontierApplicationPorts);
    const setupError = requireError(await assembly.application.presentCityFrontierSetup({
      resolvedCountryShortlistRevisionId: "resolved:one",
      countryCode: "SI",
    }).catch((error: unknown) => error));
    const startError = requireError(await assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: "resolved:one",
      countryCode: "SI",
      criteriaDraft: structuredClone(VALID_DRAFT),
      commandId: "start:one",
    }).catch((error: unknown) => error));

    expect(setupError).toBeInstanceOf(Error);
    expect(startError).toBeInstanceOf(Error);
    expect(setupError.message).toBe("city_package_not_ready");
    expect(startError.message).toBe("city_package_not_ready");
    expect(setupError).not.toBe(startError);
    expect(order).toEqual(["availability:SI", "availability:SI"]);
    expect(ports.resolveAvailability).toHaveBeenCalledTimes(2);
  });

  test("distinguishes a ready-but-uninstalled package after the exact readiness callback", async () => {
    // Break caught: slash-form aliases or collapsing not-ready and not-installed into one error.
    const current = getCityResearchPackageAvailability("SI")!;
    const order: string[] = [];
    const ports = unavailablePorts() as unknown as MutableRecord;
    ports.resolveAvailability = () => {
      order.push("availability");
      return {
        definition: structuredClone(current.definition),
        sourceContractStatus: "bounded_verified_or_unknown",
        readiness: { status: "ready", issues: [] },
      };
    };
    ports.installedPackages = {
      findReady: () => { order.push("findReady"); return undefined; },
      findExact: NEVER,
    };
    const application = createCityFrontierApplication(
      ports as unknown as CityFrontierApplicationPorts,
    ).application;
    const error = requireError(await application.presentCityFrontierSetup({
      resolvedCountryShortlistRevisionId: "country-resolution:one",
      countryCode: "SI",
    }).catch((caught: unknown) => caught));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("city_package_not_installed");
    expect(error.message).not.toBe("city/package/not-installed");
    expect(order).toEqual(["availability", "findReady"]);
  });

  test("rejects open or executable Start and Prepare DTOs before readiness or persistence", async () => {
    // Break caught: allowing clients to smuggle run/package/fact/time authority or evaluating accessors.
    let callbacks = 0;
    let accessorReads = 0;
    let proxyTraps = 0;
    const ports = unavailablePorts(() => { callbacks += 1; throw new Error("must_not_run"); });
    const application = createCityFrontierApplication(ports).application;
    const accessor = {
      resolvedCountryShortlistRevisionId: "country-resolution:one",
      countryCode: "SI",
      criteriaDraft: structuredClone(VALID_DRAFT),
      commandId: "start:one",
    } as MutableRecord;
    Object.defineProperty(accessor, "commandId", {
      enumerable: true,
      get() { accessorReads += 1; return "start:one"; },
    });
    const proxy = new Proxy({
      runId: `city-frontier:${DIGEST}`,
      expectedRevisionId: `city-frontier-revision:${DIGEST}`,
      commandId: "continue:one",
    }, {
      ownKeys() { proxyTraps += 1; throw new Error("dto_proxy"); },
      getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("dto_proxy"); },
    });
    const startCandidates = [
      {
        resolvedCountryShortlistRevisionId: "country-resolution:one",
        countryCode: "SI",
        criteriaDraft: structuredClone(VALID_DRAFT),
        commandId: "start:one",
        runId: `city-frontier:${DIGEST}`,
      },
      accessor,
    ];
    for (const candidate of startCandidates) {
      const first = requireError(await application.startCityFrontier(candidate as unknown as StartCityFrontierInput)
        .catch((caught: unknown) => caught));
      const second = requireError(await application.startCityFrontier(candidate as unknown as StartCityFrontierInput)
        .catch((caught: unknown) => caught));
      expect(first.message).toBe("integrity_mismatch");
      expect(second.message).toBe("integrity_mismatch");
      expect(first).not.toBe(second);
    }
    const prepareError = requireError(await application.prepareCityFrontierContinuation(
      proxy as PrepareCityFrontierContinuationInput,
    ).catch((caught: unknown) => caught));
    expect(prepareError.message).toBe("integrity_mismatch");
    expect(callbacks).toBe(0);
    expect(accessorReads).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  test("derives Setup and Start from the verified package/profile graph and presents without sources", async () => {
    // Break caught: accepting caller package/run/time authority or projecting a structural root before semantic reload.
    const harness = await syntheticApplicationHarness();
    const trustedManifest = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        harness.fixture.installed.installedPackageManifest.key,
      ))!;
    const expectedEarlyAuthorityValues = [
      manifestPayload(trustedManifest),
      ...administrativeArtifactValues(harness.fixture.installed),
    ];
    const expectedAuthorityCanonicals = expectedEarlyAuthorityValues.map((value) =>
      EVIDENCE_INTEGRITY.canonical(value));
    const expectedEvidenceSentinels = expectedAuthorityCanonicals.map((value) =>
      `evidence-authority:${value}`);
    harness.state.discriminateEvidenceAuthority(expectedEarlyAuthorityValues);
    expect(Reflect.ownKeys(harness.assembly)).toEqual(["application", "selectionAuthority"]);
    expect(Reflect.ownKeys(harness.assembly.application)).toEqual([
      "presentCityFrontierSetup",
      "startCityFrontier",
      "prepareCityFrontierContinuation",
      "continueCityFrontier",
      "continueCityFrontierWithSourceRecovery",
      "presentCityFrontier",
    ]);
    expect(Reflect.ownKeys(harness.assembly.selectionAuthority)).toEqual([
      "loadCurrentTerminalSelectionAuthority",
    ]);
    expect(Reflect.ownKeys(harness.assembly.application)).not.toContain("selectionAuthority");
    expect(Reflect.ownKeys(harness.capabilities.installedPackageManifests)).toEqual([
      "loadVerified",
    ]);
    expect(harness.capabilities.installedPackageManifests).not.toBe(harness.fixture.manifestStore);
    recursivelyFrozen(harness.capabilities.installedPackageManifests);
    recursivelyFrozen(harness.assembly);
    const setup = await harness.assembly.application.presentCityFrontierSetup({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
    });
    expect(Reflect.ownKeys(setup)).toEqual([
      "resolvedCountryShortlistRevisionId",
      "countryCode",
      "profileSnapshotId",
      "preferenceProfileSnapshotId",
      "resolvedCountryEntry",
      "installedPackageContext",
      "registryRevisionId",
      "catalogMemberCount",
      "catalogCoverage",
      "criterionDefinitions",
      "criteriaDraft",
    ]);
    expect(setup).toMatchObject({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      profileSnapshotId: harness.fixture.relocation.id,
      preferenceProfileSnapshotId: harness.fixture.preference.id,
      installedPackageContext: harness.fixture.installed.installedPackageManifest.key,
      registryRevisionId: harness.fixture.catalog.registry.id,
      catalogMemberCount: harness.fixture.catalog.catalog.members.length,
      catalogCoverage: harness.fixture.catalog.catalog.coverage,
      criteriaDraft: DERIVED_V1_DRAFT,
    });
    recursivelyFrozen(setup);
    expect(harness.calls.catalogReads).toEqual(["catalog.latest:SI"]);
    expect(harness.calls.authorityOrder).toEqual(["catalog.latest:SI", "manifest.exact"]);
    expect(harness.calls.manifestKeys).toHaveLength(1);
    expect(harness.calls.manifestKeys[0]).toBe(setup.installedPackageContext);
    expect(harness.calls.manifestResults).toHaveLength(1);
    const setupManifest = harness.calls.manifestResults[0] as InstalledCityPackageManifest;
    expectManifestAuthority(
      setupManifest,
      setup.installedPackageContext,
      harness.fixture.installed.installedPackageManifest.id,
    );
    recursivelyNotAliased(
      setupManifest,
      withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(setup.installedPackageContext)),
    );
    expect(manifestPayload(setupManifest)).toEqual(manifestPayload(trustedManifest));
    expect(expectedEarlyAuthorityValues).toHaveLength(
      harness.fixture.installed.catalog.members.length * 3 + 5,
    );
    expect(harness.calls.evidenceCanonicals.map(({ value }) => value))
      .toEqual(expectedEarlyAuthorityValues);
    expect(harness.calls.evidenceHashes.map(({ value }) => value))
      .toEqual(expectedEvidenceSentinels);
    expect(harness.calls.evidenceCanonicals.map(({ result }) => result))
      .toEqual(expectedEvidenceSentinels);
    expect(harness.calls.evidenceHashes.map(({ result }) => result))
      .toEqual(expectedAuthorityCanonicals.map((value) => EVIDENCE_INTEGRITY.hash(value)));
    expect(harness.calls.evidenceSigns).toEqual([]);
    expect(harness.calls.decisionCanonicals.length).toBeGreaterThan(0);
    expect(harness.calls.decisionHashes.some(({ value }) =>
      value.startsWith("decision-authority:") || value.startsWith("evidence-authority:")))
      .toBe(false);
    harness.calls.catalogReads.splice(0);
    harness.calls.reloads.splice(0);
    harness.calls.authorityOrder.splice(0);
    harness.calls.manifestKeys.splice(0);
    harness.calls.manifestResults.splice(0);
    harness.calls.evidenceCanonicals.splice(0);
    harness.calls.evidenceHashes.splice(0);
    harness.calls.evidenceSigns.splice(0);
    harness.calls.decisionCanonicals.splice(0);
    harness.calls.decisionHashes.splice(0);

    const first = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:task14",
    });
    const firstReloads = [...harness.calls.reloads];
    const firstCatalogReads = [...harness.calls.catalogReads];
    const firstAuthorityOrder = [...harness.calls.authorityOrder];
    const firstManifestKeys = [...harness.calls.manifestKeys];
    const firstManifestResults = [...harness.calls.manifestResults];
    const firstEvidenceCanonicals = [...harness.calls.evidenceCanonicals];
    const firstEvidenceHashes = [...harness.calls.evidenceHashes];
    const firstEvidenceSigns = [...harness.calls.evidenceSigns];
    const retry = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:task14",
    });
    const presentAOrderOffset = harness.calls.authorityOrder.length;
    const presentARankingOffset = harness.calls.rankingResults.length;
    const presentAKeyOffset = harness.calls.exactPackageKeys.length;
    const presentAManifestOffset = harness.calls.manifestKeys.length;
    const presentedA = await harness.assembly.application.presentCityFrontier(first.runId);
    const presentAOrder = harness.calls.authorityOrder.slice(presentAOrderOffset);
    const presentBOrderOffset = harness.calls.authorityOrder.length;
    const presentBRankingOffset = harness.calls.rankingResults.length;
    const presentBKeyOffset = harness.calls.exactPackageKeys.length;
    const presentBManifestOffset = harness.calls.manifestKeys.length;
    const presentedB = await harness.assembly.application.presentCityFrontier(first.runId);
    const presentBOrder = harness.calls.authorityOrder.slice(presentBOrderOffset);

    expect(first).toEqual(retry);
    expect(first).toEqual(presentedA);
    expect(presentedA).toEqual(presentedB);
    expect(first).not.toBe(retry);
    expect(presentedA).not.toBe(presentedB);
    recursivelyFrozen(first);
    recursivelyFrozen(retry);
    recursivelyFrozen(presentedA);
    recursivelyFrozen(presentedB);
    expect(first.catalog).toEqual(harness.fixture.catalog.catalog);
    expect(first.selections).toEqual([]);
    expect(first.selections).not.toBe(retry.selections);
    expect(retry.selections).not.toBe(presentedA.selections);
    expect(presentedA.selections).not.toBe(presentedB.selections);
    expect(Object.isFrozen(first.selections)).toBe(true);
    expect(first.criteria.confirmedAt).toBe(START_AT);
    expect(first.ranking.assessmentAt).toBe(START_AT);
    expect(first.ranking.createdAt).toBe(START_AT);
    expect(first.revision.createdAt).toBe(START_AT);
    expect(harness.calls.publications[0]!.preCityBranch.createdAt).toBe(PARENT_AT);
    expect(harness.calls.publications[0]!.preCitySource).toEqual({
      profileSnapshotId: harness.fixture.relocation.id,
      preferenceProfileSnapshotId: harness.fixture.preference.id,
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      resolvedCountryEntry: harness.fixture.resolved.resolvedEntries[0],
    });
    const persisted = harness.state.artifacts();
    expect(harness.calls.publications[0]!.criteria).not.toBe(persisted.criteria);
    expect(harness.calls.publications[0]!.preCityBranch).not.toBe(persisted.branch);
    expect(harness.calls.publications[0]!.ranking).not.toBe(persisted.ranking);
    expect(harness.calls.publications[0]!.root).not.toBe(persisted.root);
    expect(first.criteria).not.toBe(persisted.criteria);
    expect(first.ranking).not.toBe(persisted.ranking);
    expect(first.revision).not.toBe(persisted.root);
    expect(firstManifestKeys).toHaveLength(1);
    expect(DECISION_INTEGRITY.canonical(firstManifestKeys[0])).toBe(
      DECISION_INTEGRITY.canonical(first.ranking.installedPackageContext),
    );
    expect(firstManifestResults).toHaveLength(1);
    recursivelyNotAliased(setupManifest, firstManifestResults[0]);
    expectManifestAuthority(
      firstManifestResults[0] as InstalledCityPackageManifest,
      first.ranking.installedPackageContext,
      harness.fixture.installed.installedPackageManifest.id,
    );
    expect(firstEvidenceCanonicals.map(({ value }) => value)).toEqual([
      manifestPayload(firstManifestResults[0] as InstalledCityPackageManifest),
      ...administrativeArtifactValues(harness.fixture.installed),
    ]);
    expect(firstEvidenceHashes.map(({ value }) => value))
      .toEqual(expectedEvidenceSentinels);
    expect(firstEvidenceCanonicals.map(({ result }) => result)).toEqual(expectedEvidenceSentinels);
    expect(firstEvidenceHashes.map(({ result }) => result))
      .toEqual(expectedAuthorityCanonicals.map((value) => EVIDENCE_INTEGRITY.hash(value)));
    expect(firstEvidenceSigns).toEqual([]);
    expect(harness.calls.decisionHashes.some(({ value }) =>
      value.startsWith("decision-authority:") || value.startsWith("evidence-authority:")))
      .toBe(false);
    expect(firstCatalogReads).toEqual([
      "catalog.latest:SI",
      `catalog.historical:${first.catalog.id}`,
    ]);
    expect(firstReloads).toEqual([
      `criteria:${first.criteria.id}`,
      `branch:${first.preCityBranchCommitId}`,
      `ranking:${first.ranking.id}`,
      `frontier.chain:${first.runId}`,
      `frontier.command:${first.runId}:start:task14`,
    ]);
    expect(firstAuthorityOrder).toEqual([
      "catalog.latest:SI",
      "manifest.exact",
      ...harness.fixture.installed.catalog.members.map(({ cityId }) =>
        `knowledge.latest:${cityId}`),
      `criteria:${first.criteria.id}`,
      `branch:${first.preCityBranchCommitId}`,
      `ranking:${first.ranking.id}`,
      `catalog.historical:${first.catalog.id}`,
      `frontier.chain:${first.runId}`,
      `frontier.command:${first.runId}:start:task14`,
      `selection:${first.runId}`,
    ]);
    const expectedPresentOrder = [
      `frontier.chain:${first.runId}`,
      `ranking:${first.ranking.id}`,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${first.catalog.id}`,
      `criteria:${first.criteria.id}`,
      `branch:${first.preCityBranchCommitId}`,
    ];
    expect(presentAOrder).toEqual(expectedPresentOrder);
    expect(presentBOrder).toEqual(expectedPresentOrder);
    for (const [rankingOffset, keyOffset, manifestOffset] of [
      [presentARankingOffset, presentAKeyOffset, presentAManifestOffset],
      [presentBRankingOffset, presentBKeyOffset, presentBManifestOffset],
    ] as const) {
      const rankingResult = harness.calls.rankingResults[rankingOffset]!;
      const packageKey = harness.calls.exactPackageKeys[keyOffset]!;
      const manifestKey = harness.calls.manifestKeys[manifestOffset]!;
      expect(packageKey).toBe(rankingResult.installedPackageContext);
      expect(manifestKey).toBe(rankingResult.installedPackageContext);
      expectManifestAuthority(
        harness.calls.manifestResults[manifestOffset] as InstalledCityPackageManifest,
        manifestKey,
        harness.fixture.installed.installedPackageManifest.id,
      );
    }
    recursivelyNotAliased(
      harness.calls.manifestResults[presentAManifestOffset],
      harness.calls.manifestResults[presentBManifestOffset],
    );
    expect(harness.calls.source).toEqual([]);
    expect(harness.calls.selectionHistory).toEqual([
      first.runId,
      first.runId,
    ]);
    expect(harness.calls.clocks).toEqual([START_AT, START_AT]);
  });

  test("rejects drift independently in the granular writer result and authenticated reloads", async () => {
    // Break caught: projecting writer/candidate bytes directly or skipping cross-row reload equations.
    const scenarios: readonly SyntheticHarnessOptions[] = [
      { writerResultDrift: "criteria" },
      { writerResultDrift: "branch" },
      { writerResultDrift: "ranking" },
      { writerResultDrift: "root" },
      { reloadDrift: "criteria" },
      { reloadDrift: "branch" },
      { reloadDrift: "ranking" },
      { reloadDrift: "catalog" },
      { reloadDrift: "root" },
    ];
    for (const options of scenarios) {
      const harness = await syntheticApplicationHarness(options);
      const error = requireError(await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:drift:${options.writerResultDrift ?? options.reloadDrift}`,
      }).catch((caught: unknown) => caught));

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("integrity_mismatch");
      expect(harness.calls.publications).toHaveLength(1);
      expect(harness.calls.source).toEqual([]);
      expect(harness.calls.selectionHistory).toEqual([]);
      expect(harness.state.root()).toEqual(harness.calls.publications[0]!.root);
      expect(harness.state.root()).not.toBe(harness.calls.publications[0]!.root);
      if (options.writerResultDrift !== undefined) {
        expect(harness.calls.reloads).toEqual([]);
        expect(harness.calls.catalogReads).toEqual(["catalog.latest:SI"]);
        continue;
      }
      const artifacts = harness.state.artifacts();
      const reloadPrefixes = {
        criteria: [`criteria:${artifacts.criteria.id}`],
        branch: [
          `criteria:${artifacts.criteria.id}`,
          `branch:${artifacts.branch.id}`,
        ],
        ranking: [
          `criteria:${artifacts.criteria.id}`,
          `branch:${artifacts.branch.id}`,
          `ranking:${artifacts.ranking.id}`,
        ],
        catalog: [
          `criteria:${artifacts.criteria.id}`,
          `branch:${artifacts.branch.id}`,
          `ranking:${artifacts.ranking.id}`,
        ],
        root: [
          `criteria:${artifacts.criteria.id}`,
          `branch:${artifacts.branch.id}`,
          `ranking:${artifacts.ranking.id}`,
          `frontier.chain:${artifacts.root.runId}`,
        ],
      } as const;
      expect(harness.calls.reloads).toEqual(reloadPrefixes[options.reloadDrift!]);
      expect(harness.calls.catalogReads).toEqual(options.reloadDrift === "catalog" ||
        options.reloadDrift === "root"
        ? ["catalog.latest:SI", `catalog.historical:${artifacts.ranking.catalogRevisionId}`]
        : ["catalog.latest:SI"]);
    }
  });

  test("prepares only the current working head and classifies claimed-base drift narrowly", async () => {
    // Break caught: broad stale errors, loading Ranking during Prepare, or trusting a forged/cross-bound base.
    const harness = await syntheticApplicationHarness();
    const model = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:prepare",
    });
    harness.calls.rankingReads.splice(0);
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: model.runId,
      expectedRevisionId: model.revision.id,
      commandId: "continue:one",
    });
    expect(Reflect.ownKeys(prepared)).toEqual([
      "schemaVersion", "runId", "baseRevisionId", "rankingSnapshotId", "nextUncheckedRank", "commandId",
    ]);
    expect(prepared).toEqual({
      schemaVersion: "city-frontier-prepared@1",
      runId: model.runId,
      baseRevisionId: model.revision.id,
      rankingSnapshotId: model.ranking.id,
      nextUncheckedRank: 1,
      commandId: "continue:one",
    });
    recursivelyFrozen(prepared);
    expect(harness.calls.rankingReads).toEqual([]);

    const emit = vi.fn();
    for (const candidate of [
      { ...prepared, schemaVersion: "city-frontier-prepared@2" },
      { ...prepared, rankingSnapshotId: `city-ranking:${"7".repeat(64)}` },
      { ...prepared, nextUncheckedRank: 2 },
    ]) {
      const first = requireError(await harness.assembly.application.continueCityFrontier(
        candidate as CityFrontierPrepared,
        emit,
        new AbortController().signal,
      ).catch((caught: unknown) => caught));
      const second = requireError(await harness.assembly.application.continueCityFrontier(
        candidate as CityFrontierPrepared,
        emit,
        new AbortController().signal,
      ).catch((caught: unknown) => caught));
      expect(first.message).toBe("integrity_mismatch");
      expect(second.message).toBe("integrity_mismatch");
      expect(first).not.toBe(second);
    }
    expect(emit).not.toHaveBeenCalled();
    expect(harness.calls.source).toEqual([]);

    const marker = syntheticMarker();
    const successor = sealCityFrontierRevision({
      runId: model.runId,
      predecessorRevisionId: model.revision.id,
      rankingSnapshotId: model.ranking.id,
      markers: [marker],
      projection: {
        kind: "working",
        nextUncheckedRank: 2,
        selectableCityIds: [marker.cityId],
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId: "continue:winner",
        expectedHeadRevisionId: model.revision.id,
        cityId: marker.cityId,
        cityCheckRunId: `city-check:${"b".repeat(64)}`,
      },
      createdAt: "2026-08-25T12:00:20.000Z",
    }, DECISION_INTEGRITY);
    harness.state.replaceChain([model.revision, successor]);
    const crossRun = sealCityFrontierRevision({
      runId: `city-frontier:${"c".repeat(64)}`,
      rankingSnapshotId: model.ranking.id,
      markers: [],
      projection: { kind: "working", nextUncheckedRank: 1, selectableCityIds: [], phase: "verification_required" },
      operation: { kind: "start", commandId: "cross-run", criteriaPayloadHash: "d".repeat(64) },
      createdAt: START_AT,
    }, DECISION_INTEGRITY);
    const crossRanking = sealCityFrontierRevision({
      runId: model.runId,
      rankingSnapshotId: `city-ranking:${"e".repeat(64)}`,
      markers: [],
      projection: { kind: "working", nextUncheckedRank: 1, selectableCityIds: [], phase: "verification_required" },
      operation: { kind: "start", commandId: "cross-ranking", criteriaPayloadHash: "f".repeat(64) },
      createdAt: START_AT,
    }, DECISION_INTEGRITY);
    const forged = {
      ...structuredClone(model.revision),
      id: `city-frontier-revision:${"9".repeat(64)}`,
    } as CityFrontierRevision;
    harness.state.addRevision(crossRun);
    harness.state.addRevision(crossRanking);
    harness.state.addRevision(forged);

    const missingId = `city-frontier-revision:${"8".repeat(64)}`;
    const rows = [
      {
        key: "ancestor",
        baseRevisionId: model.revision.id,
        message: "stale_city_frontier_head",
      },
      { key: "missing", baseRevisionId: missingId, message: "integrity_mismatch" },
      { key: "cross-run", baseRevisionId: crossRun.id, message: "integrity_mismatch" },
      {
        key: "cross-ranking-adapter-return",
        baseRevisionId: crossRanking.id,
        message: "integrity_mismatch",
      },
      { key: "forged-adapter-return", baseRevisionId: forged.id, message: "integrity_mismatch" },
    ] as const;
    for (const row of rows) {
      const commandId = `continue:classification:${row.key}`;
      const expectedOrder = [
        `frontier.command:${model.runId}:${commandId}`,
        `frontier.head:${model.runId}`,
        `frontier.revision:${row.baseRevisionId}`,
      ];
      const beforeEffects = claimedBaseClassificationEffects(harness);
      const prepareReloadOffset = harness.calls.reloads.length;
      const prepareOrderOffset = harness.calls.authorityOrder.length;
      const prepareError = requireError(await harness.assembly.application.prepareCityFrontierContinuation({
        runId: model.runId,
        expectedRevisionId: row.baseRevisionId,
        commandId,
      }).catch((caught: unknown) => caught));
      expect(prepareError).toBeInstanceOf(Error);
      expect(prepareError.message).toBe(row.message);
      expect(harness.calls.reloads.slice(prepareReloadOffset)).toEqual(expectedOrder);
      expect(harness.calls.authorityOrder.slice(prepareOrderOffset)).toEqual(expectedOrder);

      const serverPrepared: CityFrontierPrepared = Object.freeze({
        schemaVersion: "city-frontier-prepared@1",
        runId: model.runId,
        baseRevisionId: row.baseRevisionId,
        rankingSnapshotId: model.ranking.id,
        nextUncheckedRank: model.revision.nextUncheckedRank,
        commandId,
      });
      expect(Reflect.ownKeys(serverPrepared)).toEqual([
        "schemaVersion",
        "runId",
        "baseRevisionId",
        "rankingSnapshotId",
        "nextUncheckedRank",
        "commandId",
      ]);
      const emit = vi.fn();
      const continueReloadOffset = harness.calls.reloads.length;
      const continueOrderOffset = harness.calls.authorityOrder.length;
      const continueError = requireError(await harness.assembly.application.continueCityFrontier(
        serverPrepared,
        emit,
        new AbortController().signal,
      ).catch((caught: unknown) => caught));
      expect(continueError).toBeInstanceOf(Error);
      expect(continueError.message).toBe(row.message);
      expect(continueError).not.toBe(prepareError);
      expect(harness.calls.reloads.slice(continueReloadOffset)).toEqual(expectedOrder);
      expect(harness.calls.authorityOrder.slice(continueOrderOffset)).toEqual(expectedOrder);
      expect(claimedBaseClassificationEffects(harness)).toEqual(beforeEffects);
      expect(emit).not.toHaveBeenCalled();
    }

    const nativeFailure = new Error("native_revision_loader_failure");
    const nativeId = `city-frontier-revision:${"7".repeat(64)}`;
    const nativeCommandId = "continue:classification:native";
    const nativeOrder = [
      `frontier.command:${model.runId}:${nativeCommandId}`,
      `frontier.head:${model.runId}`,
      `frontier.revision:${nativeId}`,
    ];
    harness.state.failRevisionLoad(nativeId, nativeFailure);
    const beforeNativeEffects = claimedBaseClassificationEffects(harness);
    const nativeEmit = vi.fn();
    const nativePrepared: CityFrontierPrepared = Object.freeze({
      schemaVersion: "city-frontier-prepared@1",
      runId: model.runId,
      baseRevisionId: nativeId,
      rankingSnapshotId: model.ranking.id,
      nextUncheckedRank: model.revision.nextUncheckedRank,
      commandId: nativeCommandId,
    });
    expect(Reflect.ownKeys(nativePrepared)).toEqual([
      "schemaVersion",
      "runId",
      "baseRevisionId",
      "rankingSnapshotId",
      "nextUncheckedRank",
      "commandId",
    ]);
    const nativeErrors: unknown[] = [];
    for (const boundary of ["prepare", "continue"] as const) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const error = boundary === "prepare"
        ? await harness.assembly.application.prepareCityFrontierContinuation({
            runId: model.runId,
            expectedRevisionId: nativeId,
            commandId: nativeCommandId,
          }).catch((caught: unknown) => caught)
        : await harness.assembly.application.continueCityFrontier(
            nativePrepared,
            nativeEmit,
            new AbortController().signal,
          ).catch((caught: unknown) => caught);
      nativeErrors.push(error);
      expect(error).toBe(nativeFailure);
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(nativeOrder);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(nativeOrder);
    }
    expect(nativeErrors).toEqual([nativeFailure, nativeFailure]);
    expect(claimedBaseClassificationEffects(harness)).toEqual(beforeNativeEffects);
    expect(nativeEmit).not.toHaveBeenCalled();
  });

  test("keeps a frozen run on exact installed package A after a real later B install", async () => {
    // Break caught: borrowing the current package or copying/rebuilding Ranking's exact lookup key.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:frozen-package-a",
    });
    const packageA = harness.fixture.installed;
    const packageB = await harness.fixture.installLaterPackage();
    expect(packageB.catalog.id).not.toBe(packageA.catalog.id);
    expect(packageB.fixedPlansByCityId.ljubljana![2]!.planId)
      .not.toBe(packageA.fixedPlansByCityId.ljubljana![2]!.planId);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findExact(packageA.installedPackageManifest.key))?.catalog)
      .toEqual(packageA.catalog);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findReady("SI"))?.catalog).toEqual(packageB.catalog);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.latestInstalledVerified("SI"))?.catalog)
      .toEqual(packageB.catalog);
    const manifestA = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        packageA.installedPackageManifest.key,
      ))!;
    const manifestB = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        packageB.installedPackageManifest.key,
      ))!;
    expectManifestAuthority(manifestA, packageA.installedPackageManifest.key,
      packageA.installedPackageManifest.id);
    expectManifestAuthority(manifestB, packageB.installedPackageManifest.key,
      packageB.installedPackageManifest.id);
    expect(manifestB.id).not.toBe(manifestA.id);

    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:frozen-package-a",
    });
    resetContinuationPreflightObservations(harness);
    harness.calls.rankingReads.splice(0);
    harness.calls.rankingResults.splice(0);
    harness.calls.catalogReads.splice(0);
    harness.calls.readyPackageCountries.splice(0);
    harness.calls.exactPackageKeys.splice(0);
    harness.calls.installedPackageResults.splice(0);
    harness.calls.manifestKeys.splice(0);
    harness.calls.manifestResults.splice(0);
    harness.calls.evidenceCanonicals.splice(0);
    harness.calls.evidenceHashes.splice(0);
    harness.calls.evidenceSigns.splice(0);
    harness.calls.fixedRouteInputs.splice(0);
    harness.calls.fixedRouteOutputs.splice(0);
    harness.calls.safetySearchInputs.splice(0);
    harness.calls.safetySearchOutputs.splice(0);
    harness.calls.safetyDocumentInputs.splice(0);
    harness.calls.safetyDocumentOutputs.splice(0);
    fixedRunnerHarness.inputs.splice(0);
    const events: CityFrontierEvent[] = [];
    const result = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        events.push(event);
      },
      new AbortController().signal,
    );

    expectPrivateSuccessfulTrace(events, result, started.revision.id, packageA);
    expect(harness.calls.exactPackageKeys).toHaveLength(1);
    expect(harness.calls.manifestKeys).toHaveLength(1);
    expect(harness.calls.rankingResults.length).toBeGreaterThan(0);
    const exactKey = harness.calls.exactPackageKeys[0]!;
    expect(exactKey).toBe(harness.calls.rankingResults[0]!.installedPackageContext);
    expect(harness.calls.manifestKeys[0]).toBe(harness.calls.rankingResults[0]!.installedPackageContext);
    expect(Reflect.ownKeys(exactKey)).toEqual([
      "countryCode",
      "packageId",
      "packageSchemaVersion",
      "catalogRevisionId",
      "evidenceRulesVersion",
    ]);
    recursivelyFrozen(exactKey);
    expect(DECISION_INTEGRITY.canonical(exactKey))
      .toBe(DECISION_INTEGRITY.canonical(packageA.installedPackageManifest.key));
    expect(DECISION_INTEGRITY.canonical(exactKey))
      .not.toBe(DECISION_INTEGRITY.canonical(packageB.installedPackageManifest.key));
    expect(harness.calls.readyPackageCountries).toEqual([]);
    expect(harness.calls.catalogReads.filter((value) => value.startsWith("catalog.latest:")))
      .toEqual([]);
    const historicalCatalogs = harness.calls.catalogReads.filter((value) =>
      value.startsWith("catalog.historical:"));
    expect(historicalCatalogs.length).toBeGreaterThan(0);
    expect(new Set(historicalCatalogs)).toEqual(new Set([
      `catalog.historical:${packageA.catalog.id}`,
    ]));
    expect(harness.calls.installedPackageResults).toHaveLength(1);
    expect(harness.calls.installedPackageResults[0]!.catalog.id).toBe(packageA.catalog.id);
    expect(harness.calls.manifestResults).toHaveLength(1);
    expectManifestAuthority(
      harness.calls.manifestResults[0] as InstalledCityPackageManifest,
      exactKey,
      packageA.installedPackageManifest.id,
    );
    expect(harness.calls.authorityOrder.slice(0, 6)).toEqual([
      `frontier.command:${started.runId}:continue:frozen-package-a`,
      `frontier.head:${started.runId}`,
      `ranking:${started.ranking.id}`,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${packageA.catalog.id}`,
    ]);

    const aFixedUrls = new Set(packageA.fixedPlansByCityId.ljubljana!.flatMap((plan) =>
      plan.routes.map(({ navigationUrl }) => navigationUrl)));
    const bFixedUrls = new Set(packageB.fixedPlansByCityId.ljubljana!.flatMap((plan) =>
      plan.routes.map(({ navigationUrl }) => navigationUrl)));
    const attemptedFixedUrls = harness.calls.fixedRouteInputs.map((value) =>
      (value as { readonly route: { readonly navigationUrl: string } }).route.navigationUrl);
    expect(attemptedFixedUrls.every((url) => aFixedUrls.has(url))).toBe(true);
    expect(attemptedFixedUrls.some((url) => bFixedUrls.has(url))).toBe(false);
    expect((fixedRunnerHarness.inputs as Array<CityFixedSourceRunInput<SloveniaCityFixedSourceId>>)
      .map(({ planId }) => planId)).toEqual(
      packageA.fixedPlansByCityId.ljubljana!.map(({ planId }) => planId),
    );
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect((harness.calls.safetyDocumentInputs[0] as { readonly candidateUrl: string }).candidateUrl)
      .toBe(packageA.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl);
    const sourceResults = DECISION_INTEGRITY.canonical({
      fixed: harness.calls.fixedRouteOutputs,
      safety: harness.calls.safetyDocumentOutputs,
      evidence: harness.calls.evidenceSeals,
    });
    expect(sourceResults).toContain(
      packageA.fixedPlansByCityId.ljubljana![2]!.routes[0]!.navigationUrl,
    );
    expect(sourceResults).not.toContain("/later");
  });

  test("rejects missing or drifted exact package results before historical authority", async () => {
    // Break caught: checking only the visible package key or falling through to current-package reads.
    const visibleFields = [
      "countryCode",
      "packageId",
      "packageSchemaVersion",
      "catalogRevisionId",
      "evidenceRulesVersion",
    ] as const satisfies readonly (keyof InstalledCityPackageExactKey)[];
    const rows = [
      { key: "missing", mode: "missing", message: "city_package_revision_not_installed" },
      ...visibleFields.map((visibleField) => ({
        key: `visible-${visibleField}`,
        mode: "visible-key-drift" as const,
        visibleField,
        message: "integrity_mismatch",
      })),
      { key: "hidden-manifest-key", mode: "hidden-key-drift", message: "integrity_mismatch" },
    ] as const;
    for (const row of rows) {
      const harness = await syntheticApplicationHarness();
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:exact-package:${row.key}`,
      });
      const packageB = await harness.fixture.installLaterPackage();
      expect(withInfrastructurePlanGateRead(() => harness.fixture.installedPackages.findExact(
        harness.fixture.installed.installedPackageManifest.key,
      ))?.catalog.id).toBe(harness.fixture.installed.catalog.id);
      expect(withInfrastructurePlanGateRead(() =>
        harness.fixture.installedPackages.findReady("SI"))?.catalog.id).toBe(packageB.catalog.id);
      const commandId = `continue:exact-package:${row.key}`;
      const beforePrepareEffects = exactPackageBoundaryEffects(harness);
      const beforePrepareExactKeys = harness.calls.exactPackageKeys.length;
      const beforePreparePackageResults = harness.calls.installedPackageResults.length;
      const beforePrepareManifestKeys = harness.calls.manifestKeys.length;
      const beforePrepareManifestResults = harness.calls.manifestResults.length;
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId,
      });
      expect(exactPackageBoundaryEffects(harness)).toEqual(beforePrepareEffects);
      expect(harness.calls.exactPackageKeys).toHaveLength(beforePrepareExactKeys);
      expect(harness.calls.installedPackageResults).toHaveLength(beforePreparePackageResults);
      expect(harness.calls.manifestKeys).toHaveLength(beforePrepareManifestKeys);
      expect(harness.calls.manifestResults).toHaveLength(beforePrepareManifestResults);
      harness.state.overrideExactPackageResult(
        row.mode,
        packageB,
        "visibleField" in row ? row.visibleField : undefined,
      );
      harness.calls.reloads.splice(0);
      harness.calls.authorityOrder.splice(0);
      harness.calls.rankingReads.splice(0);
      harness.calls.rankingResults.splice(0);
      harness.calls.catalogReads.splice(0);
      harness.calls.readyPackageCountries.splice(0);
      harness.calls.exactPackageKeys.splice(0);
      harness.calls.installedPackageResults.splice(0);
      harness.calls.manifestKeys.splice(0);
      harness.calls.manifestResults.splice(0);
      harness.calls.evidenceCanonicals.splice(0);
      harness.calls.evidenceHashes.splice(0);
      harness.calls.evidenceSigns.splice(0);
      harness.calls.flightIdentityCanonicals.splice(0);
      const beforeEffects = exactPackageBoundaryEffects(harness);
      const emit = vi.fn();
      const errors: Error[] = [];
      const expectedReloads = [
        `frontier.command:${started.runId}:${commandId}`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
      ];
      const expectedOrder = [...expectedReloads, "package.exact"];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const rankingOffset = harness.calls.rankingResults.length;
        const keyOffset = harness.calls.exactPackageKeys.length;
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emit,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe(row.message);
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
        const rankingResult = harness.calls.rankingResults[rankingOffset]!;
        const exactKey = harness.calls.exactPackageKeys[keyOffset]!;
        expect(exactKey).toBe(rankingResult.installedPackageContext);
        expect(Reflect.ownKeys(exactKey)).toEqual([
          "countryCode",
          "packageId",
          "packageSchemaVersion",
          "catalogRevisionId",
          "evidenceRulesVersion",
        ]);
        recursivelyFrozen(exactKey);
        expect(DECISION_INTEGRITY.canonical(exactKey)).toBe(
          DECISION_INTEGRITY.canonical(harness.fixture.installed.installedPackageManifest.key),
        );
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(exactPackageBoundaryEffects(harness)).toEqual(beforeEffects);
      expect(harness.calls.readyPackageCountries).toEqual([]);
      expect(harness.calls.catalogReads).toEqual([]);
      expect(emit).not.toHaveBeenCalled();
    }
  });

  test("rejects missing, malformed or misbound independent manifests before historical authority", async () => {
    // Break caught: trusting the lookup audit shell without loading its independently signed manifest.
    const rows = ["missing", "malformed", "alternate", "joint-forged"] as const;
    for (const mode of rows) {
      const harness = await syntheticApplicationHarness();
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:manifest-boundary:${mode}`,
      });
      const packageB = await harness.fixture.installLaterPackage();
      const manifestA = withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(
          harness.fixture.installed.installedPackageManifest.key,
        ))!;
      const manifestB = withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(
          packageB.installedPackageManifest.key,
        ))!;
      expectManifestAuthority(
        manifestB,
        packageB.installedPackageManifest.key,
        packageB.installedPackageManifest.id,
      );
      const commandId = `continue:manifest-boundary:${mode}`;
      const beforePrepareEffects = exactPackageBoundaryEffects(harness);
      const beforePrepareExactKeys = harness.calls.exactPackageKeys.length;
      const beforePreparePackageResults = harness.calls.installedPackageResults.length;
      const beforePrepareManifestKeys = harness.calls.manifestKeys.length;
      const beforePrepareManifestResults = harness.calls.manifestResults.length;
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId,
      });
      expect(exactPackageBoundaryEffects(harness)).toEqual(beforePrepareEffects);
      expect(harness.calls.exactPackageKeys).toHaveLength(beforePrepareExactKeys);
      expect(harness.calls.installedPackageResults).toHaveLength(beforePreparePackageResults);
      expect(harness.calls.manifestKeys).toHaveLength(beforePrepareManifestKeys);
      expect(harness.calls.manifestResults).toHaveLength(beforePrepareManifestResults);
      harness.state.overrideManifestResult(
        mode,
        mode === "alternate" ? manifestB : undefined,
      );
      resetContinuationPreflightObservations(harness);
      const beforeDownstream = manifestBoundaryDownstreamEffects(harness);
      const emit = vi.fn();
      const errors: Error[] = [];
      const expectedReloads = [
        `frontier.command:${started.runId}:${commandId}`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
      ];
      const expectedOrder = [...expectedReloads, "package.exact", "manifest.exact"];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const rankingOffset = harness.calls.rankingResults.length;
        const packageKeyOffset = harness.calls.exactPackageKeys.length;
        const manifestKeyOffset = harness.calls.manifestKeys.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emit,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
        const rankingResult = harness.calls.rankingResults[rankingOffset]!;
        const packageKey = harness.calls.exactPackageKeys[packageKeyOffset]!;
        const manifestKey = harness.calls.manifestKeys[manifestKeyOffset]!;
        expect(packageKey).toBe(rankingResult.installedPackageContext);
        expect(manifestKey).toBe(rankingResult.installedPackageContext);
        expect(Reflect.ownKeys(manifestKey)).toEqual([
          "countryCode",
          "packageId",
          "packageSchemaVersion",
          "catalogRevisionId",
          "evidenceRulesVersion",
        ]);
        recursivelyFrozen(manifestKey);
        const expectedIntegrityDelta = mode === "joint-forged" ? 1 : 0;
        expect(harness.calls.evidenceCanonicals.slice(canonicalOffset))
          .toHaveLength(expectedIntegrityDelta);
        expect(harness.calls.evidenceHashes.slice(hashOffset)).toHaveLength(expectedIntegrityDelta);
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
        if (mode === "joint-forged") {
          const canonicalCall = harness.calls.evidenceCanonicals[canonicalOffset]!;
          const hashCall = harness.calls.evidenceHashes[hashOffset]!;
          expect(canonicalCall.value).toEqual(manifestPayload(manifestA));
          expect(hashCall.value).toBe(canonicalCall.result);
          expect(hashCall.result).toBe(EVIDENCE_INTEGRITY.hash(canonicalCall.result));
        }
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(manifestBoundaryDownstreamEffects(harness)).toEqual(beforeDownstream);
      expect(harness.calls.readyPackageCountries).toEqual([]);
      expect(harness.calls.catalogReads).toEqual([]);
      expect(harness.calls.manifestResults).toHaveLength(mode === "missing" ? 0 : 2);
      expect(emit).not.toHaveBeenCalled();
    }

    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:manifest-boundary:native",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:manifest-boundary:native",
    });
    const nativeFailure = new Error("native_manifest_load_failure");
    harness.state.failManifestLoad(nativeFailure);
    resetContinuationPreflightObservations(harness);
    const beforeDownstream = manifestBoundaryDownstreamEffects(harness);
    const nativeErrors: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const orderOffset = harness.calls.authorityOrder.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        prepared,
        vi.fn(),
        new AbortController().signal,
      ).catch((error: unknown) => error);
      nativeErrors.push(caught);
      expect(caught).toBe(nativeFailure);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual([
        `frontier.command:${started.runId}:continue:manifest-boundary:native`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
        "package.exact",
        "manifest.exact",
      ]);
      expect(harness.calls.evidenceCanonicals.slice(canonicalOffset)).toEqual([]);
      expect(harness.calls.evidenceHashes.slice(hashOffset)).toEqual([]);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(nativeErrors).toEqual([nativeFailure, nativeFailure]);
    expect(manifestBoundaryDownstreamEffects(harness)).toEqual(beforeDownstream);
    expect(harness.calls.manifestResults).toEqual([]);
  });

  test("rejects a real later broadband plan substituted behind package A and manifest A", async () => {
    // Break caught: treating a structurally valid plan as authenticated without its manifest digest.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:manifest-plan-drift",
    });
    const packageA = harness.fixture.installed;
    const packageB = await harness.fixture.installLaterRouteOnlyPackage();
    const manifestA = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        packageA.installedPackageManifest.key,
      ))!;
    const manifestB = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        packageB.installedPackageManifest.key,
      ))!;
    const finalMember = packageA.catalog.members.at(-1)!;
    const planA = packageA.fixedPlansByCityId[finalMember.cityId]![2]!;
    const planB = packageB.fixedPlansByCityId[finalMember.cityId]![2]!;
    const bindingA = manifestA.fixedPlansByCityId[finalMember.cityId]![2]!;
    const bindingB = manifestB.fixedPlansByCityId[finalMember.cityId]![2]!;
    const digestA = EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(planA));
    const digestB = EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(planB));
    expect(bindingA.planArtifact.sha256).toBe(digestA);
    expect(bindingB.planArtifact.sha256).toBe(digestB);
    expect(digestB).not.toBe(digestA);
    expect(finalMember.cityId).toBe("maribor");
    expect(planA.sourceId).toBe("si-city-fixed-broadband");
    expect(planB.sourceId).toBe("si-city-fixed-broadband");
    const { routes: routesA, ...visiblePlanA } = structuredClone(planA);
    const { routes: routesB, ...visiblePlanB } = structuredClone(planB);
    expect(visiblePlanB).toEqual(visiblePlanA);
    expect(routesB).not.toEqual(routesA);

    const commandId = "continue:manifest-plan-drift";
    const beforePrepareEffects = exactPackageBoundaryEffects(harness);
    const beforePreparePackageKeys = harness.calls.exactPackageKeys.length;
    const beforePrepareManifestKeys = harness.calls.manifestKeys.length;
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId,
    });
    expect(exactPackageBoundaryEffects(harness)).toEqual(beforePrepareEffects);
    expect(harness.calls.exactPackageKeys).toHaveLength(beforePreparePackageKeys);
    expect(harness.calls.manifestKeys).toHaveLength(beforePrepareManifestKeys);
    harness.state.overrideFinalMemberBroadbandPlan(packageB);
    harness.state.discriminateEvidenceAuthority([planB]);
    resetContinuationPreflightObservations(harness);
    planGateHarness.fixed.splice(0);
    planGateHarness.directories.splice(0);
    planGateHarness.safetyPlans.splice(0);
    planGateHarness.definitionStructures.splice(0);
    planGateHarness.defaults.splice(0);
    planGateHarness.definitions.splice(0);
    planGateHarness.semanticEntries.splice(0);
    planGateHarness.beforeSemantic = undefined;
    planGateHarness.order.splice(0);
    const beforeDownstream = planGateDownstreamEffects(harness);
    const errors: Error[] = [];
    const expectedReloads = [
      `frontier.command:${started.runId}:${commandId}`,
      `frontier.head:${started.runId}`,
      `ranking:${started.ranking.id}`,
    ];
    const expectedAuthorityOrder = [
      ...expectedReloads,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${packageA.catalog.id}`,
    ];
    const expectedFixedOrder = packageA.catalog.members.flatMap(({ cityId }) => [
      `fixed:${cityId}:si-city-long-term-rent`,
      `fixed:${cityId}:si-city-urban-transit`,
      `fixed:${cityId}:si-city-fixed-broadband`,
    ]);
    const emit = vi.fn();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const packageKeyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const fixedOffset = planGateHarness.fixed.length;
      const fixedOrderOffset = planGateHarness.order.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const decisionHashOffset = harness.calls.decisionHashes.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        prepared,
        emit,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      errors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedAuthorityOrder);
      const rankingResult = harness.calls.rankingResults[rankingOffset]!;
      expect(harness.calls.exactPackageKeys[packageKeyOffset])
        .toBe(rankingResult.installedPackageContext);
      expect(harness.calls.manifestKeys[manifestKeyOffset])
        .toBe(rankingResult.installedPackageContext);
      expectManifestAuthority(
        harness.calls.manifestResults[manifestKeyOffset] as InstalledCityPackageManifest,
        rankingResult.installedPackageContext,
        manifestA.id,
      );
      expect(planGateHarness.order.slice(fixedOrderOffset)).toEqual(expectedFixedOrder);
      const attemptedPlans = planGateHarness.fixed.slice(fixedOffset).map(({ value }) => value);
      const expectedPlans = packageA.catalog.members.flatMap(({ cityId }) =>
        packageA.fixedPlansByCityId[cityId]!).slice();
      expectedPlans[expectedPlans.length - 1] = planB;
      expect(attemptedPlans).toEqual(expectedPlans);
      const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
      const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
      expect(canonicalCalls).toHaveLength(packageA.catalog.members.length * 3 + 1);
      expect(hashCalls).toHaveLength(canonicalCalls.length);
      const planBCanonicalCalls = canonicalCalls.filter(({ value }) =>
        EVIDENCE_INTEGRITY.canonical(value) === EVIDENCE_INTEGRITY.canonical(planB));
      expect(planBCanonicalCalls).toHaveLength(1);
      expect(planBCanonicalCalls[0]!.result).toBe(
        `evidence-authority:${EVIDENCE_INTEGRITY.canonical(planB)}`,
      );
      const planBHashCalls = hashCalls.filter(({ value }) =>
        value === planBCanonicalCalls[0]!.result);
      expect(planBHashCalls).toEqual([{
        value: planBCanonicalCalls[0]!.result,
        result: digestB,
      }]);
      expect(planBHashCalls[0]!.result).not.toBe(bindingA.planArtifact.sha256);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      expect(harness.calls.decisionHashes.slice(decisionHashOffset).some(({ value }) =>
        value.startsWith("decision-authority:") || value.startsWith("evidence-authority:")))
        .toBe(false);
    }
    expect(errors[0]).not.toBe(errors[1]);
    expect(planGateHarness.directories).toEqual([]);
    expect(planGateHarness.safetyPlans).toEqual([]);
    expect(planGateHarness.semanticEntries).toEqual([]);
    expect(planGateDownstreamEffects(harness)).toEqual(beforeDownstream);
    expect(harness.calls.readyPackageCountries).toEqual([]);
    expect(harness.calls.catalogReads.filter((value) => value.startsWith("catalog.latest:")))
      .toEqual([]);
    expect(harness.calls.source).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  test("rejects bounded final-member broadband structural and visible-binding drifts", async () => {
    // Break caught: authenticating the final tuple by digest alone or skipping one visible scalar.
    const cases = [
      {
        name: "route_closure",
        collideDigest: false,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          routes: plan.routes.map((route, index) => index === 0
            ? { ...structuredClone(route), extra: true }
            : structuredClone(route)),
        }),
      },
      {
        name: "route_url",
        collideDigest: false,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          routes: plan.routes.map((route, index) => index === 0
            ? { ...structuredClone(route), navigationUrl: `${route.navigationUrl}/drift` }
            : structuredClone(route)),
        }),
      },
      {
        name: "parser",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan), parserVersion: `${plan.parserVersion}:drift`,
        }),
      },
      {
        name: "rules",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan), rulesVersion: `${plan.rulesVersion}:drift`,
        }),
      },
      {
        name: "plan_id",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan), planId: `${plan.planId}:drift`,
        }),
      },
      {
        name: "city_id",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan), cityId: "ljubljana",
        }),
      },
      {
        name: "source_id",
        collideDigest: false,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          sourceId: "si-city-urban-transit",
          claimContract: {
            ...structuredClone(plan.claimContract),
            sourceId: "si-city-urban-transit",
          },
        }),
      },
      {
        name: "criterion_id",
        collideDigest: false,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          criterionId: "urban_transit",
          claimContract: {
            ...structuredClone(plan.claimContract),
            criterionId: "urban_transit",
          },
        }),
      },
      {
        name: "definition_id",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          definitionId: "broadband-drift@1",
          claimContract: {
            ...structuredClone(plan.claimContract),
            definitionId: "broadband-drift@1",
          },
        }),
      },
      {
        name: "claim_contract",
        collideDigest: true,
        mutate: (plan: CityFixedSourcePlan<"si-city-fixed-broadband">) => ({
          ...structuredClone(plan),
          claimContract: {
            ...structuredClone(plan.claimContract),
            scope: `${plan.claimContract.scope}:drift`,
          },
        }),
      },
    ] as const;

    for (const row of cases) {
      const earlyHarness = await syntheticApplicationHarness();
      const earlyPackage = earlyHarness.fixture.installed;
      const earlyManifest = withInfrastructurePlanGateRead(() =>
        earlyHarness.fixture.manifestStore.loadVerified(
          earlyPackage.installedPackageManifest.key,
        ))!;
      const earlyFinalMember = earlyPackage.catalog.members.at(-1)!;
      const earlyOriginal = earlyPackage.fixedPlansByCityId[earlyFinalMember.cityId]![2]!;
      const earlyMutated = freezeDeep(row.mutate(earlyOriginal));
      const earlyBinding = earlyManifest.fixedPlansByCityId[earlyFinalMember.cityId]![2]!;
      if (row.collideDigest) {
        earlyHarness.state.collideEvidenceDigest(
          earlyMutated,
          earlyBinding.planArtifact.sha256,
        );
      }
      earlyHarness.state.overrideFinalMemberBroadbandPlanValue(earlyMutated);
      resetContinuationPreflightObservations(earlyHarness);
      resetPlanGateObservations();
      const expectedEarlyPlans = earlyPackage.catalog.members.flatMap(({ cityId }) =>
        earlyPackage.fixedPlansByCityId[cityId]!).slice();
      expectedEarlyPlans[expectedEarlyPlans.length - 1] = earlyMutated as typeof earlyOriginal;
      const expectedEarlyFixedOrder = earlyPackage.catalog.members.flatMap(({ cityId }) => [
        `fixed:${cityId}:si-city-long-term-rent`,
        `fixed:${cityId}:si-city-urban-transit`,
        `fixed:${cityId}:si-city-fixed-broadband`,
      ]);
      const expectedEarlyCanonicalPrefix = [
        manifestPayload(earlyManifest),
        ...expectedEarlyPlans.slice(0, -1),
        ...(row.name === "route_url" ? [earlyMutated] : []),
      ];
      const earlyErrors: Error[] = [];
      const earlyActions = [
        () => earlyHarness.assembly.application.presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: earlyHarness.fixture.resolved.id,
          countryCode: "SI",
        }),
        () => earlyHarness.assembly.application.startCityFrontier({
          resolvedCountryShortlistRevisionId: earlyHarness.fixture.resolved.id,
          countryCode: "SI",
          criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
          commandId: `start:fixed-gate-early-${row.name}`,
        }),
      ];
      for (const [actionIndex, action] of earlyActions.entries()) {
        const orderOffset = earlyHarness.calls.authorityOrder.length;
        const fixedOffset = planGateHarness.fixed.length;
        const fixedOrderOffset = planGateHarness.order.length;
        const canonicalOffset = earlyHarness.calls.evidenceCanonicals.length;
        const hashOffset = earlyHarness.calls.evidenceHashes.length;
        const signOffset = earlyHarness.calls.evidenceSigns.length;
        const caught = await action().catch((error: unknown) => error);
        expect(caught, `${row.name}:${actionIndex}`).toBeInstanceOf(Error);
        const error = caught as Error;
        earlyErrors.push(error);
        expect(["integrity_mismatch", "invalid_city_fixed_plan"]).toContain(error.message);
        expect(earlyHarness.calls.authorityOrder.slice(orderOffset)).not.toContain(
          "semantic-verifier",
        );
        expect(planGateHarness.order.slice(fixedOrderOffset))
          .toHaveLength(expectedEarlyFixedOrder.length);
        expect(planGateHarness.fixed.slice(fixedOffset).map(({ value }) => value))
          .toEqual(expectedEarlyPlans);
        const canonicalCalls = earlyHarness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashCalls = earlyHarness.calls.evidenceHashes.slice(hashOffset);
        expect(canonicalCalls.map(({ value }) => value)).toEqual(expectedEarlyCanonicalPrefix);
        expect(hashCalls.map(({ value }) => value))
          .toEqual(canonicalCalls.map(({ result }) => result));
        expect(earlyHarness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      }
      expect(earlyErrors[0]).not.toBe(earlyErrors[1]);
      expect(earlyHarness.calls.forbiddenPrepareCallbacks.filter((value) =>
        value !== "availability")).toEqual([]);
      expect(earlyHarness.calls.forbiddenPrepareCallbacks).toEqual([
        "availability",
        "availability",
      ]);
      expect(planGateHarness.directories).toEqual([]);
      expect(planGateHarness.safetyPlans).toEqual([]);
      expect(planGateHarness.defaults).toEqual([]);
      expect(planGateHarness.definitions).toEqual([]);
      expect(planGateHarness.semanticEntries).toEqual([]);
      expect(earlyHarness.calls.reloads).toEqual([]);
      expect(earlyHarness.calls.rankingReads).toEqual([]);
      expect(earlyHarness.calls.selectionHistory).toEqual([]);
      expect(earlyHarness.fixture.policyCalls.evaluations).toEqual([]);
      expect(earlyHarness.calls.source).toEqual([]);
      expect(earlyHarness.calls.fixedRouteInputs).toEqual([]);
      expect(earlyHarness.calls.evidenceSeals).toEqual([]);
      expect(earlyHarness.calls.knowledgePublishes).toEqual([]);
      expect(earlyHarness.calls.appends).toEqual([]);
      expect(earlyHarness.calls.publications).toEqual([]);

      if (!["route_closure", "parser", "claim_contract"].includes(row.name)) continue;
      const harness = await syntheticApplicationHarness();
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:fixed-gate-${row.name}`,
      });
      const packageA = harness.fixture.installed;
      const manifestA = withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(
          packageA.installedPackageManifest.key,
        ))!;
      const finalMember = packageA.catalog.members.at(-1)!;
      const original = packageA.fixedPlansByCityId[finalMember.cityId]![2]!;
      const mutated = freezeDeep(row.mutate(original));
      const binding = manifestA.fixedPlansByCityId[finalMember.cityId]![2]!;
      if (row.collideDigest) {
        harness.state.collideEvidenceDigest(mutated, binding.planArtifact.sha256);
      }
      harness.state.overrideFinalMemberBroadbandPlanValue(mutated);
      const beforePrepareEffects = exactPackageBoundaryEffects(harness);
      const beforePreparePlanGate = planGateCounts();
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:fixed-gate-${row.name}`,
      });
      expect(exactPackageBoundaryEffects(harness)).toEqual(beforePrepareEffects);
      expect(planGateCounts()).toEqual(beforePreparePlanGate);
      resetContinuationPreflightObservations(harness);
      resetPlanGateObservations();
      const beforeDownstream = planGateDownstreamEffects(harness);
      const expectedReloads = [
        `frontier.command:${started.runId}:continue:fixed-gate-${row.name}`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
      ];
      const expectedAuthorityOrder = [
        ...expectedReloads,
        "package.exact",
        "manifest.exact",
        `catalog.historical:${packageA.catalog.id}`,
      ];
      const expectedPlans = packageA.catalog.members.flatMap(({ cityId }) =>
        packageA.fixedPlansByCityId[cityId]!).slice();
      expectedPlans[expectedPlans.length - 1] = mutated as typeof original;
      const expectedFixedOrder = packageA.catalog.members.flatMap(({ cityId }) => [
        `fixed:${cityId}:si-city-long-term-rent`,
        `fixed:${cityId}:si-city-urban-transit`,
        `fixed:${cityId}:si-city-fixed-broadband`,
      ]);
      const canonicalPrefix = [
        manifestPayload(manifestA),
        ...expectedPlans.slice(0, -1),
      ];
      const errors: Error[] = [];
      const emitted = vi.fn();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const fixedOffset = planGateHarness.fixed.length;
        const fixedOrderOffset = planGateHarness.order.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emitted,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(["integrity_mismatch", "invalid_city_fixed_plan"]).toContain(error.message);
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedAuthorityOrder);
        expect(planGateHarness.order.slice(fixedOrderOffset)).toEqual(
          expect.arrayContaining(expectedFixedOrder),
        );
        expect(planGateHarness.fixed.slice(fixedOffset).map(({ value }) => value))
          .toEqual(expectedPlans);
        const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
        expect(canonicalCalls.slice(0, canonicalPrefix.length).map(({ value }) => value))
          .toEqual(canonicalPrefix);
        expect(canonicalCalls).toHaveLength(canonicalPrefix.length);
        expect(hashCalls.map(({ value }) => value))
          .toEqual(canonicalCalls.map(({ result }) => result));
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(planGateHarness.directories).toEqual([]);
      expect(planGateHarness.safetyPlans).toEqual([]);
      expect(planGateHarness.defaults).toEqual([]);
      expect(planGateHarness.definitions).toEqual([]);
      expect(planGateHarness.semanticEntries).toEqual([]);
      expect(planGateDownstreamEffects(harness)).toEqual(beforeDownstream);
      expect(harness.calls.source).toEqual([]);
      expect(harness.calls.appends).toEqual([]);
      expect(emitted).not.toHaveBeenCalled();
    }
  });

  test("rejects bounded directory, safety, definitions and defaults authority drifts", async () => {
    // Break caught: stopping artifact verification after fixed tuples or trusting digest alone.
    for (const kind of ["directory", "safety", "definitions", "defaults"] as const) {
      const harness = await syntheticApplicationHarness();
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:singleton-gate-${kind}`,
      });
      const installed = harness.fixture.installed;
      const manifest = withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(
          installed.installedPackageManifest.key,
        ))!;
      let mutated: unknown;
      let expectedOrderTail: readonly string[];
      let canonicalEvidenceTail: readonly unknown[];
      let targetDigest: string;
      if (kind === "directory") {
        const { id: _id, ...payload } = structuredClone(installed.officialAuthorityDirectory);
        void _id;
        mutated = buildOfficialAuthorityDirectory({
          ...payload,
          publishers: payload.publishers.map((publisher, index) => index === 0
            ? { ...publisher, maxBytes: publisher.maxBytes + 1 }
            : publisher),
        }, DECISION_INTEGRITY);
        expectedOrderTail = ["directory"];
        canonicalEvidenceTail = [];
        targetDigest = manifest.safety.authorityDirectoryArtifact.sha256;
      } else if (kind === "safety") {
        mutated = buildCitySafetySourcePlan({
          catalog: installed.catalog,
          directory: installed.officialAuthorityDirectory,
          entries: installed.safetySourcePlan.entries.map((entry, memberIndex) => ({
            ...structuredClone(entry),
            configuredRoutes: entry.configuredRoutes.map((route, routeIndex) =>
              memberIndex === installed.safetySourcePlan.entries.length - 1 && routeIndex === 0
                ? { ...structuredClone(route), navigationUrl: `${route.navigationUrl}/drift` }
                : structuredClone(route)),
          })),
        }, DECISION_INTEGRITY);
        expectedOrderTail = ["directory", "safety-plan"];
        canonicalEvidenceTail = [];
        targetDigest = manifest.safety.sourcePlanArtifact.sha256;
      } else if (kind === "definitions") {
        mutated = freezeDeep(installed.criterionDefinitions.map((definition, index) => index === 0
          ? { ...structuredClone(definition), evaluatorVersion: `${definition.evaluatorVersion}:drift` }
          : structuredClone(definition)));
        expectedOrderTail = ["directory", "safety-plan", "definitions"];
        canonicalEvidenceTail = [
          installed.safetySourcePlan,
          installed.officialAuthorityDirectory,
          installed.criteriaDefaults,
          mutated,
        ];
        targetDigest = manifest.criteria.definitionsArtifact.sha256;
      } else {
        mutated = freezeDeep({
          ...structuredClone(installed.criteriaDefaults),
          mappingVersion: `${installed.criteriaDefaults.mappingVersion}:drift`,
        });
        expectedOrderTail = ["directory", "safety-plan", "definitions", "defaults"];
        canonicalEvidenceTail = [
          installed.safetySourcePlan,
          installed.officialAuthorityDirectory,
          mutated,
          installed.criterionDefinitions,
        ];
        targetDigest = manifest.criteria.defaultsArtifact.sha256;
      }
      expect(EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(mutated)))
        .not.toBe(targetDigest);

      const initialHarness = await syntheticApplicationHarness();
      expect(initialHarness.fixture.installed.installedPackageManifest.key)
        .toEqual(installed.installedPackageManifest.key);
      initialHarness.state.collideEvidenceDigest(mutated, targetDigest);
      initialHarness.state.overrideInstalledArtifactValue(kind, mutated);
      resetPlanGateObservations();
      const initialPlans = installed.catalog.members.flatMap(({ cityId }) =>
        installed.fixedPlansByCityId[cityId]!);
      const initialFixedOrder = installed.catalog.members.flatMap(({ cityId }) => [
        `fixed:${cityId}:si-city-long-term-rent`,
        `fixed:${cityId}:si-city-urban-transit`,
        `fixed:${cityId}:si-city-fixed-broadband`,
      ]);
      const initialCanonicalValues = [
        manifestPayload(manifest),
        ...initialPlans,
        ...canonicalEvidenceTail,
      ];
      const policyBeforeInitial = {
        evaluations: structuredClone(initialHarness.fixture.policyCalls.evaluations),
        values: structuredClone(initialHarness.fixture.policyCalls.values),
        sourcePeriods: structuredClone(initialHarness.fixture.policyCalls.sourcePeriods),
      };
      const initialErrors: Error[] = [];
      for (const action of [
        () => initialHarness.assembly.application.presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
        }),
        () => initialHarness.assembly.application.startCityFrontier({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
          criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
          commandId: `start:singleton-visible-${kind}`,
        }),
      ]) {
        const authorityOffset = initialHarness.calls.authorityOrder.length;
        const orderOffset = planGateHarness.order.length;
        const canonicalOffset = initialHarness.calls.evidenceCanonicals.length;
        const hashOffset = initialHarness.calls.evidenceHashes.length;
        const signOffset = initialHarness.calls.evidenceSigns.length;
        const caught = await action().catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        initialErrors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(initialHarness.calls.authorityOrder.slice(authorityOffset)).toEqual([
          "catalog.latest:SI",
          "manifest.exact",
        ]);
        expect(planGateHarness.order.slice(orderOffset)).toEqual(expect.arrayContaining([
          ...initialFixedOrder,
          ...expectedOrderTail,
        ]));
        const canonicals = initialHarness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashes = initialHarness.calls.evidenceHashes.slice(hashOffset);
        expect(canonicals.map(({ value }) => value)).toEqual(initialCanonicalValues);
        expect(hashes.map(({ value }) => value))
          .toEqual(canonicals.map(({ result }) => result));
        expect(initialHarness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      }
      expect(initialErrors[0]).not.toBe(initialErrors[1]);
      expect({
        evaluations: initialHarness.fixture.policyCalls.evaluations,
        values: initialHarness.fixture.policyCalls.values,
        sourcePeriods: initialHarness.fixture.policyCalls.sourcePeriods,
      }).toEqual(policyBeforeInitial);
      expect(planGateHarness.semanticEntries).toEqual([]);
      expect(initialHarness.calls.reloads).toEqual([]);
      expect(initialHarness.calls.rankingReads).toEqual([]);
      expect(initialHarness.calls.source).toEqual([]);
      expect(initialHarness.calls.publications).toEqual([]);
      expect(initialHarness.calls.appends).toEqual([]);

      harness.state.collideEvidenceDigest(mutated, targetDigest);
      harness.state.overrideInstalledArtifactValue(kind, mutated);
      const beforePrepareEffects = exactPackageBoundaryEffects(harness);
      const beforePreparePlanGate = planGateCounts();
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:singleton-gate-${kind}`,
      });
      expect(exactPackageBoundaryEffects(harness)).toEqual(beforePrepareEffects);
      expect(planGateCounts()).toEqual(beforePreparePlanGate);
      resetContinuationPreflightObservations(harness);
      resetPlanGateObservations();
      const beforeDownstream = planGateDownstreamEffects(harness);
      const expectedReloads = [
        `frontier.command:${started.runId}:continue:singleton-gate-${kind}`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
      ];
      const expectedAuthorityOrder = [
        ...expectedReloads,
        "package.exact",
        "manifest.exact",
        `catalog.historical:${installed.catalog.id}`,
      ];
      const expectedFixedOrder = installed.catalog.members.flatMap(({ cityId }) => [
        `fixed:${cityId}:si-city-long-term-rent`,
        `fixed:${cityId}:si-city-urban-transit`,
        `fixed:${cityId}:si-city-fixed-broadband`,
      ]);
      const expectedPlans = installed.catalog.members.flatMap(({ cityId }) =>
        installed.fixedPlansByCityId[cityId]!);
      const canonicalPrefix = [
        manifestPayload(manifest),
        ...expectedPlans,
        ...canonicalEvidenceTail,
      ];
      const errors: Error[] = [];
      const emitted = vi.fn();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const planOrderOffset = planGateHarness.order.length;
        const fixedOffset = planGateHarness.fixed.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emitted,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedAuthorityOrder);
        expect(planGateHarness.order.slice(planOrderOffset)).toEqual(expect.arrayContaining([
          ...expectedFixedOrder,
          ...expectedOrderTail,
        ]));
        expect(planGateHarness.fixed.slice(fixedOffset).map(({ value }) => value))
          .toEqual(expectedPlans);
        const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
        const expectedCanonicals = canonicalPrefix;
        expect(canonicalCalls.map(({ value }) => value)).toEqual(expectedCanonicals);
        expect(hashCalls.map(({ value }) => value))
          .toEqual(canonicalCalls.map(({ result }) => result));
        if (kind === "definitions" || kind === "defaults") {
          const mutatedIndex = expectedCanonicals.indexOf(mutated);
          expect(mutatedIndex).toBeGreaterThan(0);
          expect(canonicalCalls[mutatedIndex]!.value).toEqual(mutated);
          expect(hashCalls[mutatedIndex]!.result).toBe(targetDigest);
        }
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(planGateHarness.semanticEntries).toEqual([]);
      expect(planGateDownstreamEffects(harness)).toEqual(beforeDownstream);
      expect(harness.calls.source).toEqual([]);
      expect(harness.calls.appends).toEqual([]);
      expect(emitted).not.toHaveBeenCalled();
    }
  });

  test("requires the independent Evidence digest for every singleton artifact in initial and historical gates", async () => {
    // Break caught: reconstructing a valid singleton but never comparing its manifest artifact SHA.
    for (const kind of ([
      "safety",
      "directory",
      "defaults",
      "definitions",
    ] as const)) {
      const run = async (
        harness: SyntheticApplicationHarness,
        action: () => Promise<unknown>,
        expectedAuthority: readonly string[],
      ): Promise<Error> => {
        const installed = harness.fixture.installed;
        const manifest = withInfrastructurePlanGateRead(() =>
          harness.fixture.writerManifestStore.loadVerified(
            installed.installedPackageManifest.key,
          ))!;
        const plans = installed.catalog.members.flatMap(({ cityId }) =>
          installed.fixedPlansByCityId[cityId]!);
        const singletonValues = {
          directory: installed.officialAuthorityDirectory,
          safety: installed.safetySourcePlan,
          definitions: installed.criterionDefinitions,
          defaults: installed.criteriaDefaults,
        } as const;
        const target = singletonValues[kind];
        const expectedDigest = kind === "directory"
          ? manifest.safety.authorityDirectoryArtifact.sha256
          : kind === "safety"
            ? manifest.safety.sourcePlanArtifact.sha256
            : kind === "definitions"
              ? manifest.criteria.definitionsArtifact.sha256
              : manifest.criteria.defaultsArtifact.sha256;
        const wrongDigest = String(([
          "safety", "directory", "defaults", "definitions",
        ] as const).indexOf(kind) + 1).repeat(64);
        expect(wrongDigest).not.toBe(expectedDigest);
        harness.state.collideEvidenceDigest(target, wrongDigest);
        resetPlanGateObservations();
        const orderOffset = harness.calls.authorityOrder.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const fixedOffset = planGateHarness.fixed.length;
        const directoryOffset = planGateHarness.directories.length;
        const safetyOffset = planGateHarness.safetyPlans.length;
        const definitionsOffset = planGateHarness.definitions.length;
        const defaultsOffset = planGateHarness.defaults.length;
        const semanticOffset = planGateHarness.semanticEntries.length;
        const beforeDownstream = planGateDownstreamEffects(harness);
        const caught = await action().catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        expect(error.message).toBe("integrity_mismatch");
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedAuthority);
        expect(planGateHarness.fixed.slice(fixedOffset).map(({ value }) => value)).toEqual(plans);
        const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
        const singletonPrefix = {
          safety: [installed.safetySourcePlan],
          directory: [installed.safetySourcePlan, installed.officialAuthorityDirectory],
          defaults: [
            installed.safetySourcePlan,
            installed.officialAuthorityDirectory,
            installed.criteriaDefaults,
          ],
          definitions: [
            installed.safetySourcePlan,
            installed.officialAuthorityDirectory,
            installed.criteriaDefaults,
            installed.criterionDefinitions,
          ],
        }[kind];
        expect(canonicalCalls.map(({ value }) => value)).toEqual([
          manifestPayload(manifest),
          ...plans,
          ...singletonPrefix,
        ]);
        expect(hashCalls.map(({ value }) => value))
          .toEqual(canonicalCalls.map(({ result }) => result));
        expect(hashCalls.at(-1)).toEqual({
          value: canonicalCalls.at(-1)!.result,
          result: wrongDigest,
        });
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
        expect(planGateHarness.directories.slice(directoryOffset)).toHaveLength(1);
        expect(planGateHarness.safetyPlans.slice(safetyOffset)).toHaveLength(1);
        expect(planGateHarness.definitions.slice(definitionsOffset)).toEqual([]);
        expect(planGateHarness.defaults.slice(defaultsOffset)).toEqual([]);
        expect(planGateHarness.semanticEntries.slice(semanticOffset)).toEqual([]);
        const afterDownstream = planGateDownstreamEffects(harness);
        expect({
          ...afterDownstream,
          findReady: beforeDownstream.findReady,
          latestCatalogs: beforeDownstream.latestCatalogs,
          forbiddenCallbacks: beforeDownstream.forbiddenCallbacks,
        }).toEqual({
          ...beforeDownstream,
          findReady: beforeDownstream.findReady,
          latestCatalogs: beforeDownstream.latestCatalogs,
          forbiddenCallbacks: beforeDownstream.forbiddenCallbacks,
        });
        return error;
      };

      const initialHarness = await syntheticApplicationHarness();
      const setupError = await run(
        initialHarness,
        () => initialHarness.assembly.application.presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
        }),
        ["catalog.latest:SI", "manifest.exact"],
      );
      const startError = await run(
        initialHarness,
        () => initialHarness.assembly.application.startCityFrontier({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
          criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
          commandId: `start:singleton-digest-${kind}`,
        }),
        ["catalog.latest:SI", "manifest.exact"],
      );
      expect(setupError).not.toBe(startError);
      expect(initialHarness.calls.publications).toEqual([]);

      const historicalHarness = await syntheticApplicationHarness();
      const started = await historicalHarness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: historicalHarness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:singleton-digest-history-${kind}`,
      });
      const prepared = await historicalHarness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:singleton-digest-${kind}`,
      });
      const first = await run(
        historicalHarness,
        () => historicalHarness.assembly.application.continueCityFrontier(
          prepared,
          vi.fn(),
          new AbortController().signal,
        ),
        [
          `frontier.command:${started.runId}:continue:singleton-digest-${kind}`,
          `frontier.head:${started.runId}`,
          `ranking:${started.ranking.id}`,
          "package.exact",
          "manifest.exact",
          `catalog.historical:${started.catalog.id}`,
        ],
      );
      const second = await run(
        historicalHarness,
        () => historicalHarness.assembly.application.continueCityFrontier(
          prepared,
          vi.fn(),
          new AbortController().signal,
        ),
        [
          `frontier.command:${started.runId}:continue:singleton-digest-${kind}`,
          `frontier.head:${started.runId}`,
          `ranking:${started.ranking.id}`,
          "package.exact",
          "manifest.exact",
          `catalog.historical:${started.catalog.id}`,
        ],
      );
      expect(first).not.toBe(second);
      expect(historicalHarness.calls.source).toEqual([]);
      expect(historicalHarness.calls.appends).toEqual([]);
    }
  });

  test("rejects renamed member keys and sparse fixed tuples before any plan callback", async () => {
    // Break caught: checking tuple length/cardinality without exact map keys or array density.
    for (const shape of ["renamed-member", "sparse-tuple"] as const) {
      const malformedMap = (installed: InstalledCityResearchPackage): unknown => {
        const owned = structuredClone(installed.fixedPlansByCityId) as Record<string, unknown>;
        if (shape === "renamed-member") {
          owned.maribor_extra = owned.maribor;
          delete owned.maribor;
        } else {
          const sparse = [...(owned.maribor as readonly unknown[])];
          delete sparse[1];
          owned.maribor = sparse;
        }
        return owned;
      };
      const assertFailure = async (
        harness: SyntheticApplicationHarness,
        action: () => Promise<unknown>,
        expectedAuthority: readonly string[],
      ): Promise<Error> => {
        harness.state.overrideFixedPlansByCityIdValue(malformedMap(harness.fixture.installed));
        resetPlanGateObservations();
        const orderOffset = harness.calls.authorityOrder.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const publicationCount = harness.calls.publications.length;
        const appendCount = harness.calls.appends.length;
        const sourceCount = harness.calls.source.length;
        const caught = await action().catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        expect(error.message).toBe("integrity_mismatch");
        const observedAuthority = harness.calls.authorityOrder.slice(orderOffset);
        expect(observedAuthority).toEqual(expectedAuthority.slice(0, observedAuthority.length));
        const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
        const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
        expect(hashCalls.map(({ value }) => value))
          .toEqual(canonicalCalls.map(({ result }) => result));
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
        expect(planGateCounts()).toEqual({
          fixed: 0,
          directories: 0,
          safetyPlans: 0,
          definitionStructures: 0,
          defaults: 0,
          definitions: 0,
          semanticEntries: 0,
        });
        expect(harness.calls.source).toHaveLength(sourceCount);
        expect(harness.calls.appends).toHaveLength(appendCount);
        expect(harness.calls.publications).toHaveLength(publicationCount);
        return error;
      };

      const initialHarness = await syntheticApplicationHarness();
      const setup = await assertFailure(
        initialHarness,
        () => initialHarness.assembly.application.presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
        }),
        ["catalog.latest:SI", "manifest.exact"],
      );
      const start = await assertFailure(
        initialHarness,
        () => initialHarness.assembly.application.startCityFrontier({
          resolvedCountryShortlistRevisionId: initialHarness.fixture.resolved.id,
          countryCode: "SI",
          criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
          commandId: `start:member-map-${shape}`,
        }),
        ["catalog.latest:SI", "manifest.exact"],
      );
      expect(setup).not.toBe(start);

      const historicalHarness = await syntheticApplicationHarness();
      const started = await historicalHarness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: historicalHarness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:member-map-history-${shape}`,
      });
      const prepared = await historicalHarness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:member-map-${shape}`,
      });
      const expectedAuthority = [
        `frontier.command:${started.runId}:continue:member-map-${shape}`,
        `frontier.head:${started.runId}`,
        `ranking:${started.ranking.id}`,
        "package.exact",
        "manifest.exact",
        `catalog.historical:${started.catalog.id}`,
      ];
      const first = await assertFailure(
        historicalHarness,
        () => historicalHarness.assembly.application.continueCityFrontier(
          prepared,
          vi.fn(),
          new AbortController().signal,
        ),
        expectedAuthority,
      );
      const second = await assertFailure(
        historicalHarness,
        () => historicalHarness.assembly.application.continueCityFrontier(
          prepared,
          vi.fn(),
          new AbortController().signal,
        ),
        expectedAuthority,
      );
      expect(first).not.toBe(second);
    }
  });

  test("relies on the real Task 9 approved-defaults reader before Setup or Start", async () => {
    // Break caught: Application invents defaults after the real installed-package reader fails closed.
    for (const kind of ["missing", "mapping", "target", "mode", "importance"] as const) {
      const installDefaults = structuredClone({
        schemaVersion: "city-criteria-defaults@1",
        mappingVersion: "task14-defaults@1",
        criteria: VALID_DRAFT,
      } satisfies InstalledCityCriteriaDefaults) as {
        schemaVersion: "city-criteria-defaults@1";
        mappingVersion: string;
        criteria: [CityCriterionDraft, CityCriterionDraft, CityCriterionDraft, CityCriterionDraft];
      };
      if (kind === "mapping") installDefaults.mappingVersion = "task14-defaults-drift@1";
      if (kind === "target") installDefaults.criteria[3] = {
        ...installDefaults.criteria[3]!,
        target: "101",
      };
      if (kind === "mode") installDefaults.criteria[0] = {
        ...installDefaults.criteria[0]!,
        mode: "weighted",
      };
      if (kind === "importance") installDefaults.criteria[0] = {
        ...installDefaults.criteria[0]!,
        importance: 4,
      };
      const harness = await syntheticApplicationHarness({
        authorityFixtureOptions: {
          installDefaults,
          readerApproval: kind === "missing" ? "empty" : "canonical",
        },
      });
      const writerReady = withInfrastructurePlanGateRead(() =>
        harness.fixture.writerInstalledPackages.findReady("SI"))!;
      expect(writerReady.criteriaDefaults).toEqual(installDefaults);
      if (kind === "target") {
        expect(writerReady.evaluatorRegistry.fixed_broadband.canonicalizeTarget("101"))
          .toBe("101");
      }
      expect(withInfrastructurePlanGateRead(() =>
        harness.fixture.writerManifestStore.loadVerified(
          harness.fixture.installed.installedPackageManifest.key,
        ))).toBeDefined();
      const policyBefore = structuredClone(harness.fixture.policyCalls);
      resetPlanGateObservations();
      const expectedMessage = kind === "missing"
        ? "city_package_behavior_unavailable"
        : "integrity_mismatch";
      const errors: Error[] = [];
      const actions = [
        () => harness.assembly.application.presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
          countryCode: "SI",
        }),
        () => harness.assembly.application.startCityFrontier({
          resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
          countryCode: "SI",
          criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
          commandId: `start:approved-defaults-${kind}`,
        }),
      ];
      for (const action of actions) {
        const readyOffset = harness.calls.readyPackageCountries.length;
        const availabilityOffset = harness.calls.forbiddenPrepareCallbacks.length;
        const caught = await action().catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe(expectedMessage);
        expect(harness.calls.readyPackageCountries.slice(readyOffset)).toEqual(["SI"]);
        expect(harness.calls.forbiddenPrepareCallbacks.slice(availabilityOffset))
          .toEqual(["availability"]);
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(harness.calls.installedPackageResults).toEqual([]);
      expect(harness.calls.catalogReads).toEqual([]);
      expect(harness.calls.manifestKeys).toEqual([]);
      expect(harness.calls.reloads).toEqual([]);
      expect(harness.calls.rankingReads).toEqual([]);
      expect(harness.calls.publications).toEqual([]);
      expect(harness.calls.selectionHistory).toEqual([]);
      expect(harness.calls.clocks).toEqual([]);
      expect(harness.calls.deadlinePolicyDates).toEqual([]);
      expect(harness.calls.scheduledDeadlines).toEqual([]);
      expect(harness.calls.source).toEqual([]);
      expect(harness.calls.fixedRouteInputs).toEqual([]);
      expect(harness.calls.safetySearchInputs).toEqual([]);
      expect(harness.calls.safetyDocumentInputs).toEqual([]);
      expect(harness.calls.appends).toEqual([]);
      expect(harness.calls.evidenceSeals).toEqual([]);
      expect(harness.calls.knowledgePublishes).toEqual([]);
      expect(planGateCounts()).toEqual({
        fixed: 0,
        directories: 0,
        safetyPlans: 0,
        definitionStructures: 0,
        defaults: 0,
        definitions: 0,
        semanticEntries: 0,
      });
      expect(harness.fixture.policyCalls).toEqual(policyBefore);
    }
  });

  test("rejects invalid or unequal fixed deadlines before activation, flight or source work", async () => {
    // Break caught: validating deadline-policy results lazily inside one of the source runners.
    const nativeSentinel = new Error("native_deadline_policy_failure");
    let hostileReads = 0;
    let noncanonicalReads = 0;
    const rows = [
      {
        name: "non-date",
        expectedCalls: 1,
        output: (): unknown => ({ deadline: "borrowed" }),
      },
      {
        name: "invalid-date",
        expectedCalls: 1,
        output: (): unknown => new Date(Number.NaN),
      },
      {
        name: "hostile-date-proxy",
        expectedCalls: 1,
        output: (now: Date): unknown => new Proxy(
          new Date(now.valueOf() + 45_000),
          {
            get() {
              hostileReads += 1;
              throw new Error("hostile_deadline_read");
            },
          },
        ),
      },
      {
        name: "open-noncanonical-date",
        expectedCalls: 1,
        output: (now: Date): unknown => {
          const value = new Date(now.valueOf() + 45_000);
          Object.defineProperty(value, "toISOString", {
            configurable: true,
            enumerable: true,
            value: () => {
              noncanonicalReads += 1;
              return "2026-08-25T03:00:45+03:00";
            },
          });
          return value;
        },
      },
      {
        name: "nonfuture",
        expectedCalls: 1,
        output: (now: Date): unknown => new Date(now),
      },
      {
        name: "unequal-three",
        expectedCalls: 3,
        output: (now: Date, index: number): unknown =>
          new Date(now.valueOf() + 45_000 + (index === 1 ? 1 : 0)),
      },
      {
        name: "native-throw",
        expectedCalls: 1,
        output: (): never => { throw nativeSentinel; },
      },
    ] as const;

    for (const row of rows) {
      let policyIndex = 0;
      const harness = await syntheticApplicationHarness({
        fixedSourceDeadlineAt: (now) => row.output(now, policyIndex++),
      });
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:deadline-policy:${row.name}`,
      });
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:deadline-policy:${row.name}`,
      });
      resetContinuationPreflightObservations(harness);
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      const selectionOffset = harness.calls.selectionHistory.length;
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        policyIndex = 0;
        const deadlineOffset = harness.calls.deadlinePolicyDates.length;
        const clockOffset = harness.calls.clocks.length;
        const fixedRunnerOffset = fixedRunnerHarness.inputs.length;
        const fixedPromiseOffset = fixedRunnerHarness.promises.length;
        const safetyPromiseOffset = safetyRunnerHarness.promises.length;
        const genericOffset = genericSealHarness.calls;
        const publicationOffset = harness.calls.publications.length;
        const events: CityFrontierEvent[] = [];
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          (event: CityFrontierEvent) => { events.push(event); },
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        if (row.name === "native-throw") {
          expect(caught).toBe(nativeSentinel);
        } else {
          const error = caught as Error;
          errors.push(error);
          expect(error.message).toBe("integrity_mismatch");
        }
        const deadlineInputs = harness.calls.deadlinePolicyDates.slice(deadlineOffset);
        expect(deadlineInputs).toHaveLength(row.expectedCalls);
        expect(deadlineInputs.every((value) =>
          Object.getPrototypeOf(value) === Date.prototype &&
          Reflect.ownKeys(value).length === 0 && value.toISOString() === START_AT)).toBe(true);
        expect(new Set(deadlineInputs).size).toBe(row.expectedCalls);
        expect(harness.calls.clocks.slice(clockOffset)).toEqual([START_AT]);
        expect(events).toEqual([]);
        expect(harness.calls.source).toEqual([]);
        expect(harness.calls.scheduledDeadlines).toEqual([]);
        expect(fixedRunnerHarness.inputs).toHaveLength(fixedRunnerOffset);
        expect(fixedRunnerHarness.promises).toHaveLength(fixedPromiseOffset);
        expect(safetyRunnerHarness.promises).toHaveLength(safetyPromiseOffset);
        expect(harness.calls.fixedRouteInputs).toEqual([]);
        expect(harness.calls.safetySearchInputs).toEqual([]);
        expect(harness.calls.safetyDocumentInputs).toEqual([]);
        expect(harness.calls.flightIdentityCanonicals).toEqual([]);
        expect(harness.calls.evidenceSeals).toEqual([]);
        expect(harness.calls.knowledgePublishes).toEqual([]);
        expect(harness.calls.appends).toEqual([]);
        expect(genericSealHarness.calls).toBe(genericOffset);
        expect(harness.calls.publications).toHaveLength(publicationOffset);
        expect(harness.calls.selectionHistory).toHaveLength(selectionOffset);
        expect(harness.state.root()).toEqual(started.revision);
        expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
          .toEqual(databaseChanges);
      }
      if (row.name !== "native-throw") expect(errors[0]).not.toBe(errors[1]);
    }
    expect(hostileReads).toBe(0);
    expect(noncanonicalReads).toBe(0);
  });

  test("owns and validates each fixed runner clock sample while preserving native throws", async () => {
    // Break caught: passing a borrowed Date/clock through Research or normalizing its native failure.
    const nativeSentinel = new Error("native_runner_clock_failure");
    let hostileReads = 0;
    const rows = [
      { name: "non-date", result: (): unknown => "2026-08-25T00:00:00.001Z" },
      { name: "invalid-date", result: (): unknown => new Date(Number.NaN) },
      {
        name: "hostile-date-proxy",
        result: (): unknown => new Proxy(new Date("2026-08-25T00:00:00.001Z"), {
          get() {
            hostileReads += 1;
            throw new Error("hostile_runner_clock_read");
          },
        }),
      },
      { name: "native-throw", result: (): never => { throw nativeSentinel; } },
    ] as const;

    for (const row of rows) {
      let runnerClockCalls = 0;
      let deadlineCancelCalls = 0;
      const harness = await syntheticApplicationHarness({
        runnerNow: () => {
          runnerClockCalls += 1;
          return row.result();
        },
        fixedDeadlineScheduler: {
          schedule: () => ({ cancel: () => { deadlineCancelCalls += 1; } }),
        },
      });
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:runner-clock:${row.name}`,
      });
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:runner-clock:${row.name}`,
      });
      resetContinuationPreflightObservations(harness);
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      const errors: Error[] = [];
      const capturedNow: Array<() => string> = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const inputOffset = fixedRunnerHarness.inputs.length;
        const promiseOffset = fixedRunnerHarness.promises.length;
        const safetyPromiseOffset = safetyRunnerHarness.promises.length;
        const evidenceOffset = harness.calls.evidenceSeals.length;
        const knowledgeOffset = harness.calls.knowledgePublishes.length;
        const appendOffset = harness.calls.appends.length;
        const publicationOffset = harness.calls.publications.length;
        const genericOffset = genericSealHarness.calls;
        const fixedRouteOffset = harness.calls.fixedRouteInputs.length;
        const scheduledOffset = harness.calls.scheduledDeadlines.length;
        const cancelOffset = deadlineCancelCalls;
        const events: CityFrontierEvent[] = [];
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          (event: CityFrontierEvent) => {
            recursivelyFrozen(event);
            events.push(structuredClone(event));
          },
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        if (row.name === "native-throw") {
          expect(caught).toBe(nativeSentinel);
        } else {
          const error = caught as Error;
          errors.push(error);
          expect(error.message).toBe("invalid_city_fixed_clock");
          expect(error.stack).toContain("runCityFixedSourcePlan");
          expect(error.stack).not.toContain("fixedRunnerClockSample");
        }
        expect(fixedRunnerHarness.inputs.slice(inputOffset)).toHaveLength(3);
        const runnerInput = fixedRunnerHarness.inputs[inputOffset] as
          CityFixedSourceRunInput<SloveniaCityFixedSourceId>;
        capturedNow.push(runnerInput.now);
        expect(typeof runnerInput.now).toBe("function");
        expect(runnerInput.now).not.toBe(harness.capabilities.clock);
        expect(Object.values(runnerInput).some((value) => value instanceof Date)).toBe(false);
        expect(fixedRunnerHarness.promises).toHaveLength(promiseOffset + 3);
        await Promise.allSettled([
          ...fixedRunnerHarness.promises.slice(promiseOffset),
          ...safetyRunnerHarness.promises.slice(safetyPromiseOffset),
        ]);
        expect(events.map((event) => event.type)).toEqual([
          "city_activated",
          "city_progress",
          "city_progress",
          "city_progress",
          "city_progress",
        ]);
        expect(events.slice(1).map((event) => event.type === "city_progress"
          ? event.stage
          : "invalid")).toEqual([
          "source_started:si-city-safety",
          "source_started:si-city-long-term-rent",
          "source_started:si-city-urban-transit",
          "source_started:si-city-fixed-broadband",
        ]);
        expect(harness.calls.evidenceSeals).toHaveLength(evidenceOffset);
        expect(harness.calls.knowledgePublishes).toHaveLength(knowledgeOffset);
        expect(harness.calls.appends).toHaveLength(appendOffset);
        expect(harness.calls.publications).toHaveLength(publicationOffset);
        expect(genericSealHarness.calls).toBe(genericOffset);
        expect(harness.calls.fixedRouteInputs).toHaveLength(fixedRouteOffset);
        expect(harness.calls.scheduledDeadlines).toHaveLength(scheduledOffset + 3);
        expect(deadlineCancelCalls).toBe(cancelOffset + 3);
        expect(harness.state.root()).toEqual(started.revision);
        expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
          .toEqual(databaseChanges);
        const eventCount = events.length;
        await nextEventLoopTurn();
        expect(events).toHaveLength(eventCount);
      }
      expect(runnerClockCalls).toBe(6);
      expect(capturedNow).toHaveLength(2);
      expect(capturedNow[0]).not.toBe(capturedNow[1]);
      if (row.name !== "native-throw") expect(errors[0]).not.toBe(errors[1]);
    }
    expect(hostileReads).toBe(0);
  });

  test("aborts one never-settling fixed route at its deadline and retries the same command cleanly", async () => {
    // Break caught: completing deadline failures as unknown, leaking a flight, or leaving source work alive.
    interface ManualDeadlineRecord {
      readonly deadlineAt: string;
      readonly fire: () => void;
      cancelCalls: number;
      cancelEffects: number;
      callbackCalls: number;
      cancelled: boolean;
      fired: boolean;
    }
    const scheduleEntered = deferred<void>();
    const scheduleRecords: ManualDeadlineRecord[] = [];
    const scheduler: CityFixedDeadlineScheduler = {
      schedule(deadlineAt, onDeadline) {
        const record: ManualDeadlineRecord = {
          deadlineAt,
          cancelCalls: 0,
          cancelEffects: 0,
          callbackCalls: 0,
          cancelled: false,
          fired: false,
          fire() {
            if (record.cancelled || record.fired) return;
            record.fired = true;
            record.callbackCalls += 1;
            onDeadline();
          },
        };
        scheduleRecords.push(record);
        if (scheduleRecords.length === 3) scheduleEntered.resolve(undefined);
        return {
          cancel() {
            record.cancelCalls += 1;
            if (!record.cancelled) {
              record.cancelled = true;
              record.cancelEffects += 1;
            }
          },
        };
      },
    };
    const harness = await syntheticApplicationHarness({
      blockFixedBroadbandRoute: true,
      fixedDeadlineScheduler: scheduler,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:fixed-deadline",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:fixed-deadline",
    });
    resetSemanticGateObservations(harness);
    planGateHarness.beforeSemantic = () => ({
      evidenceCanonicals: structuredClone(harness.calls.evidenceCanonicals),
      evidenceHashes: structuredClone(harness.calls.evidenceHashes),
      evidenceSigns: structuredClone(harness.calls.evidenceSigns),
    });
    const databaseChanges = harness.fixture.database.prepare(
      "SELECT total_changes() AS count",
    ).get();
    const caller = new AbortController();
    const events: CityFrontierEvent[] = [];
    const continuation = harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        events.push(structuredClone(event));
      },
      caller.signal,
    );
    let publicSettled = false;
    const handled = continuation.then(
      (value: CityFrontierReadModel) => {
        publicSettled = true;
        return { kind: "fulfilled" as const, value };
      },
      (error: unknown) => {
        publicSettled = true;
        return { kind: "rejected" as const, error };
      },
    );
    const entryBarrier = Promise.all([
      harness.gates.researchEntered,
      harness.gates.allResearchSignalsEntered,
      scheduleEntered.promise,
    ]);
    let sharedSignals: AbortSignal[] = [];
    let privateSignal: AbortSignal | undefined;
    let failureError: Error | undefined;
    let failedEventCount = -1;
    let failedEvidenceFindCount = -1;
    let failedReplayPackageCount = -1;
    let rawRouteSettled = false;
    try {
      await awaitBarrierOrEarlySettlement(entryBarrier, [continuation]);
      expect(publicSettled).toBe(false);
      expect(fixedRunnerHarness.inputs).toHaveLength(3);
      expect(fixedRunnerHarness.promises).toHaveLength(3);
      expect(safetyRunnerHarness.promises).toHaveLength(1);
      const fixedInputs = fixedRunnerHarness.inputs as Array<
        CityFixedSourceRunInput<SloveniaCityFixedSourceId>
      >;
      expect(fixedInputs.map(({ sourceId }) => sourceId)).toEqual([
        "si-city-long-term-rent",
        "si-city-urban-transit",
        "si-city-fixed-broadband",
      ]);
      expect(scheduleRecords.map(({ deadlineAt }) => deadlineAt)).toEqual(
        fixedInputs.map(({ deadlineAt }) => deadlineAt),
      );
      const broadbandIndex = fixedInputs.findIndex(({ sourceId }) =>
        sourceId === "si-city-fixed-broadband");
      expect(broadbandIndex).toBeGreaterThanOrEqual(0);
      await Promise.allSettled([
        ...fixedRunnerHarness.promises.filter((_promise, index) => index !== broadbandIndex),
        ...safetyRunnerHarness.promises,
      ]);
      expect(harness.calls.gatedFixedRouteInputs).toHaveLength(1);
      const blockedInput = harness.calls.gatedFixedRouteInputs[0] as {
        readonly routeIndex: number;
        readonly route: CityFixedSourcePlan<"si-city-fixed-broadband">["routes"][number];
        readonly signal: AbortSignal;
      };
      expect(blockedInput.routeIndex).toBe(0);
      expect(blockedInput.route).toEqual(
        harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!.routes[0],
      );
      privateSignal = blockedInput.signal;
      sharedSignals = capturedResearchSignals(harness);
      expect(sharedSignals).toHaveLength(7);
      expect(new Set(sharedSignals).size).toBe(1);
      expect(sharedSignals[0]).not.toBe(caller.signal);
      expect(privateSignal).not.toBe(sharedSignals[0]);
      expect(sharedSignals.every(({ aborted }) => !aborted)).toBe(true);
      expect(privateSignal.aborted).toBe(false);
      const activeRecords = scheduleRecords.filter(({ cancelEffects }) => cancelEffects === 0);
      expect(activeRecords).toHaveLength(1);
      const target = activeRecords[0]!;
      expect(scheduleRecords.indexOf(target)).toBe(broadbandIndex);
      expect(target.cancelCalls).toBe(0);
      expect(harness.calls.gatedFixedRoutePromises).toHaveLength(1);
      void harness.calls.gatedFixedRoutePromises[0]!.then(
        () => { rawRouteSettled = true; },
        () => { rawRouteSettled = true; },
      );
      await Promise.resolve();
      expect(rawRouteSettled).toBe(false);
      failedEvidenceFindCount = harness.calls.authorityOrder.filter((value) =>
        value.startsWith("evidence.find:")).length;
      failedReplayPackageCount = harness.calls.forbiddenPrepareCallbacks.filter((value) =>
        value === "evidence-replay-package").length;
      target.fire();
      target.fire();
      expect(target.callbackCalls).toBe(1);
      expect(privateSignal.aborted).toBe(true);
      expect(privateSignal.reason).toBeInstanceOf(Error);
      expect((privateSignal.reason as Error).message).toBe("city_fixed_deadline");
      harness.gates.releaseResearch();
      const outcome = await handled;
      expect(outcome.kind).toBe("rejected");
      if (outcome.kind !== "rejected") throw new Error("expected_deadline_rejection");
      expect(outcome.error).toBeInstanceOf(Error);
      failureError = outcome.error as Error;
      expect(failureError.message).toBe("city_fixed_deadline");
      expectOpaqueSharedAbort(sharedSignals, failureError);
      expect(privateSignal.aborted).toBe(true);
      expect(privateSignal.reason).toBeInstanceOf(Error);
      expect((privateSignal.reason as Error).message).toBe("city_fixed_deadline");
      expect(caller.signal.aborted).toBe(false);
      expect(scheduleRecords.every(({ cancelCalls, cancelEffects, cancelled }) =>
        cancelCalls >= 1 && cancelEffects === 1 && cancelled)).toBe(true);
      target.fire();
      expect(target.callbackCalls).toBe(1);
      expect(planGateHarness.semanticEntries).toHaveLength(1);
      const baselineKnowledge: readonly CityKnowledgeRankingProjection[] =
        harness.fixture.installed.catalog.members.map(({ cityId }) => ({
          cityId,
          knowledgeRevisionId: null,
          facts: [] as const,
        }));
      expectSemanticGateEntry(harness, planGateHarness.semanticEntries[0]!, {
        criteria: started.criteria,
        ranking: started.ranking,
        root: started.revision,
        knowledge: baselineKnowledge,
      }, harness.calls.rankingResults[0]!);
      expect(events.slice(0, 5).map(({ type }) => type)).toEqual([
        "city_activated",
        "city_progress",
        "city_progress",
        "city_progress",
        "city_progress",
      ]);
      expect(events.slice(1, 5).map((event) => event.type === "city_progress"
        ? event.stage
        : "invalid")).toEqual([
        "source_started:si-city-safety",
        "source_started:si-city-long-term-rent",
        "source_started:si-city-urban-transit",
        "source_started:si-city-fixed-broadband",
      ]);
      expect(events).toHaveLength(5);
      expect(events.map(({ sequence }) => sequence)).toEqual(
        Array.from({ length: events.length }, (_value, index) => index + 1),
      );
      expect(events.some((event) => event.type === "city_progress" && [
        "source_completed:si-city-fixed-broadband",
        "evidence_verified",
        "knowledge_published",
      ].includes(event.stage))).toBe(false);
      expect(events.some(({ type }) => type === "city_revision_committed" ||
        type === "city_continuation_completed")).toBe(false);
      expect(harness.calls.authorityOrder.filter((value) =>
        value.startsWith("evidence.find:")).length).toBe(failedEvidenceFindCount);
      expect(harness.calls.forbiddenPrepareCallbacks.filter((value) =>
        value === "evidence-replay-package").length).toBe(failedReplayPackageCount);
      expect(genericSealHarness.calls).toBe(0);
      expect(harness.calls.evidenceSeals).toEqual([]);
      expect(harness.calls.knowledgePublishes).toEqual([]);
      expect(harness.calls.appends).toEqual([]);
      expect(harness.calls.selectionHistory).toEqual([]);
      expect(harness.state.root()).toEqual(started.revision);
      expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
        .toEqual(databaseChanges);
      failedEventCount = events.length;
    } finally {
      harness.gates.releaseResearch();
      if (!publicSettled) caller.abort(new Error("test_cleanup"));
      await Promise.allSettled([
        continuation,
        handled,
        ...harness.calls.gatedFixedRoutePromises,
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ]);
      await nextEventLoopTurn();
    }
    expect(failureError?.message).toBe("city_fixed_deadline");
    expect(rawRouteSettled).toBe(true);
    expect(failedEventCount).toBe(5);
    expect(events).toHaveLength(5);
    expect(genericSealHarness.calls).toBe(0);
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
    expect(harness.calls.selectionHistory).toEqual([]);
    expect(harness.calls.authorityOrder.filter((value) =>
      value.startsWith("evidence.find:")).length).toBe(failedEvidenceFindCount);
    expect(harness.calls.forbiddenPrepareCallbacks.filter((value) =>
      value === "evidence-replay-package").length).toBe(failedReplayPackageCount);
    expect(harness.state.root()).toEqual(started.revision);
    expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
      .toEqual(databaseChanges);

    const retryEventCount = events.length;
    const fixedInputOffset = fixedRunnerHarness.inputs.length;
    const fixedPromiseOffset = fixedRunnerHarness.promises.length;
    const safetyPromiseOffset = safetyRunnerHarness.promises.length;
    const scheduleOffset = scheduleRecords.length;
    const routeOffset = harness.calls.fixedRouteInputs.length;
    const safetySearchOffset = harness.calls.safetySearchInputs.length;
    const safetyDocumentOffset = harness.calls.safetyDocumentInputs.length;
    const evidenceOffset = harness.calls.evidenceSeals.length;
    const knowledgeOffset = harness.calls.knowledgePublishes.length;
    const appendOffset = harness.calls.appends.length;
    const flightOffset = harness.calls.flightIdentityCanonicals.length;
    const retryEvents: CityFrontierEvent[] = [];
    const retryCaller = new AbortController();
    const retryContinuation = harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { retryEvents.push(structuredClone(event)); },
      retryCaller.signal,
    );
    let retrySettled = false;
    const retryHandled = retryContinuation.then(
      (value: CityFrontierReadModel) => {
        retrySettled = true;
        return { kind: "fulfilled" as const, value };
      },
      (error: unknown) => {
        retrySettled = true;
        return { kind: "rejected" as const, error };
      },
    );
    let retryResult: CityFrontierReadModel | undefined;
    try {
      const retryOutcome = await retryHandled;
      expect(retryOutcome.kind).toBe("fulfilled");
      if (retryOutcome.kind === "fulfilled") retryResult = retryOutcome.value;
    } finally {
      if (!retrySettled) retryCaller.abort(new Error("test_retry_cleanup"));
      await Promise.allSettled([
        retryContinuation,
        retryHandled,
        ...fixedRunnerHarness.promises.slice(fixedPromiseOffset),
        ...safetyRunnerHarness.promises.slice(safetyPromiseOffset),
      ]);
      await nextEventLoopTurn();
    }
    if (retryResult === undefined) throw new Error("expected_healthy_deadline_retry");
    expectPrivateSuccessfulTrace(
      retryEvents,
      retryResult,
      started.revision.id,
      harness.fixture.installed,
    );
    expect(events).toHaveLength(retryEventCount);
    expect(fixedRunnerHarness.inputs.slice(fixedInputOffset)).toHaveLength(3);
    expect(fixedRunnerHarness.promises.slice(fixedPromiseOffset)).toHaveLength(3);
    expect(safetyRunnerHarness.promises.slice(safetyPromiseOffset)).toHaveLength(1);
    expect(scheduleRecords.slice(scheduleOffset)).toHaveLength(3);
    expect(scheduleRecords.slice(scheduleOffset).every(({
      cancelCalls,
      cancelEffects,
      callbackCalls,
      cancelled,
      fired,
    }) => cancelCalls >= 1 && cancelEffects === 1 && callbackCalls === 0 && cancelled && !fired))
      .toBe(true);
    expect(harness.calls.fixedRouteInputs.length - routeOffset).toBe(5);
    expect(harness.calls.safetySearchInputs.length - safetySearchOffset).toBe(3);
    expect(harness.calls.safetyDocumentInputs.length - safetyDocumentOffset).toBe(1);
    expect(harness.calls.evidenceSeals.length - evidenceOffset).toBe(1);
    expect(harness.calls.knowledgePublishes.length - knowledgeOffset).toBe(1);
    expect(harness.calls.appends.length - appendOffset).toBe(1);
    expect(harness.calls.flightIdentityCanonicals.length - flightOffset).toBe(1);
    const retrySignals = [
      ...(fixedRunnerHarness.inputs.slice(fixedInputOffset) as Array<
        CityFixedSourceRunInput<SloveniaCityFixedSourceId>
      >).map(({ signal }) => signal),
      ...harness.calls.safetySearchInputs.slice(safetySearchOffset).map((value) =>
        (value as { readonly signal: AbortSignal }).signal),
      ...harness.calls.safetyDocumentInputs.slice(safetyDocumentOffset).map((value) =>
        (value as { readonly signal: AbortSignal }).signal),
    ];
    expect(retrySignals).toHaveLength(7);
    expect(new Set(retrySignals).size).toBe(1);
    expect(retrySignals[0]).not.toBe(sharedSignals[0]);
    expect(retrySignals[0]).not.toBe(retryCaller.signal);
    expect(retrySignals.every(({ aborted }) => !aborted)).toBe(true);
    expect(retryResult.revision.markers).toHaveLength(1);
  });

  test("buffers authentic parallel source results and emits their completions in canonical order", async () => {
    // Break caught: broadcasting completion frames from physical Promise completion callbacks.
    const harness = await syntheticApplicationHarness({
      gateFinalResearchResults: true,
      discriminatingClock: true,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:reverse-source-completion",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:reverse-source-completion",
    });
    resetSemanticGateObservations(harness);
    planGateHarness.beforeSemantic = () => ({
      evidenceCanonicals: structuredClone(harness.calls.evidenceCanonicals),
      evidenceHashes: structuredClone(harness.calls.evidenceHashes),
      evidenceSigns: structuredClone(harness.calls.evidenceSigns),
    });
    const caller = new AbortController();
    const events: CityFrontierEvent[] = [];
    const continuation = harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        events.push(structuredClone(event));
      },
      caller.signal,
    );
    let publicSettled = false;
    void continuation.then(
      () => { publicSettled = true; },
      () => { publicSettled = true; },
    );
    const releaseOrder: readonly GatedResearchSourceId[] = [
      "si-city-fixed-broadband",
      "si-city-urban-transit",
      "si-city-long-term-rent",
      "si-city-safety",
    ];
    const runnerSettlementOrder: GatedResearchSourceId[] = [];
    let result: CityFrontierReadModel | undefined;
    try {
      await awaitBarrierOrEarlySettlement(
        harness.gates.allFinalResearchResultsEntered,
        [continuation],
      );
      expect(publicSettled).toBe(false);
      expect(new Set(harness.calls.finalResearchResultsEntered)).toEqual(new Set([
        "si-city-safety",
        "si-city-long-term-rent",
        "si-city-urban-transit",
        "si-city-fixed-broadband",
      ]));
      expect(harness.calls.finalResearchResultsEntered).toHaveLength(4);
      expect(harness.calls.finalResearchResultsReturned).toEqual([]);
      expect(fixedRunnerHarness.inputs).toHaveLength(3);
      expect(fixedRunnerHarness.promises).toHaveLength(3);
      expect(safetyRunnerHarness.promises).toHaveLength(1);
      const fixedPromises = new Map(
        (fixedRunnerHarness.inputs as Array<
          CityFixedSourceRunInput<SloveniaCityFixedSourceId>
        >).map(({ sourceId }, index) => [sourceId, fixedRunnerHarness.promises[index]!] as const),
      );
      for (const [sourceId, promise] of fixedPromises) {
        void promise.then(
          () => { runnerSettlementOrder.push(sourceId); },
          () => { runnerSettlementOrder.push(sourceId); },
        );
      }
      void safetyRunnerHarness.promises[0]!.then(
        () => { runnerSettlementOrder.push("si-city-safety"); },
        () => { runnerSettlementOrder.push("si-city-safety"); },
      );
      expect(events.map(({ type }) => type)).toEqual([
        "city_activated",
        "city_progress",
        "city_progress",
        "city_progress",
        "city_progress",
      ]);
      expect(events.slice(1).map((event) => event.type === "city_progress"
        ? event.stage
        : "invalid")).toEqual([
        "source_started:si-city-safety",
        "source_started:si-city-long-term-rent",
        "source_started:si-city-urban-transit",
        "source_started:si-city-fixed-broadband",
      ]);
      for (const sourceId of releaseOrder) {
        harness.gates.releaseFinalResearchResult(sourceId);
        const promise = sourceId === "si-city-safety"
          ? safetyRunnerHarness.promises[0]!
          : fixedPromises.get(sourceId)!;
        await promise;
        expect(runnerSettlementOrder).toEqual(releaseOrder.slice(
          0,
          releaseOrder.indexOf(sourceId) + 1,
        ));
        expect(harness.calls.finalResearchResultsReturned).toEqual(releaseOrder.slice(
          0,
          releaseOrder.indexOf(sourceId) + 1,
        ));
        if (sourceId !== "si-city-safety") {
          expect(publicSettled).toBe(false);
          expect(events).toHaveLength(5);
        }
      }
      result = await continuation;
    } finally {
      for (const sourceId of releaseOrder) harness.gates.releaseFinalResearchResult(sourceId);
      if (!publicSettled) caller.abort(new Error("test_reverse_completion_cleanup"));
      await Promise.allSettled([
        continuation,
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ]);
    }
    if (result === undefined) throw new Error("expected_reverse_completion_result");
    expect(runnerSettlementOrder).toEqual(releaseOrder);
    expect(harness.calls.finalResearchResultsReturned).toEqual(releaseOrder);
    expectPrivateSuccessfulTrace(
      events,
      result,
      started.revision.id,
      harness.fixture.installed,
    );
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
    expect(harness.calls.selectionHistory).toHaveLength(1);
    expect(result.revision).toEqual(harness.calls.appends[0]);
    expect(harness.state.root()).toEqual(result.revision);
    const marker = result.revision.markers.at(-1)!;
    const evidence = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(marker.evidenceSnapshotId));
    const knowledge = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.loadVerified(marker.knowledgeRevisionId));
    recursivelyFrozen(evidence);
    recursivelyFrozen(knowledge);
    expect(evidence.snapshot.id).toBe(marker.evidenceSnapshotId);
    expect(knowledge.id).toBe(marker.knowledgeRevisionId);
    expect(knowledge.evidenceSnapshotId).toBe(evidence.snapshot.id);
  });

  test("keeps malformed and native fixed-route failures private and leaves no durable residue", async () => {
    // Break caught: normalizing native errors, leaking provider text, or publishing partial source results.
    const hostileProtocolOutput = freezeDeep({
      kind: "verified",
      provider_query: "provider_query_secret",
      snippet: "snippet_secret",
      credential: "credential_secret",
      raw_error: "raw_error_secret",
      sourceUrl: "https://provider.invalid/private-broadband",
    });
    expect(Object.getPrototypeOf(hostileProtocolOutput)).toBe(Object.prototype);
    recursivelyFrozen(hostileProtocolOutput);
    const nativeSentinel = new Error(
      "provider_query_secret snippet_secret credential_secret raw_error_secret " +
      "https://provider.invalid/private-broadband",
    );
    const rows = [
      {
        name: "malformed-protocol",
        fault: { kind: "protocol" as const, output: hostileProtocolOutput },
        expectedMessage: "city_fixed_operation_failed",
      },
      {
        name: "native-error",
        fault: { kind: "native" as const, error: nativeSentinel },
        expectedMessage: nativeSentinel.message,
      },
    ] as const;
    for (const row of rows) {
      const harness = await syntheticApplicationHarness({ fixedBroadbandFault: row.fault });
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:fixed-fatal:${row.name}`,
      });
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:fixed-fatal:${row.name}`,
      });
      resetSemanticGateObservations(harness);
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const fixedInputOffset = fixedRunnerHarness.inputs.length;
        const fixedPromiseOffset = fixedRunnerHarness.promises.length;
        const safetyPromiseOffset = safetyRunnerHarness.promises.length;
        const fixedRouteOffset = harness.calls.fixedRouteInputs.length;
        const genericOffset = genericSealHarness.calls;
        const evidenceOffset = harness.calls.evidenceSeals.length;
        const knowledgeOffset = harness.calls.knowledgePublishes.length;
        const appendOffset = harness.calls.appends.length;
        const historyOffset = harness.calls.selectionHistory.length;
        const events: CityFrontierEvent[] = [];
        const continuation = harness.assembly.application.continueCityFrontier(
          prepared,
          (event: CityFrontierEvent) => {
            recursivelyFrozen(event);
            events.push(structuredClone(event));
          },
          new AbortController().signal,
        );
        const outcome = await continuation.then(
          (value: CityFrontierReadModel) => ({ kind: "fulfilled" as const, value }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        );
        await Promise.allSettled([
          continuation,
          ...fixedRunnerHarness.promises.slice(fixedPromiseOffset),
          ...safetyRunnerHarness.promises.slice(safetyPromiseOffset),
        ]);
        await nextEventLoopTurn();
        expect(outcome.kind).toBe("rejected");
        if (outcome.kind !== "rejected") throw new Error("expected_fixed_route_rejection");
        const caught = outcome.error;
        expect(caught).toBeInstanceOf(Error);
        if (row.fault.kind === "native") {
          expect(caught).toBe(nativeSentinel);
        } else {
          const error = caught as Error;
          errors.push(error);
          expect(error.message).toBe(row.expectedMessage);
        }
        expect(fixedRunnerHarness.inputs.slice(fixedInputOffset)).toHaveLength(3);
        expect(fixedRunnerHarness.promises.slice(fixedPromiseOffset)).toHaveLength(3);
        expect(safetyRunnerHarness.promises.slice(safetyPromiseOffset)).toHaveLength(1);
        const broadbandInputs = harness.calls.fixedRouteInputs.slice(fixedRouteOffset).filter(
          (value) => (value as { readonly sourceId: string }).sourceId ===
            "si-city-fixed-broadband",
        ) as Array<{
          readonly sourceId: SloveniaCityFixedSourceId;
          readonly routeIndex: number;
          readonly route: CityFixedSourcePlan<"si-city-fixed-broadband">["routes"][number];
        }>;
        expect(broadbandInputs).toEqual([expect.objectContaining({
          sourceId: "si-city-fixed-broadband",
          routeIndex: 0,
          route: harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!.routes[0],
        })]);
        expect(events.map(({ type }) => type)).toEqual([
          "city_activated",
          "city_progress",
          "city_progress",
          "city_progress",
          "city_progress",
        ]);
        expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5]);
        expect(events.slice(1).map((event) => event.type === "city_progress"
          ? event.stage
          : "invalid")).toEqual([
          "source_started:si-city-safety",
          "source_started:si-city-long-term-rent",
          "source_started:si-city-urban-transit",
          "source_started:si-city-fixed-broadband",
        ]);
        const serializedEvents = JSON.stringify(events);
        for (const hostile of [
          "provider_query_secret",
          "snippet_secret",
          "credential_secret",
          "raw_error_secret",
          "https://provider.invalid/private-broadband",
        ]) expect(serializedEvents).not.toContain(hostile);
        expect(genericSealHarness.calls).toBe(genericOffset);
        expect(harness.calls.evidenceSeals).toHaveLength(evidenceOffset);
        expect(harness.calls.knowledgePublishes).toHaveLength(knowledgeOffset);
        expect(harness.calls.appends).toHaveLength(appendOffset);
        expect(harness.calls.selectionHistory).toHaveLength(historyOffset);
        expect(harness.state.root()).toEqual(started.revision);
        expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
          .toEqual(databaseChanges);
        const eventCount = events.length;
        await nextEventLoopTurn();
        expect(events).toHaveLength(eventCount);
      }
      if (row.fault.kind === "protocol") {
        expect(errors).toHaveLength(2);
        expect(errors[0]).not.toBe(errors[1]);
      }
    }
  });

  test.each([
    {
      name: "June fallback",
      commandSuffix: "june-fallback",
      assessmentAt: "2026-06-30T23:59:59.999Z",
      expectedSafetyResult: {
        kind: "verified" as const,
        quantity: {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents" as const,
        },
        referenceYear: 2024,
        acceptedCandidateIndex: 0,
      },
      confidentialSearch: true,
    },
    {
      name: "July stale",
      commandSuffix: "july-stale",
      assessmentAt: "2026-07-01T00:00:00.000Z",
      expectedSafetyResult: { kind: "unknown" as const, reason: "stale" as const },
      confidentialSearch: false,
    },
  ] as const)(
    "binds a real 2024 police/SURS safety graph at the exact $name boundary",
    async (row) => {
      // Break caught: using completion time for freshness or leaking provider/raw-document authority.
      const navigationUrl = "https://ljubljana.si/safety";
      const terminalUrl = "https://ljubljana.si/report-2024.pdf";
      const hostileCandidateUrl =
        "https://hostile-provider.invalid/private-candidate?credential=candidate-secret";
      const providerId = row.confidentialSearch ? "private-provider" : "empty-provider";
      const terminalSnippet = "PRIVATE_TERMINAL_SNIPPET";
      const bearerToken = "BEARER_TOKEN_SECRET";
      const rawCapturedArtifacts: LiveCapturedArtifact<"si-city-safety">[] = [];
      const populationArtifacts: LiveCapturedArtifact<"si-city-safety">[] = [];
      const safetyDocuments = createSloveniaCitySafetyAdapter({
        capture: async (request) => {
          const rawText = request.url === terminalUrl
            ? terminalSnippet
            : `official-navigation:${request.url}`;
          const bytes = new TextEncoder().encode(rawText);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const artifact = {
            artifactId: `${request.runId}:${request.role}:${sha256}`,
            runId: request.runId,
            sourceId: "si-city-safety" as const,
            role: request.role,
            origin: "live" as const,
            capturedAt: row.assessmentAt,
            responseStatus: 200,
            responseUrl: request.url,
            request: { method: "GET" as const, url: request.url },
            url: request.url,
            mediaType: "application/pdf",
            sha256,
            bytes,
          } satisfies LiveCapturedArtifact<"si-city-safety">;
          rawCapturedArtifacts.push(artifact);
          return { artifact, redirectChain: [request.url] };
        },
        analyze: async ({ artifact }) => artifact.url === navigationUrl
          ? { kind: "navigate" as const, confirmedDocumentUrl: terminalUrl }
          : {
              kind: "terminal" as const,
              dataAuthorityId: "police",
              municipalityCodes: ["061"],
              definitionId: "si-municipal-police-offences-per-100000@1",
              referenceYear: 2024,
              offenceCounts: ["1200"],
            },
        loadPopulation: async ({ runId, municipalityCode, referenceYear }) => {
          const url = "https://pxweb.stat.si/population-2024";
          const bytes = new TextEncoder().encode("population:061:2024:300000");
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const artifact: LiveCapturedArtifact<"si-city-safety"> = {
            artifactId: `${runId}:surs-denominator:${sha256}`,
            runId,
            sourceId: "si-city-safety",
            role: "surs_denominator",
            origin: "live",
            capturedAt: row.assessmentAt,
            responseStatus: 200,
            responseUrl: url,
            request: { method: "GET", url },
            url,
            mediaType: "application/pdf",
            sha256,
            bytes,
          };
          populationArtifacts.push(artifact);
          return {
            kind: "captured" as const,
            publisherId: "surs",
            municipalityCode,
            referenceDate: `${String(referenceYear)}-01-01`,
            population: "300000",
            artifact,
          };
        },
      });
      const httpRequests: Array<Parameters<CitySafetySearchHttpRequest>[0]> = [];
      const stepInputs: Array<{ readonly query: string; readonly resultLimit: number }> = [];
      let httpResponseIndex = 0;
      const request: CitySafetySearchHttpRequest = async (input) => {
        httpRequests.push(input);
        const urls = httpResponseIndex === 0 ? [hostileCandidateUrl] : [];
        httpResponseIndex += 1;
        return {
          status: 200,
          mediaType: "application/json; charset=utf-8",
          bodyBytes: new TextEncoder().encode(JSON.stringify({ urls })),
        };
      };
      const safetySearch = row.confidentialSearch
        ? createCitySafetySearchPort({
            providerId,
            step: createHttpCitySafetySearchStep({
              endpoint: "https://search-provider.invalid/query",
              providerId,
              bearerToken,
              timeoutMs: 1_000,
              maxResponseBytes: 65536,
            }, request),
          })
        : createCitySafetySearchPort({
            providerId,
            step: async (input) => {
              stepInputs.push(structuredClone(input));
              return { kind: "completed" as const, payload: { urls: [] as string[] } };
            },
          });
      const harness = await syntheticApplicationHarness({
        assessmentAt: row.assessmentAt,
        authorityFixtureOptions: { authorityAt: "2026-06-01T00:00:00.000Z" },
        safetySearch,
        safetyDocuments,
      });
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:safety-boundary:${row.commandSuffix}`,
      });
      expect(started.ranking.assessmentAt).toBe(row.assessmentAt);
      expect(started.revision.createdAt).toBe(row.assessmentAt);
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:safety-boundary:${row.commandSuffix}`,
      });
      resetSemanticGateObservations(harness);
      const events: CityFrontierEvent[] = [];
      const fixedPromiseOffset = fixedRunnerHarness.promises.length;
      const safetyPromiseOffset = safetyRunnerHarness.promises.length;
      const result = await harness.assembly.application.continueCityFrontier(
        prepared,
        (event: CityFrontierEvent) => {
          recursivelyFrozen(event);
          events.push(structuredClone(event));
        },
        new AbortController().signal,
      );
      await Promise.allSettled([
        ...fixedRunnerHarness.promises.slice(fixedPromiseOffset),
        ...safetyRunnerHarness.promises.slice(safetyPromiseOffset),
      ]);
      const eventCount = events.length;
      await nextEventLoopTurn();
      expect(events).toHaveLength(eventCount);
      expectPrivateSuccessfulTrace(
        events,
        result,
        started.revision.id,
        harness.fixture.installed,
      );
      expect(harness.calls.evidenceSeals).toHaveLength(1);
      expect(harness.calls.knowledgePublishes).toHaveLength(1);
      expect(harness.calls.appends).toHaveLength(1);
      expect(result.revision).toEqual(harness.calls.appends[0]);
      expect(harness.state.root()).toEqual(result.revision);
      const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
      const safetyLedger = evidenceInput.safetyAttemptLedger;
      expect(safetyLedger.assessmentAt).toBe(row.assessmentAt);
      expect(safetyLedger.result).toEqual(row.expectedSafetyResult);
      expect(safetyLedger.queries).toHaveLength(3);
      expect(safetyLedger.queries.map(({ providerId: provider }) => provider))
        .toEqual([providerId, providerId, providerId]);
      expect(harness.calls.safetySearchInputs).toHaveLength(3);
      expect(harness.calls.safetySearchOutputs).toEqual(Array.from(
        { length: 3 },
        (_value, index) => ({
          kind: "completed",
          providerId,
          urls: row.confidentialSearch && index === 0 ? [hostileCandidateUrl] : [],
        }),
      ));
      const runtimeSearchInputs = harness.calls.safetySearchInputs as Array<{
        readonly query: string;
        readonly resultLimit: number;
      }>;
      expect(runtimeSearchInputs.map(({ resultLimit }) => resultLimit)).toEqual(
        row.confidentialSearch ? [9, 8, 8] : [9, 9, 9],
      );
      expect(safetyLedger.queries.map(({ query }) => query))
        .toEqual(runtimeSearchInputs.map(({ query }) => query));
      expect(rawCapturedArtifacts.map(({ url }) => url)).toEqual([navigationUrl, terminalUrl]);
      expect(populationArtifacts).toHaveLength(1);
      if (row.confidentialSearch) {
        expect(safetyLedger.candidates).toHaveLength(2);
        expect(safetyLedger.candidates[0]).toEqual(expect.objectContaining({
          index: 0,
          origin: { kind: "configured", configuredRouteIndex: 0 },
          canonicalUrl: navigationUrl,
          publisherId: "municipality-ljubljana",
          dataAuthorityId: "police",
          publisherNavigationUrl: navigationUrl,
          resolvedEvidenceUrl: terminalUrl,
          disposition: "usable",
          referenceYear: 2024,
          periodDisposition: "fallback",
          quantity: row.expectedSafetyResult.kind === "verified"
            ? row.expectedSafetyResult.quantity
            : undefined,
        }));
        expect(safetyLedger.candidates[1]).toEqual(expect.objectContaining({
          index: 1,
          origin: { kind: "search", queryId: safetyLedger.queries[0]!.queryId },
          canonicalUrl: hostileCandidateUrl,
          disposition: "rejected",
          reason: "authority_untrusted",
          artifactRefs: [],
        }));
        expect(httpRequests).toHaveLength(3);
        const httpBodies = httpRequests.map(({ bodyBytes }) =>
          JSON.parse(new TextDecoder().decode(bodyBytes)) as {
            readonly query: string;
            readonly resultLimit: number;
          });
        expect(httpBodies).toEqual(runtimeSearchInputs.map(({ query, resultLimit }) => ({
          query,
          resultLimit,
        })));
        expect(httpRequests.every(({ headers }) =>
          headers.authorization === `Bearer ${bearerToken}`)).toBe(true);
        expect(harness.calls.safetyDocumentInputs[1]).toEqual(expect.objectContaining({
          candidateUrl: hostileCandidateUrl,
        }));
        expect(harness.calls.safetyDocumentOutputs[1]).toEqual(expect.objectContaining({
          kind: "rejected",
          detail: expect.objectContaining({ reason: "authority_untrusted" }),
          artifacts: [],
        }));
      } else {
        expect(httpRequests).toEqual([]);
        expect(stepInputs).toEqual(runtimeSearchInputs.map(({ query, resultLimit }) => ({
          query,
          resultLimit,
        })));
        expect(safetyLedger.candidates).toHaveLength(1);
        expect(Reflect.ownKeys(safetyLedger.candidates[0]!).sort()).toEqual([
          "artifactRefs",
          "canonicalUrl",
          "disposition",
          "index",
          "mediaType",
          "officialTrace",
          "origin",
          "reason",
          "retentionPolicyId",
          "reviewedOfficial",
          "transientRawDeleted",
        ].sort());
        expect(safetyLedger.candidates[0]).toEqual(expect.objectContaining({
          index: 0,
          origin: { kind: "configured", configuredRouteIndex: 0 },
          canonicalUrl: navigationUrl,
          disposition: "rejected",
          reason: "stale",
          reviewedOfficial: {
            publisherId: "municipality-ljubljana",
            dataAuthorityId: "police",
            publisherNavigationUrl: navigationUrl,
            resolvedEvidenceUrl: terminalUrl,
            referenceYear: 2024,
          },
        }));
      }
      const terminalArtifact = rawCapturedArtifacts.find(({ url }) => url === terminalUrl)!;
      expect(terminalArtifact.runId).toBe(evidenceInput.cityCheckRunId);
      expect(new TextDecoder().decode(terminalArtifact.bytes)).toBe(terminalSnippet);
      expect(createHash("sha256").update(terminalArtifact.bytes).digest("hex"))
        .toBe(terminalArtifact.sha256);
      const terminalReference = safetyLedger.candidates[0]!.artifactRefs.find((reference) =>
        reference.role === "municipal_source" && reference.documentRole === "terminal_claim")!;
      expect(terminalReference.locator).toBe(terminalUrl);
      expect(terminalReference.sourceSha256).toBe(terminalArtifact.sha256);
      expect(evidenceInput.artifacts.some(({ artifactId, sha256 }) =>
        artifactId === terminalReference.artifactId && sha256 === terminalReference.artifactSha256))
        .toBe(true);
      const marker = result.revision.markers.at(-1)!;
      const loadedEvidence = withInfrastructurePlanGateRead(() =>
        harness.fixture.evidenceStore.loadVerified(marker.evidenceSnapshotId));
      const loadedKnowledge = withInfrastructurePlanGateRead(() =>
        harness.fixture.knowledgeStore.loadVerified(marker.knowledgeRevisionId));
      recursivelyFrozen(loadedEvidence);
      recursivelyFrozen(loadedKnowledge);
      expect(loadedEvidence.snapshot.safetyAttemptLedger).toEqual(safetyLedger);
      expect(loadedKnowledge.evidenceSnapshotId).toBe(loadedEvidence.snapshot.id);
      const knowledgeSafety = loadedKnowledge.facts.find((fact: CityKnowledgeRevision["facts"][number]) =>
        fact.criterionId === "safety")!;
      const markerSafety = marker.facts.find((fact: CityCommittedFactProjection) =>
        fact.criterionId === "safety")!;
      if (row.expectedSafetyResult.kind === "verified") {
        expect(knowledgeSafety).toEqual(expect.objectContaining({
          referencePeriod: "2024",
          outcome: {
            kind: "verified",
            basis: { kind: "municipal_safety", quantity: row.expectedSafetyResult.quantity },
          },
        }));
        expect(markerSafety).toEqual(expect.objectContaining({
          referencePeriod: "2024",
          outcome: knowledgeSafety.outcome,
          evidenceLinks: [{
            sourceId: "si-city-safety",
            disposition: "accepted",
            navigationUrl,
            resolvedEvidenceUrl: terminalUrl,
            referenceYear: 2024,
          }],
          manualCheckLinks: [],
        }));
        expect(marker.unknownBasis.some((warning: CityLiveMarker["unknownBasis"][number]) =>
          warning.criterionId === "safety")).toBe(false);
      } else {
        expect(knowledgeSafety).toEqual(expect.objectContaining({
          referencePeriod: null,
          outcome: { kind: "unknown", reason: "stale" },
        }));
        expect(markerSafety).toEqual(expect.objectContaining({
          referencePeriod: null,
          outcome: knowledgeSafety.outcome,
          evidenceLinks: [],
          manualCheckLinks: [{
            sourceId: "si-city-safety",
            disposition: "reviewed_rejected",
            navigationUrl,
            resolvedEvidenceUrl: terminalUrl,
            referenceYear: 2024,
            rejectionReason: "stale",
          }],
        }));
        expect(marker.unknownBasis).toContainEqual({
          criterionId: "safety",
          definitionId: "si-municipal-police-offences-per-100000@1",
          reason: "stale",
        });
      }
      const safetyCompletion = events.find((event) => event.type === "city_progress" &&
        event.stage === "source_completed:si-city-safety");
      expect(safetyCompletion).toEqual(expect.objectContaining({ sourceUrl: navigationUrl }));
      if (safetyCompletion?.type === "city_progress" && "sourceUrl" in safetyCompletion) {
        expect(safetyCompletion.sourceUrl).not.toBe(terminalUrl);
        expect(safetyCompletion.sourceUrl).not.toBe(hostileCandidateUrl);
      }
      if (row.confidentialSearch) {
        const serializedEvents = JSON.stringify(events);
        const confidentialValues = [
          ...runtimeSearchInputs.map(({ query }) => query),
          hostileCandidateUrl,
          "hostile-provider.invalid",
          "private-candidate",
          "candidate-secret",
          providerId,
          terminalSnippet,
          bearerToken,
          `Bearer ${bearerToken}`,
        ];
        for (const confidential of confidentialValues) {
          expect(serializedEvents).not.toContain(confidential);
        }
      }
    },
  );

  test("binds a safety marker rejection to its aggregate outcome and terminal blocker lineage", async () => {
    // Break caught: using the last discovered candidate's detail for an earlier terminal blocker.
    const hostileCandidateUrl = "https://untrusted-safety.invalid/report.pdf";
    let searchIndex = 0;
    const harness = await syntheticApplicationHarness({
      safetySearch: {
        search: async () => ({
          kind: "completed",
          providerId: "aggregate-reason-provider",
          urls: searchIndex++ === 0 ? [hostileCandidateUrl] : [],
        }),
      },
      safetyDocuments: {
        inspect: async (input) => input.publisherContext === undefined
          ? {
              kind: "rejected",
              detail: {
                officialTrace: {
                  initialUrl: input.candidateUrl,
                  edges: [],
                  officialHops: 0,
                  failure: { captureKind: "navigation_mismatch" },
                },
                artifactRefs: [],
                disposition: "rejected",
                reason: "authority_untrusted",
              },
              artifacts: [],
            }
          : {
              kind: "rejected",
              detail: {
                officialTrace: {
                  initialUrl: input.candidateUrl,
                  edges: [],
                  lastTrustedUrl: input.candidateUrl,
                  officialHops: 0,
                  failure: {
                    captureKind: "http_error",
                    responseStatus: 404,
                    responseUrl: input.candidateUrl,
                  },
                },
                artifactRefs: [],
                disposition: "rejected",
                reason: "http_not_found",
              },
              artifacts: [],
            },
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:safety-aggregate-terminal-lineage",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:safety-aggregate-terminal-lineage",
    });
    resetSemanticGateObservations(harness);

    const result = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    await Promise.allSettled([
      ...fixedRunnerHarness.promises,
      ...safetyRunnerHarness.promises,
    ]);

    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    expect(evidenceInput.safetyAttemptLedger.candidates.map((candidate) => ({
      disposition: candidate.disposition,
      reason: candidate.disposition === "rejected" ? candidate.reason : undefined,
    }))).toEqual([
      { disposition: "rejected", reason: "http_not_found" },
      { disposition: "rejected", reason: "authority_untrusted" },
    ]);
    expect(evidenceInput.safetyAttemptLedger.result).toEqual({
      kind: "unknown",
      reason: "not_found",
    });
    const markerSafety = result.revision.markers[0]!.facts.find(({ criterionId }) =>
      criterionId === "safety")!;
    expect(markerSafety.outcome).toEqual({ kind: "unknown", reason: "not_found" });
    expect(markerSafety.manualCheckLinks).toEqual([{
      sourceId: "si-city-safety",
      disposition: "reviewed_rejected",
      navigationUrl: harness.fixture.installed.safetySourcePlan.entries[0]!
        .configuredRoutes[0]!.navigationUrl,
      resolvedEvidenceUrl: harness.fixture.installed.safetySourcePlan.entries[0]!
        .configuredRoutes[0]!.navigationUrl,
      rejectionReason: "http_not_found",
    }]);
    expect(Reflect.ownKeys(markerSafety.manualCheckLinks[0]!)).not.toContain("referenceYear");
  });

  test("projects a conflicting fallback terminal as one reviewed marker link", async () => {
    // Break caught: treating two authenticated fallback quantities as a candidate-less blocker.
    const assessmentAt = "2026-06-30T23:59:59.999Z";
    const navigationUrl = "https://ljubljana.si/safety";
    const configuredTerminalUrl = "https://ljubljana.si/report-2024.pdf";
    const searchedTerminalUrl = "https://ljubljana.si/report-alternate-2024.pdf";
    const artifact = (
      runId: string,
      role: LiveCapturedArtifact<"si-city-safety">["role"],
      url: string,
      body: string,
    ): LiveCapturedArtifact<"si-city-safety"> => {
      const bytes = new TextEncoder().encode(body);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        artifactId: `${runId}:${role}:${sha256}`,
        runId,
        sourceId: "si-city-safety",
        role,
        origin: "live",
        capturedAt: assessmentAt,
        responseStatus: 200,
        responseUrl: url,
        request: { method: "GET", url },
        url,
        mediaType: "application/pdf",
        sha256,
        bytes,
      };
    };
    const safetyDocuments = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact(request.runId, request.role, request.url, `document:${request.url}`),
        redirectChain: [request.url],
      }),
      analyze: async ({ artifact: captured }) => captured.url === navigationUrl
        ? { kind: "navigate", confirmedDocumentUrl: configuredTerminalUrl }
        : {
            kind: "terminal",
            dataAuthorityId: "police",
            municipalityCodes: ["061"],
            definitionId: "si-municipal-police-offences-per-100000@1",
            referenceYear: 2024,
            offenceCounts: [captured.url === configuredTerminalUrl ? "1200" : "1300"],
          },
      loadPopulation: async ({ runId, municipalityCode, referenceYear }) => ({
        kind: "captured",
        publisherId: "surs",
        municipalityCode,
        referenceDate: `${String(referenceYear)}-01-01`,
        population: "300000",
        artifact: artifact(
          runId,
          "surs_denominator",
          "https://pxweb.stat.si/population-2024",
          "population:061:2024:300000",
        ),
      }),
    });
    let searchIndex = 0;
    const harness = await syntheticApplicationHarness({
      assessmentAt,
      authorityFixtureOptions: { authorityAt: "2026-06-01T00:00:00.000Z" },
      safetyDocuments,
      safetySearch: {
        search: async () => ({
          kind: "completed",
          providerId: "conflict-provider",
          urls: searchIndex++ === 0 ? [searchedTerminalUrl] : [],
        }),
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:safety-fallback-conflict",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:safety-fallback-conflict",
    });
    resetSemanticGateObservations(harness);

    const result = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    await Promise.allSettled([
      ...fixedRunnerHarness.promises,
      ...safetyRunnerHarness.promises,
    ]);

    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    expect(evidenceInput.safetyAttemptLedger.result).toEqual({
      kind: "unknown",
      reason: "conflict",
    });
    expect(evidenceInput.safetyAttemptLedger.candidates).toEqual([
      expect.objectContaining({
        origin: { kind: "configured", configuredRouteIndex: 0 },
        disposition: "usable",
        resolvedEvidenceUrl: configuredTerminalUrl,
        referenceYear: 2024,
        quantity: expect.objectContaining({ offenceCount: "1200" }),
      }),
      expect.objectContaining({
        origin: { kind: "search", queryId: expect.any(String) },
        disposition: "usable",
        resolvedEvidenceUrl: searchedTerminalUrl,
        referenceYear: 2024,
        quantity: expect.objectContaining({ offenceCount: "1300" }),
      }),
    ]);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
    expect(result.revision).toEqual(harness.calls.appends[0]);
    expect(harness.state.root()).toEqual(result.revision);
    const markerSafety = result.revision.markers[0]!.facts.find(({ criterionId }) =>
      criterionId === "safety")!;
    expect(markerSafety.outcome).toEqual({ kind: "unknown", reason: "conflict" });
    expect(markerSafety.manualCheckLinks).toEqual([{
      sourceId: "si-city-safety",
      disposition: "reviewed_rejected",
      navigationUrl,
      resolvedEvidenceUrl: configuredTerminalUrl,
      referenceYear: 2024,
      rejectionReason: "conflict",
    }]);
  });

  test("preserves a reviewed in-document conflict through Continue and durable Present replay", async () => {
    // Break caught: lexicographic offence ordering persists 10 before 9 through durable replay.
    const assessmentAt = "2026-06-30T23:59:59.999Z";
    const navigationUrl = "https://ljubljana.si/safety";
    const terminalUrl = "https://ljubljana.si/report-internal-conflict-2024.pdf";
    const artifact = (
      runId: string,
      role: LiveCapturedArtifact<"si-city-safety">["role"],
      url: string,
      body: string,
    ): LiveCapturedArtifact<"si-city-safety"> => {
      const bytes = new TextEncoder().encode(body);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        artifactId: `${runId}:${role}:${sha256}`,
        runId,
        sourceId: "si-city-safety",
        role,
        origin: "live",
        capturedAt: assessmentAt,
        responseStatus: 200,
        responseUrl: url,
        request: { method: "GET", url },
        url,
        mediaType: "application/pdf",
        sha256,
        bytes,
      };
    };
    const safetyDocuments = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact(request.runId, request.role, request.url, `document:${request.url}`),
        redirectChain: [request.url],
      }),
      analyze: async ({ artifact: captured }) => captured.url === navigationUrl
        ? { kind: "navigate", confirmedDocumentUrl: terminalUrl }
        : {
            kind: "terminal",
            dataAuthorityId: "police",
            municipalityCodes: ["061"],
            definitionId: "si-municipal-police-offences-per-100000@1",
            referenceYear: 2024,
            offenceCounts: ["10", "9"],
          },
      loadPopulation: async ({ runId, municipalityCode, referenceYear }) => ({
        kind: "captured",
        publisherId: "surs",
        municipalityCode,
        referenceDate: `${String(referenceYear)}-01-01`,
        population: "300000",
        artifact: artifact(
          runId,
          "surs_denominator",
          "https://pxweb.stat.si/population-2024",
          "population:061:2024:300000",
        ),
      }),
    });
    const harness = await syntheticApplicationHarness({
      assessmentAt,
      authorityFixtureOptions: { authorityAt: "2026-06-01T00:00:00.000Z" },
      safetyDocuments,
      safetySearch: {
        search: async () => ({
          kind: "completed",
          providerId: "internal-conflict-provider",
          urls: [],
        }),
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:safety-internal-conflict",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:safety-internal-conflict",
    });
    resetSemanticGateObservations(harness);

    const events: CityFrontierEvent[] = [];
    const outcome = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event) => {
        recursivelyFrozen(event);
        events.push(structuredClone(event));
      },
      new AbortController().signal,
    ).then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    await Promise.allSettled([
      ...fixedRunnerHarness.promises,
      ...safetyRunnerHarness.promises,
    ]);
    if (outcome.kind === "rejected") {
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe("invalid_city_safety_terminal_entry");
    }
    expect(outcome.kind).toBe("fulfilled");
    if (outcome.kind !== "fulfilled") return;
    const result = outcome.value;
    const eventCount = events.length;
    await nextEventLoopTurn();
    expect(events).toHaveLength(eventCount);
    expectPrivateSuccessfulTrace(events, result, started.revision.id, harness.fixture.installed);

    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
    expect(result.revision).toEqual(harness.calls.appends[0]);
    expect(harness.state.root()).toEqual(result.revision);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    expect(evidenceInput.safetyAttemptLedger.result).toEqual({
      kind: "unknown",
      reason: "conflict",
    });
    expect(evidenceInput.safetyAttemptLedger.candidates).toEqual([
      expect.objectContaining({
        origin: { kind: "configured", configuredRouteIndex: 0 },
        disposition: "rejected",
        reason: "conflict",
        reviewedOfficial: expect.objectContaining({
          publisherNavigationUrl: navigationUrl,
          resolvedEvidenceUrl: terminalUrl,
          referenceYear: 2024,
        }),
        conflictBasis: expect.objectContaining({
          referenceYear: 2024,
          quantities: [
            expect.objectContaining({ offenceCount: "9", population: "300000" }),
            expect.objectContaining({ offenceCount: "10", population: "300000" }),
          ],
        }),
      }),
    ]);
    expect(evidenceInput.genericEvidence.snapshot.blockers).toContainEqual(expect.objectContaining({
      sourceId: "si-city-safety",
      kind: "conflict",
      navigationUrl,
      resolvedUrl: terminalUrl,
    }));
    const markerSafety = result.revision.markers[0]!.facts.find(({ criterionId }) =>
      criterionId === "safety")!;
    expect(markerSafety.outcome).toEqual({ kind: "unknown", reason: "conflict" });
    expect(markerSafety.manualCheckLinks).toEqual([{
      sourceId: "si-city-safety",
      disposition: "reviewed_rejected",
      navigationUrl,
      resolvedEvidenceUrl: terminalUrl,
      referenceYear: 2024,
      rejectionReason: "conflict",
    }]);

    const durableEvidence = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(`${evidenceInput.cityCheckRunId}:evidence`));
    expect(durableEvidence.snapshot.safetyAttemptLedger).toEqual(evidenceInput.safetyAttemptLedger);
    const beforePresent = researchAndPublicationCounts(harness);
    const presented = await harness.assembly.application.presentCityFrontier(result.runId);
    expect(presented.revision).toEqual(result.revision);
    expect(presented.revision).not.toBe(result.revision);
    recursivelyFrozen(presented);
    expect(researchAndPublicationCounts(harness)).toEqual(beforePresent);
  });

  test("rejects an ambiguous conflict projection before Knowledge or Frontier publication", async () => {
    const assessmentAt = "2026-06-30T23:59:59.999Z";
    const navigationUrl = "https://ljubljana.si/safety";
    const sharedTerminalUrl = "https://ljubljana.si/report-shared-2024.pdf";
    let terminalAnalysisIndex = 0;
    const safetyDocuments = createSloveniaCitySafetyAdapter({
      capture: async (request) => {
        const bytes = new TextEncoder().encode(`document:${request.url}`);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        return {
          artifact: {
            artifactId: `${request.runId}:${request.role}:${sha256}`,
            runId: request.runId,
            sourceId: "si-city-safety",
            role: request.role,
            origin: "live",
            capturedAt: assessmentAt,
            responseStatus: 200,
            responseUrl: request.url,
            request: { method: "GET", url: request.url },
            url: request.url,
            mediaType: "application/pdf",
            sha256,
            bytes,
          },
          redirectChain: [request.url],
        };
      },
      analyze: async ({ artifact: captured }) => captured.url !== sharedTerminalUrl
        ? { kind: "navigate", confirmedDocumentUrl: sharedTerminalUrl }
        : {
            kind: "terminal",
            dataAuthorityId: "police",
            municipalityCodes: ["061"],
            definitionId: "si-municipal-police-offences-per-100000@1",
            referenceYear: 2024,
            offenceCounts: [terminalAnalysisIndex++ === 0 ? "1200" : "1300"],
          },
      loadPopulation: async ({ runId, municipalityCode, referenceYear }) => {
        const url = "https://pxweb.stat.si/population-2024";
        const bytes = new TextEncoder().encode("population:061:2024:300000");
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        return {
          kind: "captured",
          publisherId: "surs",
          municipalityCode,
          referenceDate: `${String(referenceYear)}-01-01`,
          population: "300000",
          artifact: {
            artifactId: `${runId}:surs-denominator:${sha256}`,
            runId,
            sourceId: "si-city-safety",
            role: "surs_denominator",
            origin: "live",
            capturedAt: assessmentAt,
            responseStatus: 200,
            responseUrl: url,
            request: { method: "GET", url },
            url,
            mediaType: "application/pdf",
            sha256,
            bytes,
          },
        };
      },
    });
    let searchIndex = 0;
    const harness = await syntheticApplicationHarness({
      assessmentAt,
      authorityFixtureOptions: {
        authorityAt: "2026-06-01T00:00:00.000Z",
        municipalPublisherNavigationMatchesRoute: true,
      },
      safetyDocuments,
      safetySearch: {
        search: async () => ({
          kind: "completed",
          providerId: "ambiguous-conflict-provider",
          urls: searchIndex++ === 0 ? [sharedTerminalUrl] : [],
        }),
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:safety-ambiguous-conflict",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:safety-ambiguous-conflict",
    });
    resetSemanticGateObservations(harness);

    const events: CityFrontierEvent[] = [];
    const outcome = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event) => { events.push(structuredClone(event)); },
      new AbortController().signal,
    ).then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    expect(evidenceInput.safetyAttemptLedger.result).toEqual({
      kind: "unknown",
      reason: "conflict",
    });
    expect(evidenceInput.safetyAttemptLedger.candidates).toEqual([
      expect.objectContaining({
        origin: { kind: "configured", configuredRouteIndex: 0 },
        disposition: "usable",
        publisherNavigationUrl: navigationUrl,
        resolvedEvidenceUrl: sharedTerminalUrl,
        referenceYear: 2024,
        quantity: expect.objectContaining({ offenceCount: "1200" }),
      }),
      expect.objectContaining({
        origin: { kind: "search", queryId: expect.any(String) },
        disposition: "usable",
        publisherNavigationUrl: navigationUrl,
        resolvedEvidenceUrl: sharedTerminalUrl,
        referenceYear: 2024,
        quantity: expect.objectContaining({ offenceCount: "1300" }),
      }),
    ]);
    expect(evidenceInput.genericEvidence.snapshot.blockers).toContainEqual(expect.objectContaining({
      sourceId: "si-city-safety",
      kind: "conflict",
      navigationUrl,
      resolvedUrl: sharedTerminalUrl,
    }));
    const replayed = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(`${evidenceInput.cityCheckRunId}:evidence`));
    const safetyEntry = replayed.genericEvidence.entries.find(({ sourceId }) =>
      sourceId === "si-city-safety")!;
    expect(safetyEntry).toEqual(expect.objectContaining({
      navigationUrl,
      resolvedEvidenceUrl: sharedTerminalUrl,
    }));
    expect(replayed.snapshot.safetyAttemptLedger).toEqual(evidenceInput.safetyAttemptLedger);
    expect(replayed.genericEvidence.entries.find(({ sourceId }) =>
      sourceId === "si-city-safety")).toEqual(safetyEntry);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe("integrity_mismatch");
    }
    expect(harness.calls.knowledgePublishes).toHaveLength(0);
    expect(harness.calls.appends).toHaveLength(0);
    expect(harness.state.root()).toEqual(started.revision);
    expect(harness.calls.safetyDocumentInputs.map((input) =>
      (input as { readonly candidateUrl: string }).candidateUrl)).toEqual([
      navigationUrl,
      sharedTerminalUrl,
    ]);
    expect(events.some((event) =>
      (event.type === "city_progress" && [
        "evidence_verified",
        "knowledge_published",
      ].includes(event.stage)) ||
      event.type === "city_revision_committed" ||
      event.type === "city_continuation_completed")).toBe(false);
  });

  test.each([
    {
      name: "typed provider unavailable",
      commandSuffix: "typed-provider-unavailable",
      kind: "typed" as const,
      providerId: "typed-unavailable-provider",
      reason: "provider_unavailable" as const,
    },
    {
      name: "unconfigured provider",
      commandSuffix: "unconfigured-provider",
      kind: "composition-unconfigured" as const,
      providerId: "search-provider-unconfigured",
      reason: "search_provider_unconfigured" as const,
    },
  ] as const)(
    "durably records $name as bounded source_unavailable",
    async (row) => {
      // Break caught: treating an unavailable search provider as fatal or omitting its durable ledger.
      let safetySearch: CitySafetySearchPort;
      if (row.kind === "typed") {
        safetySearch = createCitySafetySearchPort({
          providerId: row.providerId,
          step: async () => ({ kind: "unavailable", reason: row.reason }),
        });
      } else {
        const database = openEvidenceDatabase(":memory:");
        databases.push(database);
        const factoryOffset = compositionHarness.applicationFactoryPorts.length;
        compositionHarness.enabled = true;
        try {
          createCityFrontierComposition({
            database,
            hmacKey: "task-14-omitted-search-key-at-least-32-bytes",
            resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
            profiles: {
              loadRelocationAnyVerified: NEVER,
              loadPreferenceForRankingVerified: NEVER,
            },
            liveSources: {
              kind: "configured",
              fixedRoutes: {
                "si-city-long-term-rent": { inspect: NEVER },
                "si-city-urban-transit": { inspect: NEVER },
                "si-city-fixed-broadband": { inspect: NEVER },
              },
              safetyDocuments: { inspect: NEVER },
            },
          });
        } finally {
          compositionHarness.enabled = false;
        }
        expect(compositionHarness.applicationFactoryPorts).toHaveLength(factoryOffset + 1);
        safetySearch = (compositionHarness.applicationFactoryPorts[factoryOffset] as
          CityFrontierApplicationPorts).safetySearch;
      }
      const harness = await syntheticApplicationHarness({ safetySearch });
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:safety-search-unavailable:${row.commandSuffix}`,
      });
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:safety-search-unavailable:${row.commandSuffix}`,
      });
      resetSemanticGateObservations(harness);
      const searchInputOffset = harness.calls.safetySearchInputs.length;
      const searchOutputOffset = harness.calls.safetySearchOutputs.length;
      const documentInputOffset = harness.calls.safetyDocumentInputs.length;
      const documentOutputOffset = harness.calls.safetyDocumentOutputs.length;
      const events: CityFrontierEvent[] = [];
      const result = await harness.assembly.application.continueCityFrontier(
        prepared,
        (event: CityFrontierEvent) => {
          recursivelyFrozen(event);
          events.push(structuredClone(event));
        },
        new AbortController().signal,
      );
      await Promise.allSettled([
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ]);
      const eventCount = events.length;
      await nextEventLoopTurn();
      expect(events).toHaveLength(eventCount);
      expectPrivateSuccessfulTrace(
        events,
        result,
        started.revision.id,
        harness.fixture.installed,
      );
      expect(genericSealHarness.calls).toBe(1);
      expect(harness.calls.evidenceSeals).toHaveLength(1);
      expect(harness.calls.knowledgePublishes).toHaveLength(1);
      expect(harness.calls.appends).toHaveLength(1);
      expect(harness.calls.selectionHistory).toHaveLength(1);
      expect(result.revision).toEqual(harness.calls.appends[0]);
      expect(harness.state.root()).toEqual(result.revision);
      const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
      const searchInputs = harness.calls.safetySearchInputs.slice(searchInputOffset) as Array<{
        readonly queryId: string;
        readonly query: string;
        readonly resultLimit: number;
        readonly signal: AbortSignal;
      }>;
      const searchOutputs = harness.calls.safetySearchOutputs.slice(searchOutputOffset);
      const documentInputs = harness.calls.safetyDocumentInputs.slice(documentInputOffset);
      const documentOutputs = harness.calls.safetyDocumentOutputs.slice(documentOutputOffset);
      expect(searchInputs).toHaveLength(3);
      expect(searchOutputs).toEqual(Array.from({ length: 3 }, () => ({
        kind: "unavailable",
        providerId: row.providerId,
        reason: row.reason,
      })));
      expect(documentInputs).toHaveLength(1);
      expect(documentOutputs).toHaveLength(1);
      expect(documentOutputs[0]).toEqual(expect.objectContaining({ kind: "rejected" }));
      const documentInput = documentInputs[0] as
        Parameters<CitySafetyOfficialDocumentPort["inspect"]>[0];
      const documentOutput = documentOutputs[0] as
        Awaited<ReturnType<CitySafetyOfficialDocumentPort["inspect"]>>;
      const safetyEntry = harness.fixture.installed.safetySourcePlan.entries[0]!;
      const configuredRoute = safetyEntry.configuredRoutes[0]!;
      expect(documentInput).toEqual({
        runId: evidenceInput.cityCheckRunId,
        cityId: evidenceInput.cityId,
        municipalityCode: safetyEntry.municipalityCode,
        candidateUrl: configuredRoute.navigationUrl,
        publisherContext: {
          publisherId: configuredRoute.publisherId,
          publisherNavigationUrl: configuredRoute.navigationUrl,
        },
        officialHopLimit: 2,
        assessmentAt: evidenceInput.assessmentAt,
        authorityDirectory: harness.fixture.installed.officialAuthorityDirectory,
        signal: expect.any(AbortSignal),
      });
      expect(documentOutput.kind).toBe("rejected");
      if (documentOutput.kind !== "rejected") {
        throw new Error("expected_reviewed_official_rejection");
      }
      expect(evidenceInput.safetyAttemptLedger.candidates).toHaveLength(1);
      expect(evidenceInput.safetyAttemptLedger.candidates[0]).toEqual({
        index: 0,
        origin: { kind: "configured", configuredRouteIndex: 0 },
        canonicalUrl: documentInput.candidateUrl,
        ...documentOutput.detail,
      });
      const documentArtifactIds = new Set(documentOutput.artifacts.map(({ artifactId }) =>
        artifactId));
      expect(documentArtifactIds.size).toBe(documentOutput.artifacts.length);
      expect(evidenceInput.artifacts.filter(({ artifactId }) =>
        documentArtifactIds.has(artifactId))).toEqual(documentOutput.artifacts);
      for (const artifact of documentOutput.artifacts) {
        expect(evidenceInput.artifacts).toContainEqual(expect.objectContaining({
          artifactId: artifact.artifactId,
          sha256: artifact.sha256,
          sourceId: artifact.sourceId,
          runId: artifact.runId,
          request: artifact.request,
          responseStatus: artifact.responseStatus,
          responseUrl: artifact.responseUrl,
          url: artifact.url,
        }));
      }
      expect(evidenceInput.safetyAttemptLedger.queries).toHaveLength(3);
      expect(evidenceInput.safetyAttemptLedger.queries.map(({ providerId, outcome }) => ({
        providerId,
        outcome,
      }))).toEqual(Array.from({ length: 3 }, () => ({
        providerId: row.providerId,
        outcome: { kind: "unavailable", reason: row.reason },
      })));
      expect(searchInputs.map(({ queryId, query, resultLimit }) => ({
        queryId,
        query,
        resultLimit,
      }))).toEqual(evidenceInput.safetyAttemptLedger.queries.map(({ queryId, query }) => ({
        queryId,
        query,
        resultLimit: 9,
      })));
      expect(evidenceInput.safetyAttemptLedger.queries.map((query) => ({
        index: query.index,
        queryId: query.queryId,
        queryTemplateVersion: query.queryTemplateVersion,
        providerId: query.providerId,
        outcome: query.outcome,
      }))).toEqual(searchOutputs.map((_output, index) => ({
        index,
        queryId: searchInputs[index]!.queryId,
        queryTemplateVersion: harness.fixture.installed.safetySourcePlan.queryTemplateVersion,
        providerId: row.providerId,
        outcome: { kind: "unavailable", reason: row.reason },
      })));
      expect(evidenceInput.safetyAttemptLedger.counters).toEqual({
        queries: 3,
        candidates: 1,
        maxOfficialHops: 1,
      });
      expect(evidenceInput.safetyAttemptLedger.result).toEqual({
        kind: "unknown",
        reason: "source_unavailable",
      });
      const marker = result.revision.markers.at(-1)!;
      const evidence = withInfrastructurePlanGateRead(() =>
        harness.fixture.evidenceStore.loadVerified(marker.evidenceSnapshotId));
      const knowledge = withInfrastructurePlanGateRead(() =>
        harness.fixture.knowledgeStore.loadVerified(marker.knowledgeRevisionId));
      recursivelyFrozen(evidence);
      recursivelyFrozen(knowledge);
      expect(evidence.snapshot.safetyAttemptLedger).toEqual(evidenceInput.safetyAttemptLedger);
      const knowledgeSafety = knowledge.facts.find((fact: CityKnowledgeRevision["facts"][number]) =>
        fact.criterionId === "safety")!;
      expect(knowledgeSafety).toEqual(expect.objectContaining({
        referencePeriod: null,
        outcome: { kind: "unknown", reason: "source_unavailable" },
      }));
      const markerSafety = marker.facts.find((fact: CityCommittedFactProjection) =>
        fact.criterionId === "safety")!;
      expect(markerSafety).toEqual(expect.objectContaining({
        referencePeriod: null,
        outcome: knowledgeSafety.outcome,
        evidenceLinks: [],
        manualCheckLinks: [expect.objectContaining({
          sourceId: "si-city-safety",
          disposition: "reviewed_rejected",
          navigationUrl: harness.fixture.installed.safetySourcePlan.entries[0]!
            .configuredRoutes[0]!.navigationUrl,
          rejectionReason: "http_not_found",
        })],
      }));
      expect(marker.unknownBasis).toContainEqual({
        criterionId: "safety",
        definitionId: "si-municipal-police-offences-per-100000@1",
        reason: "source_unavailable",
      });
      const safetyCompletion = events.find((event) => event.type === "city_progress" &&
        event.stage === "source_completed:si-city-safety");
      expect(safetyCompletion).toEqual(expect.objectContaining({
        sourceUrl: harness.fixture.installed.safetySourcePlan.entries[0]!
          .configuredRoutes[0]!.navigationUrl,
      }));
    },
  );

  test("maps the wholly unconfigured composition document port directly to its fail-closed error", async () => {
    // Break caught: exposing a no-op document adapter or deferring its failure into Application.
    const fixture = await syntheticAuthorityFixture();
    const factoryOffset = compositionHarness.applicationFactoryPorts.length;
    compositionHarness.enabled = true;
    try {
      createCityFrontierComposition({
        database: fixture.database,
        hmacKey: "task-14-unconfigured-document-key-at-least-32-bytes",
        resolvedCountries: { requireResolvedCountryShortlistForCity: NEVER },
        profiles: {
          loadRelocationAnyVerified: NEVER,
          loadPreferenceForRankingVerified: NEVER,
        },
        liveSources: { kind: "unconfigured" },
      });
    } finally {
      compositionHarness.enabled = false;
    }
    expect(compositionHarness.applicationFactoryPorts).toHaveLength(factoryOffset + 1);
    const capturedPorts = compositionHarness.applicationFactoryPorts[factoryOffset] as
      CityFrontierApplicationPorts;
    const safetyEntry = fixture.installed.safetySourcePlan.entries[0]!;
    const route = safetyEntry.configuredRoutes[0]!;
    const input: Parameters<CitySafetyOfficialDocumentPort["inspect"]>[0] = {
      runId: "city-check:direct-unconfigured-document",
      cityId: safetyEntry.cityId,
      municipalityCode: safetyEntry.municipalityCode,
      candidateUrl: route.navigationUrl,
      publisherContext: {
        publisherId: route.publisherId,
        publisherNavigationUrl: route.navigationUrl,
      },
      officialHopLimit: 2,
      assessmentAt: START_AT,
      authorityDirectory: fixture.installed.officialAuthorityDirectory,
      signal: new AbortController().signal,
    };
    const databaseChanges = fixture.database.prepare("SELECT total_changes() AS count").get();
    type Inspection = Awaited<ReturnType<CitySafetyOfficialDocumentPort["inspect"]>>;
    type InspectionOutcome =
      | { readonly kind: "fulfilled"; readonly value: Inspection }
      | { readonly kind: "rejected"; readonly error: unknown };
    const outcomes = await Promise.all([0, 1].map(() =>
      capturedPorts.safetyDocuments.inspect(input).then(
        (value: Inspection) => ({ kind: "fulfilled" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      )));
    const errors = outcomes.map((outcome: InspectionOutcome) => {
      expect(outcome.kind).toBe("rejected");
      if (outcome.kind !== "rejected") throw new Error("expected_unconfigured_document_rejection");
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toBe("city_source_adapter_unconfigured");
      return outcome.error as Error;
    });
    expect(errors[0]).not.toBe(errors[1]);
    expect(fixture.database.prepare("SELECT total_changes() AS count").get()).toEqual(databaseChanges);
  });

  test("preserves native safety document and search failures without events or durable residue", async () => {
    // Break caught: normalizing a native source error or emitting raw provider data before all sources validate.
    const rows = [
      {
        name: "document",
        sentinel: new Error("PRIVATE_NATIVE_DOCUMENT_PROVIDER_RAW_ERROR"),
        options(error: Error): SyntheticHarnessOptions {
          return {
            safetyDocuments: {
              inspect: async () => { throw error; },
            },
          };
        },
        expectedDocuments: 1,
        expectedSearches: 0,
      },
      {
        name: "search",
        sentinel: new Error("PRIVATE_NATIVE_SEARCH_PROVIDER_RAW_ERROR"),
        options(error: Error): SyntheticHarnessOptions {
          return {
            safetySearch: {
              search: async () => { throw error; },
            },
          };
        },
        expectedDocuments: 1,
        expectedSearches: 1,
      },
    ] as const;
    for (const row of rows) {
      const harness = await syntheticApplicationHarness(row.options(row.sentinel));
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:native-safety-${row.name}`,
      });
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: `continue:native-safety-${row.name}`,
      });
      resetSemanticGateObservations(harness);
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const fixedInputOffset = fixedRunnerHarness.inputs.length;
        const fixedPromiseOffset = fixedRunnerHarness.promises.length;
        const safetyPromiseOffset = safetyRunnerHarness.promises.length;
        const documentOffset = harness.calls.safetyDocumentInputs.length;
        const searchOffset = harness.calls.safetySearchInputs.length;
        const genericOffset = genericSealHarness.calls;
        const evidenceOffset = harness.calls.evidenceSeals.length;
        const knowledgeOffset = harness.calls.knowledgePublishes.length;
        const appendOffset = harness.calls.appends.length;
        const historyOffset = harness.calls.selectionHistory.length;
        const semanticOffset = planGateHarness.semanticEntries.length;
        const events: CityFrontierEvent[] = [];
        const continuation = harness.assembly.application.continueCityFrontier(
          prepared,
          (event: CityFrontierEvent) => {
            recursivelyFrozen(event);
            events.push(structuredClone(event));
          },
          new AbortController().signal,
        );
        const outcome = await continuation.then(
          (value: CityFrontierReadModel) => ({ kind: "fulfilled" as const, value }),
          (error: unknown) => ({ kind: "rejected" as const, error }),
        );
        await Promise.allSettled([
          continuation,
          ...fixedRunnerHarness.promises.slice(fixedPromiseOffset),
          ...safetyRunnerHarness.promises.slice(safetyPromiseOffset),
        ]);
        await nextEventLoopTurn();
        expect(outcome.kind).toBe("rejected");
        if (outcome.kind !== "rejected") throw new Error("expected_native_safety_rejection");
        expect(outcome.error).toBe(row.sentinel);
        expect(fixedRunnerHarness.inputs.slice(fixedInputOffset)).toHaveLength(3);
        expect(fixedRunnerHarness.promises.slice(fixedPromiseOffset)).toHaveLength(3);
        expect(safetyRunnerHarness.promises.slice(safetyPromiseOffset)).toHaveLength(1);
        expect(harness.calls.safetyDocumentInputs.length - documentOffset)
          .toBe(row.expectedDocuments);
        expect(harness.calls.safetySearchInputs.length - searchOffset)
          .toBe(row.expectedSearches);
        expect(planGateHarness.semanticEntries.length - semanticOffset).toBe(1);
        expect(events.map(({ type }) => type)).toEqual([
          "city_activated",
          "city_progress",
          "city_progress",
          "city_progress",
          "city_progress",
        ]);
        expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5]);
        expect(events.slice(1).map((event) => event.type === "city_progress"
          ? event.stage
          : "invalid")).toEqual([
          "source_started:si-city-safety",
          "source_started:si-city-long-term-rent",
          "source_started:si-city-urban-transit",
          "source_started:si-city-fixed-broadband",
        ]);
        const serializedEvents = JSON.stringify(events);
        expect(serializedEvents).not.toContain(row.sentinel.message);
        expect(serializedEvents).not.toContain("PRIVATE_NATIVE");
        for (const value of harness.calls.safetySearchInputs.slice(searchOffset) as Array<{
          readonly query: string;
        }>) expect(serializedEvents).not.toContain(value.query);
        expect(genericSealHarness.calls).toBe(genericOffset);
        expect(harness.calls.evidenceSeals).toHaveLength(evidenceOffset);
        expect(harness.calls.knowledgePublishes).toHaveLength(knowledgeOffset);
        expect(harness.calls.appends).toHaveLength(appendOffset);
        expect(harness.calls.selectionHistory).toHaveLength(historyOffset);
        expect(harness.state.root()).toEqual(started.revision);
        expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
          .toEqual(databaseChanges);
        const eventCount = events.length;
        await nextEventLoopTurn();
        expect(events).toHaveLength(eventCount);
      }
    }
  });

  test("continues one city through bounded sources, durable authority and the exact private event trace", async () => {
    // Break caught: source-owned time/URLs or a projection assembled before durable replay enters the model.
    const harness = await syntheticApplicationHarness({ discriminatingClock: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:continue-success",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:ljubljana",
    });
    resetContinuationPreflightObservations(harness);
    harness.calls.source.splice(0);
    harness.calls.fixedRouteInputs.splice(0);
    harness.calls.deadlinePolicyDates.splice(0);
    harness.calls.scheduledDeadlines.splice(0);
    harness.calls.evidenceSeals.splice(0);
    harness.calls.knowledgePublishes.splice(0);
    harness.calls.appends.splice(0);
    harness.calls.clocks.splice(0);
    harness.calls.safetySearchInputs.splice(0);
    harness.calls.safetyDocumentInputs.splice(0);
    harness.calls.fixedRouteOutputs.splice(0);
    harness.calls.safetySearchOutputs.splice(0);
    harness.calls.safetyDocumentOutputs.splice(0);
    fixedRunnerHarness.inputs.splice(0);
    genericSealHarness.calls = 0;
    harness.fixture.policyCalls.canonicalTargets.splice(0);
    harness.fixture.policyCalls.evaluations.splice(0);
    harness.fixture.policyCalls.values.splice(0);
    harness.fixture.policyCalls.sourcePeriods.splice(0);
    planGateHarness.fixed.splice(0);
    planGateHarness.directories.splice(0);
    planGateHarness.safetyPlans.splice(0);
    planGateHarness.definitionStructures.splice(0);
    planGateHarness.defaults.splice(0);
    planGateHarness.definitions.splice(0);
    planGateHarness.semanticEntries.splice(0);
    planGateHarness.order.splice(0);
    planGateHarness.beforeSemantic = () => ({
      evidenceCanonicals: structuredClone(harness.calls.evidenceCanonicals),
      evidenceHashes: structuredClone(harness.calls.evidenceHashes),
      evidenceSigns: structuredClone(harness.calls.evidenceSigns),
      completedEvidence: harness.calls.authorityOrder.filter((value) =>
        value.startsWith("evidence.")).length,
      knowledge: harness.calls.authorityOrder.filter((value) =>
        value.startsWith("knowledge.")).length,
      flightIdentities: harness.calls.flightIdentityCanonicals.length,
      fixedRunnerInputs: fixedRunnerHarness.inputs.length,
      fixedSourceCalls: harness.calls.fixedRouteInputs.length,
      safetySearchCalls: harness.calls.safetySearchInputs.length,
      safetyDocumentCalls: harness.calls.safetyDocumentInputs.length,
      genericSeals: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
    });
    const events: CityFrontierEvent[] = [];

    const result = await harness.assembly.application.continueCityFrontier(
      prepared,
      async (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        events.push(structuredClone(event));
      },
      new AbortController().signal,
    );
    const appendOffset = harness.calls.appendAuthorityOffsets[0]!;

    expect(harness.calls.authorityOrder.slice(0, 6)).toEqual([
      `frontier.command:${started.runId}:continue:ljubljana`,
      `frontier.head:${started.runId}`,
      `ranking:${started.ranking.id}`,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${started.catalog.id}`,
    ]);
    expect(harness.calls.rankingResults).not.toEqual([]);
    expect(harness.calls.exactPackageKeys).toHaveLength(1);
    expect(harness.calls.manifestKeys).toHaveLength(1);
    expect(harness.calls.exactPackageKeys[0]).toBe(
      harness.calls.rankingResults[0]!.installedPackageContext,
    );
    expect(harness.calls.manifestKeys[0]).toBe(
      harness.calls.rankingResults[0]!.installedPackageContext,
    );
    expect(harness.calls.manifestResults).toHaveLength(1);
    expectManifestAuthority(
      harness.calls.manifestResults[0] as InstalledCityPackageManifest,
      harness.calls.manifestKeys[0]!,
      harness.fixture.installed.installedPackageManifest.id,
    );
    const gateManifest = harness.calls.manifestResults[0] as InstalledCityPackageManifest;
    expectAdministrativeManifestBindings(gateManifest, harness.fixture.installed);
    const expectedFixedPlans = harness.fixture.installed.catalog.members.flatMap(({ cityId }) =>
      harness.fixture.installed.fixedPlansByCityId[cityId]!);
    const expectedFixedOrder = harness.fixture.installed.catalog.members.flatMap(({ cityId }) => [
      `fixed:${cityId}:si-city-long-term-rent`,
      `fixed:${cityId}:si-city-urban-transit`,
      `fixed:${cityId}:si-city-fixed-broadband`,
    ]);
    expect(planGateHarness.semanticEntries).toHaveLength(1);
    const semanticEntry = planGateHarness.semanticEntries[0]!;
    const gateSnapshot = semanticEntry.gateSnapshot;
    expect(gateSnapshot.fixed.map(({ value }) => value)).toEqual(expectedFixedPlans);
    expect(gateSnapshot.fixed.map(({ expectedSourceId }) => expectedSourceId)).toEqual(
      harness.fixture.installed.catalog.members.flatMap(() => [
        "si-city-long-term-rent",
        "si-city-urban-transit",
        "si-city-fixed-broadband",
      ]),
    );
    expect(gateSnapshot.order).toEqual([
      ...expectedFixedOrder,
      "directory",
      "safety-plan",
      "definitions",
      "defaults",
      "semantic-verifier",
    ]);
    expect(planGateHarness.order.slice(0, gateSnapshot.order.length)).toEqual(gateSnapshot.order);
    expect(gateSnapshot.directories).toHaveLength(1);
    expect(gateSnapshot.directories[0]![0])
      .toEqual(harness.fixture.installed.officialAuthorityDirectory);
    expect(gateSnapshot.safetyPlans).toHaveLength(1);
    expect(gateSnapshot.safetyPlans[0]![0])
      .toEqual(harness.fixture.installed.safetySourcePlan);
    expect(gateSnapshot.definitions).toHaveLength(1);
    expect(gateSnapshot.definitions[0]).toEqual([
      harness.fixture.installed.criterionDefinitions,
      gateManifest.criteria.definitionIds,
      gateManifest.criteria.evaluatorVersionIds,
    ]);
    expect(gateSnapshot.defaults).toHaveLength(1);
    expect(gateSnapshot.defaults[0]![0]).toEqual(harness.fixture.installed.criteriaDefaults);
    expect(gateSnapshot.defaults[0]![1]).toBe(gateManifest.criteria.defaultsMappingVersion);
    expect(semanticEntry).toMatchObject({
      fixedCount: expectedFixedPlans.length,
      directoryCount: 1,
      safetyPlanCount: 1,
      defaultsCount: 1,
      definitionsCount: 1,
    });
    const preSemantic = semanticEntry.preSemantic as {
      readonly evidenceCanonicals: typeof harness.calls.evidenceCanonicals;
      readonly evidenceHashes: typeof harness.calls.evidenceHashes;
      readonly evidenceSigns: typeof harness.calls.evidenceSigns;
      readonly completedEvidence: number;
      readonly knowledge: number;
      readonly flightIdentities: number;
      readonly fixedRunnerInputs: number;
      readonly fixedSourceCalls: number;
      readonly safetySearchCalls: number;
      readonly safetyDocumentCalls: number;
      readonly genericSeals: number;
      readonly evidenceSeals: number;
      readonly knowledgePublishes: number;
      readonly appends: number;
    };
    const expectedGateValues = [
      manifestPayload(gateManifest),
      ...expectedFixedPlans,
      harness.fixture.installed.safetySourcePlan,
      harness.fixture.installed.officialAuthorityDirectory,
      harness.fixture.installed.criteriaDefaults,
      harness.fixture.installed.criterionDefinitions,
    ];
    expect(preSemantic.evidenceCanonicals.map(({ value }) => value)).toEqual(expectedGateValues);
    expect(preSemantic.evidenceHashes.map(({ value }) => value))
      .toEqual(preSemantic.evidenceCanonicals.map(({ result }) => result));
    expect(preSemantic.evidenceHashes.map(({ result }) => result)).toEqual([
      gateManifest.payloadHash,
      ...expectedGateValues.slice(1).map((value) =>
        EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(value))),
    ]);
    expect(preSemantic.evidenceSigns).toEqual([]);
    expect({
      completedEvidence: preSemantic.completedEvidence,
      knowledge: preSemantic.knowledge,
      flightIdentities: preSemantic.flightIdentities,
      fixedRunnerInputs: preSemantic.fixedRunnerInputs,
      fixedSourceCalls: preSemantic.fixedSourceCalls,
      safetySearchCalls: preSemantic.safetySearchCalls,
      safetyDocumentCalls: preSemantic.safetyDocumentCalls,
      genericSeals: preSemantic.genericSeals,
      evidenceSeals: preSemantic.evidenceSeals,
      knowledgePublishes: preSemantic.knowledgePublishes,
      appends: preSemantic.appends,
    }).toEqual({
      completedEvidence: 0,
      knowledge: 0,
      flightIdentities: 0,
      fixedRunnerInputs: 0,
      fixedSourceCalls: 0,
      safetySearchCalls: 0,
      safetyDocumentCalls: 0,
      genericSeals: 0,
      evidenceSeals: 0,
      knowledgePublishes: 0,
      appends: 0,
    });
    expect(gateManifest.criteria.evaluatorRegistryVersionId).toBe("task14-evaluator-registry@1");
    expect(gateManifest.criteria.evaluatorVersionIds).toEqual(Object.fromEntries(
      harness.fixture.installed.criterionDefinitions.map((definition) => [
        definition.criterionId,
        definition.evaluatorVersion,
      ]),
    ));
    expect(gateManifest.valueValidatorVersionId).toBe("task14-value-validator@1");
    expect(gateManifest.sourcePeriodValidatorVersionId).toBe("task14-period-validator@1");
    const semanticInputs = semanticEntry.args[1] as {
      readonly evaluators: CityCriterionEvaluatorRegistry;
    };
    const gatePackage = harness.calls.installedPackageResults[0]!;
    for (const criterionId of CITY_CRITERION_IDS) {
      expect(semanticInputs.evaluators[criterionId].canonicalizeTarget)
        .toBe(gatePackage.evaluatorRegistry[criterionId].canonicalizeTarget);
      expect(semanticInputs.evaluators[criterionId].evaluate)
        .toBe(gatePackage.evaluatorRegistry[criterionId].evaluate);
    }

    const identity = {
      schemaVersion: "city-check-run@1",
      runId: started.runId,
      cityId: "ljubljana",
      rankingSnapshotId: started.ranking.id,
    } as const;
    const checkId = `city-check:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(identity),
    )}`;
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    const commonDeadline = new Date(
      harness.calls.deadlinePolicyDates[0]!.valueOf() + 45_000,
    ).toISOString();
    const fixedRouteAttempts = harness.calls.fixedRouteInputs.map((value) => {
      const input = value as {
        readonly cityCheckRunId: string;
        readonly sourceId: SloveniaCityFixedSourceId;
        readonly assessmentAt: string;
        readonly deadlineAt: string;
        readonly routeIndex: number;
        readonly route: { readonly navigationUrl: string };
      };
      return {
        cityCheckRunId: input.cityCheckRunId,
        sourceId: input.sourceId,
        assessmentAt: input.assessmentAt,
        deadlineAt: input.deadlineAt,
        routeIndex: input.routeIndex,
        navigationUrl: input.route.navigationUrl,
      };
    });
    expect(fixedRouteAttempts).toHaveLength(5);
    for (const [index, plan] of
      harness.fixture.installed.fixedPlansByCityId.ljubljana!.entries()) {
      expect(fixedRouteAttempts.filter(({ sourceId }) => sourceId === plan.sourceId)).toEqual(
        plan.routes.slice(0, index === 2 ? 1 : 2).map((route, routeIndex) => ({
          cityCheckRunId: checkId,
          sourceId: plan.sourceId,
          assessmentAt: START_AT,
          deadlineAt: commonDeadline,
          routeIndex,
          navigationUrl: route.navigationUrl,
        })),
      );
    }
    expect(harness.calls.deadlinePolicyDates).toHaveLength(3);
    expect(new Set(harness.calls.deadlinePolicyDates.map((value) => value.toISOString())).size)
      .toBe(1);
    expect(new Set(harness.calls.deadlinePolicyDates).size).toBe(3);
    expect(harness.calls.scheduledDeadlines).toEqual([
      commonDeadline,
      commonDeadline,
      commonDeadline,
    ]);
    expect(fixedRunnerHarness.inputs).toHaveLength(3);
    const fixedRunnerInputs = fixedRunnerHarness.inputs as Array<
      CityFixedSourceRunInput<SloveniaCityFixedSourceId>
    >;
    expect(fixedRunnerInputs.map(({ sourceId }) => sourceId)).toEqual([
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ]);
    const runnerPackage = harness.calls.installedPackageResults.at(-1)!;
    expect(fixedRunnerInputs.every(({ validateValue, validateSourcePeriod }) =>
      validateValue === runnerPackage.validateValue &&
      validateSourcePeriod === runnerPackage.validateSourcePeriod)).toBe(true);
    expect(new Set(fixedRunnerInputs.map(({ deadlineScheduler }) => deadlineScheduler)).size).toBe(1);
    expect(fixedRunnerInputs.every(({ deadlineScheduler }) =>
      deadlineScheduler !== harness.capabilities.fixedDeadlineScheduler)).toBe(true);
    expect(new Set(fixedRunnerInputs.map(({ now }) => now)).size).toBe(3);
    expect(fixedRunnerInputs.every(({ now }) =>
      (now as unknown) !== (harness.capabilities.clock as unknown))).toBe(true);
    const validatedPlans = [
      harness.fixture.installed.fixedPlansByCityId.ljubljana![0]!,
      harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!,
    ];
    const expectedValueValidations = validatedPlans.map((plan) => ({
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      policyVersion: plan.claimContract.valuePolicyVersion,
      value: "1",
      unit: plan.claimContract.unit,
      denominator: plan.claimContract.denominator,
    }));
    const expectedValueKeys = new Set(expectedValueValidations.map((value) =>
      DECISION_INTEGRITY.canonical(value)));
    const valueKeys = harness.fixture.policyCalls.values.map((value) =>
      DECISION_INTEGRITY.canonical(value));
    expect(valueKeys.every((value) => expectedValueKeys.has(value))).toBe(true);
    expect([...expectedValueKeys].every((value) => valueKeys.includes(value))).toBe(true);
    expect(new Set(valueKeys)).toEqual(expectedValueKeys);
    const expectedPeriodValidations = validatedPlans.map((plan) => ({
      sourceId: plan.sourceId,
      policyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      sourcePeriod: "2025",
      assessmentAt: START_AT,
    }));
    const expectedPeriodKeys = new Set(expectedPeriodValidations.map((value) =>
      DECISION_INTEGRITY.canonical(value)));
    const periodKeys = harness.fixture.policyCalls.sourcePeriods.map((value) =>
      DECISION_INTEGRITY.canonical(value));
    expect(periodKeys.every((value) => expectedPeriodKeys.has(value))).toBe(true);
    expect([...expectedPeriodKeys].every((value) => periodKeys.includes(value))).toBe(true);
    expect(new Set(periodKeys)).toEqual(expectedPeriodKeys);
    expect(harness.calls.fixedRouteInputs.every((value) => {
      const input = value as { readonly attemptedAt: string; readonly signal: AbortSignal };
      return input.signal instanceof AbortSignal &&
        harness.calls.clocks.filter((clock) => clock === input.attemptedAt).length === 1;
    })).toBe(true);
    const safetyEntry = harness.fixture.installed.safetySourcePlan.entries[0]!;
    const expectedQueries = buildCitySafetyQueries(
      safetyEntry,
      harness.fixture.installed.officialAuthorityDirectory,
      START_AT,
      harness.fixture.installed.catalog,
      DECISION_INTEGRITY,
    );
    expect(harness.calls.safetySearchInputs.map((value) => {
      const input = value as {
        readonly queryId: string;
        readonly query: string;
        readonly resultLimit: number;
        readonly signal: AbortSignal;
      };
      expect(input.signal).toBeInstanceOf(AbortSignal);
      return { queryId: input.queryId, query: input.query, resultLimit: input.resultLimit };
    })).toEqual(expectedQueries.map((query, index) => ({
      queryId: `city-safety-query:${checkId}:${index + 1}`,
      query,
      resultLimit: 9,
    })));
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(harness.calls.safetyDocumentInputs[0]).toEqual(expect.objectContaining({
      runId: checkId,
      cityId: "ljubljana",
      municipalityCode: safetyEntry.municipalityCode,
      candidateUrl: safetyEntry.configuredRoutes[0]!.navigationUrl,
      assessmentAt: START_AT,
      authorityDirectory: harness.fixture.installed.officialAuthorityDirectory,
      officialHopLimit: 2,
      signal: expect.any(AbortSignal),
    }));

    expect(events.map(({ type }) => type)).toEqual([
      "city_activated",
      ...Array.from({ length: 10 }, () => "city_progress" as const),
      "city_revision_committed",
      "city_continuation_completed",
    ]);
    expect(events.map(({ sequence }) => sequence))
      .toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    for (const event of events) {
      expect(event.runId).toBe(started.runId);
      expect(event.baseRevisionId).toBe(started.revision.id);
      if ("cityId" in event) expect(event.cityId).toBe("ljubljana");
      const common = ["type", "runId", "baseRevisionId", "sequence", "occurredAt"];
      const expectedKeys = event.type === "city_activated"
        ? [...common, "cityId", "rank"]
        : event.type === "city_progress"
          ? [...common, "cityId", "stage", ...("sourceUrl" in event ? ["sourceUrl"] : [])]
          : event.type === "city_revision_committed"
            ? [...common, "marker", "revision"]
            : [...common, "readModel"];
      expect(Reflect.ownKeys(event).sort()).toEqual(expectedKeys.sort());
    }
    expect(events[0]).toMatchObject({ type: "city_activated", cityId: "ljubljana", rank: 1 });
    expect(events.every(({ occurredAt }) => occurredAt === new Date(occurredAt).toISOString()))
      .toBe(true);
    expect(events.every(({ occurredAt }) => harness.calls.clocks.includes(occurredAt))).toBe(true);
    const eventTimes = events.map(({ occurredAt }) => occurredAt);
    expect(new Set(eventTimes).size).toBe(13);
    expect(eventTimes.every((value) => harness.calls.clocks.filter((clock) => clock === value).length === 1))
      .toBe(true);
    expect(eventTimes.every((value, index, values) =>
      index === 0 || values[index - 1]! <= value)).toBe(true);
    expect(harness.calls.fixedRouteInputs.every((value) => {
      const input = value as { readonly attemptedAt: string };
      return harness.calls.clocks.includes(input.attemptedAt) &&
        input.attemptedAt === new Date(input.attemptedAt).toISOString();
    })).toBe(true);
    const progress = events.filter((event) => event.type === "city_progress");
    expect(progress.map(({ stage }) => stage)).toEqual([
      "source_started:si-city-safety",
      "source_started:si-city-long-term-rent",
      "source_started:si-city-urban-transit",
      "source_started:si-city-fixed-broadband",
      "source_completed:si-city-safety",
      "source_completed:si-city-long-term-rent",
      "source_completed:si-city-urban-transit",
      "source_completed:si-city-fixed-broadband",
      "evidence_verified",
      "knowledge_published",
    ]);
    expect(progress.map((event) => "sourceUrl" in event ? event.sourceUrl : undefined)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      harness.fixture.installed.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl,
      harness.fixture.installed.fixedPlansByCityId.ljubljana![0]!.routes[1]!.navigationUrl,
      harness.fixture.installed.fixedPlansByCityId.ljubljana![1]!.routes[1]!.navigationUrl,
      harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!.routes[0]!.navigationUrl,
      undefined,
      undefined,
    ]);
    expect(JSON.stringify(events)).not.toMatch(/query|snippet|credential|raw_error|synthetic-search/);

    expect(harness.calls.evidenceSeals).toHaveLength(1);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    expect(Reflect.ownKeys(evidenceInput)).not.toContain("rulesVersion");
    expect(evidenceInput.cityCheckRunId).toBe(checkId);
    expect(evidenceInput.evidenceRulesVersion)
      .toBe(started.ranking.installedPackageContext.evidenceRulesVersion);
    expect(evidenceInput.genericEvidence.snapshot.rulesVersion).toBe(evidenceInput.evidenceRulesVersion);
    const expectedContext: CityEvidenceContext = {
      schemaVersion: "city-evidence-context@1",
      cityCheckRunId: checkId,
      frontierRunId: started.runId,
      cityId: "ljubljana",
      countryCode: started.ranking.installedPackageContext.countryCode,
      packageId: started.ranking.installedPackageContext.packageId,
      packageSchemaVersion: started.ranking.installedPackageContext.packageSchemaVersion,
      catalogRevisionId: started.ranking.installedPackageContext.catalogRevisionId,
      criteriaSnapshotId: started.criteria.id,
      rankingSnapshotId: started.ranking.id,
      definitionIds: {
        safety: harness.fixture.installed.safetySourcePlan.definitionId,
        long_term_rent: harness.fixture.installed.fixedPlansByCityId.ljubljana![0]!.definitionId,
        urban_transit: harness.fixture.installed.fixedPlansByCityId.ljubljana![1]!.definitionId,
        fixed_broadband: harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!.definitionId,
      },
      evidenceRulesVersion: started.ranking.installedPackageContext.evidenceRulesVersion,
      assessmentAt: started.ranking.assessmentAt,
      completedAt: evidenceInput.completedAt,
    };
    expect(evidenceInput).toMatchObject(expectedContext);
    expect(evidenceInput.genericEvidence.snapshot.contextHash)
      .toBe(cityEvidenceContextHash(expectedContext, DECISION_INTEGRITY));
    expect(evidenceInput.fixedAttemptLedgers.map(({ sourceId }) => sourceId)).toEqual([
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ]);
    expect(evidenceInput.fixedAttemptLedgers.every(({ cityCheckRunId, cityId, assessmentAt }) =>
      cityCheckRunId === checkId && cityId === "ljubljana" &&
      assessmentAt === started.ranking.assessmentAt)).toBe(true);
    type CapturedFixedOutput = {
      readonly sourceId: SloveniaCityFixedSourceId;
      readonly output: {
        readonly kind: "verified" | "rejected";
        readonly attempt: CityEvidenceSealInput["fixedAttemptLedgers"][number]["attempts"][number];
        readonly parserEntry: { readonly artifacts: readonly LiveCapturedArtifact<SloveniaCityFixedSourceId>[] };
        readonly claims?: readonly [{ readonly claimId: string }];
      };
    };
    const fixedOutputs = harness.calls.fixedRouteOutputs as CapturedFixedOutput[];
    const fixedOutputsInLedgerOrder = evidenceInput.fixedAttemptLedgers.flatMap((ledger) =>
      fixedOutputs.filter(({ sourceId }) => sourceId === ledger.sourceId)
        .sort((left, right) => left.output.attempt.index - right.output.attempt.index));
    for (const ledger of evidenceInput.fixedAttemptLedgers) {
      const outputs = fixedOutputsInLedgerOrder.filter(({ sourceId }) => sourceId === ledger.sourceId);
      expect(ledger.attempts).toEqual(outputs.map(({ output }) => output.attempt));
      const verified = outputs.find(({ output }) => output.kind === "verified");
      expect(ledger.result).toEqual(verified === undefined
        ? { kind: "unknown", reason: "not_found" }
        : { kind: "verified", claimIds: verified.output.attempt.disposition === "accepted"
            ? verified.output.attempt.claimIds
            : [] });
    }
    expect(evidenceInput.safetyAttemptLedger).toMatchObject({
      cityId: "ljubljana",
      catalogRevisionId: started.ranking.installedPackageContext.catalogRevisionId,
      sourcePlanId: harness.fixture.installed.safetySourcePlan.id,
      authorityDirectoryId: harness.fixture.installed.officialAuthorityDirectory.id,
      assessmentAt: started.ranking.assessmentAt,
    });
    expect(harness.calls.safetySearchOutputs).toEqual(Array.from(
      { length: 3 },
      () => ({ kind: "completed", providerId: "synthetic-search", urls: [] }),
    ));
    expect(evidenceInput.safetyAttemptLedger.queries.map(({ queryId, query, outcome }) => ({
      queryId,
      query,
      outcome,
    }))).toEqual(expectedQueries.map((query, index) => ({
      queryId: `city-safety-query:${checkId}:${index + 1}`,
      query,
      outcome: { kind: "completed", returnedUrls: [] },
    })));
    const safetyInspection = harness.calls.safetyDocumentOutputs[0] as {
      readonly detail: {
        readonly officialTrace: unknown;
        readonly artifactRefs: readonly unknown[];
        readonly reviewedOfficial: unknown;
        readonly mediaType: string;
        readonly retentionPolicyId: string;
        readonly transientRawDeleted: boolean;
        readonly disposition: "rejected";
        readonly reason: string;
      };
      readonly artifacts: readonly LiveCapturedArtifact<"si-city-safety">[];
    };
    expect(evidenceInput.safetyAttemptLedger.candidates).toEqual([{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: safetyEntry.configuredRoutes[0]!.navigationUrl,
      officialTrace: safetyInspection.detail.officialTrace,
      reviewedOfficial: safetyInspection.detail.reviewedOfficial,
      mediaType: safetyInspection.detail.mediaType,
      retentionPolicyId: safetyInspection.detail.retentionPolicyId,
      transientRawDeleted: safetyInspection.detail.transientRawDeleted,
      artifactRefs: safetyInspection.detail.artifactRefs,
      disposition: safetyInspection.detail.disposition,
      reason: safetyInspection.detail.reason,
    }]);
    expect(evidenceInput.safetyAttemptLedger.result).toEqual({
      kind: "unknown",
      reason: "not_found",
    });
    const expectedArtifacts = [
      ...safetyInspection.artifacts,
      ...fixedOutputsInLedgerOrder.flatMap(({ output }) => output.parserEntry.artifacts),
    ];
    expect(evidenceInput.artifacts).toEqual(expectedArtifacts);
    expect(evidenceInput.genericEvidence.snapshot.claims).toEqual(
      fixedOutputsInLedgerOrder.flatMap(({ output }) => output.claims ?? []),
    );
    const artifactIds = evidenceInput.artifacts.map(({ artifactId }) => artifactId);
    expect(new Set(artifactIds).size).toBe(artifactIds.length);
    expect(evidenceInput.artifacts.every(({ bytes, sha256 }) =>
      createHash("sha256").update(bytes).digest("hex") === sha256)).toBe(true);
    const sourceTimes = new Set([
      ...evidenceInput.fixedAttemptLedgers.flatMap(({ attempts, completedAt }) => [
        ...attempts.map(({ attemptedAt }) => attemptedAt),
        completedAt,
      ]),
      ...evidenceInput.safetyAttemptLedger.queries.map(({ searchedAt }) => searchedAt),
      evidenceInput.safetyAttemptLedger.completedAt,
      ...evidenceInput.artifacts.map(({ capturedAt }) => capturedAt),
      evidenceInput.completedAt,
    ]);
    expect(eventTimes.every((occurredAt) => !sourceTimes.has(occurredAt))).toBe(true);
    const fixedAttemptTimes = harness.calls.fixedRouteInputs.map((value) =>
      (value as { readonly attemptedAt: string }).attemptedAt);
    expect(new Set(fixedAttemptTimes).size).toBe(5);
    const priorClockSamples = new Set(harness.calls.clocks);
    for (const { now } of fixedRunnerInputs) {
      const beforeClockCalls = harness.calls.clocks.length;
      const sample = now();
      expect(harness.calls.clocks).toHaveLength(beforeClockCalls + 1);
      expect(harness.calls.clocks.at(-1)).toBe(sample);
      expect(sample).toBe(new Date(sample).toISOString());
      expect(priorClockSamples.has(sample)).toBe(false);
      priorClockSamples.add(sample);
    }
    expect(artifactIds).toEqual(evidenceInput.genericEvidence.manifest.artifacts
      .map(({ artifactId }) => artifactId));
    expect(evidenceInput.genericEvidence.manifest.entries.map(({ sourceId }) => sourceId)).toEqual([
      "si-city-safety",
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ]);
    expect(harness.calls.knowledgePublishes).toEqual([{
      evidenceSnapshotId: `${checkId}:evidence`,
      createdAt: evidenceInput.completedAt,
    }]);
    expect(harness.calls.clocks.filter((value) => value === evidenceInput.completedAt)).toHaveLength(1);
    expect(evidenceInput.completedAt >= started.ranking.assessmentAt).toBe(true);
    expect(harness.calls.fixedRouteInputs.every((value) =>
      (value as { readonly attemptedAt: string }).attemptedAt <= evidenceInput.completedAt)).toBe(true);
    expect(evidenceInput.safetyAttemptLedger.queries.every(({ searchedAt }) =>
      searchedAt <= evidenceInput.completedAt)).toBe(true);
    expect(harness.calls.appends).toHaveLength(1);
    expect(harness.calls.appends[0]!.createdAt).toBe(evidenceInput.completedAt);
    expect(harness.calls.appends[0]!.markers).toHaveLength(1);
    expect(result.revision).toEqual(harness.calls.appends[0]);
    const persistedMarker = result.revision.markers[0]!;
    expect(harness.calls.authorityOrder.slice(appendOffset)).toEqual([
      `frontier.chain:${started.runId}`,
      `ranking:${started.ranking.id}`,
      `frontier.command:${started.runId}:${started.revision.operation.commandId}`,
      `frontier.command:${started.runId}:continue:ljubljana`,
      `catalog.historical:${started.catalog.id}`,
      `criteria:${started.criteria.id}`,
      `branch:${started.preCityBranchCommitId}`,
      `knowledge.load:${persistedMarker.knowledgeRevisionId}`,
      `evidence.load:${persistedMarker.evidenceSnapshotId}`,
      `selection:${started.runId}`,
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "city_revision_committed",
      marker: harness.calls.appends[0]!.markers[0],
      revision: harness.calls.appends[0],
    });
    expect(evidenceInput.completedAt <= events.at(-2)!.occurredAt).toBe(true);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: "city_continuation_completed",
      readModel: result,
    }));
    recursivelyFrozen(result);

    const loadedEvidence = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(`${checkId}:evidence`));
    expect(loadedEvidence.snapshot.fixedAttemptLedgers).toEqual(evidenceInput.fixedAttemptLedgers);
    expect(loadedEvidence.snapshot.safetyAttemptLedger).toEqual(evidenceInput.safetyAttemptLedger);
    expect(loadedEvidence.genericEvidence.snapshot).toEqual(evidenceInput.genericEvidence.snapshot);
    expect(loadedEvidence.genericEvidence.manifest).toEqual(evidenceInput.genericEvidence.manifest);
    expect(evidenceInput.genericEvidence.canonicalManifest).toBe(
      EVIDENCE_INTEGRITY.canonical(loadedEvidence.genericEvidence.manifest),
    );
    const loadedKnowledge = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(
        loadedEvidence.snapshot.id,
      ));
    expect(loadedKnowledge).toBeDefined();
    const knowledge = loadedKnowledge!;
    expect(knowledge.facts).toHaveLength(4);
    const sourceIds = [
      "si-city-safety",
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ] as const;
    for (const [index, sourceId] of sourceIds.entries()) {
      const fact = knowledge.facts[index]!;
      const entry = loadedEvidence.genericEvidence.entries.find((candidate) =>
        candidate.sourceId === sourceId)!;
      const claims = loadedEvidence.genericEvidence.snapshot.claims.filter((claim) =>
        claim.sourceId === sourceId);
      const blockers = loadedEvidence.genericEvidence.snapshot.blockers.filter((blocker) =>
        blocker.sourceId === sourceId);
      if (claims.length === 1) {
        const claim = claims[0]!;
        expect(blockers).toEqual([]);
        expect(fact).toMatchObject({
          criterionId: claim.criterionId,
          definitionId: claim.definitionId,
          geoScope: { kind: claim.geoScope, officialAreaId: claim.officialAreaId },
          referencePeriod: claim.sourcePeriod,
          freshnessBasis: { policyVersion: claim.freshnessPolicyVersion },
          unit: claim.unit,
          denominator: claim.denominator,
          outcome: { kind: "verified", basis: claim.value },
          evidenceRefs: [{
            kind: "claim",
            sourceId,
            artifactId: claim.anchor.artifactId,
            locator: claim.anchor.locator,
            excerptHash: claim.anchor.excerptSha256,
            navigationUrl: entry.navigationUrl,
            resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
          }],
        });
      } else {
        expect(claims).toEqual([]);
        expect(blockers).toHaveLength(1);
        const blocker = blockers[0]!;
        expect(fact).toMatchObject({
          referencePeriod: null,
          outcome: { kind: "unknown", reason: blocker.kind },
          evidenceRefs: [{
            kind: "blocker",
            sourceId,
            blocker: blocker.kind,
            artifactIds: blocker.artifactIds,
            navigationUrl: entry.navigationUrl,
            ...(blocker.resolvedUrl === undefined
              ? {}
              : { resolvedEvidenceUrl: blocker.resolvedUrl }),
          }],
        });
      }
    }
    const lastSafetyAttempt = loadedEvidence.snapshot.safetyAttemptLedger.candidates.at(-1)!;
    if (lastSafetyAttempt.disposition !== "rejected") throw new Error("expected_safety_rejection");
    const projectedFacts = knowledge.facts.map((fact) => {
      const evidenceLinks = fact.evidenceRefs.filter((reference) => reference.kind === "claim")
        .map((reference) => ({
          sourceId: reference.sourceId,
          disposition: "accepted" as const,
          navigationUrl: reference.navigationUrl,
          resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
        }));
      const manualCheckLinks = fact.evidenceRefs.filter((reference) => reference.kind === "blocker")
        .map((reference) => ({
          sourceId: reference.sourceId,
          disposition: "reviewed_rejected" as const,
          navigationUrl: reference.navigationUrl,
          ...(reference.resolvedEvidenceUrl === undefined
            ? {}
            : { resolvedEvidenceUrl: reference.resolvedEvidenceUrl }),
          ...(fact.criterionId === "safety"
            ? {
                rejectionReason: lastSafetyAttempt.reason,
              }
            : {}),
        }));
      return {
        criterionId: fact.criterionId,
        definitionId: fact.definitionId,
        geoScope: fact.geoScope.kind,
        referencePeriod: fact.referencePeriod,
        freshnessBasis: fact.freshnessBasis.policyVersion,
        unit: fact.unit,
        denominator: fact.denominator,
        outcome: fact.outcome,
        evidenceLinks,
        manualCheckLinks,
      } satisfies CityCommittedFactProjection;
    }) as unknown as CityCommittedFactProjectionTuple;
    const authority: CityMarkerAuthorityProjection = {
      cityId: knowledge.cityId,
      knowledgeRevisionId: knowledge.id,
      evidenceSnapshotId: knowledge.evidenceSnapshotId,
      lastCheckedAt: knowledge.lastCheckedAt,
      facts: projectedFacts,
    };
    const expectedMarker = reconstructCityLiveMarker({
      assessmentAt: started.ranking.assessmentAt,
      criteria: result.criteria,
      evaluators: harness.fixture.installed.evaluatorRegistry,
      rank: 1,
      authority,
    });
    expect(result.revision.markers[0]).toEqual(expectedMarker);
    const safetyArtifact = safetyInspection.artifacts[0]!;
    expect(loadedEvidence.genericEvidence.manifest.artifacts).toContainEqual(expect.objectContaining({
      artifactId: safetyArtifact.artifactId,
      sha256: safetyArtifact.sha256,
      sourceId: "si-city-safety",
    }));
    expect(knowledge.facts[0]!.evidenceRefs).toContainEqual(expect.objectContaining({
      kind: "blocker",
      sourceId: "si-city-safety",
      artifactIds: [safetyArtifact.artifactId],
    }));
    expect(result.revision.markers[0]!.facts[0]!.manualCheckLinks).toEqual([{
      sourceId: "si-city-safety",
      disposition: "reviewed_rejected",
      navigationUrl: safetyEntry.configuredRoutes[0]!.navigationUrl,
      resolvedEvidenceUrl: safetyEntry.configuredRoutes[0]!.navigationUrl,
      rejectionReason: "http_not_found",
    }]);
    expect(result.revision.markers[0]).toMatchObject({
      knowledgeRevisionId: knowledge.id,
      evidenceSnapshotId: loadedEvidence.snapshot.id,
      lastCheckedAt: knowledge.lastCheckedAt,
      status: expectedMarker.status,
      visualStatus: expectedMarker.visualStatus,
      verificationCoverage: expectedMarker.verificationCoverage,
      unknownBasis: expectedMarker.unknownBasis,
      facts: expectedMarker.facts,
    });

    const fixedCalls = harness.calls.fixedRouteInputs.length;
    const safetyCalls = [...harness.calls.source];
    const presented = await harness.assembly.application.presentCityFrontier(started.runId);
    expect(presented).toEqual(result);
    expect(harness.calls.fixedRouteInputs).toHaveLength(fixedCalls);
    expect(harness.calls.source).toEqual(safetyCalls);
  });

  test("rejects a coherently sealed cold Present graph with a noncanonical city-check identity", async () => {
    // Break caught: trusting agreement between Frontier and Evidence instead of deriving check identity.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:cold-present-check-identity",
    });
    const cityId = started.ranking.ordered[0]!.cityId;
    const forgedCityCheckRunId = `city-check:${"f".repeat(64)}`;
    const evidenceInput = await legacyEvidenceInput(
      harness.fixture.installed,
      started.ranking,
      started.criteria,
      cityId,
      1,
      forgedCityCheckRunId,
    );
    const insertedEvidence = insertLegacyEvidence(harness.fixture.database, evidenceInput);
    const evidence = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(insertedEvidence.id));
    const knowledge = buildCityKnowledgeRevision({
      packageKey: harness.fixture.installed.installedPackageManifest.key,
      evidence,
      factContracts: legacyKnowledgeContracts(harness.fixture.installed, cityId),
      createdAt: evidenceInput.completedAt,
    }, DECISION_INTEGRITY);
    insertLegacyKnowledge(harness.fixture.database, knowledge);
    const markerAuthority = durableMarkerAuthority(harness, {
      cityId,
      knowledgeRevisionId: knowledge.id,
      evidenceSnapshotId: evidence.snapshot.id,
    });
    const marker = reconstructCityLiveMarker({
      assessmentAt: started.ranking.assessmentAt,
      criteria: started.criteria,
      evaluators: harness.fixture.installed.evaluatorRegistry,
      rank: 1,
      authority: markerAuthority,
    });
    const markerDigest = DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(marker));
    const projection = reconstructCityFrontier({
      ranking: {
        assessmentAt: started.ranking.assessmentAt,
        orderedCityIds: started.ranking.ordered.map(({ cityId: rankedCityId }) => rankedCityId),
        screenedExclusionCityIds: started.ranking.screenedExclusions.map(
          ({ cityId: excludedCityId }) => excludedCityId,
        ),
      },
      criteria: started.criteria,
      evaluators: harness.fixture.installed.evaluatorRegistry,
      predecessorMarkers: started.revision.markers,
      markerBindings: [{ marker, markerDigest, authority: markerAuthority }],
    });
    const forged = sealCityFrontierRevision({
      runId: started.runId,
      predecessorRevisionId: started.revision.id,
      rankingSnapshotId: started.ranking.id,
      markers: [marker],
      projection,
      operation: {
        kind: "city_completed",
        commandId: "continue:cold-present-check-identity",
        expectedHeadRevisionId: started.revision.id,
        cityId,
        cityCheckRunId: forgedCityCheckRunId,
      },
      createdAt: evidenceInput.completedAt,
    }, DECISION_INTEGRITY);
    harness.state.replaceChain([started.revision, forged]);
    harness.calls.authorityOrder.splice(0);

    await expect(harness.assembly.application.presentCityFrontier(started.runId))
      .rejects.toThrow("integrity_mismatch");
    expect(harness.calls.authorityOrder).not.toContain(`knowledge.load:${knowledge.id}`);
    expect(harness.calls.authorityOrder).not.toContain(`evidence.load:${evidence.snapshot.id}`);
  });

  test("authenticates every completed command envelope before Present or selection callbacks", async () => {
    // Break caught: chain HMACs were accepted while a target-prefix command index was absent/drifted.
    for (const index of [1, 2] as const) {
      for (const mode of ["missing", "substituted"] as const) {
        const harness = await syntheticApplicationHarness();
        const seeded = await seedCurrentSemanticKnowledge(harness, `command-index:${index}:${mode}`);
        const chain = harness.state.chain();
        expect(chain).toHaveLength(3);
        const target = chain[index]!;
        const alternate = chain[index === 1 ? 2 : 1]!;
        expect(target.operation.kind).toBe("city_completed");
        harness.state.overrideCommandResult(
          target.operation.commandId,
          mode === "missing"
            ? undefined
            : { operation: alternate.operation, revision: alternate },
        );

        for (const invoke of [
          () => harness.assembly.application.presentCityFrontier(seeded.head.runId),
          () => harness.assembly.selectionAuthority.loadCurrentTerminalSelectionAuthority(
            seeded.head.revision.id,
          ),
        ]) {
          harness.calls.authorityOrder.splice(0);
          await expect(invoke()).rejects.toThrow("integrity_mismatch");
          expect(harness.calls.authorityOrder).toContain(
            `frontier.command:${seeded.head.runId}:${target.operation.commandId}`,
          );
          expect(harness.calls.authorityOrder.some((entry) =>
            entry.startsWith("knowledge.load:") || entry.startsWith("evidence.load:"))).toBe(false);
        }
      }
    }
  });

  test("authenticates the complete Continue chain before marker callbacks or effects", async () => {
    // Break caught: a valid head hid a missing or authentically re-signed corrupt intermediate.
    for (const mode of ["missing", "resigned-intermediate"] as const) {
      const harness = await syntheticApplicationHarness();
      const seeded = await seedCurrentSemanticKnowledge(harness, `continue-chain:${mode}`);
      const authentic = harness.state.chain();
      const root = authentic[0]!;
      const intermediate = authentic[1]!;
      const terminal = authentic[2]!;
      if (intermediate.operation.kind !== "city_completed" ||
        terminal.operation.kind !== "city_completed") {
        throw new Error("invalid_continue_chain_fixture");
      }
      const driftedIntermediate = mode === "resigned-intermediate"
        ? sealCityFrontierRevision({
            runId: intermediate.runId,
            predecessorRevisionId: intermediate.predecessorRevisionId,
            rankingSnapshotId: intermediate.rankingSnapshotId,
            markers: intermediate.markers,
            projection: {
              kind: "working",
              nextUncheckedRank: intermediate.nextUncheckedRank,
              selectableCityIds: intermediate.markers.filter(({ status }) =>
                status === "selectable").map(({ cityId }) => cityId),
              phase: "verification_required",
            },
            operation: {
              ...intermediate.operation,
              cityCheckRunId: `city-check:${"f".repeat(64)}`,
            },
            createdAt: intermediate.createdAt,
          }, DECISION_INTEGRITY)
        : intermediate;
      const head = sealCityFrontierRevision({
        runId: terminal.runId,
        predecessorRevisionId: driftedIntermediate.id,
        rankingSnapshotId: terminal.rankingSnapshotId,
        markers: terminal.markers,
        projection: {
          kind: "working",
          nextUncheckedRank: terminal.nextUncheckedRank,
          selectableCityIds: terminal.markers.filter(({ status }) =>
            status === "selectable").map(({ cityId }) => cityId),
          phase: "verification_required",
        },
        operation: {
          ...terminal.operation,
          expectedHeadRevisionId: driftedIntermediate.id,
        },
        createdAt: terminal.createdAt,
      }, DECISION_INTEGRITY);
      harness.state.replaceChain(mode === "missing"
        ? [root, head]
        : [root, driftedIntermediate, head]);
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: seeded.head.runId,
        expectedRevisionId: head.id,
        commandId: `continue:after-corrupt-chain:${mode}`,
      });
      const before = {
        knowledge: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("knowledge.")).length,
        evidence: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("evidence.")).length,
        clocks: harness.calls.clocks.length,
        fixed: harness.calls.fixedRouteInputs.length,
        safety: harness.calls.source.length,
        seals: harness.calls.evidenceSeals.length,
        publishes: harness.calls.knowledgePublishes.length,
        appends: harness.calls.appends.length,
      };
      await expect(harness.assembly.application.continueCityFrontier(
        prepared,
        vi.fn(),
        new AbortController().signal,
      )).rejects.toThrow("integrity_mismatch");
      expect({
        knowledge: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("knowledge.")).length,
        evidence: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("evidence.")).length,
        clocks: harness.calls.clocks.length,
        fixed: harness.calls.fixedRouteInputs.length,
        safety: harness.calls.source.length,
        seals: harness.calls.evidenceSeals.length,
        publishes: harness.calls.knowledgePublishes.length,
        appends: harness.calls.appends.length,
      }).toEqual(before);
    }
  });

  test("authenticates the root command index on a committed Continue hit before presentation", async () => {
    // Break caught: the hit path authenticated completed commands but skipped the chain root index.
    for (const mode of ["missing", "substituted"] as const) {
      const harness = await syntheticApplicationHarness();
      const started = await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:hit-root-command:${mode}`,
      });
      const commandId = `continue:hit-root-command:${mode}`;
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId,
      });
      const committed = await harness.assembly.application.continueCityFrontier(
        prepared,
        vi.fn(),
        new AbortController().signal,
      );
      const hitPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId,
      });
      expect(hitPrepared).toEqual(prepared);
      harness.state.overrideCommandResult(
        started.revision.operation.commandId,
        mode === "missing"
          ? undefined
          : { operation: committed.revision.operation, revision: committed.revision },
      );
      const presentationEffects = () => ({
        criteria: harness.calls.reloads.filter((entry) => entry.startsWith("criteria:")).length,
        branch: harness.calls.reloads.filter((entry) => entry.startsWith("branch:")).length,
        knowledge: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("knowledge.")).length,
        evidence: harness.calls.authorityOrder.filter((entry) =>
          entry.startsWith("evidence.")).length,
        history: harness.calls.selectionHistory.length,
        clocks: harness.calls.clocks.length,
        fixed: harness.calls.fixedRouteInputs.length,
        safety: harness.calls.source.length,
        seals: harness.calls.evidenceSeals.length,
        publishes: harness.calls.knowledgePublishes.length,
        appends: harness.calls.appends.length,
        flights: harness.calls.flightIdentityCanonicals.length,
      });
      const before = presentationEffects();
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const caught = await harness.assembly.application.continueCityFrontier(
          hitPrepared,
          vi.fn(),
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(presentationEffects()).toEqual(before);
      }
      expect(errors[0]).not.toBe(errors[1]);
    }
  });

  test("returns fresh current terminal selection authority after complete semantic replay", async () => {
    // Break caught: exposing a structural terminal or a borrowed public read model as Task 15 authority.
    const harness = await syntheticApplicationHarness();
    const seeded = await seedCurrentSemanticKnowledge(harness, "selection-authority");
    expect(seeded.head.revision.kind).toBe("terminal");
    if (seeded.head.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");
    const terminal = seeded.head.revision;
    const presented = await harness.assembly.application.presentCityFrontier(terminal.runId);
    const stored = harness.state.artifacts();
    const resolvedEntries = harness.fixture.resolved.resolvedEntries.filter(({ countryCode }) =>
      countryCode === seeded.head.ranking.countryCode);
    expect(resolvedEntries).toHaveLength(1);
    const expectedPreCitySource: PreCityBranchSourceProjection = {
      profileSnapshotId: harness.fixture.relocation.id,
      preferenceProfileSnapshotId: harness.fixture.preference.id,
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      resolvedCountryEntry: resolvedEntries[0]!,
    };
    const expectedTerminal = reconstructCityFrontierRevision(stored.root, DECISION_INTEGRITY);
    expect(expectedTerminal.kind).toBe("terminal");
    const expectedRanking = reconstructCityRankingSnapshot(stored.ranking, DECISION_INTEGRITY);
    const expectedRankingKnowledge: readonly CityKnowledgeRankingProjection[] =
      harness.fixture.installed.catalog.members.map(({ cityId }) => {
        const knowledgeRevisionId = expectedRanking.knowledgeRevisionIds[cityId] ?? null;
        expect(knowledgeRevisionId).toBeNull();
        return { cityId, knowledgeRevisionId: null, facts: [] };
      });
    const expectedBranch = replayPreCityBranchCommit(
      stored.branch,
      expectedPreCitySource,
      DECISION_INTEGRITY,
    );
    const expectedFrontier = terminalFrontierAuthorityInput(
      harness,
      expectedTerminal as TerminalCityShortlistSnapshot,
      expectedRanking,
      seeded.head.criteria,
    );
    expect(reconstructCityFrontier(expectedFrontier)).toEqual({
      kind: "terminal",
      nextUncheckedRank: terminal.nextUncheckedRank,
      selectableCityIds: terminal.markers
        .filter(({ status }) => status === "selectable")
        .map(({ cityId }) => cityId),
      entries: terminal.entries,
      stopCondition: terminal.stopCondition,
    });

    const mutationEffects = () => ({
      source: harness.calls.source.length,
      publications: harness.calls.publications.length,
      clocks: harness.calls.clocks.length,
      deadlines: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      fixed: harness.calls.fixedRouteInputs.length,
      fixedRunnerInputs: fixedRunnerHarness.inputs.length,
      fixedRunnerPromises: fixedRunnerHarness.promises.length,
      safetyRunnerPromises: safetyRunnerHarness.promises.length,
      safetySearch: harness.calls.safetySearchInputs.length,
      safetyDocuments: harness.calls.safetyDocumentInputs.length,
      generic: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
      flight: harness.calls.flightIdentityCanonicals.length,
    });
    const invoke = async (): Promise<VerifiedCityTerminalSelectionAuthority> => {
      const beforeMutations = mutationEffects();
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const packageOffset = harness.calls.exactPackageKeys.length;
      const manifestOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const catalogOffset = harness.calls.catalogReads.length;
      const selectionOffset = harness.calls.selectionHistory.length;
      const resolvedOffset = harness.calls.resolvedCountryIds.length;
      const relocationOffset = harness.calls.relocationProfileIds.length;
      const preferenceOffset = harness.calls.preferenceProfileIds.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const fixedOffset = planGateHarness.fixed.length;
      const directoryOffset = planGateHarness.directories.length;
      const safetyOffset = planGateHarness.safetyPlans.length;
      const defaultsOffset = planGateHarness.defaults.length;
      const definitionsOffset = planGateHarness.definitions.length;
      const semanticOffset = planGateHarness.semanticEntries.length;
      const planOrderOffset = planGateHarness.order.length;
      const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
      planGateHarness.beforeSemantic = () => {
        harness.calls.authorityOrder.push("semantic-verifier");
        return {
          evidenceCanonicals: structuredClone(
            harness.calls.evidenceCanonicals.slice(canonicalOffset),
          ),
          evidenceHashes: structuredClone(harness.calls.evidenceHashes.slice(hashOffset)),
          evidenceSigns: structuredClone(harness.calls.evidenceSigns.slice(signOffset)),
        };
      };
      const authority = await harness.assembly.selectionAuthority
        .loadCurrentTerminalSelectionAuthority(terminal.id);
      const reloads = harness.calls.reloads.slice(reloadOffset);
      const order = harness.calls.authorityOrder.slice(orderOffset);
      const markerKnowledgeOrder = terminal.markers.map(({ knowledgeRevisionId }) =>
        `knowledge.load:${knowledgeRevisionId}`);
      const markerEvidenceOrder = terminal.markers.map(({ evidenceSnapshotId }) =>
        `evidence.load:${evidenceSnapshotId}`);
      expect(reloads.slice(0, 3)).toEqual([
        `frontier.revision:${terminal.id}`,
        `frontier.chain:${terminal.runId}`,
        `ranking:${seeded.head.ranking.id}`,
      ]);
      expect(reloads.filter((value) => value.startsWith("criteria:"))).toEqual([
        `criteria:${seeded.head.criteria.id}`,
      ]);
      expect(reloads.filter((value) => value.startsWith("branch:"))).toEqual([
        `branch:${seeded.head.preCityBranchCommitId}`,
      ]);
      expect(order.slice(0, 6)).toEqual([
        `frontier.revision:${terminal.id}`,
        `frontier.chain:${terminal.runId}`,
        `ranking:${seeded.head.ranking.id}`,
        "package.exact",
        "manifest.exact",
        `catalog.historical:${seeded.head.catalog.id}`,
      ]);
      expect(order.filter((value) => value.startsWith("knowledge.load:")))
        .toEqual(markerKnowledgeOrder);
      expect(order.filter((value) => value.startsWith("evidence.load:")))
        .toEqual(markerEvidenceOrder);
      expect(order.filter((value) => value === "semantic-verifier")).toEqual([
        "semantic-verifier",
      ]);
      expect(order.indexOf("semantic-verifier"))
        .toBeGreaterThan(order.indexOf(markerKnowledgeOrder.at(-1)!));
      expect(order.indexOf(markerEvidenceOrder[0]!))
        .toBeGreaterThan(order.indexOf("semantic-verifier"));
      expect(order.at(-1)).toBe(`selection:${terminal.runId}`);
      expect(harness.calls.rankingResults.slice(rankingOffset)).toHaveLength(1);
      const loadedRanking = harness.calls.rankingResults[rankingOffset]!;
      expect(harness.calls.exactPackageKeys.slice(packageOffset)).toEqual([
        loadedRanking.installedPackageContext,
      ]);
      expect(harness.calls.exactPackageKeys[packageOffset])
        .toBe(loadedRanking.installedPackageContext);
      expect(harness.calls.manifestKeys.slice(manifestOffset)).toEqual([
        loadedRanking.installedPackageContext,
      ]);
      expect(harness.calls.manifestKeys[manifestOffset])
        .toBe(loadedRanking.installedPackageContext);
      expect(harness.calls.manifestResults.slice(manifestResultOffset)).toHaveLength(1);
      const loadedManifest = harness.calls.manifestResults[manifestResultOffset] as
        InstalledCityPackageManifest;
      expectManifestAuthority(
        loadedManifest,
        loadedRanking.installedPackageContext,
        harness.fixture.installed.installedPackageManifest.id,
      );
      expectAdministrativeManifestBindings(loadedManifest, harness.fixture.installed);
      expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([
        `catalog.historical:${seeded.head.catalog.id}`,
      ]);
      expect(harness.calls.selectionHistory.slice(selectionOffset)).toEqual([terminal.runId]);
      expect(harness.calls.resolvedCountryIds.slice(resolvedOffset)).toEqual([
        harness.fixture.resolved.id,
      ]);
      expect(harness.calls.relocationProfileIds.slice(relocationOffset)).toEqual([
        harness.fixture.relocation.id,
      ]);
      expect(harness.calls.preferenceProfileIds.slice(preferenceOffset)).toEqual([
        harness.fixture.preference.id,
      ]);
      expect(harness.calls.evidenceCanonicals.slice(canonicalOffset)).toHaveLength(
        harness.fixture.installed.catalog.members.length * 3 + 5,
      );
      expect(harness.calls.evidenceHashes.slice(hashOffset)).toHaveLength(
        harness.fixture.installed.catalog.members.length * 3 + 5,
      );
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      expect(planGateHarness.semanticEntries.slice(semanticOffset)).toHaveLength(1);
      const semanticEntry = planGateHarness.semanticEntries[semanticOffset]!;
      expectSemanticGateEntry(harness, {
        ...semanticEntry,
        fixedCount: semanticEntry.fixedCount - fixedOffset,
        directoryCount: semanticEntry.directoryCount - directoryOffset,
        safetyPlanCount: semanticEntry.safetyPlanCount - safetyOffset,
        defaultsCount: semanticEntry.defaultsCount - defaultsOffset,
        definitionsCount: semanticEntry.definitionsCount - definitionsOffset,
        gateSnapshot: {
          fixed: semanticEntry.gateSnapshot.fixed.slice(fixedOffset),
          directories: semanticEntry.gateSnapshot.directories.slice(directoryOffset),
          safetyPlans: semanticEntry.gateSnapshot.safetyPlans.slice(safetyOffset),
          defaults: semanticEntry.gateSnapshot.defaults.slice(defaultsOffset),
          definitions: semanticEntry.gateSnapshot.definitions.slice(definitionsOffset),
          order: semanticEntry.gateSnapshot.order.slice(planOrderOffset),
        },
      }, {
        criteria: seeded.head.criteria,
        ranking: expectedRanking,
        root: expectedTerminal,
        knowledge: expectedRankingKnowledge,
      }, loadedRanking);
      expect(harness.fixture.policyCalls.evaluations.slice(evaluationOffset)).toHaveLength(
        harness.fixture.installed.catalog.members.length * CITY_CRITERION_IDS.length +
          terminal.markers.length * CITY_CRITERION_IDS.length,
      );
      expect(mutationEffects()).toEqual(beforeMutations);
      return authority;
    };

    const first = await invoke();
    const second = await invoke();
    expect(Reflect.ownKeys(first)).toEqual([
      "readModel",
      "terminal",
      "ranking",
      "preCityBranch",
      "preCitySource",
      "frontier",
    ]);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    recursivelyFrozen(first);
    recursivelyFrozen(second);
    recursivelyNotAliased(first, second);
    expect(first.readModel).toEqual(presented);
    expect(DECISION_INTEGRITY.canonical(first.readModel))
      .toBe(DECISION_INTEGRITY.canonical(presented));
    expect(Reflect.ownKeys(first.readModel)).toEqual([
      "runId",
      "assessmentAt",
      "resolvedCountryShortlistRevisionId",
      "countryCode",
      "preCityBranchCommitId",
      "registry",
      "catalog",
      "criteria",
      "ranking",
      "revision",
      "selections",
    ]);
    expect(Reflect.ownKeys(first.readModel)).not.toContain("selectionAuthority");
    expect(first.terminal).toEqual(expectedTerminal);
    expect(first.ranking).toEqual(expectedRanking);
    expect(first.preCityBranch).toEqual(expectedBranch);
    expect(first.preCitySource).toEqual(expectedPreCitySource);
    expect({ ...first.frontier, evaluators: undefined })
      .toEqual({ ...expectedFrontier, evaluators: undefined });
    expect(Reflect.ownKeys(first.frontier.evaluators)).toEqual(CITY_CRITERION_IDS);
    expect(first.frontier.evaluators).not.toBe(expectedFrontier.evaluators);
    for (const criterionId of CITY_CRITERION_IDS) {
      const actualEvaluator = first.frontier.evaluators[criterionId];
      const fixtureEvaluator = expectedFrontier.evaluators[criterionId];
      const criterion = seeded.head.criteria.criteria.find((candidate) =>
        candidate.criterionId === criterionId)!;
      const representativeInput = {
        criterion,
        fact: {
          criterionId,
          definitionId: actualEvaluator.definition.definitionId,
          geoScope: "municipality",
          referencePeriod: null,
          freshnessBasis: actualEvaluator.definition.freshnessPolicyVersion,
          unit: actualEvaluator.definition.unit,
          denominator: actualEvaluator.definition.denominator,
          outcome: { kind: "unknown" as const, reason: "source_unavailable" as const },
        },
        assessmentAt: seeded.head.ranking.assessmentAt,
      };
      expect(actualEvaluator.definition).toEqual(fixtureEvaluator.definition);
      expect(actualEvaluator.canonicalizeTarget(criterion.target))
        .toBe(fixtureEvaluator.canonicalizeTarget(criterion.target));
      expect(actualEvaluator.evaluate(structuredClone(representativeInput)))
        .toEqual(fixtureEvaluator.evaluate(structuredClone(representativeInput)));
      expect(actualEvaluator.canonicalizeTarget)
        .not.toBe(fixtureEvaluator.canonicalizeTarget);
      expect(actualEvaluator.evaluate).not.toBe(fixtureEvaluator.evaluate);
    }
    expect(replayPreCityBranchCommit(
      first.preCityBranch,
      first.preCitySource,
      DECISION_INTEGRITY,
    )).toEqual(first.preCityBranch);
    expect(createPreCityBranchCommit({
      source: expectedPreCitySource,
      createdAt: first.preCityBranch.createdAt,
    }, DECISION_INTEGRITY)).toEqual(first.preCityBranch);
    expect(reconstructCityFrontier(first.frontier)).toEqual(expectedFrontier.persisted);
    recursivelyNotAliased(first.readModel, presented);
    recursivelyNotAliased(first.terminal, stored.root);
    recursivelyNotAliased(first.ranking, stored.ranking);
    recursivelyNotAliased(first.preCityBranch, stored.branch);
    recursivelyNotAliased(first.frontier, expectedFrontier);
    expect(Reflect.ownKeys(harness.assembly)).toEqual(["application", "selectionAuthority"]);
    expect(Reflect.ownKeys(harness.assembly.application)).toEqual([
      "presentCityFrontierSetup",
      "startCityFrontier",
      "prepareCityFrontierContinuation",
      "continueCityFrontier",
      "continueCityFrontierWithSourceRecovery",
      "presentCityFrontier",
    ]);
    expect(Reflect.ownKeys(harness.assembly.application)).not.toContain("selectionAuthority");
  });

  test("rejects rehashed Criteria, Ranking and terminal-root reloads on both presentation surfaces", async () => {
    // Break caught: projecting a rich model from one structurally valid but cross-row-misbound load.
    const rows = ["criteria", "ranking", "root"] as const;
    const surfaces = ["public", "internal"] as const;
    for (const row of rows) {
      const harness = await syntheticApplicationHarness();
      const seeded = await seedCurrentSemanticKnowledge(harness, `presentation-reload:${row}`);
      expect(seeded.head.revision.kind).toBe("terminal");
      if (seeded.head.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");
      const terminal = seeded.head.revision;
      const stored = harness.state.artifacts();
      expect(stored.root).toEqual(terminal);
      expect(reconstructCityFrontierRevision(stored.root, DECISION_INTEGRITY)).toEqual(stored.root);
      const storedRootCanonical = DECISION_INTEGRITY.canonical(stored.root);
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      const immutableEffects = () => ({
        publications: harness.calls.publications.length,
        clocks: harness.calls.clocks.length,
        deadlines: harness.calls.deadlinePolicyDates.length,
        scheduled: harness.calls.scheduledDeadlines.length,
        source: harness.calls.source.length,
        fixedInputs: harness.calls.fixedRouteInputs.length,
        fixedRunnerInputs: fixedRunnerHarness.inputs.length,
        fixedRunnerPromises: fixedRunnerHarness.promises.length,
        safetyRunnerPromises: safetyRunnerHarness.promises.length,
        safetySearch: harness.calls.safetySearchInputs.length,
        safetyDocuments: harness.calls.safetyDocumentInputs.length,
        generic: genericSealHarness.calls,
        evidenceSeals: harness.calls.evidenceSeals.length,
        knowledgePublishes: harness.calls.knowledgePublishes.length,
        appends: harness.calls.appends.length,
        flight: harness.calls.flightIdentityCanonicals.length,
      });
      harness.state.overrideReloadDrift(row);
      const allErrors: Error[] = [];

      for (const surface of surfaces) {
        const surfaceErrors: Error[] = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const effectsBefore = immutableEffects();
          const reloadOffset = harness.calls.reloads.length;
          const orderOffset = harness.calls.authorityOrder.length;
          const rankingOffset = harness.calls.rankingResults.length;
          const packageOffset = harness.calls.exactPackageKeys.length;
          const packageResultOffset = harness.calls.installedPackageResults.length;
          const manifestOffset = harness.calls.manifestKeys.length;
          const manifestResultOffset = harness.calls.manifestResults.length;
          const catalogOffset = harness.calls.catalogReads.length;
          const readyOffset = harness.calls.readyPackageCountries.length;
          const selectionOffset = harness.calls.selectionHistory.length;
          const resolvedOffset = harness.calls.resolvedCountryIds.length;
          const relocationOffset = harness.calls.relocationProfileIds.length;
          const preferenceOffset = harness.calls.preferenceProfileIds.length;
          const forbiddenOffset = harness.calls.forbiddenPrepareCallbacks.length;
          const canonicalOffset = harness.calls.evidenceCanonicals.length;
          const hashOffset = harness.calls.evidenceHashes.length;
          const signOffset = harness.calls.evidenceSigns.length;
          const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
          const planBefore = planGateCounts();
          const continuation = surface === "public"
            ? harness.assembly.application.presentCityFrontier(terminal.runId)
            : harness.assembly.selectionAuthority
              .loadCurrentTerminalSelectionAuthority(terminal.id);
          const outcome = await continuation.then(
            (value: unknown) => ({ kind: "fulfilled" as const, value }),
            (error: unknown) => ({ kind: "rejected" as const, error }),
          );
          expect(outcome.kind).toBe("rejected");
          const error = (outcome as { readonly kind: "rejected"; readonly error: unknown }).error;
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe("integrity_mismatch");
          surfaceErrors.push(error as Error);
          allErrors.push(error as Error);

          const structuralPrefix = surface === "public"
            ? [`frontier.chain:${terminal.runId}`]
            : [
                `frontier.revision:${terminal.id}`,
                `frontier.chain:${terminal.runId}`,
              ];
          const reloads = harness.calls.reloads.slice(reloadOffset);
          const order = harness.calls.authorityOrder.slice(orderOffset);
          const planAfter = planGateCounts();
          const planDelta = Object.fromEntries(Object.keys(planAfter).map((key) => [
            key,
            planAfter[key]! - planBefore[key]!,
          ]));

          if (row === "ranking") {
            expect(reloads).toEqual([
              ...structuralPrefix,
              `ranking:${stored.ranking.id}`,
            ]);
            expect(order).toEqual(reloads);
            expect(harness.calls.rankingResults.slice(rankingOffset)).toHaveLength(1);
            expect(harness.calls.rankingResults[rankingOffset]!.id).not.toBe(stored.ranking.id);
            expect(harness.calls.exactPackageKeys).toHaveLength(packageOffset);
            expect(harness.calls.installedPackageResults).toHaveLength(packageResultOffset);
            expect(harness.calls.manifestKeys).toHaveLength(manifestOffset);
            expect(harness.calls.manifestResults).toHaveLength(manifestResultOffset);
            expect(harness.calls.catalogReads).toHaveLength(catalogOffset);
            expect(Object.values(planDelta).every((value) => value === 0)).toBe(true);
            expect(harness.calls.evidenceCanonicals).toHaveLength(canonicalOffset);
            expect(harness.calls.evidenceHashes).toHaveLength(hashOffset);
            expect(harness.calls.evidenceSigns).toHaveLength(signOffset);
            expect(harness.fixture.policyCalls.evaluations).toHaveLength(evaluationOffset);
          } else if (row === "criteria") {
            expect(reloads).toEqual([
              ...structuralPrefix,
              `ranking:${stored.ranking.id}`,
              `criteria:${stored.criteria.id}`,
            ]);
            expect(order).toEqual([
              ...structuralPrefix,
              `ranking:${stored.ranking.id}`,
              "package.exact",
              "manifest.exact",
              `catalog.historical:${stored.ranking.catalogRevisionId}`,
              `criteria:${stored.criteria.id}`,
            ]);
            expect(harness.calls.rankingResults.slice(rankingOffset)).toEqual([stored.ranking]);
            const loadedRanking = harness.calls.rankingResults[rankingOffset]!;
            expect(harness.calls.exactPackageKeys.slice(packageOffset)).toHaveLength(1);
            expect(harness.calls.exactPackageKeys[packageOffset])
              .toBe(loadedRanking.installedPackageContext);
            expect(harness.calls.installedPackageResults.slice(packageResultOffset)).toHaveLength(1);
            expect(harness.calls.manifestKeys.slice(manifestOffset)).toHaveLength(1);
            expect(harness.calls.manifestKeys[manifestOffset])
              .toBe(loadedRanking.installedPackageContext);
            expect(harness.calls.manifestResults.slice(manifestResultOffset)).toHaveLength(1);
            expectManifestAuthority(
              harness.calls.manifestResults[manifestResultOffset] as InstalledCityPackageManifest,
              loadedRanking.installedPackageContext,
              harness.fixture.installed.installedPackageManifest.id,
            );
            expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([
              `catalog.historical:${stored.ranking.catalogRevisionId}`,
            ]);
            expect(planDelta).toEqual({
              fixed: harness.fixture.installed.catalog.members.length * 3,
              directories: 1,
              safetyPlans: 1,
              definitionStructures: 0,
              defaults: 1,
              definitions: 1,
              semanticEntries: 0,
            });
            const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
            const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
            expect(canonicalCalls).toHaveLength(
              harness.fixture.installed.catalog.members.length * 3 + 5,
            );
            expect(hashCalls.map(({ value }) => value))
              .toEqual(canonicalCalls.map(({ result }) => result));
            expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
            expect(harness.fixture.policyCalls.evaluations).toHaveLength(evaluationOffset);
          } else {
            const expectedRootPrefix = surface === "public"
              ? [`frontier.chain:${terminal.runId}`]
              : [`frontier.revision:${terminal.id}`];
            expect(reloads).toEqual(expectedRootPrefix);
            expect(order).toEqual(expectedRootPrefix);
            expect(harness.calls.rankingResults).toHaveLength(rankingOffset);
            expect(harness.calls.exactPackageKeys).toHaveLength(packageOffset);
            expect(harness.calls.installedPackageResults).toHaveLength(packageResultOffset);
            expect(harness.calls.manifestKeys).toHaveLength(manifestOffset);
            expect(harness.calls.manifestResults).toHaveLength(manifestResultOffset);
            expect(harness.calls.catalogReads).toHaveLength(catalogOffset);
            expect(Object.values(planDelta).every((value) => value === 0)).toBe(true);
            expect(harness.calls.evidenceCanonicals).toHaveLength(canonicalOffset);
            expect(harness.calls.evidenceHashes).toHaveLength(hashOffset);
            expect(harness.calls.evidenceSigns).toHaveLength(signOffset);
            expect(harness.fixture.policyCalls.evaluations).toHaveLength(evaluationOffset);
          }

          expect(harness.calls.selectionHistory).toHaveLength(selectionOffset);
          expect(harness.calls.readyPackageCountries).toHaveLength(readyOffset);
          expect(harness.calls.resolvedCountryIds).toHaveLength(resolvedOffset);
          expect(harness.calls.relocationProfileIds).toHaveLength(relocationOffset);
          expect(harness.calls.preferenceProfileIds).toHaveLength(preferenceOffset);
          expect(harness.calls.forbiddenPrepareCallbacks).toHaveLength(forbiddenOffset);
          expect(immutableEffects()).toEqual(effectsBefore);
          expect(DECISION_INTEGRITY.canonical(harness.state.root())).toBe(storedRootCanonical);
          expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
            .toEqual(databaseChanges);
        }
        expect(surfaceErrors).toHaveLength(2);
        expect(surfaceErrors[0]).not.toBe(surfaceErrors[1]);
      }
      expect(new Set(allErrors).size).toBe(4);
    }
  });

  test("rejects working current and authenticated noncurrent terminal authority before semantics", async () => {
    // Break caught: treating any loader-visible revision or any current head as selection authority.
    const workingHarness = await syntheticApplicationHarness();
    const working = await workingHarness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: workingHarness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:selection-authority-working",
    });
    expect(working.revision.kind).toBe("working");
    const assertStructuralStop = async (
      harness: SyntheticApplicationHarness,
      revision: CityFrontierRevision,
    ): Promise<void> => {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const before = semanticDownstreamEffects(harness);
      const rankingOffset = harness.calls.rankingResults.length;
      const packageOffset = harness.calls.exactPackageKeys.length;
      const manifestOffset = harness.calls.manifestKeys.length;
      const catalogOffset = harness.calls.catalogReads.length;
      const selectionOffset = harness.calls.selectionHistory.length;
      const resolvedOffset = harness.calls.resolvedCountryIds.length;
      const relocationOffset = harness.calls.relocationProfileIds.length;
      const preferenceOffset = harness.calls.preferenceProfileIds.length;
      const planBefore = planGateCounts();
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const caught = await harness.assembly.selectionAuthority
          .loadCurrentTerminalSelectionAuthority(revision.id)
          .catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual([
        `frontier.revision:${revision.id}`,
        `frontier.chain:${revision.runId}`,
        `frontier.revision:${revision.id}`,
        `frontier.chain:${revision.runId}`,
      ]);
      expect(harness.calls.authorityOrder.slice(orderOffset))
        .toEqual(harness.calls.reloads.slice(reloadOffset));
      expect(harness.calls.rankingResults.slice(rankingOffset)).toEqual([]);
      expect(harness.calls.exactPackageKeys.slice(packageOffset)).toEqual([]);
      expect(harness.calls.manifestKeys.slice(manifestOffset)).toEqual([]);
      expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([]);
      expect(harness.calls.selectionHistory.slice(selectionOffset)).toEqual([]);
      expect(harness.calls.resolvedCountryIds.slice(resolvedOffset)).toEqual([]);
      expect(harness.calls.relocationProfileIds.slice(relocationOffset)).toEqual([]);
      expect(harness.calls.preferenceProfileIds.slice(preferenceOffset)).toEqual([]);
      expect(planGateCounts()).toEqual(planBefore);
      expect(semanticDownstreamEffects(harness)).toEqual(before);
    };
    await assertStructuralStop(workingHarness, working.revision);

    const terminalHarness = await syntheticApplicationHarness();
    const seeded = await seedCurrentSemanticKnowledge(terminalHarness, "noncurrent-terminal");
    expect(seeded.head.revision.kind).toBe("terminal");
    if (seeded.head.revision.kind !== "terminal") throw new Error("expected_terminal_fixture");
    const current = seeded.head.revision;
    if (current.operation.kind !== "city_completed" ||
      current.predecessorRevisionId === undefined) {
      throw new Error("expected_completed_terminal_fixture");
    }
    const sibling = sealCityFrontierRevision({
      runId: current.runId,
      predecessorRevisionId: current.predecessorRevisionId,
      rankingSnapshotId: current.rankingSnapshotId,
      markers: current.markers,
      projection: {
        kind: "terminal",
        nextUncheckedRank: current.nextUncheckedRank,
        selectableCityIds: current.markers
          .filter(({ status }) => status === "selectable")
          .map(({ cityId }) => cityId),
        entries: current.entries,
        stopCondition: current.stopCondition,
      },
      operation: {
        ...current.operation,
        commandId: "continue:authenticated-noncurrent-terminal",
      },
      createdAt: current.createdAt,
    }, DECISION_INTEGRITY);
    expect(sibling.id).not.toBe(current.id);
    expect(reconstructCityFrontierRevision(sibling, DECISION_INTEGRITY)).toEqual(sibling);
    terminalHarness.state.addRevision(sibling);
    await assertStructuralStop(terminalHarness, sibling);
  });

  test("presents an authentic legacy terminal but keeps internal selection authority current-only", async () => {
    // Break caught: either dropping historical audit replay or leaking @1 into Task 15 authority.
    const harness = await syntheticApplicationHarness();
    const fixture = await authenticLegacyTerminal(harness);
    const artifacts = harness.state.artifacts();
    expect(fixture.terminal).toBe(harness.state.root());
    expect(fixture.legacy.catalog.rulesVersion).toBe("city-catalog@1");
    expect(fixture.current.catalog.rulesVersion).toBe("city-catalog@2");
    expect(fixture.legacy.catalog.id).not.toBe(fixture.current.catalog.id);
    expect(fixture.legacy.installedPackageManifest.id)
      .not.toBe(fixture.current.installedPackageManifest.id);
    expect(fixture.legacy.installedPackageManifest.key)
      .not.toEqual(fixture.current.installedPackageManifest.key);
    const manifestA = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        fixture.legacy.installedPackageManifest.key,
      ))!;
    const manifestB = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        fixture.current.installedPackageManifest.key,
      ))!;
    expect(manifestA).toEqual(fixture.manifest);
    expect(manifestA.id).not.toBe(manifestB.id);
    expect(withInfrastructurePlanGateRead(() => harness.fixture.installedPackages.findExact(
      fixture.legacy.installedPackageManifest.key,
    ))?.catalog.id).toBe(fixture.legacy.catalog.id);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findReady("SI"))?.catalog.id)
      .toBe(fixture.current.catalog.id);
    expect(fixture.evidence).toHaveLength(fixture.legacy.catalog.members.length);
    expect(fixture.knowledge).toHaveLength(fixture.legacy.catalog.members.length);
    for (const [index, member] of fixture.legacy.catalog.members.entries()) {
      const evidence = fixture.evidence[index]!;
      const knowledge = fixture.knowledge[index]!;
      expect(evidence.snapshot).toMatchObject({
        cityId: member.cityId,
        frontierRunId: fixture.terminal.runId,
        catalogRevisionId: fixture.legacy.catalog.id,
        rankingSnapshotId: fixture.terminal.rankingSnapshotId,
      });
      expect(knowledge).toMatchObject({
        cityId: member.cityId,
        evidenceSnapshotId: evidence.snapshot.id,
        rulesVersion: fixture.legacy.installedPackageManifest.key.evidenceRulesVersion,
      });
      expect(fixture.terminal.markers[index]).toMatchObject({
        cityId: member.cityId,
        knowledgeRevisionId: knowledge.id,
        evidenceSnapshotId: evidence.snapshot.id,
      });
    }
    const baselineKnowledge: readonly CityKnowledgeRankingProjection[] =
      fixture.legacy.catalog.members.map(({ cityId }) => ({
        cityId,
        knowledgeRevisionId: null,
        facts: [],
      }));
    const semanticExpected: SemanticAuthorityFixture = {
      criteria: artifacts.criteria,
      ranking: artifacts.ranking,
      root: fixture.terminal,
      knowledge: baselineKnowledge,
    };
    const databaseChanges = harness.fixture.database.prepare(
      "SELECT total_changes() AS count",
    ).get();
    const immutableEffects = () => ({
      source: harness.calls.source.length,
      publications: harness.calls.publications.length,
      clocks: harness.calls.clocks.length,
      deadlines: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      fixedInputs: harness.calls.fixedRouteInputs.length,
      fixedRunnerInputs: fixedRunnerHarness.inputs.length,
      safetySearch: harness.calls.safetySearchInputs.length,
      safetyDocuments: harness.calls.safetyDocumentInputs.length,
      genericSeals: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
      flights: harness.calls.flightIdentityCanonicals.length,
    });
    const presentLegacy = async (): Promise<CityFrontierReadModel> => {
      const effectsBefore = immutableEffects();
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const keyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const catalogOffset = harness.calls.catalogReads.length;
      const selectionOffset = harness.calls.selectionHistory.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const fixedOffset = planGateHarness.fixed.length;
      const directoryOffset = planGateHarness.directories.length;
      const safetyOffset = planGateHarness.safetyPlans.length;
      const defaultsOffset = planGateHarness.defaults.length;
      const definitionsOffset = planGateHarness.definitions.length;
      const semanticOffset = planGateHarness.semanticEntries.length;
      const planOrderOffset = planGateHarness.order.length;
      const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
      const resolvedOffset = harness.calls.resolvedCountryIds.length;
      const relocationOffset = harness.calls.relocationProfileIds.length;
      const preferenceOffset = harness.calls.preferenceProfileIds.length;
      planGateHarness.beforeSemantic = () => {
        harness.calls.authorityOrder.push("semantic-verifier");
        return {
          evidenceCanonicals: structuredClone(
            harness.calls.evidenceCanonicals.slice(canonicalOffset),
          ),
          evidenceHashes: structuredClone(harness.calls.evidenceHashes.slice(hashOffset)),
          evidenceSigns: structuredClone(harness.calls.evidenceSigns.slice(signOffset)),
        };
      };
      const presented = await harness.assembly.application.presentCityFrontier(
        fixture.terminal.runId,
      );
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual([
        `frontier.chain:${fixture.terminal.runId}`,
        `ranking:${artifacts.ranking.id}`,
        `criteria:${artifacts.criteria.id}`,
        `branch:${artifacts.branch.id}`,
        ...fixture.chain.slice(1).map(({ operation }) =>
          `frontier.command:${fixture.terminal.runId}:${operation.commandId}`),
      ]);
      const order = harness.calls.authorityOrder.slice(orderOffset);
      expect(order.slice(0, 5)).toEqual([
        `frontier.chain:${fixture.terminal.runId}`,
        `ranking:${artifacts.ranking.id}`,
        "package.exact",
        "manifest.exact",
        `catalog.historical:${fixture.legacy.catalog.id}`,
      ]);
      expect(order.filter((value) => value.startsWith("knowledge.load:"))).toEqual(
        fixture.knowledge.map(({ id }) => `knowledge.load:${id}`),
      );
      expect(order.filter((value) => value.startsWith("evidence.load:"))).toEqual(
        fixture.evidence.map(({ snapshot }) => `evidence.load:${snapshot.id}`),
      );
      expect(order.filter((value) => value === "semantic-verifier")).toEqual([
        "semantic-verifier",
      ]);
      expect(order.indexOf("semantic-verifier"))
        .toBeGreaterThan(order.indexOf(`knowledge.load:${fixture.knowledge.at(-1)!.id}`));
      expect(order.indexOf(`evidence.load:${fixture.evidence[0]!.snapshot.id}`))
        .toBeGreaterThan(order.indexOf("semantic-verifier"));
      expect(order.at(-1)).toBe(`selection:${fixture.terminal.runId}`);
      const loadedRanking = harness.calls.rankingResults[rankingOffset]!;
      expect(loadedRanking).toEqual(artifacts.ranking);
      expect(harness.calls.exactPackageKeys[keyOffset]).toBe(loadedRanking.installedPackageContext);
      expect(harness.calls.manifestKeys[manifestKeyOffset])
        .toBe(loadedRanking.installedPackageContext);
      expect(harness.calls.exactPackageKeys.slice(keyOffset)).toHaveLength(1);
      expect(harness.calls.manifestKeys.slice(manifestKeyOffset)).toHaveLength(1);
      expect(harness.calls.manifestResults.slice(manifestResultOffset)).toHaveLength(1);
      const loadedManifest = harness.calls.manifestResults[manifestResultOffset] as
        InstalledCityPackageManifest;
      expectManifestAuthority(
        loadedManifest,
        loadedRanking.installedPackageContext,
        fixture.legacy.installedPackageManifest.id,
      );
      expectAdministrativeManifestBindings(loadedManifest, fixture.legacy);
      expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([
        `catalog.historical:${fixture.legacy.catalog.id}`,
      ]);
      expect(harness.calls.selectionHistory.slice(selectionOffset)).toEqual([
        fixture.terminal.runId,
      ]);
      expect(harness.calls.resolvedCountryIds.slice(resolvedOffset)).toEqual([
        harness.fixture.resolved.id,
      ]);
      expect(harness.calls.relocationProfileIds.slice(relocationOffset)).toEqual([
        harness.fixture.relocation.id,
      ]);
      expect(harness.calls.preferenceProfileIds.slice(preferenceOffset)).toEqual([
        harness.fixture.preference.id,
      ]);
      const entry = planGateHarness.semanticEntries[semanticOffset]!;
      expectSemanticGateEntry(harness, {
        ...entry,
        fixedCount: entry.fixedCount - fixedOffset,
        directoryCount: entry.directoryCount - directoryOffset,
        safetyPlanCount: entry.safetyPlanCount - safetyOffset,
        defaultsCount: entry.defaultsCount - defaultsOffset,
        definitionsCount: entry.definitionsCount - definitionsOffset,
        gateSnapshot: {
          fixed: entry.gateSnapshot.fixed.slice(fixedOffset),
          directories: entry.gateSnapshot.directories.slice(directoryOffset),
          safetyPlans: entry.gateSnapshot.safetyPlans.slice(safetyOffset),
          defaults: entry.gateSnapshot.defaults.slice(defaultsOffset),
          definitions: entry.gateSnapshot.definitions.slice(definitionsOffset),
          order: entry.gateSnapshot.order.slice(planOrderOffset),
        },
      }, semanticExpected, loadedRanking, fixture.legacy);
      expect(harness.fixture.policyCalls.evaluations.length)
        .toBeGreaterThan(evaluationOffset);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      expect(immutableEffects()).toEqual(effectsBefore);
      expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
        .toEqual(databaseChanges);
      return presented;
    };
    const presentedA = await presentLegacy();
    const presentedB = await presentLegacy();
    expect(presentedA).toEqual(presentedB);
    expect(presentedA).not.toBe(presentedB);
    expect(presentedA.catalog.rulesVersion).toBe("city-catalog@1");
    expect(presentedA.revision).toEqual(fixture.terminal);
    recursivelyFrozen(presentedA);
    recursivelyFrozen(presentedB);
    recursivelyNotAliased(presentedA, presentedB);
    recursivelyNotAliased(presentedA.revision, fixture.terminal);
    recursivelyNotAliased(presentedA.ranking, artifacts.ranking);
    recursivelyNotAliased(presentedA.criteria, artifacts.criteria);
    recursivelyNotAliased(presentedA.catalog, fixture.legacy.catalog);

    const internalUpgrade = async (): Promise<readonly [Error, Error]> => {
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const effectsBefore = immutableEffects();
        const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const rankingOffset = harness.calls.rankingResults.length;
        const keyOffset = harness.calls.exactPackageKeys.length;
        const manifestKeyOffset = harness.calls.manifestKeys.length;
        const manifestResultOffset = harness.calls.manifestResults.length;
        const canonicalOffset = harness.calls.evidenceCanonicals.length;
        const hashOffset = harness.calls.evidenceHashes.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const catalogOffset = harness.calls.catalogReads.length;
        const criteriaOffset = harness.calls.reloads.filter((value) =>
          value.startsWith("criteria:")).length;
        const selectionOffset = harness.calls.selectionHistory.length;
        const resolvedOffset = harness.calls.resolvedCountryIds.length;
        const relocationOffset = harness.calls.relocationProfileIds.length;
        const preferenceOffset = harness.calls.preferenceProfileIds.length;
        const readyOffset = harness.calls.readyPackageCountries.length;
        const forbiddenOffset = harness.calls.forbiddenPrepareCallbacks.length;
        const semanticOffset = planGateHarness.semanticEntries.length;
        const caught = await harness.assembly.selectionAuthority
          .loadCurrentTerminalSelectionAuthority(fixture.terminal.id)
          .catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("city_catalog_upgrade_required");
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual([
          `frontier.revision:${fixture.terminal.id}`,
          `frontier.chain:${fixture.terminal.runId}`,
          `ranking:${artifacts.ranking.id}`,
        ]);
        expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual([
          `frontier.revision:${fixture.terminal.id}`,
          `frontier.chain:${fixture.terminal.runId}`,
          `ranking:${artifacts.ranking.id}`,
          "package.exact",
          "manifest.exact",
          `catalog.historical:${fixture.legacy.catalog.id}`,
        ]);
        const loadedRanking = harness.calls.rankingResults[rankingOffset]!;
        expect(harness.calls.exactPackageKeys[keyOffset]).toBe(loadedRanking.installedPackageContext);
        expect(harness.calls.manifestKeys[manifestKeyOffset])
          .toBe(loadedRanking.installedPackageContext);
        expect(harness.calls.manifestResults.slice(manifestResultOffset)).toHaveLength(1);
        const loadedManifest = harness.calls.manifestResults[manifestResultOffset] as
          InstalledCityPackageManifest;
        expectManifestAuthority(
          loadedManifest,
          loadedRanking.installedPackageContext,
          fixture.legacy.installedPackageManifest.id,
        );
        expect(harness.calls.evidenceCanonicals.slice(canonicalOffset).map(({ value }) => value))
          .toEqual([manifestPayload(loadedManifest)]);
        expect(harness.calls.evidenceHashes.slice(hashOffset).map(({ value }) => value))
          .toEqual(harness.calls.evidenceCanonicals.slice(canonicalOffset).map(({ result }) => result));
        expect(harness.calls.evidenceHashes.slice(hashOffset).map(({ result }) => result))
          .toEqual([loadedManifest.payloadHash]);
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
        expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([
          `catalog.historical:${fixture.legacy.catalog.id}`,
        ]);
        expect(harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length)
          .toBe(criteriaOffset);
        expect(harness.calls.selectionHistory).toHaveLength(selectionOffset);
        expect(harness.calls.resolvedCountryIds).toHaveLength(resolvedOffset);
        expect(harness.calls.relocationProfileIds).toHaveLength(relocationOffset);
        expect(harness.calls.preferenceProfileIds).toHaveLength(preferenceOffset);
        expect(harness.calls.readyPackageCountries).toHaveLength(readyOffset);
        expect(harness.calls.forbiddenPrepareCallbacks).toHaveLength(forbiddenOffset);
        expect(planGateHarness.semanticEntries).toHaveLength(semanticOffset);
        expect(harness.fixture.policyCalls.evaluations).toHaveLength(evaluationOffset);
        expect(immutableEffects()).toEqual(effectsBefore);
      }
      expect(errors[0]).not.toBe(errors[1]);
      return errors as unknown as readonly [Error, Error];
    };
    await internalUpgrade();

    harness.state.overrideManifestResult("alternate", manifestB);
    const driftErrors: Error[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const effectsBefore = immutableEffects();
      const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
      const semanticOffset = planGateHarness.semanticEntries.length;
      const readyOffset = harness.calls.readyPackageCountries.length;
      const forbiddenOffset = harness.calls.forbiddenPrepareCallbacks.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const catalogOffset = harness.calls.catalogReads.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.selectionAuthority
        .loadCurrentTerminalSelectionAuthority(fixture.terminal.id)
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      driftErrors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual([
        `frontier.revision:${fixture.terminal.id}`,
        `frontier.chain:${fixture.terminal.runId}`,
        `ranking:${artifacts.ranking.id}`,
        "package.exact",
        "manifest.exact",
      ]);
      expect(harness.calls.catalogReads).toHaveLength(catalogOffset);
      expect(harness.calls.evidenceCanonicals).toHaveLength(canonicalOffset);
      expect(harness.calls.evidenceHashes).toHaveLength(hashOffset);
      expect(harness.calls.evidenceSigns).toHaveLength(signOffset);
      expect(planGateHarness.semanticEntries).toHaveLength(semanticOffset);
      expect(harness.calls.readyPackageCountries).toHaveLength(readyOffset);
      expect(harness.calls.forbiddenPrepareCallbacks).toHaveLength(forbiddenOffset);
      expect(harness.fixture.policyCalls.evaluations).toHaveLength(evaluationOffset);
      expect(immutableEffects()).toEqual(effectsBefore);
    }
    expect(driftErrors[0]).not.toBe(driftErrors[1]);
    harness.state.overrideManifestResult("alternate", manifestA);
    const restored = await internalUpgrade();
    expect(restored[0].message).toBe("city_catalog_upgrade_required");
    expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
      .toEqual(databaseChanges);
  });

  test("publishes and reads through the genuine verified historical package adapter", async () => {
    // Break caught: a writer definition projection omitting real package fields such as sourceIds.
    const { harness, authority, pair } =
      await currentYellowSelectionHistoryFixture("real-package-adapter");
    const database = harness.fixture.database;
    const ranking = authority.ranking;
    const payload = EVIDENCE_INTEGRITY.canonical(ranking);
    database.pragma("foreign_keys = OFF");
    database.prepare(`
      INSERT INTO city_ranking_snapshots (
        id, run_id, resolved_country_shortlist_revision_id, country_code, package_id,
        package_schema_version, registry_revision_id, catalog_revision_id,
        criteria_snapshot_id, pre_city_branch_commit_id, profile_snapshot_id,
        preference_profile_snapshot_id, evidence_rules_version,
        installed_package_context_json, live_city_candidate_limit,
        target_selectable_cities, budget_rules_version, schema_version, rules_version,
        assessment_at, payload_json, payload_hash, hmac, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ranking.id,
      ranking.runId,
      ranking.resolvedCountryShortlistRevisionId,
      ranking.countryCode,
      ranking.packageId,
      ranking.packageSchemaVersion,
      ranking.registryRevisionId,
      ranking.catalogRevisionId,
      ranking.criteriaSnapshotId,
      ranking.preCityBranchCommitId,
      ranking.profileSnapshotId,
      ranking.preferenceProfileSnapshotId,
      ranking.installedPackageContext.evidenceRulesVersion,
      EVIDENCE_INTEGRITY.canonical(ranking.installedPackageContext),
      ranking.verificationBudget.liveCityCandidateLimit,
      ranking.verificationBudget.targetSelectableCities,
      ranking.verificationBudget.rulesVersion,
      ranking.schemaVersion,
      ranking.rulesVersion,
      ranking.assessmentAt,
      payload,
      EVIDENCE_INTEGRITY.hash(payload),
      EVIDENCE_INTEGRITY.sign(payload),
      ranking.createdAt,
    );
    const writer = new SqliteCitySelectionWriter(database, EVIDENCE_INTEGRITY, {
      catalogs: harness.fixture.catalogStore,
      historicalPackages: harness.fixture.writerManifestStore,
      branches: {
        loadPreCityBranchVerified: () => structuredClone(authority.preCityBranch),
      },
      rankings: {
        loadRankingVerified: () => structuredClone(authority.ranking),
      },
      frontier: {
        loadRevisionVerified: () => structuredClone(authority.terminal),
      },
    });
    const publication = {
      commandId: pair.selection.commandId,
      intent: {
        terminalCityShortlistSnapshotId: pair.selection.terminalRevisionId,
        cityId: pair.selection.cityId,
        warningCopyVersion: "city-unknown-risk@1" as const,
      },
      pair,
    };

    const published = await writer.publishSelection(publication);
    const loaded = await writer.loadSelectionWithBranchVerified(published.selection.id);

    expect(published).toEqual(pair);
    expect(loaded).toEqual(pair);
    expect(harness.fixture.writerManifestStore.loadExactVerified(
      ranking.installedPackageContext,
    )!.ready.definition.sourceIds).toEqual(SLOVENIA_CITY_FACT_SOURCE_IDS);
    recursivelyFrozen(published);
    recursivelyFrozen(loaded);
  });

  test("replays one authentic yellow selection history pair as fresh owned public state", async () => {
    // Break caught: returning a history pair after only structural parsing or borrowing its graph.
    const { harness, seeded, authority, marker, projection, pair, history } =
      await currentYellowSelectionHistoryFixture("positive");
    const baselineKnowledge: readonly CityKnowledgeRankingProjection[] =
      harness.fixture.installed.catalog.members.map(({ cityId }) => {
        const knowledgeRevisionId = authority.ranking.knowledgeRevisionIds[cityId] ?? null;
        expect(knowledgeRevisionId).toBeNull();
        return { cityId, knowledgeRevisionId: null, facts: [] };
      });
    const semanticExpected: SemanticAuthorityFixture = {
      criteria: seeded.head.criteria,
      ranking: authority.ranking,
      root: authority.terminal,
      knowledge: baselineKnowledge,
    };
    const mutationEffects = () => ({
      source: harness.calls.source.length,
      clocks: harness.calls.clocks.length,
      deadlines: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      fixedInputs: harness.calls.fixedRouteInputs.length,
      fixedRuns: fixedRunnerHarness.inputs.length,
      safetyRuns: safetyRunnerHarness.promises.length,
      safetySearch: harness.calls.safetySearchInputs.length,
      safetyDocuments: harness.calls.safetyDocumentInputs.length,
      genericSeals: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      publications: harness.calls.publications.length,
      appends: harness.calls.appends.length,
      flights: harness.calls.flightIdentityCanonicals.length,
    });
    const databaseChanges = harness.fixture.database.prepare(
      "SELECT total_changes() AS count",
    ).get();

    const invoke = async (): Promise<CityFrontierReadModel> => {
      const effectsBefore = mutationEffects();
      const historyOffset = history.runIds.length;
      const historyResultOffset = history.returned.length;
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const packageOffset = harness.calls.exactPackageKeys.length;
      const manifestOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const catalogOffset = harness.calls.catalogReads.length;
      const readyOffset = harness.calls.readyPackageCountries.length;
      const resolvedOffset = harness.calls.resolvedCountryIds.length;
      const relocationOffset = harness.calls.relocationProfileIds.length;
      const preferenceOffset = harness.calls.preferenceProfileIds.length;
      const forbiddenOffset = harness.calls.forbiddenPrepareCallbacks.length;
      const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
      const semanticOffset = planGateHarness.semanticEntries.length;
      let canonicalCursor = harness.calls.evidenceCanonicals.length;
      let hashCursor = harness.calls.evidenceHashes.length;
      let signCursor = harness.calls.evidenceSigns.length;
      planGateHarness.beforeSemantic = () => {
        harness.calls.authorityOrder.push("semantic-verifier");
        const snapshot = {
          evidenceCanonicals: structuredClone(
            harness.calls.evidenceCanonicals.slice(canonicalCursor),
          ),
          evidenceHashes: structuredClone(harness.calls.evidenceHashes.slice(hashCursor)),
          evidenceSigns: structuredClone(harness.calls.evidenceSigns.slice(signCursor)),
        };
        canonicalCursor = harness.calls.evidenceCanonicals.length;
        hashCursor = harness.calls.evidenceHashes.length;
        signCursor = harness.calls.evidenceSigns.length;
        return snapshot;
      };
      selectionReplayHarness.pureInputs.splice(0);
      selectionReplayHarness.pairInputs.splice(0);
      selectionReplayHarness.order.splice(0);
      selectionReplayHarness.onPhase = (phase) => harness.calls.authorityOrder.push(phase);
      selectionReplayHarness.enabled = true;
      let presented: CityFrontierReadModel;
      try {
        presented = await harness.assembly.application.presentCityFrontier(seeded.head.runId);
      } finally {
        selectionReplayHarness.enabled = false;
        selectionReplayHarness.onPhase = undefined;
      }

      expect(history.runIds.slice(historyOffset)).toEqual([seeded.head.runId]);
      expect(history.returned.slice(historyResultOffset)).toHaveLength(1);
      recursivelyFrozen(history.returned[historyResultOffset]);
      expect(harness.calls.rankingResults.slice(rankingOffset)).toHaveLength(2);
      const loadedRankings = harness.calls.rankingResults.slice(rankingOffset);
      expect(loadedRankings).toEqual([authority.ranking, authority.ranking]);
      expect(harness.calls.exactPackageKeys.slice(packageOffset)).toEqual(
        loadedRankings.map(({ installedPackageContext }) => installedPackageContext),
      );
      expect(harness.calls.manifestKeys.slice(manifestOffset)).toEqual(
        loadedRankings.map(({ installedPackageContext }) => installedPackageContext),
      );
      for (const [index, loadedRanking] of loadedRankings.entries()) {
        expect(harness.calls.exactPackageKeys[packageOffset + index])
          .toBe(loadedRanking.installedPackageContext);
        expect(harness.calls.manifestKeys[manifestOffset + index])
          .toBe(loadedRanking.installedPackageContext);
        const manifest = harness.calls.manifestResults[manifestResultOffset + index] as
          InstalledCityPackageManifest;
        expectManifestAuthority(
          manifest,
          loadedRanking.installedPackageContext,
          harness.fixture.installed.installedPackageManifest.id,
        );
        expectAdministrativeManifestBindings(manifest, harness.fixture.installed);
      }
      expect(harness.calls.catalogReads.slice(catalogOffset)).toEqual([
        `catalog.historical:${authority.ranking.catalogRevisionId}`,
        `catalog.historical:${authority.ranking.catalogRevisionId}`,
      ]);
      expect(harness.calls.readyPackageCountries).toHaveLength(readyOffset);
      expect(harness.calls.resolvedCountryIds.slice(resolvedOffset)).toEqual([
        authority.ranking.resolvedCountryShortlistRevisionId,
        authority.ranking.resolvedCountryShortlistRevisionId,
      ]);
      expect(harness.calls.relocationProfileIds.slice(relocationOffset)).toEqual([
        authority.ranking.profileSnapshotId,
        authority.ranking.profileSnapshotId,
      ]);
      expect(harness.calls.preferenceProfileIds.slice(preferenceOffset)).toEqual([
        authority.ranking.preferenceProfileSnapshotId,
        authority.ranking.preferenceProfileSnapshotId,
      ]);
      const expectedCallbacks = Array.from({ length: 2 }, () => [
        "resolved-country",
        "relocation-profile",
        "preference-profile",
        ...Array.from(
          { length: authority.terminal.markers.length },
          () => "evidence-replay-package",
        ),
      ]).flat();
      expect([...harness.calls.forbiddenPrepareCallbacks.slice(forbiddenOffset)].sort())
        .toEqual([...expectedCallbacks].sort());
      expect(harness.fixture.policyCalls.evaluations.length - evaluationOffset).toBe(
        (2 * harness.fixture.installed.catalog.members.length * seeded.criteria.criteria.length) +
        (3 * authority.terminal.markers.length * seeded.criteria.criteria.length),
      );
      const semanticEntries = planGateHarness.semanticEntries.slice(semanticOffset);
      expect(semanticEntries).toHaveLength(2);
      for (const entry of semanticEntries) {
        const fixedCursor = entry.fixedCount -
          (harness.fixture.installed.catalog.members.length * 3);
        const directoryCursor = entry.directoryCount - 1;
        const safetyCursor = entry.safetyPlanCount - 1;
        const defaultsCursor = entry.defaultsCount - 1;
        const definitionsCursor = entry.definitionsCount - 1;
        const orderCursor = entry.gateSnapshot.order.length -
          (harness.fixture.installed.catalog.members.length * 3 + 5);
        expectSemanticGateEntry(harness, {
          ...entry,
          fixedCount: entry.fixedCount - fixedCursor,
          directoryCount: entry.directoryCount - directoryCursor,
          safetyPlanCount: entry.safetyPlanCount - safetyCursor,
          defaultsCount: entry.defaultsCount - defaultsCursor,
          definitionsCount: entry.definitionsCount - definitionsCursor,
          gateSnapshot: {
            fixed: entry.gateSnapshot.fixed.slice(fixedCursor),
            directories: entry.gateSnapshot.directories.slice(directoryCursor),
            safetyPlans: entry.gateSnapshot.safetyPlans.slice(safetyCursor),
            defaults: entry.gateSnapshot.defaults.slice(defaultsCursor),
            definitions: entry.gateSnapshot.definitions.slice(definitionsCursor),
            order: entry.gateSnapshot.order.slice(orderCursor),
          },
        }, semanticExpected, authority.ranking);
      }
      expect(selectionReplayHarness.order).toEqual([
        "semantic-verifier",
        "selection-history",
        "semantic-verifier",
        "pure-selection",
        "selection-wrapper",
      ]);
      expect(selectionReplayHarness.pureInputs).toEqual([[
        {
          frontier: authority.frontier,
          request: {
            cityId: marker.cityId,
            warningCopyVersion: "city-unknown-risk@1",
          },
        },
      ]]);
      expect(selectionReplayHarness.pairInputs).toHaveLength(1);
      const pairInput = selectionReplayHarness.pairInputs[0] as readonly unknown[];
      expect(pairInput[0]).toEqual(pair);
      expect(pairInput[1]).toEqual({
        terminal: authority.terminal,
        ranking: authority.ranking,
        preCityBranch: authority.preCityBranch,
      });
      const order = harness.calls.authorityOrder.slice(orderOffset);
      const knowledgeOrder = authority.terminal.markers.map(({ knowledgeRevisionId }) =>
        `knowledge.load:${knowledgeRevisionId}`);
      const evidenceOrder = authority.terminal.markers.map(({ evidenceSnapshotId }) =>
        `evidence.load:${evidenceSnapshotId}`);
      expect(order.filter((value) => value.startsWith("knowledge.load:"))).toEqual([
        ...knowledgeOrder,
        ...knowledgeOrder,
      ]);
      expect(order.filter((value) => value.startsWith("evidence.load:"))).toEqual([
        ...evidenceOrder,
        ...evidenceOrder,
      ]);
      expect(order.filter((value) => value === `selection:${seeded.head.runId}`)).toEqual([
        `selection:${seeded.head.runId}`,
      ]);
      const selectionIndex = order.indexOf(`selection:${seeded.head.runId}`);
      const firstKnowledgeEnd = order.indexOf(knowledgeOrder.at(-1)!);
      const firstSemanticIndex = order.indexOf("semantic-verifier");
      const firstEvidenceStart = order.indexOf(evidenceOrder[0]!);
      expect(firstSemanticIndex).toBeGreaterThan(firstKnowledgeEnd);
      expect(firstEvidenceStart).toBeGreaterThan(firstSemanticIndex);
      expect(selectionIndex).toBeGreaterThan(order.indexOf(evidenceOrder.at(-1)!));
      expect(order.indexOf("package.exact", selectionIndex + 1)).toBeGreaterThan(selectionIndex);
      const secondKnowledgeStart = order.indexOf(knowledgeOrder[0]!, selectionIndex + 1);
      const secondKnowledgeEnd = order.indexOf(knowledgeOrder.at(-1)!, secondKnowledgeStart);
      const secondSemanticIndex = order.indexOf("semantic-verifier", firstSemanticIndex + 1);
      const secondEvidenceStart = order.indexOf(evidenceOrder[0]!, secondSemanticIndex + 1);
      expect(secondKnowledgeStart).toBeGreaterThan(selectionIndex);
      expect(secondSemanticIndex).toBeGreaterThan(secondKnowledgeEnd);
      expect(secondEvidenceStart).toBeGreaterThan(secondSemanticIndex);
      const secondEvidenceIndex = order.lastIndexOf(evidenceOrder.at(-1)!);
      expect(order.indexOf("pure-selection")).toBeGreaterThan(secondEvidenceIndex);
      expect(order.indexOf("selection-wrapper")).toBeGreaterThan(
        order.indexOf("pure-selection"),
      );
      const reloads = harness.calls.reloads.slice(reloadOffset);
      expect(reloads.filter((value) => value.startsWith("ranking:"))).toEqual([
        `ranking:${authority.ranking.id}`,
        `ranking:${authority.ranking.id}`,
      ]);
      expect(reloads.filter((value) => value.startsWith("criteria:"))).toEqual([
        `criteria:${authority.ranking.criteriaSnapshotId}`,
        `criteria:${authority.ranking.criteriaSnapshotId}`,
      ]);
      expect(reloads.filter((value) => value.startsWith("branch:"))).toEqual([
        `branch:${authority.preCityBranch.id}`,
        `branch:${authority.preCityBranch.id}`,
      ]);
      expect(presented.selections).toEqual([pair]);
      expect(presented.selections[0]?.selection).toMatchObject({
        runId: authority.terminal.runId,
        terminalRevisionId: authority.terminal.id,
        cityId: marker.cityId,
        countryCode: authority.ranking.countryCode,
        profileSnapshotId: authority.preCitySource.profileSnapshotId,
        preferenceProfileSnapshotId: authority.preCitySource.preferenceProfileSnapshotId,
        resolvedCountryShortlistRevisionId:
          authority.preCitySource.resolvedCountryShortlistRevisionId,
        criteriaSnapshotId: authority.ranking.criteriaSnapshotId,
        rankingSnapshotId: authority.ranking.id,
        preCityBranchCommitId: authority.preCityBranch.id,
        knowledgeRevisionId: marker.knowledgeRevisionId,
        evidenceSnapshotId: marker.evidenceSnapshotId,
        warningCopyVersion: "city-unknown-risk@1",
      });
      expect(presented.selections[0]?.selection.selectedMarkerDigest)
        .toBe(DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(marker)));
      expect(presented.selections[0]?.selection.unknownBasis).toEqual(marker.unknownBasis);
      expect(presented.selections[0]?.commit).toMatchObject({
        parentId: authority.preCityBranch.id,
        forkedFrom: authority.preCityBranch.id,
        citySelectionSnapshotId: pair.selection.id,
      });
      expect(projection.reviewedSourceLinks).toEqual(marker.facts.flatMap(({ manualCheckLinks }) =>
        manualCheckLinks));
      expect(reconstructCitySelectionWithBranch(presented.selections[0], {
        terminal: authority.terminal,
        ranking: authority.ranking,
        preCityBranch: authority.preCityBranch,
      }, DECISION_INTEGRITY)).toEqual(pair);
      recursivelyFrozen(presented);
      recursivelyNotAliased(presented.selections[0], pair);
      recursivelyNotAliased(
        presented.selections[0],
        history.returned[historyResultOffset]?.[0],
      );
      expect(mutationEffects()).toEqual(effectsBefore);
      expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
        .toEqual(databaseChanges);
      return presented;
    };

    const first = await invoke();
    const second = await invoke();
    expect(history.returned).toHaveLength(2);
    expect(history.returned[0]).not.toBe(history.returned[1]);
    recursivelyNotAliased(history.returned[0], history.returned[1]);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    recursivelyNotAliased(first, second);
  });

  test("rejects rehashed history mirror, marker-binding and yellow-warning drifts", async () => {
    // Break caught: trusting a self-consistent pair without replaying its layered current authority.
    const rows = ["ranking-mirror", "marker-binding", "yellow-warning"] as const;
    for (const row of rows) {
      const { harness, seeded, authority, marker, pair, history } =
        await currentYellowSelectionHistoryFixture(row);
      const otherMarker = authority.terminal.markers.find(({ cityId }) =>
        cityId !== marker.cityId)!;
      const otherMarkerDigest = DECISION_INTEGRITY.hash(
        DECISION_INTEGRITY.canonical(otherMarker),
      );
      expect(otherMarkerDigest).not.toBe(pair.selection.selectedMarkerDigest);
      const drift = structurallyRehashedSelectionPair(
        pair,
        authority.preCityBranch,
        (payload) => {
          if (row === "ranking-mirror") {
            return {
              ...payload,
              rankingSnapshotId: `city-ranking:${"f".repeat(64)}`,
            };
          }
          if (row === "marker-binding") {
            return { ...payload, selectedMarkerDigest: otherMarkerDigest };
          }
          const withoutWarning = { ...payload } as MutableRecord;
          delete withoutWarning.warningCopyVersion;
          return withoutWarning as unknown as CitySelectionSnapshotPayload;
        },
      );
      expect(drift.selection.id).not.toBe(pair.selection.id);
      expect(drift.commit.id).not.toBe(pair.commit.id);
      const structuralError = captureError(() => reconstructCitySelectionWithBranch(drift, {
        terminal: authority.terminal,
        ranking: authority.ranking,
        preCityBranch: authority.preCityBranch,
      }, DECISION_INTEGRITY));
      expect(structuralError.message).toBe("integrity_mismatch");
      history.pair = drift;
      history.runIds.splice(0);
      history.returned.splice(0);
      const effects = () => ({
        source: harness.calls.source.length,
        clocks: harness.calls.clocks.length,
        deadlines: harness.calls.deadlinePolicyDates.length,
        scheduled: harness.calls.scheduledDeadlines.length,
        fixedInputs: harness.calls.fixedRouteInputs.length,
        fixedRuns: fixedRunnerHarness.inputs.length,
        safetyRuns: safetyRunnerHarness.promises.length,
        safetySearch: harness.calls.safetySearchInputs.length,
        safetyDocuments: harness.calls.safetyDocumentInputs.length,
        genericSeals: genericSealHarness.calls,
        evidenceSeals: harness.calls.evidenceSeals.length,
        knowledgePublishes: harness.calls.knowledgePublishes.length,
        publications: harness.calls.publications.length,
        appends: harness.calls.appends.length,
        flights: harness.calls.flightIdentityCanonicals.length,
      });
      const databaseChanges = harness.fixture.database.prepare(
        "SELECT total_changes() AS count",
      ).get();
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const beforeEffects = effects();
        const historyOffset = history.runIds.length;
        const historyResultOffset = history.returned.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const semanticOffset = planGateHarness.semanticEntries.length;
        const readyOffset = harness.calls.readyPackageCountries.length;
        const resolvedOffset = harness.calls.resolvedCountryIds.length;
        const relocationOffset = harness.calls.relocationProfileIds.length;
        const preferenceOffset = harness.calls.preferenceProfileIds.length;
        const forbiddenOffset = harness.calls.forbiddenPrepareCallbacks.length;
        const evaluationOffset = harness.fixture.policyCalls.evaluations.length;
        selectionReplayHarness.pureInputs.splice(0);
        selectionReplayHarness.pairInputs.splice(0);
        selectionReplayHarness.order.splice(0);
        selectionReplayHarness.onPhase = (phase) => harness.calls.authorityOrder.push(phase);
        planGateHarness.beforeSemantic = () => {
          harness.calls.authorityOrder.push("semantic-verifier");
          return {
            evidenceCanonicals: [],
            evidenceHashes: [],
            evidenceSigns: [],
          };
        };
        selectionReplayHarness.enabled = true;
        let caught: unknown;
        try {
          caught = await harness.assembly.application.presentCityFrontier(
            seeded.head.runId,
          ).catch((error: unknown) => error);
        } finally {
          selectionReplayHarness.enabled = false;
          selectionReplayHarness.onPhase = undefined;
        }
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(history.runIds.slice(historyOffset)).toEqual([seeded.head.runId]);
        expect(history.returned.slice(historyResultOffset)).toHaveLength(1);
        recursivelyFrozen(history.returned[historyResultOffset]);
        const expectedSemanticCount = row === "ranking-mirror" ? 1 : 2;
        expect(planGateHarness.semanticEntries.slice(semanticOffset))
          .toHaveLength(expectedSemanticCount);
        const order = harness.calls.authorityOrder.slice(orderOffset);
        const knowledgeOrder = authority.terminal.markers.map(({ knowledgeRevisionId }) =>
          `knowledge.load:${knowledgeRevisionId}`);
        const evidenceOrder = authority.terminal.markers.map(({ evidenceSnapshotId }) =>
          `evidence.load:${evidenceSnapshotId}`);
        const expectedReplayCopies = row === "ranking-mirror" ? 1 : 2;
        expect(harness.calls.readyPackageCountries).toHaveLength(readyOffset);
        expect(harness.calls.resolvedCountryIds.slice(resolvedOffset)).toEqual(
          Array.from(
            { length: expectedReplayCopies },
            () => authority.ranking.resolvedCountryShortlistRevisionId,
          ),
        );
        expect(harness.calls.relocationProfileIds.slice(relocationOffset)).toEqual(
          Array.from(
            { length: expectedReplayCopies },
            () => authority.ranking.profileSnapshotId,
          ),
        );
        expect(harness.calls.preferenceProfileIds.slice(preferenceOffset)).toEqual(
          Array.from(
            { length: expectedReplayCopies },
            () => authority.ranking.preferenceProfileSnapshotId,
          ),
        );
        const expectedCallbacks = Array.from({ length: expectedReplayCopies }, () => [
          "resolved-country",
          "relocation-profile",
          "preference-profile",
          ...Array.from(
            { length: authority.terminal.markers.length },
            () => "evidence-replay-package",
          ),
        ]).flat();
        expect([...harness.calls.forbiddenPrepareCallbacks.slice(forbiddenOffset)].sort())
          .toEqual([...expectedCallbacks].sort());
        expect(order.filter((value) => value.startsWith("knowledge.load:"))).toEqual(
          Array.from({ length: expectedReplayCopies }, () => knowledgeOrder).flat(),
        );
        expect(order.filter((value) => value.startsWith("evidence.load:"))).toEqual(
          Array.from({ length: expectedReplayCopies }, () => evidenceOrder).flat(),
        );
        const selectionIndex = order.indexOf(`selection:${seeded.head.runId}`);
        let replayCursor = 0;
        let semanticCursor = -1;
        for (let pass = 0; pass < expectedReplayCopies; pass += 1) {
          const knowledgeStart = order.indexOf(knowledgeOrder[0]!, replayCursor);
          const knowledgeEnd = order.indexOf(knowledgeOrder.at(-1)!, knowledgeStart);
          const semanticIndex = order.indexOf("semantic-verifier", semanticCursor + 1);
          const evidenceStart = order.indexOf(evidenceOrder[0]!, semanticIndex + 1);
          const evidenceEnd = order.indexOf(evidenceOrder.at(-1)!, evidenceStart);
          if (pass === 0) expect(selectionIndex).toBeGreaterThan(evidenceEnd);
          else expect(knowledgeStart).toBeGreaterThan(selectionIndex);
          expect(semanticIndex).toBeGreaterThan(knowledgeEnd);
          expect(evidenceStart).toBeGreaterThan(semanticIndex);
          replayCursor = evidenceEnd + 1;
          semanticCursor = semanticIndex;
        }
        expect(selectionIndex).toBeGreaterThan(order.indexOf(evidenceOrder.at(-1)!));
        const criterionCount = seeded.criteria.criteria.length;
        const expectedEvaluationCount = row === "ranking-mirror"
          ? (harness.fixture.installed.catalog.members.length +
            authority.terminal.markers.length) * criterionCount
          : (2 * harness.fixture.installed.catalog.members.length * criterionCount) +
            (3 * authority.terminal.markers.length * criterionCount);
        expect(harness.fixture.policyCalls.evaluations.length - evaluationOffset)
          .toBe(expectedEvaluationCount);
        if (row === "ranking-mirror") {
          expect(selectionReplayHarness.order).toEqual([
            "semantic-verifier",
            "selection-history",
          ]);
          expect(selectionReplayHarness.pureInputs).toEqual([]);
          expect(selectionReplayHarness.pairInputs).toEqual([]);
        } else if (row === "marker-binding") {
          expect(selectionReplayHarness.order).toEqual([
            "semantic-verifier",
            "selection-history",
            "semantic-verifier",
            "pure-selection",
            "selection-wrapper",
          ]);
          expect(selectionReplayHarness.pureInputs).toEqual([[
            {
              frontier: authority.frontier,
              request: {
                cityId: drift.selection.cityId,
                warningCopyVersion: drift.selection.warningCopyVersion,
              },
            },
          ]]);
          expect(selectionReplayHarness.pairInputs).toHaveLength(1);
          const pairInput = selectionReplayHarness.pairInputs[0] as readonly unknown[];
          expect(pairInput).toHaveLength(3);
          expect(pairInput[0]).toEqual(drift);
          expect(pairInput[1]).toEqual({
            terminal: authority.terminal,
            ranking: authority.ranking,
            preCityBranch: authority.preCityBranch,
          });
          const capturedIntegrity = pairInput[2] as CityDecisionIntegrity;
          expect(Reflect.ownKeys(capturedIntegrity).sort()).toEqual(["canonical", "hash"]);
          for (const key of ["canonical", "hash"] as const) {
            const descriptor = Object.getOwnPropertyDescriptor(capturedIntegrity, key)!;
            expect(descriptor.get).toBeUndefined();
            expect(descriptor.set).toBeUndefined();
            expect(typeof descriptor.value).toBe("function");
          }
          const canonicalOffset = harness.calls.decisionCanonicals.length;
          const hashOffset = harness.calls.decisionHashes.length;
          const probe = freezeDeep({
            schemaVersion: "selection-integrity-probe@1",
            selectionId: drift.selection.id,
          });
          const canonicalProbe = capturedIntegrity.canonical(probe);
          const probeDigest = capturedIntegrity.hash(canonicalProbe);
          expect(canonicalProbe).toBe(DECISION_INTEGRITY.canonical(probe));
          expect(probeDigest).toBe(DECISION_INTEGRITY.hash(canonicalProbe));
          expect(harness.calls.decisionCanonicals.slice(canonicalOffset)).toEqual([{
            value: probe,
            result: canonicalProbe,
          }]);
          expect(harness.calls.decisionHashes.slice(hashOffset)).toEqual([{
            value: canonicalProbe,
            result: probeDigest,
          }]);
        } else {
          expect(selectionReplayHarness.order).toEqual([
            "semantic-verifier",
            "selection-history",
            "semantic-verifier",
            "pure-selection",
          ]);
          expect(selectionReplayHarness.pureInputs).toEqual([[
            {
              frontier: authority.frontier,
              request: { cityId: drift.selection.cityId },
            },
          ]]);
          expect(selectionReplayHarness.pairInputs).toEqual([]);
        }
        expect(effects()).toEqual(beforeEffects);
        expect(harness.fixture.database.prepare("SELECT total_changes() AS count").get())
          .toEqual(databaseChanges);
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(history.returned).toHaveLength(2);
      expect(history.returned[0]).not.toBe(history.returned[1]);
      recursivelyNotAliased(history.returned[0], history.returned[1]);
    }
  });

  test("replays committed working and terminal commands from their original prepared base", async () => {
    // Break caught: checking the current head before the command or rerunning sources on a committed hit.
    let forbidHistoricalWorkingHistory = false;
    const harness = await syntheticApplicationHarness({
      selectionHistory: {
        listSelectionsWithBranchesVerified: async () => {
          if (forbidHistoricalWorkingHistory) {
            throw new Error("historical_working_history_read");
          }
          return Object.freeze([]);
        },
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:hit-replay",
    });
    const firstPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:working-winner",
    });
    const firstWinner = await harness.assembly.application.continueCityFrontier(
      firstPrepared,
      () => undefined,
      new AbortController().signal,
    );
    expect(firstWinner.revision.kind).toBe("working");
    const snapshotEffects = () => ({
      fixed: harness.calls.fixedRouteInputs.length,
      safety: harness.calls.source.length,
      append: harness.calls.appends.length,
      clocks: harness.calls.clocks.length,
      deadlines: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      evidence: harness.calls.evidenceSeals.length,
      knowledge: harness.calls.knowledgePublishes.length,
    });
    const firstSourceCounts = snapshotEffects();
    const recoveredFirst = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:working-winner",
    });
    expect(recoveredFirst).toEqual(firstPrepared);
    const firstHitEvents = vi.fn();
    const firstHit = await harness.assembly.application.continueCityFrontier(
      recoveredFirst,
      firstHitEvents,
      new AbortController().signal,
    );
    expect(firstHit).toEqual(firstWinner);
    expect(firstHitEvents).not.toHaveBeenCalled();
    expect(harness.calls.fixedRouteInputs).toHaveLength(firstSourceCounts.fixed);
    expect(harness.calls.source).toHaveLength(firstSourceCounts.safety);
    expect(harness.calls.appends).toHaveLength(firstSourceCounts.append);
    expect(snapshotEffects()).toEqual(firstSourceCounts);

    const secondPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: firstWinner.revision.id,
      commandId: "continue:terminal-winner",
    });
    const terminalWinner = await harness.assembly.application.continueCityFrontier(
      secondPrepared,
      () => undefined,
      new AbortController().signal,
    );
    expect(terminalWinner.revision.kind).toBe("terminal");
    const terminalCounts = snapshotEffects();
    const recoveredTerminal = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: firstWinner.revision.id,
      commandId: "continue:terminal-winner",
    });
    expect(recoveredTerminal).toEqual(secondPrepared);
    const terminalHitEvents = vi.fn();
    const terminalHit = await harness.assembly.application.continueCityFrontier(
      recoveredTerminal,
      terminalHitEvents,
      new AbortController().signal,
    );
    expect(terminalHit).toEqual(terminalWinner);
    expect(terminalHitEvents).not.toHaveBeenCalled();
    expect(harness.calls.fixedRouteInputs).toHaveLength(terminalCounts.fixed);
    expect(harness.calls.source).toHaveLength(terminalCounts.safety);
    expect(harness.calls.appends).toHaveLength(terminalCounts.append);
    expect(snapshotEffects()).toEqual(terminalCounts);

    const earlierHitEvents = vi.fn();
    const beforeEarlierHit = snapshotEffects();
    const beforeHistoricalPrepareEffects = nonStructuralEffects(harness);
    const historicalReloadOffset = harness.calls.reloads.length;
    const historicalOrderOffset = harness.calls.authorityOrder.length;
    const recoveredEarlierAfterTerminal = await harness.assembly.application
      .prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: started.revision.id,
        commandId: "continue:working-winner",
      });
    expect(recoveredEarlierAfterTerminal).toEqual(firstPrepared);
    expect(nonStructuralEffects(harness)).toEqual(beforeHistoricalPrepareEffects);
    expect(harness.calls.reloads.slice(historicalReloadOffset)).toEqual([
      `frontier.command:${started.runId}:continue:working-winner`,
      `frontier.revision:${started.revision.id}`,
    ]);
    expect(harness.calls.authorityOrder.slice(historicalOrderOffset)).toEqual([
      `frontier.command:${started.runId}:continue:working-winner`,
      `frontier.revision:${started.revision.id}`,
    ]);
    forbidHistoricalWorkingHistory = true;
    const earlierHit = await harness.assembly.application.continueCityFrontier(
      recoveredEarlierAfterTerminal,
      earlierHitEvents,
      new AbortController().signal,
    );
    expect(earlierHit).toEqual(firstWinner);
    expect(earlierHit.revision.kind).toBe("working");
    expect(earlierHit.selections).toEqual([]);
    expect(earlierHitEvents).not.toHaveBeenCalled();
    expect(snapshotEffects()).toEqual(beforeEarlierHit);
  });

  test("rejects a drifted append result before any post-append projection or repeated source work", async () => {
    // Break caught: trusting the append return graph or rerunning a completed flight after mismatch.
    const harness = await syntheticApplicationHarness({ appendResultDrift: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:append-drift",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:append-drift",
    });
    const emitted: CityFrontierEvent[] = [];
    const error = requireError(await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { emitted.push(event); },
      new AbortController().signal,
    ).catch((caught: unknown) => caught));

    expect(error.message).toBe("integrity_mismatch");
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(harness.calls.safetySearchInputs).toHaveLength(3);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
    expect(harness.calls.selectionHistory).toEqual([started.runId]);
    expect(emitted.some(({ type }) => type === "city_revision_committed")).toBe(false);
    expect(emitted.some(({ type }) => type === "city_continuation_completed")).toBe(false);
    expect(harness.calls.authorityOrder.slice(harness.calls.appendAuthorityOffsets[0]!)).toEqual([]);
  });

  test("shares one flight while every identical waiter owns a private serialized event pump", async () => {
    // Break caught: caching only sources, sharing event objects, or awaiting one caller's emitter in the flight.
    const harness = await syntheticApplicationHarness({
      gateResearch: true,
      discriminatingClock: true,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:shared-flight",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:shared-flight",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    genericSealHarness.beforeReturn = undefined;
    resetContinuationPreflightObservations(harness);
    harness.calls.clocks.splice(0);
    const firstEvents: CityFrontierEvent[] = [];
    const secondEvents: CityFrontierEvent[] = [];
    const firstEmitterRelease = deferred<void>();
    const followerActivated = deferred<void>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = harness.assembly.application.continueCityFrontier(
      prepared,
      async (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        firstEvents.push(event);
        if (event.type === "city_progress" &&
          event.stage === "source_completed:si-city-safety") await firstEmitterRelease.promise;
      },
      firstController.signal,
    ) as Promise<CityFrontierReadModel>;
    let firstSettled = false;
    let firstResult: CityFrontierReadModel | undefined;
    let firstFailure: unknown;
    void first.then(
      (result) => {
        firstResult = result;
        firstSettled = true;
      },
      (error: unknown) => {
        firstFailure = error;
        firstSettled = true;
      },
    );
    let second: Promise<CityFrontierReadModel> | undefined;
    let secondSettled = false;
    let secondResult: CityFrontierReadModel | undefined;
    let secondFailure: unknown;
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.researchEntered, [first]);
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 2,
        head: 1,
        ranking: 1,
        exactPackage: 1,
        exactManifest: 1,
        historicalCatalog: 1,
        criteria: 1,
        branch: 1,
        evidence: 1,
      });
      const follower = harness.assembly.application.continueCityFrontier(
        prepared,
        (event: CityFrontierEvent) => {
          recursivelyFrozen(event);
          secondEvents.push(event);
          if (event.type === "city_activated") followerActivated.resolve(undefined);
        },
        secondController.signal,
      ) as Promise<CityFrontierReadModel>;
      second = follower;
      void follower.then(
        (result: CityFrontierReadModel) => {
          secondResult = result;
          secondSettled = true;
        },
        (error: unknown) => {
          secondFailure = error;
          secondSettled = true;
        },
      );
      await awaitBarrierOrEarlySettlement(followerActivated.promise, [first, second]);
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 4,
        head: 2,
        ranking: 2,
        exactPackage: 2,
        exactManifest: 2,
        historicalCatalog: 2,
        criteria: 2,
        branch: 2,
        evidence: 2,
      });
      harness.gates.releaseResearch();
      expect(fixedRunnerHarness.promises).toHaveLength(3);
      expect(safetyRunnerHarness.promises).toHaveLength(1);
      await Promise.allSettled([
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ]);
      await nextEventLoopTurn();
      expect(secondSettled).toBe(true);
      expect(secondFailure).toBeUndefined();
      expect(firstSettled).toBe(false);
      expect(firstEvents.at(-1)).toMatchObject({
        type: "city_progress",
        stage: "source_completed:si-city-safety",
      });
    } finally {
      harness.gates.releaseResearch();
      firstEmitterRelease.resolve(undefined);
      await Promise.allSettled(second === undefined ? [first] : [first, second]);
    }
    expect(firstFailure).toBeUndefined();
    if (firstResult === undefined || secondResult === undefined) {
      throw new Error("missing_waiter_result");
    }

    expect(firstResult).toEqual(secondResult);
    recursivelyNotAliased(firstResult, secondResult);
    expectPrivateSuccessfulTrace(
      firstEvents,
      firstResult,
      started.revision.id,
      harness.fixture.installed,
    );
    expectPrivateSuccessfulTrace(
      secondEvents,
      secondResult,
      started.revision.id,
      harness.fixture.installed,
    );
    expect(firstEvents.map(({ type }) => type)).toEqual(secondEvents.map(({ type }) => type));
    for (const [index, event] of firstEvents.entries()) {
      recursivelyNotAliased(event, secondEvents[index]);
    }
    const firstEventTimes = firstEvents.map(({ occurredAt }) => occurredAt);
    const secondEventTimes = secondEvents.map(({ occurredAt }) => occurredAt);
    expect(new Set(firstEventTimes).size).toBe(13);
    expect(new Set(secondEventTimes).size).toBe(13);
    expect(firstEventTimes.every((value, index, values) =>
      index === 0 || values[index - 1]! <= value)).toBe(true);
    expect(secondEventTimes.every((value, index, values) =>
      index === 0 || values[index - 1]! <= value)).toBe(true);
    expect(firstEventTimes.every((value) => !secondEventTimes.includes(value))).toBe(true);
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    expect(harness.calls.safetySearchInputs).toHaveLength(3);
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(2);
    expect(DECISION_INTEGRITY.canonical(harness.calls.appends[0]))
      .toBe(DECISION_INTEGRITY.canonical(harness.calls.appends[1]));
    const sharedSignals = capturedResearchSignals(harness);
    expect(sharedSignals).toHaveLength(7);
    expect(new Set(sharedSignals).size).toBe(1);
    expect(sharedSignals[0]).not.toBe(firstController.signal);
    expect(sharedSignals[0]).not.toBe(secondController.signal);
    const sharedEvidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    const expectedFlightIdentity = {
      cityCheckRunId: sharedEvidenceInput.cityCheckRunId,
      runId: started.runId,
      baseRevisionId: started.revision.id,
      rankingSnapshotId: started.ranking.id,
      cityId: "ljubljana",
      assessmentAt: started.ranking.assessmentAt,
      installedPackageContext: started.ranking.installedPackageContext,
    };
    expect(harness.calls.flightIdentityCanonicals).toHaveLength(2);
    expect(harness.calls.flightIdentityCanonicals.every((value) =>
      DECISION_INTEGRITY.canonical(value) ===
        DECISION_INTEGRITY.canonical(expectedFlightIdentity))).toBe(true);
    expect(harness.state.root()).toEqual(firstResult.revision);
  });

  test("detaches one aborted waiter without cancelling the shared research survivor", async () => {
    // Break caught: storing caller signals in the flight or aborting shared work while a waiter survives.
    const harness = await syntheticApplicationHarness({ gateResearch: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:one-waiter-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:one-waiter-abort",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    resetContinuationPreflightObservations(harness);
    const abortedEvents: CityFrontierEvent[] = [];
    const survivorEvents: CityFrontierEvent[] = [];
    const abortedController = new AbortController();
    const survivorController = new AbortController();
    const abortedReason = new Error("caller_detached");
    const twoActivated = deferred<void>();
    let activated = 0;
    const record = (target: CityFrontierEvent[], event: CityFrontierEvent): void => {
      recursivelyFrozen(event);
      target.push(event);
      if (event.type === "city_activated") {
        activated += 1;
        if (activated === 2) twoActivated.resolve(undefined);
      }
    };
    const aborted = harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { record(abortedEvents, event); },
      abortedController.signal,
    ).catch((error: unknown) => error);
    const survivor = harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { record(survivorEvents, event); },
      survivorController.signal,
    );

    let detachedLength = 0;
    let result: CityFrontierReadModel | undefined;
    try {
      await awaitBarrierOrEarlySettlement(
        Promise.all([harness.gates.researchEntered, twoActivated.promise]),
        [aborted, survivor],
      );
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 4,
        head: 2,
        ranking: 2,
        exactPackage: 2,
        exactManifest: 2,
        historicalCatalog: 2,
        criteria: 2,
        branch: 2,
        evidence: 2,
      });
      abortedController.abort(abortedReason);
      expect(await aborted).toBe(abortedReason);
      detachedLength = abortedEvents.length;
      const sharedSignalsBeforeRelease = (fixedRunnerHarness.inputs as Array<
        CityFixedSourceRunInput<SloveniaCityFixedSourceId>
      >).map(({ signal }) => signal);
      expect(sharedSignalsBeforeRelease.every(({ aborted: isAborted }) => !isAborted)).toBe(true);
      expect(sharedSignalsBeforeRelease[0]).not.toBe(abortedController.signal);
      expect(sharedSignalsBeforeRelease[0]).not.toBe(survivorController.signal);
      harness.gates.releaseResearch();
      result = await survivor;
    } finally {
      harness.gates.releaseResearch();
      if (result === undefined) survivorController.abort();
      await Promise.allSettled([aborted, survivor]);
    }
    if (result === undefined) throw new Error("missing_survivor_result");

    expect(result.revision.markers).toHaveLength(1);
    expect(abortedEvents).toHaveLength(detachedLength);
    expectPrivateSuccessfulTrace(
      survivorEvents,
      result,
      started.revision.id,
      harness.fixture.installed,
    );
    const sharedSignals = capturedResearchSignals(harness);
    expect(sharedSignals).toHaveLength(7);
    expect(new Set(sharedSignals).size).toBe(1);
    expect(sharedSignals.every(({ aborted: isAborted }) => !isAborted)).toBe(true);
    expect(sharedSignals[0]).not.toBe(abortedController.signal);
    expect(sharedSignals[0]).not.toBe(survivorController.signal);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
  });

  test("aborts shared research once when the last waiter detaches and clears the flight safely", async () => {
    // Break caught: orphan research publishes authority or an aborted map entry poisons the next retry.
    const harness = await syntheticApplicationHarness({ gateResearch: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:all-waiters-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:all-waiters-abort",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    genericSealHarness.beforeReturn = undefined;
    resetContinuationPreflightObservations(harness);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstReason = new Error("first_waiter_detached");
    const firstEvents: CityFrontierEvent[] = [];
    const secondEvents: CityFrontierEvent[] = [];
    const twoActivated = deferred<void>();
    let activated = 0;
    const emit = (target: CityFrontierEvent[]) => (event: CityFrontierEvent): void => {
      recursivelyFrozen(event);
      target.push(event);
      if (event.type === "city_activated") {
        activated += 1;
        if (activated === 2) twoActivated.resolve(undefined);
      }
    };
    const first = harness.assembly.application.continueCityFrontier(
      prepared,
      emit(firstEvents),
      firstController.signal,
    ).catch((error: unknown) => error);
    const second = harness.assembly.application.continueCityFrontier(
      prepared,
      emit(secondEvents),
      secondController.signal,
    ).catch((error: unknown) => error);

    let originalSignal: AbortSignal | undefined;
    let sharedAbortCount = 0;
    let firstError: unknown;
    let secondError: unknown;
    let researchPromises: Promise<unknown>[] = [];
    try {
      await awaitBarrierOrEarlySettlement(
        Promise.all([harness.gates.researchEntered, twoActivated.promise]),
        [first, second],
      );
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 4,
        head: 2,
        ranking: 2,
        exactPackage: 2,
        exactManifest: 2,
        historicalCatalog: 2,
        criteria: 2,
        branch: 2,
        evidence: 2,
      });
      expect(fixedRunnerHarness.promises).toHaveLength(3);
      expect(safetyRunnerHarness.promises).toHaveLength(1);
      researchPromises = [
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ];
      const fixedSignals = (fixedRunnerHarness.inputs as Array<
        CityFixedSourceRunInput<SloveniaCityFixedSourceId>
      >).map(({ signal }) => signal);
      expect(new Set(fixedSignals).size).toBe(1);
      originalSignal = fixedSignals[0]!;
      originalSignal.addEventListener("abort", () => { sharedAbortCount += 1; });
      harness.gates.releaseResearch();
      firstController.abort(firstReason);
      secondController.abort();
      [firstError, secondError] = await Promise.all([first, second]);
      await Promise.allSettled(researchPromises);
    } finally {
      harness.gates.releaseResearch();
      firstController.abort(firstReason);
      secondController.abort();
      await Promise.allSettled([first, second]);
      await Promise.allSettled([
        ...fixedRunnerHarness.promises,
        ...safetyRunnerHarness.promises,
      ]);
    }
    const settledSignalCount = capturedResearchSignals(harness).length;
    await nextEventLoopTurn();

    expect(firstError).toBe(firstReason);
    expect(secondError).toBe(secondController.signal.reason);
    expect(secondError).toBeInstanceOf(DOMException);
    expect((secondError as DOMException).name).toBe("AbortError");
    expect(originalSignal?.aborted).toBe(true);
    expect(sharedAbortCount).toBe(1);
    const originalSignals = capturedResearchSignals(harness);
    expect(originalSignals).toHaveLength(settledSignalCount);
    expect(new Set(originalSignals).size).toBe(1);
    expect(originalSignals[0]).toBe(originalSignal);
    expect(originalSignals[0]).not.toBe(firstController.signal);
    expect(originalSignals[0]).not.toBe(secondController.signal);
    const detachedLengths = [firstEvents.length, secondEvents.length] as const;
    expect([firstEvents.length, secondEvents.length]).toEqual(detachedLengths);
    expect(genericSealHarness.calls).toBe(0);
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    expect(harness.state.root().markers).toEqual([]);

    const retry = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => undefined,
      new AbortController().signal,
    );
    expect(retry.revision.markers).toHaveLength(1);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
    expect([firstEvents.length, secondEvents.length]).toEqual(detachedLengths);
  });

  test("rechecks the last waiter after generic sealing and before durable Evidence publication", async () => {
    // Break caught: crossing the durable boundary after the final caller detached in the sealing microtask.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:pre-evidence-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:pre-evidence-abort",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    const controller = new AbortController();
    const reason = new Error("detached_before_evidence_seal");
    const events: CityFrontierEvent[] = [];
    let preSealSignals: AbortSignal[] = [];
    let sharedAbortCount = 0;
    genericSealHarness.beforeReturn = () => {
      preSealSignals = capturedResearchSignals(harness);
      preSealSignals[0]!.addEventListener("abort", () => { sharedAbortCount += 1; });
      controller.abort(reason);
    };

    const error = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { events.push(event); },
      controller.signal,
    ).catch((caught: unknown) => caught);

    expect(error).toBe(reason);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.fixedRouteOutputs).toHaveLength(5);
    expect(harness.calls.safetySearchOutputs).toHaveLength(3);
    expect(harness.calls.safetyDocumentOutputs).toHaveLength(1);
    const detachedLength = events.length;
    expect(fixedRunnerHarness.promises).toHaveLength(3);
    expect(safetyRunnerHarness.promises).toHaveLength(1);
    expect(genericSealHarness.promises).toHaveLength(1);
    await Promise.allSettled([
      ...fixedRunnerHarness.promises,
      ...safetyRunnerHarness.promises,
      ...genericSealHarness.promises,
    ]);
    await nextEventLoopTurn();
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    expect(events).toHaveLength(detachedLength);
    const sharedSignals = capturedResearchSignals(harness);
    expect(sharedSignals).toHaveLength(7);
    expect(preSealSignals).toEqual(sharedSignals);
    expect(new Set(sharedSignals).size).toBe(1);
    expect(sharedSignals.every(({ aborted }) => aborted)).toBe(true);
    expect(sharedSignals[0]).not.toBe(controller.signal);
    expect(sharedAbortCount).toBe(1);
  });

  test("rejects a same-check-key collision between two coherent complete flight identities", async () => {
    // Break caught: keying only by cityCheckRunId and joining a different run's owned authority graph.
    const harness = await syntheticApplicationHarness({
      gateResearch: true,
      preserveRuns: true,
      discriminatingClock: true,
    });
    const firstStart = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:flight-identity-a",
    });
    const secondStart = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.alternateResolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:flight-identity-b",
    });
    const firstPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: firstStart.runId,
      expectedRevisionId: firstStart.revision.id,
      commandId: "continue:flight-identity-a",
    });
    const secondPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: secondStart.runId,
      expectedRevisionId: secondStart.revision.id,
      commandId: "continue:flight-identity-b",
    });
    const firstCityId = firstStart.ranking.ordered[0]!.cityId;
    const secondCityId = secondStart.ranking.ordered[0]!.cityId;
    const firstCheckIdentity = {
      schemaVersion: "city-check-run@1",
      runId: firstStart.runId,
      cityId: firstCityId,
      rankingSnapshotId: firstStart.ranking.id,
    } as const;
    const secondCheckIdentity = {
      schemaVersion: "city-check-run@1",
      runId: secondStart.runId,
      cityId: secondCityId,
      rankingSnapshotId: secondStart.ranking.id,
    } as const;
    expect(DECISION_INTEGRITY.canonical(firstCheckIdentity))
      .not.toBe(DECISION_INTEGRITY.canonical(secondCheckIdentity));
    expect(firstStart.ranking.assessmentAt).not.toBe(secondStart.ranking.assessmentAt);
    harness.state.collideCheckIdentities([firstCheckIdentity, secondCheckIdentity]);
    const collidedCheckId = `city-check:${"c".repeat(64)}`;
    const completeIdentities = [
      {
        cityCheckRunId: collidedCheckId,
        runId: firstStart.runId,
        baseRevisionId: firstPrepared.baseRevisionId,
        rankingSnapshotId: firstStart.ranking.id,
        cityId: firstCityId,
        assessmentAt: firstStart.ranking.assessmentAt,
        installedPackageContext: firstStart.ranking.installedPackageContext,
      },
      {
        cityCheckRunId: collidedCheckId,
        runId: secondStart.runId,
        baseRevisionId: secondPrepared.baseRevisionId,
        rankingSnapshotId: secondStart.ranking.id,
        cityId: secondCityId,
        assessmentAt: secondStart.ranking.assessmentAt,
        installedPackageContext: secondStart.ranking.installedPackageContext,
      },
    ] as const;
    expect(completeIdentities.map((identity) => Reflect.ownKeys(identity).sort())).toEqual([
      ["assessmentAt", "baseRevisionId", "cityCheckRunId", "cityId", "installedPackageContext", "rankingSnapshotId", "runId"],
      ["assessmentAt", "baseRevisionId", "cityCheckRunId", "cityId", "installedPackageContext", "rankingSnapshotId", "runId"],
    ]);
    expect(DECISION_INTEGRITY.canonical(completeIdentities[0]))
      .not.toBe(DECISION_INTEGRITY.canonical(completeIdentities[1]));
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    resetContinuationPreflightObservations(harness);
    const firstEvents: CityFrontierEvent[] = [];
    const first = harness.assembly.application.continueCityFrontier(
      firstPrepared,
      (event: CityFrontierEvent) => { firstEvents.push(event); },
      new AbortController().signal,
    );
    let firstResult: CityFrontierReadModel | undefined;
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.researchEntered, [first]);
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 2,
        head: 1,
        ranking: 1,
        exactPackage: 1,
        exactManifest: 1,
        historicalCatalog: 1,
        criteria: 1,
        branch: 1,
        evidence: 1,
      });
      const beforeCollision = {
        generic: genericSealHarness.calls,
        evidence: harness.calls.evidenceSeals.length,
        knowledge: harness.calls.knowledgePublishes.length,
        append: harness.calls.appends.length,
      };
      const secondEvents = vi.fn();
      const firstCollision = requireError(await harness.assembly.application.continueCityFrontier(
        secondPrepared,
        secondEvents,
        new AbortController().signal,
      ).catch((error: unknown) => error));
      const secondCollision = requireError(await harness.assembly.application.continueCityFrontier(
        secondPrepared,
        secondEvents,
        new AbortController().signal,
      ).catch((error: unknown) => error));

      expect(firstCollision.message).toBe("integrity_mismatch");
      expect(secondCollision.message).toBe("integrity_mismatch");
      expect(firstCollision).not.toBe(secondCollision);
      expect(secondEvents).not.toHaveBeenCalled();
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 6,
        head: 3,
        ranking: 3,
        exactPackage: 3,
        exactManifest: 3,
        historicalCatalog: 3,
        criteria: 3,
        branch: 3,
        evidence: 3,
      });
      expect({
        generic: genericSealHarness.calls,
        evidence: harness.calls.evidenceSeals.length,
        knowledge: harness.calls.knowledgePublishes.length,
        append: harness.calls.appends.length,
      }).toEqual(beforeCollision);

      harness.gates.releaseResearch();
      firstResult = await first;
    } finally {
      harness.state.replaceChain([firstStart.revision]);
      harness.gates.releaseResearch();
      await Promise.allSettled([first]);
    }
    if (firstResult === undefined) throw new Error("missing_first_flight_result");
    expect(firstResult.runId).toBe(firstStart.runId);
    expectPrivateSuccessfulTrace(
      firstEvents,
      firstResult,
      firstStart.revision.id,
      harness.fixture.installed,
    );
    const canonicalFlightValues = harness.calls.flightIdentityCanonicals.map((value) =>
      DECISION_INTEGRITY.canonical(value));
    expect(canonicalFlightValues).toContain(DECISION_INTEGRITY.canonical(completeIdentities[0]));
    expect(canonicalFlightValues).toContain(DECISION_INTEGRITY.canonical(completeIdentities[1]));
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    expect(harness.calls.safetySearchInputs).toHaveLength(3);
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
  });

  test("binds a natural check flight to the authenticated base revision identity", async () => {
    // Break caught: joining a same-run check after an authenticated base-root swap.
    const harness = await syntheticApplicationHarness({
      gateResearch: true,
      preserveRuns: true,
      discriminatingClock: true,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:natural-base-flight",
    });
    const firstPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:natural-base-flight",
    });
    const checkIdentity = {
      schemaVersion: "city-check-run@1",
      runId: started.runId,
      cityId: started.ranking.ordered[0]!.cityId,
      rankingSnapshotId: started.ranking.id,
    } as const;
    const cityCheckRunId = `city-check:${DECISION_INTEGRITY.hash(
      DECISION_INTEGRITY.canonical(checkIdentity),
    )}`;
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    genericSealHarness.beforeReturn = undefined;
    resetContinuationPreflightObservations(harness);
    const firstEvents: CityFrontierEvent[] = [];
    const firstController = new AbortController();
    const first = harness.assembly.application.continueCityFrontier(
      firstPrepared,
      (event: CityFrontierEvent) => { firstEvents.push(event); },
      firstController.signal,
    );
    let firstResult: CityFrontierReadModel | undefined;
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.researchEntered, [first]);
      expect(continuationPreflightCounts(harness)).toEqual({
        command: 2,
        head: 1,
        ranking: 1,
        exactPackage: 1,
        exactManifest: 1,
        historicalCatalog: 1,
        criteria: 1,
        branch: 1,
        evidence: 1,
      });
      if (started.revision.kind !== "working") {
        throw new Error("expected_working_frontier_fixture");
      }
      const alternateRoot = sealCityFrontierRevision({
        runId: started.revision.runId,
        rankingSnapshotId: started.revision.rankingSnapshotId,
        markers: [],
        projection: {
          kind: "working",
          nextUncheckedRank: started.revision.nextUncheckedRank,
          selectableCityIds: [],
          phase: started.revision.phase,
        },
        operation: {
          ...started.revision.operation,
          commandId: "start:natural-base-swap",
        },
        createdAt: started.revision.createdAt,
      }, DECISION_INTEGRITY);
      expect(alternateRoot.id).not.toBe(started.revision.id);
      harness.state.replaceChain([alternateRoot]);
      const beforePrepare = continuationPreflightCounts(harness);
      const alternatePrepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: started.runId,
        expectedRevisionId: alternateRoot.id,
        commandId: "continue:natural-base-swap",
      });
      expect(continuationPreflightCounts(harness)).toEqual({
        ...beforePrepare,
        command: beforePrepare.command + 1,
        head: beforePrepare.head + 1,
      });
      const firstIdentity = {
        cityCheckRunId,
        runId: started.runId,
        baseRevisionId: firstPrepared.baseRevisionId,
        rankingSnapshotId: started.ranking.id,
        cityId: checkIdentity.cityId,
        assessmentAt: started.ranking.assessmentAt,
        installedPackageContext: started.ranking.installedPackageContext,
      };
      const alternateIdentity = {
        ...firstIdentity,
        baseRevisionId: alternatePrepared.baseRevisionId,
      };
      expect(Object.entries(firstIdentity).filter(([key, value]) =>
        DECISION_INTEGRITY.canonical(value) !==
          DECISION_INTEGRITY.canonical(alternateIdentity[key as keyof typeof firstIdentity])))
        .toEqual([["baseRevisionId", firstIdentity.baseRevisionId]]);
      const beforeCollisions = {
        effects: {
          fixed: harness.calls.fixedRouteInputs.length,
          safety: harness.calls.source.length,
          generic: genericSealHarness.calls,
          evidence: harness.calls.evidenceSeals.length,
          knowledge: harness.calls.knowledgePublishes.length,
          append: harness.calls.appends.length,
        },
        preflight: continuationPreflightCounts(harness),
      };
      const collisionEvents = vi.fn();
      const firstCollision = requireError(await harness.assembly.application.continueCityFrontier(
        alternatePrepared,
        collisionEvents,
        new AbortController().signal,
      ).catch((error: unknown) => error));
      const secondCollision = requireError(await harness.assembly.application.continueCityFrontier(
        alternatePrepared,
        collisionEvents,
        new AbortController().signal,
      ).catch((error: unknown) => error));
      expect(firstCollision.message).toBe("integrity_mismatch");
      expect(secondCollision.message).toBe("integrity_mismatch");
      expect(firstCollision).not.toBe(secondCollision);
      expect(collisionEvents).not.toHaveBeenCalled();
      expect(continuationPreflightCounts(harness)).toEqual(Object.fromEntries(
        Object.entries(beforeCollisions.preflight).map(([key, value]) => [
          key,
          value + (key === "command" ? 4 : 2),
        ]),
      ));
      expect({
        fixed: harness.calls.fixedRouteInputs.length,
        safety: harness.calls.source.length,
        generic: genericSealHarness.calls,
        evidence: harness.calls.evidenceSeals.length,
        knowledge: harness.calls.knowledgePublishes.length,
        append: harness.calls.appends.length,
      }).toEqual(beforeCollisions.effects);
      const canonicalFlightValues = harness.calls.flightIdentityCanonicals.map((value) =>
        DECISION_INTEGRITY.canonical(value));
      expect(canonicalFlightValues).toContain(DECISION_INTEGRITY.canonical(firstIdentity));
      expect(canonicalFlightValues).toContain(DECISION_INTEGRITY.canonical(alternateIdentity));
      harness.state.replaceChain([started.revision]);
      harness.gates.releaseResearch();
      firstResult = await first;
    } finally {
      harness.state.replaceChain([started.revision]);
      harness.gates.releaseResearch();
      firstController.abort();
      await Promise.allSettled([first]);
    }
    if (firstResult === undefined) throw new Error("missing_natural_flight_result");
    expectPrivateSuccessfulTrace(
      firstEvents,
      firstResult,
      started.revision.id,
      harness.fixture.installed,
    );
    expect(firstResult.runId).toBe(started.runId);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
  });

  test("recovers an authentic Evidence-only crash without repeating source research", async () => {
    // Break caught: treating durable Evidence as disposable after a native Knowledge failure.
    const nativeFailure = new Error("native_knowledge_publish_failure");
    const harness = await syntheticApplicationHarness({
      failKnowledgePublishOnce: nativeFailure,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:evidence-only-crash",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:evidence-only-crash",
    });
    const failedEvents: CityFrontierEvent[] = [];
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        failedEvents.push(event);
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(failure).toBe(nativeFailure);
    expectPrivateFlightPrefix(failedEvents, "evidence_verified", {
      runId: started.runId,
      baseRevisionId: started.revision.id,
      cityId: "ljubljana",
      installed: harness.fixture.installed,
    });
    const failedEventCount = failedEvents.length;
    await nextEventLoopTurn();
    expect(failedEvents).toHaveLength(failedEventCount);
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    const durableEvidenceBefore = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(
        `${evidenceInput.cityCheckRunId}:evidence`,
      ));
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(durableEvidenceBefore.snapshot.id)))
      .toBeUndefined();
    const beforeRecovery = researchAndPublicationCounts(harness);
    const beforeRecoveryAuthority = recoveryAuthorityCounts(harness);
    const recoveryEvents: CityFrontierEvent[] = [];
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        recoveryEvents.push(event);
      },
      new AbortController().signal,
    );

    expectPrivateRecoveryTrace(recoveryEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeRecovery,
      knowledge: beforeRecovery.knowledge + 1,
      append: beforeRecovery.append + 1,
    });
    const recoveryAppendEntry = harness.calls.appendEntryAuthorityCounts.at(-1)!;
    expectEveryAuthorityChannelAdvanced(beforeRecoveryAuthority, recoveryAppendEntry);
    expectEveryAuthorityChannelAdvanced(recoveryAppendEntry, recoveryAuthorityCounts(harness));
    const durableEvidenceAfter = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(
        durableEvidenceBefore.snapshot.id,
      ));
    expect(durableEvidenceAfter).toEqual(durableEvidenceBefore);
    expect(durableEvidenceAfter).not.toBe(durableEvidenceBefore);
    recursivelyNotAliased(durableEvidenceAfter, durableEvidenceBefore);
    recursivelyFrozen(durableEvidenceAfter);
    const durableKnowledge = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(
        durableEvidenceAfter.snapshot.id,
      ));
    expect(durableKnowledge).toBeDefined();
    recursivelyFrozen(durableKnowledge);
    expect(harness.state.root()).toEqual(recovered.revision);
  });

  test("recovers authentic Evidence and Knowledge after append failed before persistence", async () => {
    // Break caught: republishing durable authority or rerunning sources after a native append failure.
    const nativeFailure = new Error("native_frontier_append_failure");
    const harness = await syntheticApplicationHarness({
      failAppendBeforePersistenceOnce: nativeFailure,
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:authority-before-append-crash",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:authority-before-append-crash",
    });
    const failedEvents: CityFrontierEvent[] = [];
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        failedEvents.push(event);
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(failure).toBe(nativeFailure);
    expectPrivateFlightPrefix(failedEvents, "knowledge_published", {
      runId: started.runId,
      baseRevisionId: started.revision.id,
      cityId: "ljubljana",
      installed: harness.fixture.installed,
    });
    const failedEventCount = failedEvents.length;
    await nextEventLoopTurn();
    expect(failedEvents).toHaveLength(failedEventCount);
    expect(harness.state.root()).toEqual(started.revision);
    expect(harness.calls.appends).toHaveLength(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    const evidenceBefore = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(
        `${evidenceInput.cityCheckRunId}:evidence`,
      ));
    const knowledgeBefore = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(
        evidenceBefore.snapshot.id,
      ));
    expect(knowledgeBefore).toBeDefined();
    const beforeRecovery = researchAndPublicationCounts(harness);
    const beforeRecoveryAuthority = recoveryAuthorityCounts(harness);
    const recoveryEvents: CityFrontierEvent[] = [];
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        recoveryEvents.push(event);
      },
      new AbortController().signal,
    );

    expectPrivateRecoveryTrace(recoveryEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeRecovery,
      append: beforeRecovery.append + 1,
    });
    const recoveryAppendEntry = harness.calls.appendEntryAuthorityCounts.at(-1)!;
    expectEveryAuthorityChannelAdvanced(beforeRecoveryAuthority, recoveryAppendEntry);
    expectEveryAuthorityChannelAdvanced(recoveryAppendEntry, recoveryAuthorityCounts(harness));
    const evidenceAfter = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(evidenceBefore.snapshot.id));
    const knowledgeAfter = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(
        evidenceBefore.snapshot.id,
      ));
    expect(evidenceAfter).toEqual(evidenceBefore);
    expect(evidenceAfter).not.toBe(evidenceBefore);
    expect(knowledgeAfter).toEqual(knowledgeBefore);
    expect(knowledgeAfter).not.toBe(knowledgeBefore);
    recursivelyNotAliased(evidenceAfter, evidenceBefore);
    recursivelyNotAliased(knowledgeAfter, knowledgeBefore);
    recursivelyFrozen(evidenceAfter);
    recursivelyFrozen(knowledgeAfter);
    expect(harness.state.root()).toEqual(recovered.revision);
  });

  test("reconstructs successor knowledge across recovery and Present replay", async () => {
    // Break caught: dropping the predecessor while reconstructing a later durable city revision.
    const harness = await syntheticApplicationHarness({
      preserveRuns: true,
      discriminatingClock: true,
    });
    const firstStarted = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:successor-knowledge:first",
    });
    const firstPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: firstStarted.runId,
      expectedRevisionId: firstStarted.revision.id,
      commandId: "continue:successor-knowledge:first",
    });
    const firstCompleted = await harness.assembly.application.continueCityFrontier(
      firstPrepared,
      () => undefined,
      new AbortController().signal,
    );
    const cityId = firstCompleted.revision.markers[0]!.cityId;
    const firstKnowledge = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.loadVerified(
        firstCompleted.revision.markers[0]!.knowledgeRevisionId,
      ));
    expect(firstKnowledge.predecessorRevisionId).toBeUndefined();

    const secondStarted = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.alternateResolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:successor-knowledge:second",
    });
    expect(secondStarted.runId).not.toBe(firstStarted.runId);
    expect(secondStarted.ranking.ordered[0]!.cityId).toBe(cityId);
    const secondPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: secondStarted.runId,
      expectedRevisionId: secondStarted.revision.id,
      commandId: "continue:successor-knowledge:second",
    });
    const preAppendFailure = new Error("pre_append_successor_interruption");
    const interrupted = await harness.assembly.application.continueCityFrontier(
      secondPrepared,
      (event: CityFrontierEvent) => {
        if (event.type === "city_progress" && event.stage === "knowledge_published") {
          throw preAppendFailure;
        }
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(interrupted).toBe(preAppendFailure);
    expect(harness.state.root()).toEqual(secondStarted.revision);

    const successor = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.latestVerified(cityId));
    expect(successor?.predecessorRevisionId).toBe(firstKnowledge.id);
    const recovered = await harness.assembly.application.continueCityFrontier(
      secondPrepared,
      () => undefined,
      new AbortController().signal,
    );
    expect(recovered.revision.markers[0]).toMatchObject({
      cityId,
      knowledgeRevisionId: successor?.id,
      evidenceSnapshotId: successor?.evidenceSnapshotId,
    });
    const replayEvents = vi.fn();
    expect(await harness.assembly.application.continueCityFrontier(
      secondPrepared,
      replayEvents,
      new AbortController().signal,
    )).toEqual(recovered);
    expect(replayEvents).not.toHaveBeenCalled();
    expect(await harness.assembly.application.presentCityFrontier(secondStarted.runId))
      .toEqual(recovered);
  });

  test("owns a published successor before reading its predecessor or calling another port", async () => {
    // Break caught: invoking a borrowed predecessor accessor after Knowledge is durable but before Frontier append.
    let poisonPublishedSuccessor = false;
    let borrowedAccessorReads = 0;
    const borrowedFailure = new Error("borrowed_knowledge_predecessor_accessor_invoked");
    const harness = await syntheticApplicationHarness({
      preserveRuns: true,
      discriminatingClock: true,
      mapKnowledgePublishResult(revision) {
        if (!poisonPublishedSuccessor) return revision;
        const borrowed = structuredClone(revision) as unknown as MutableRecord;
        Object.defineProperty(borrowed, "predecessorRevisionId", {
          configurable: true,
          enumerable: true,
          get() {
            borrowedAccessorReads += 1;
            throw borrowedFailure;
          },
        });
        return borrowed;
      },
    });
    const firstStarted = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:owned-successor:first",
    });
    const firstPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: firstStarted.runId,
      expectedRevisionId: firstStarted.revision.id,
      commandId: "continue:owned-successor:first",
    });
    await harness.assembly.application.continueCityFrontier(
      firstPrepared,
      () => undefined,
      new AbortController().signal,
    );
    const secondStarted = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.alternateResolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:owned-successor:second",
    });
    const secondPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: secondStarted.runId,
      expectedRevisionId: secondStarted.revision.id,
      commandId: "continue:owned-successor:second",
    });
    const appendOffset = harness.calls.appends.length;
    poisonPublishedSuccessor = true;

    const failure = requireError(await harness.assembly.application.continueCityFrontier(
      secondPrepared,
      () => undefined,
      new AbortController().signal,
    ).catch((error: unknown) => error));

    expect(failure.message).toBe("integrity_mismatch");
    expect(failure).not.toBe(borrowedFailure);
    expect(borrowedAccessorReads).toBe(0);
    expect(harness.calls.appends).toHaveLength(appendOffset);
    expect(harness.state.root()).toEqual(secondStarted.revision);
  });

  test("keeps durable authority when the last caller aborts or its recovery emitter fails", async () => {
    // Break caught: rolling back E/K, appending for a detached waiter, or continuing after emitter failure.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:durable-boundary-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:durable-boundary-abort",
    });
    const controller = new AbortController();
    const abortReason = new Error("caller_detached_after_knowledge");
    const abortedEvents: CityFrontierEvent[] = [];
    const aborted = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        abortedEvents.push(event);
        if (event.type === "city_progress" && event.stage === "knowledge_published") {
          const sealed = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
          const evidenceAtBoundary = withInfrastructurePlanGateRead(() =>
            harness.fixture.evidenceStore.loadVerified(
              `${sealed.cityCheckRunId}:evidence`,
            ));
          const knowledgeAtBoundary = withInfrastructurePlanGateRead(() =>
            harness.fixture.knowledgeStore.findByEvidenceVerified(
              evidenceAtBoundary.snapshot.id,
            ));
          expect(knowledgeAtBoundary).toBeDefined();
          recursivelyFrozen(evidenceAtBoundary);
          recursivelyFrozen(knowledgeAtBoundary);
          controller.abort(abortReason);
        }
      },
      controller.signal,
    ).catch((error: unknown) => error);
    expect(aborted).toBe(abortReason);
    expectPrivateFlightPrefix(abortedEvents, "knowledge_published", {
      runId: started.runId,
      baseRevisionId: started.revision.id,
      cityId: "ljubljana",
      installed: harness.fixture.installed,
    });
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    const evidenceInput = harness.calls.evidenceSeals[0] as CityEvidenceSealInput;
    const durableEvidence = withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(
        `${evidenceInput.cityCheckRunId}:evidence`,
      ));
    const durableKnowledge = withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(
        durableEvidence.snapshot.id,
      ));
    expect(durableKnowledge).toBeDefined();
    const abortedLength = abortedEvents.length;
    await nextEventLoopTurn();
    expect(abortedEvents).toHaveLength(abortedLength);

    const beforeEmitterFailure = researchAndPublicationCounts(harness);
    const beforeEmitterAuthority = recoveryAuthorityCounts(harness);
    const emitterFailure = new Error("recovery_emitter_failure");
    const failedRecoveryEvents: CityFrontierEvent[] = [];
    const failedRecovery = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        failedRecoveryEvents.push(event);
        if (event.type === "city_progress" && event.stage === "evidence_verified") {
          throw emitterFailure;
        }
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(failedRecovery).toBe(emitterFailure);
    expectPrivateRecoveryPrefix(failedRecoveryEvents, {
      runId: started.runId,
      baseRevisionId: started.revision.id,
      cityId: "ljubljana",
      rank: 1,
    });
    expect(researchAndPublicationCounts(harness)).toEqual(beforeEmitterFailure);
    expectEveryAuthorityChannelAdvanced(
      beforeEmitterAuthority,
      recoveryAuthorityCounts(harness),
    );
    const failedLength = failedRecoveryEvents.length;
    await nextEventLoopTurn();
    expect(failedRecoveryEvents).toHaveLength(failedLength);

    const finalEvents: CityFrontierEvent[] = [];
    const beforeFinalAuthority = recoveryAuthorityCounts(harness);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        finalEvents.push(event);
      },
      new AbortController().signal,
    );
    expectPrivateRecoveryTrace(finalEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeEmitterFailure,
      append: beforeEmitterFailure.append + 1,
    });
    const recoveryAppendEntry = harness.calls.appendEntryAuthorityCounts.at(-1)!;
    expectEveryAuthorityChannelAdvanced(beforeFinalAuthority, recoveryAppendEntry);
    expectEveryAuthorityChannelAdvanced(recoveryAppendEntry, recoveryAuthorityCounts(harness));
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.evidenceStore.loadVerified(durableEvidence.snapshot.id)))
      .toEqual(durableEvidence);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(durableEvidence.snapshot.id)))
      .toEqual(durableKnowledge);
  });

  test("preserves an appended winner when the committed-event emitter rejects", async () => {
    // Break caught: publishing completed after emitter failure or rolling back a durable successor.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:committed-emitter-failure",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:committed-emitter-failure",
    });
    const emitterFailure = new Error("committed_emitter_failure");
    const events: CityFrontierEvent[] = [];
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        events.push(event);
        if (event.type === "city_revision_committed") {
          expect(harness.state.root()).toEqual(event.revision);
          expect(harness.state.root().markers.at(-1)).toEqual(event.marker);
          throw emitterFailure;
        }
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(failure).toBe(emitterFailure);
    expectPrivateFlightPrefix(events, "city_revision_committed", {
      runId: started.runId,
      baseRevisionId: started.revision.id,
      cityId: "ljubljana",
      installed: harness.fixture.installed,
    });
    const winner = harness.state.root();
    expect(winner.markers).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ revision: winner, marker: winner.markers[0] });
    const eventCount = events.length;
    await nextEventLoopTurn();
    expect(events).toHaveLength(eventCount);
    const beforeHit = researchAndPublicationCounts(harness);
    const recoveredPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:committed-emitter-failure",
    });
    expect(recoveredPrepared).toEqual(prepared);
    const hitEvents = vi.fn();
    const hit = await harness.assembly.application.continueCityFrontier(
      recoveredPrepared,
      hitEvents,
      new AbortController().signal,
    );
    expect(hit.revision).toEqual(winner);
    expect(hitEvents).not.toHaveBeenCalled();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeHit);
  });

  test("rechecks the live waiter immediately after evaluator callbacks and before Frontier append", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:evaluator-abort-before-append",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:evaluator-abort-before-append",
    });
    const controller = new AbortController();
    const reason = new Error("private_evaluator_abort_secret");
    let knowledgeEmitted = false;
    const evaluators = Object.freeze(Object.fromEntries(CITY_CRITERION_IDS.map((criterionId) => {
      const original = harness.fixture.installed.evaluatorRegistry[criterionId];
      return [criterionId, Object.freeze({
        definition: original.definition,
        canonicalizeTarget: original.canonicalizeTarget,
        evaluate(input: CityCriterionEvaluationInput): CityCriterionEvaluation {
          const result = original.evaluate(input);
          expect(knowledgeEmitted).toBe(true);
          controller.abort(reason);
          return result;
        },
      })];
    }))) as unknown as CityCriterionEvaluatorRegistry;
    harness.state.overrideEvaluatorRegistry(evaluators);
    const events: CityFrontierEvent[] = [];
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        events.push(event);
        if (event.type === "city_progress" && event.stage === "knowledge_published") {
          knowledgeEmitted = true;
        }
      },
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(reason);
    expect(knowledgeEmitted).toBe(true);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    const beforeRetry = researchAndPublicationCounts(harness);
    const recoveryEvents: CityFrontierEvent[] = [];
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { recoveryEvents.push(event); },
      new AbortController().signal,
    );
    expectPrivateRecoveryTrace(recoveryEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeRetry,
      append: beforeRetry.append + 1,
    });
  });

  test("rechecks the live waiter immediately after recovery lookup and before Knowledge publish", async () => {
    const publishFailure = new Error("seed_evidence_only_residue");
    const abortReason = new Error("private_knowledge_lookup_abort_secret");
    const controller = new AbortController();
    let abortDuringLookup = false;
    const harness = await syntheticApplicationHarness({
      failKnowledgePublishOnce: publishFailure,
      beforeKnowledgeFindReturn() {
        if (abortDuringLookup) controller.abort(abortReason);
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:knowledge-lookup-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:knowledge-lookup-abort",
    });
    expect(await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    ).catch((error: unknown) => error)).toBe(publishFailure);
    const evidenceId = `${(harness.calls.evidenceSeals[0] as CityEvidenceSealInput).cityCheckRunId}:evidence`;
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(evidenceId))).toBeUndefined();
    const beforeAbort = researchAndPublicationCounts(harness);
    abortDuringLookup = true;
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      controller.signal,
    ).catch((error: unknown) => error);
    abortDuringLookup = false;

    expect(failure).toBe(abortReason);
    await nextEventLoopTurn();
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.knowledgeStore.findByEvidenceVerified(evidenceId))).toBeUndefined();
    expect(harness.calls.appends).toEqual([]);
    expect(harness.state.root()).toEqual(started.revision);
    expect(researchAndPublicationCounts(harness)).toEqual(beforeAbort);
    const recoveryEvents: CityFrontierEvent[] = [];
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { recoveryEvents.push(event); },
      new AbortController().signal,
    );
    expectPrivateRecoveryTrace(recoveryEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeAbort,
      knowledge: beforeAbort.knowledge + 1,
      append: beforeAbort.append + 1,
    });
  });

  test("does not emit a private event after its clock aborts the waiter", async () => {
    const controller = new AbortController();
    const reason = new Error("private_event_clock_abort_secret");
    let abortAtClock = Number.POSITIVE_INFINITY;
    const harness = await syntheticApplicationHarness({
      afterClock(callCount) {
        if (callCount === abortAtClock) controller.abort(reason);
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:event-clock-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:event-clock-abort",
    });
    abortAtClock = harness.calls.clocks.length + 2;
    const events: CityFrontierEvent[] = [];
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { events.push(event); },
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(reason);
    expect(events).toEqual([]);
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
  });

  test("does not search safety after its captured clock aborts the last waiter", async () => {
    const controller = new AbortController();
    const reason = new Error("private_safety_clock_abort_secret");
    let abortOnNextClock = false;
    const harness = await syntheticApplicationHarness({
      gateFinalResearchResults: true,
      afterSafetyDocumentReturn() { abortOnNextClock = true; },
      afterClock() {
        if (!abortOnNextClock) return;
        abortOnNextClock = false;
        controller.abort(reason);
      },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:safety-clock-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:safety-clock-abort",
    });
    const continuation = harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      controller.signal,
    );
    await awaitBarrierOrEarlySettlement(harness.gates.allFinalResearchResultsEntered, [continuation]);
    for (const sourceId of [
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ] as const) {
      harness.gates.releaseFinalResearchResult(sourceId);
    }
    await nextEventLoopTurn();
    expect(new Set(harness.calls.finalResearchResultsReturned)).toEqual(new Set([
      "si-city-long-term-rent",
      "si-city-urban-transit",
      "si-city-fixed-broadband",
    ]));
    harness.gates.releaseFinalResearchResult("si-city-safety");
    const failure = await continuation.catch((error: unknown) => error);

    expect(failure).toBe(reason);
    await nextEventLoopTurn();
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(harness.calls.safetySearchInputs).toEqual([]);
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
  });

  test("attaches with native signal lifecycle before starting a lazy flight", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:native-signal-lifecycle",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:native-signal-lifecycle",
    });
    const controller = new AbortController();
    const abortReason = new Error("private_native_signal_abort_secret");
    const patchedMethodFailure = new Error("patched_signal_method_must_not_run");
    let patchedCalls = 0;
    Object.defineProperties(controller.signal, {
      addEventListener: { configurable: true, value() {
        patchedCalls += 1;
        throw patchedMethodFailure;
      } },
      removeEventListener: { configurable: true, value() {
        patchedCalls += 1;
        throw patchedMethodFailure;
      } },
    });
    const beforeAbort = researchAndPublicationCounts(harness);
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => { controller.abort(abortReason); },
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(abortReason);
    expect(patchedCalls).toBe(0);
    await nextEventLoopTurn();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeAbort);
    expect(harness.state.root()).toEqual(started.revision);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    expect(recovered.revision.predecessorRevisionId).toBe(started.revision.id);
  });

  test("never reads a stateful own aborted getter while attaching and cleaning a waiter", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:native-aborted-getter",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:native-aborted-getter",
    });
    const controller = new AbortController();
    const getterFailure = new Error("borrowed_aborted_getter_invoked_twice");
    const emitterFailure = new Error("private_native_aborted_emitter_failure");
    let getterReads = 0;
    Object.defineProperty(controller.signal, "aborted", {
      configurable: true,
      get() {
        getterReads += 1;
        if (getterReads === 1) return false;
        throw getterFailure;
      },
    });
    const beforeFailure = researchAndPublicationCounts(harness);
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => { throw emitterFailure; },
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(emitterFailure);
    expect(getterReads).toBe(0);
    await nextEventLoopTurn();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeFailure);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    expect(recovered.revision.predecessorRevisionId).toBe(started.revision.id);
  });

  test("never reads an own reason getter and returns the exact native abort reason", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:native-reason-getter",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:native-reason-getter",
    });
    const controller = new AbortController();
    const nativeReason = new Error("private_native_abort_reason");
    let reasonReads = 0;
    Object.defineProperty(controller.signal, "reason", {
      configurable: true,
      get() {
        reasonReads += 1;
        throw new Error("borrowed_reason_getter_invoked");
      },
    });
    const beforeAbort = researchAndPublicationCounts(harness);
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => { controller.abort(nativeReason); },
      controller.signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(nativeReason);
    expect(reasonReads).toBe(0);
    await nextEventLoopTurn();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeAbort);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    expect(recovered.revision.predecessorRevisionId).toBe(started.revision.id);
  });

  test("rejects a borrowed Proxy follower without cancelling its active survivor", async () => {
    const harness = await syntheticApplicationHarness({ gateResearch: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:proxy-follower-survivor",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:proxy-follower-survivor",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    genericSealHarness.beforeReturn = undefined;
    const survivor = harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    let proxyTraps = 0;
    const target = new AbortController().signal;
    const followerSignal = new Proxy(target, {
      get(inner, key) {
        proxyTraps += 1;
        if (key === "aborted") return false;
        if (key === "reason") return undefined;
        return Reflect.get(inner, key, inner);
      },
      getPrototypeOf(inner) {
        proxyTraps += 1;
        return Reflect.getPrototypeOf(inner);
      },
    });
    const followerEvents = vi.fn();
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.researchEntered, [survivor]);
      const follower = harness.assembly.application.continueCityFrontier(
        prepared,
        followerEvents,
        followerSignal,
      );
      harness.gates.releaseResearch();
      const [survivorResult, followerOutcome] = await Promise.all([
        survivor,
        follower.catch((error: unknown) => error),
      ]);
      expect(survivorResult.revision.predecessorRevisionId).toBe(started.revision.id);
      const followerFailure = requireError(followerOutcome);
      expect(followerFailure.message).toBe("integrity_mismatch");
      expect(proxyTraps).toBe(0);
      expect(followerEvents).not.toHaveBeenCalled();
    } finally {
      harness.gates.releaseResearch();
      await Promise.allSettled([survivor]);
    }
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    expect(harness.calls.safetySearchInputs).toHaveLength(3);
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(1);
  });

  test("does not start a lazy flight when the first private emitter fails synchronously", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:first-emitter-failure",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:first-emitter-failure",
    });
    const emitterFailure = new Error("private_first_emitter_failure_secret");
    const beforeFailure = researchAndPublicationCounts(harness);
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => { throw emitterFailure; },
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(emitterFailure);
    await nextEventLoopTurn();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeFailure);
    expect(harness.state.root()).toEqual(started.revision);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    expect(recovered.revision.predecessorRevisionId).toBe(started.revision.id);
  });

  test("does not start lazy recovery replay when its first private emitter fails", async () => {
    const seedFailure = new Error("seed_lazy_recovery_replay");
    const harness = await syntheticApplicationHarness({ failKnowledgePublishOnce: seedFailure });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:lazy-recovery-emitter",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:lazy-recovery-emitter",
    });
    expect(await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    ).catch((error: unknown) => error)).toBe(seedFailure);
    const replayPackageReadsBefore = harness.calls.forbiddenPrepareCallbacks.filter((value) =>
      value === "evidence-replay-package").length;
    const publicationBefore = researchAndPublicationCounts(harness);
    const emitterFailure = new Error("private_lazy_recovery_emitter_failure");
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      () => { throw emitterFailure; },
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(emitterFailure);
    await nextEventLoopTurn();
    expect(harness.calls.forbiddenPrepareCallbacks.filter((value) =>
      value === "evidence-replay-package")).toHaveLength(replayPackageReadsBefore);
    expect(researchAndPublicationCounts(harness)).toEqual(publicationBefore);
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    );
    expect(recovered.revision.predecessorRevisionId).toBe(started.revision.id);
  });

  test("keeps a caller abort secret out of the shared source signal", async () => {
    const harness = await syntheticApplicationHarness({ gateResearch: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:opaque-caller-abort",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:opaque-caller-abort",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    const controller = new AbortController();
    const secret = new Error("private_caller_abort_do_not_share");
    const continuation = harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      controller.signal,
    );
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.allResearchSignalsEntered, [continuation]);
      controller.abort(secret);
      expect(await continuation.catch((error: unknown) => error)).toBe(secret);
      expectOpaqueSharedAbort(capturedResearchSignals(harness), secret);
    } finally {
      harness.gates.releaseResearch();
      controller.abort();
      await Promise.allSettled([continuation]);
    }
  });

  test("keeps a private emitter failure out of the shared source signal", async () => {
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:opaque-emitter-failure",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:opaque-emitter-failure",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    const secret = new Error("private_emitter_failure_do_not_share");
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => {
        if (event.type === "city_progress" &&
          event.stage.startsWith("source_completed:")) throw secret;
      },
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(secret);
    await nextEventLoopTurn();
    expectOpaqueSharedAbort(capturedResearchSignals(harness), secret);
  });

  test("keeps a native source failure out of the shared source signal", async () => {
    const secret = new Error("private_source_failure_do_not_share");
    const harness = await syntheticApplicationHarness({
      fixedBroadbandFault: { kind: "native", error: secret },
    });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:opaque-source-failure",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:opaque-source-failure",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    const failure = await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(failure).toBe(secret);
    await nextEventLoopTurn();
    expectOpaqueSharedAbort(capturedResearchSignals(harness), secret);
  });

  test("retains only replayed owned Evidence from a mutable accessor recovery probe", async () => {
    const seedFailure = new Error("seed_owned_recovery_probe");
    const harness = await syntheticApplicationHarness({ failKnowledgePublishOnce: seedFailure });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:owned-recovery-probe",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:owned-recovery-probe",
    });
    expect(await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    ).catch((error: unknown) => error)).toBe(seedFailure);
    let accessorReads = 0;
    const mutableProbe: Record<string, unknown> = {};
    Object.defineProperty(mutableProbe, "snapshot", {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("borrowed_recovery_accessor_invoked");
      },
    });
    harness.state.overrideCompletedEvidenceProbe(mutableProbe);
    const beforeRecovery = researchAndPublicationCounts(harness);
    const recoveryEvents: CityFrontierEvent[] = [];
    const recovered = await harness.assembly.application.continueCityFrontier(
      prepared,
      (event: CityFrontierEvent) => { recoveryEvents.push(event); },
      new AbortController().signal,
    );

    expect(accessorReads).toBe(0);
    expectPrivateRecoveryTrace(recoveryEvents, recovered, started.revision.id);
    expect(researchAndPublicationCounts(harness)).toEqual({
      ...beforeRecovery,
      knowledge: beforeRecovery.knowledge + 1,
      append: beforeRecovery.append + 1,
    });
  });

  test("rejects a proxy recovery probe without invoking it or starting effects", async () => {
    const seedFailure = new Error("seed_proxy_recovery_probe");
    const harness = await syntheticApplicationHarness({ failKnowledgePublishOnce: seedFailure });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:proxy-recovery-probe",
    });
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:proxy-recovery-probe",
    });
    expect(await harness.assembly.application.continueCityFrontier(
      prepared,
      vi.fn(),
      new AbortController().signal,
    ).catch((error: unknown) => error)).toBe(seedFailure);
    let proxyTraps = 0;
    const proxy = new Proxy({}, {
      get() { proxyTraps += 1; throw new Error("borrowed_recovery_proxy_invoked"); },
      getOwnPropertyDescriptor() {
        proxyTraps += 1;
        throw new Error("borrowed_recovery_proxy_invoked");
      },
      ownKeys() { proxyTraps += 1; throw new Error("borrowed_recovery_proxy_invoked"); },
    });
    harness.state.overrideCompletedEvidenceProbe(proxy);
    const beforeRejection = researchAndPublicationCounts(harness);
    const events = vi.fn();
    const failure = requireError(await harness.assembly.application.continueCityFrontier(
      prepared,
      events,
      new AbortController().signal,
    ).catch((error: unknown) => error));

    expect(failure.message).toBe("integrity_mismatch");
    expect(proxyTraps).toBe(0);
    expect(events).not.toHaveBeenCalled();
    expect(researchAndPublicationCounts(harness)).toEqual(beforeRejection);
    expect(harness.state.root()).toEqual(started.revision);
  });

  test("shares research for different commands but lets one same-base append winner advance the head", async () => {
    // Break caught: duplicating research or allowing two command misses to append from one predecessor.
    const harness = await syntheticApplicationHarness({ gateResearch: true });
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:different-command-race",
    });
    const preparedA = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:different-command-a",
    });
    const preparedB = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId: "continue:different-command-b",
    });
    fixedRunnerHarness.inputs.splice(0);
    fixedRunnerHarness.promises.splice(0);
    safetyRunnerHarness.promises.splice(0);
    genericSealHarness.calls = 0;
    genericSealHarness.promises.splice(0);
    const eventsA: CityFrontierEvent[] = [];
    const eventsB: CityFrontierEvent[] = [];
    const followerActivated = deferred<void>();
    const followerAtKnowledge = deferred<void>();
    const winnerCommitted = deferred<void>();
    const releaseFollower = deferred<void>();
    const first = harness.assembly.application.continueCityFrontier(
      preparedA,
      (event: CityFrontierEvent) => {
        recursivelyFrozen(event);
        eventsA.push(event);
        if (event.type === "city_revision_committed") winnerCommitted.resolve(undefined);
      },
      new AbortController().signal,
    ) as Promise<CityFrontierReadModel>;
    let second: Promise<CityFrontierReadModel> | undefined;
    let outcomes: PromiseSettledResult<CityFrontierReadModel>[] = [];
    try {
      await awaitBarrierOrEarlySettlement(harness.gates.researchEntered, [first]);
      const follower = harness.assembly.application.continueCityFrontier(
        preparedB,
        async (event: CityFrontierEvent) => {
          recursivelyFrozen(event);
          eventsB.push(event);
          if (event.type === "city_activated") followerActivated.resolve(undefined);
          if (event.type === "city_progress" && event.stage === "knowledge_published") {
            followerAtKnowledge.resolve(undefined);
            await releaseFollower.promise;
          }
        },
        new AbortController().signal,
      ) as Promise<CityFrontierReadModel>;
      second = follower;
      await awaitBarrierOrEarlySettlement(followerActivated.promise, [first, follower]);
      harness.gates.releaseResearch();
      await awaitBarrierOrEarlySettlement(
        Promise.all([followerAtKnowledge.promise, winnerCommitted.promise]),
        [first, follower],
      );
      expect(harness.state.root().operation.commandId).toBe("continue:different-command-a");
      releaseFollower.resolve(undefined);
      outcomes = await Promise.allSettled([first, follower]);
    } finally {
      harness.gates.releaseResearch();
      releaseFollower.resolve(undefined);
      await Promise.allSettled(second === undefined ? [first] : [first, second]);
    }
    const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<CityFrontierReadModel> =>
      outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(Error);
    expect((rejected[0]!.reason as Error).message).toBe("stale_city_frontier_head");
    const winnerIndex = outcomes.findIndex(({ status }) => status === "fulfilled");
    expect(winnerIndex).toBe(0);
    const winnerEvents = winnerIndex === 0 ? eventsA : eventsB;
    const loserEvents = winnerIndex === 0 ? eventsB : eventsA;
    const winner = fulfilled[0]!.value;
    expectPrivateSuccessfulTrace(
      winnerEvents,
      winner,
      started.revision.id,
      harness.fixture.installed,
    );
    expect(loserEvents.map(({ type }) => type)).toEqual([
      "city_activated",
      ...Array.from({ length: 10 }, () => "city_progress" as const),
    ]);
    expect(loserEvents.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    const loserProgress = loserEvents.filter((event) => event.type === "city_progress");
    expect(loserProgress.map(({ stage }) => stage)).toEqual([
        "source_started:si-city-safety",
        "source_started:si-city-long-term-rent",
        "source_started:si-city-urban-transit",
        "source_started:si-city-fixed-broadband",
        "source_completed:si-city-safety",
        "source_completed:si-city-long-term-rent",
        "source_completed:si-city-urban-transit",
        "source_completed:si-city-fixed-broadband",
        "evidence_verified",
        "knowledge_published",
      ]);
    expect(loserProgress.map((event) => "sourceUrl" in event ? event.sourceUrl : undefined))
      .toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        harness.fixture.installed.safetySourcePlan.entries[0]!.configuredRoutes[0]!.navigationUrl,
        harness.fixture.installed.fixedPlansByCityId.ljubljana![0]!.routes[1]!.navigationUrl,
        harness.fixture.installed.fixedPlansByCityId.ljubljana![1]!.routes[1]!.navigationUrl,
        harness.fixture.installed.fixedPlansByCityId.ljubljana![2]!.routes[0]!.navigationUrl,
        undefined,
        undefined,
      ]);
    const loserLength = loserEvents.length;
    await nextEventLoopTurn();
    expect(loserEvents).toHaveLength(loserLength);
    expect(harness.calls.fixedRouteInputs).toHaveLength(5);
    expect(harness.calls.safetySearchInputs).toHaveLength(3);
    expect(harness.calls.safetyDocumentInputs).toHaveLength(1);
    expect(genericSealHarness.calls).toBe(1);
    expect(harness.calls.evidenceSeals).toHaveLength(1);
    expect(harness.calls.knowledgePublishes).toHaveLength(1);
    expect(harness.calls.appends).toHaveLength(2);
    expect(new Set(harness.calls.appends.map(({ operation }) => operation.commandId))).toEqual(
      new Set(["continue:different-command-a", "continue:different-command-b"]),
    );
    expect(harness.calls.appends.every(({ predecessorRevisionId }) =>
      predecessorRevisionId === started.revision.id)).toBe(true);
    expect(harness.calls.appends[0]!.createdAt).toBe(harness.calls.appends[1]!.createdAt);
    expect(DECISION_INTEGRITY.canonical(harness.calls.appends[0]!.markers))
      .toBe(DECISION_INTEGRITY.canonical(harness.calls.appends[1]!.markers));
    expect(harness.state.root()).toEqual(winner.revision);
  });

  test("applies the same current-Catalog gate to Continue command misses and committed hits", async () => {
    // Break caught: a command hit returns a structurally valid @1 winner before the common package gate.
    const harness = await syntheticApplicationHarness();
    await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:legacy-gate-fixture",
    });
    const legacy = await harness.state.bindLegacyStart();
    expect(legacy.ranking.runId).toBe(legacy.root.runId);
    const loadedManifestA = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        legacy.installed.installedPackageManifest.key,
      ))!;
    const loadedManifestAgain = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        legacy.installed.installedPackageManifest.key,
      ))!;
    const loadedPackageA = withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findExact(
        legacy.installed.installedPackageManifest.key,
      ))!;
    const loadedPackageAgain = withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findExact(
        legacy.installed.installedPackageManifest.key,
      ))!;
    expect(loadedManifestA).toEqual(legacy.manifest);
    expect(loadedManifestA).not.toBe(loadedManifestAgain);
    const packageData = (value: InstalledCityResearchPackage) => ({
      ...value,
      evaluatorRegistry: undefined,
      validateValue: undefined,
      validateSourcePeriod: undefined,
    });
    expect(packageData(loadedPackageA)).toEqual(packageData(legacy.installed));
    expect(packageData(loadedPackageAgain)).toEqual(packageData(legacy.installed));
    expect(loadedPackageA).not.toBe(loadedPackageAgain);
    recursivelyFrozen(loadedManifestA);
    recursivelyFrozen(loadedManifestAgain);
    recursivelyFrozen(loadedPackageA);
    recursivelyFrozen(loadedPackageAgain);
    expect(loadedPackageA.evaluatorRegistry).not.toBe(loadedPackageAgain.evaluatorRegistry);
    expect(loadedPackageA.evaluatorRegistry).not.toBe(legacy.installed.evaluatorRegistry);
    expect(loadedPackageA.validateValue).not.toBe(loadedPackageAgain.validateValue);
    expect(loadedPackageA.validateSourcePeriod).not.toBe(loadedPackageAgain.validateSourcePeriod);
    for (const criterionId of CITY_CRITERION_IDS) {
      const firstEvaluator = loadedPackageA.evaluatorRegistry[criterionId];
      const secondEvaluator = loadedPackageAgain.evaluatorRegistry[criterionId];
      const fixtureEvaluator = legacy.installed.evaluatorRegistry[criterionId];
      const criterion = harness.state.artifacts().criteria.criteria.find((candidate) =>
        candidate.criterionId === criterionId)!;
      const representativeInput = {
        criterion,
        fact: {
          criterionId,
          definitionId: firstEvaluator.definition.definitionId,
          geoScope: "municipality" as const,
          referencePeriod: null,
          freshnessBasis: firstEvaluator.definition.freshnessPolicyVersion,
          unit: firstEvaluator.definition.unit,
          denominator: firstEvaluator.definition.denominator,
          outcome: { kind: "unknown" as const, reason: "source_unavailable" as const },
        },
        assessmentAt: legacy.ranking.assessmentAt,
      };
      expect(firstEvaluator.definition).toEqual(fixtureEvaluator.definition);
      expect(secondEvaluator.definition).toEqual(fixtureEvaluator.definition);
      expect(firstEvaluator.canonicalizeTarget(criterion.target))
        .toBe(fixtureEvaluator.canonicalizeTarget(criterion.target));
      expect(firstEvaluator.evaluate(structuredClone(representativeInput)))
        .toEqual(fixtureEvaluator.evaluate(structuredClone(representativeInput)));
      expect(secondEvaluator.evaluate(structuredClone(representativeInput)))
        .toEqual(fixtureEvaluator.evaluate(structuredClone(representativeInput)));
      expect(firstEvaluator.canonicalizeTarget).toBe(secondEvaluator.canonicalizeTarget);
      expect(firstEvaluator.evaluate).toBe(secondEvaluator.evaluate);
    }
    expectManifestAuthority(
      loadedManifestA,
      legacy.installed.installedPackageManifest.key,
      legacy.installed.installedPackageManifest.id,
    );
    const persistedManifestHmac = harness.fixture.database.prepare(
      "SELECT hmac FROM installed_city_package_manifests WHERE id = ?",
    ).pluck().get(loadedManifestA.id);
    expect(persistedManifestHmac).toBe(
      EVIDENCE_INTEGRITY.sign(EVIDENCE_INTEGRITY.canonical(manifestPayload(loadedManifestA))),
    );
    expect(legacy.current.catalog.rulesVersion).toBe("city-catalog@2");
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findReady("SI"))?.catalog.id)
      .toBe(legacy.current.catalog.id);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.latestInstalledVerified("SI"))?.catalog.id)
      .toBe(legacy.current.catalog.id);
    const currentManifestB = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        legacy.current.installedPackageManifest.key,
      ))!;
    expect(currentManifestB.predecessorManifestId).toBe(legacy.manifest.id);
    expect(harness.fixture.database.prepare(
      "SELECT COUNT(*) FROM installed_city_package_manifests",
    ).pluck().get()).toBe(2);
    const legacyArtifacts = harness.state.artifacts();
    const policyBeforePresent = {
      canonicalTargets: harness.fixture.policyCalls.canonicalTargets.length,
    };
    const semanticBeforePresent = planGateHarness.semanticEntries.length;
    const catalogBeforePresent = harness.calls.catalogReads.length;
    const reloadBeforePresent = harness.calls.reloads.length;
    const authorityBeforePresent = harness.calls.authorityOrder.length;
    const rankingBeforePresent = harness.calls.rankingResults.length;
    const exactKeysBeforePresent = harness.calls.exactPackageKeys.length;
    const manifestKeysBeforePresent = harness.calls.manifestKeys.length;
    const manifestResultsBeforePresent = harness.calls.manifestResults.length;
    const canonicalsBeforePresent = harness.calls.evidenceCanonicals.length;
    const hashesBeforePresent = harness.calls.evidenceHashes.length;
    const signsBeforePresent = harness.calls.evidenceSigns.length;
    const forbiddenBeforePresent = {
      findReady: harness.calls.readyPackageCountries.length,
      latestCatalogs: harness.calls.catalogReads.filter((value) =>
        value.startsWith("catalog.latest:")).length,
      source: harness.calls.source.length,
      fixedInputs: harness.calls.fixedRouteInputs.length,
      fixedOutputs: harness.calls.fixedRouteOutputs.length,
      safetySearchInputs: harness.calls.safetySearchInputs.length,
      safetySearchOutputs: harness.calls.safetySearchOutputs.length,
      safetyDocumentInputs: harness.calls.safetyDocumentInputs.length,
      safetyDocumentOutputs: harness.calls.safetyDocumentOutputs.length,
      clocks: harness.calls.clocks.length,
      deadlinePolicy: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      flightIdentities: harness.calls.flightIdentityCanonicals.length,
      genericSeals: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
      publications: harness.calls.publications.length,
    };
    const presentedLegacy = await harness.assembly.application.presentCityFrontier(
      legacy.root.runId,
    );
    expect(presentedLegacy.revision).toEqual(legacy.root);
    expect(presentedLegacy.catalog.rulesVersion).toBe("city-catalog@1");
    expect(presentedLegacy.ranking).toEqual(legacy.ranking);
    expect(presentedLegacy.ranking).not.toBe(legacy.ranking);
    expect(presentedLegacy.revision).not.toBe(legacy.root);
    recursivelyFrozen(presentedLegacy);
    recursivelyNotAliased(presentedLegacy.ranking, legacy.ranking);
    recursivelyNotAliased(presentedLegacy.revision, legacy.root);
    expect(harness.fixture.policyCalls.canonicalTargets.length)
      .toBeGreaterThan(policyBeforePresent.canonicalTargets);
    expect(planGateHarness.semanticEntries).toHaveLength(semanticBeforePresent + 1);
    expect(harness.calls.catalogReads.slice(catalogBeforePresent)).toEqual([
      `catalog.historical:${legacy.installed.catalog.id}`,
    ]);
    expect(harness.calls.reloads.slice(reloadBeforePresent)).toEqual([
      `frontier.chain:${legacy.root.runId}`,
      `ranking:${legacy.ranking.id}`,
      `criteria:${legacyArtifacts.criteria.id}`,
      `branch:${legacyArtifacts.branch.id}`,
    ]);
    expect(harness.calls.authorityOrder.slice(authorityBeforePresent)).toEqual([
      `frontier.chain:${legacy.root.runId}`,
      `ranking:${legacy.ranking.id}`,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${legacy.installed.catalog.id}`,
      `criteria:${legacyArtifacts.criteria.id}`,
      `branch:${legacyArtifacts.branch.id}`,
    ]);
    expect(harness.calls.rankingResults.slice(rankingBeforePresent)).toHaveLength(1);
    expect(harness.calls.exactPackageKeys.slice(exactKeysBeforePresent)).toHaveLength(1);
    expect(harness.calls.manifestKeys.slice(manifestKeysBeforePresent)).toHaveLength(1);
    expect(harness.calls.manifestResults.slice(manifestResultsBeforePresent)).toHaveLength(1);
    const presentedRanking = harness.calls.rankingResults[rankingBeforePresent]!;
    const presentedExactKey = harness.calls.exactPackageKeys[exactKeysBeforePresent]!;
    const presentedManifestKey = harness.calls.manifestKeys[manifestKeysBeforePresent]!;
    expect(presentedExactKey).toBe(presentedRanking.installedPackageContext);
    expect(presentedManifestKey).toBe(presentedRanking.installedPackageContext);
    expect(Reflect.ownKeys(presentedExactKey).sort()).toEqual([
      "countryCode",
      "packageId",
      "packageSchemaVersion",
      "catalogRevisionId",
      "evidenceRulesVersion",
    ].sort());
    recursivelyFrozen(presentedExactKey);
    expect(presentedExactKey).toEqual(legacy.installed.installedPackageManifest.key);
    expectManifestAuthority(
      harness.calls.manifestResults[manifestResultsBeforePresent] as InstalledCityPackageManifest,
      presentedManifestKey,
      legacy.manifest.id,
    );
    const presentCanonicals = harness.calls.evidenceCanonicals.slice(canonicalsBeforePresent);
    const presentHashes = harness.calls.evidenceHashes.slice(hashesBeforePresent);
    expect(presentCanonicals).toHaveLength(legacy.installed.catalog.members.length * 3 + 5);
    expect(presentCanonicals.map(({ value }) => value)).toEqual([
      manifestPayload(legacy.manifest),
      ...administrativeArtifactValues(legacy.installed),
    ]);
    expect(presentHashes).toHaveLength(presentCanonicals.length);
    expect(presentHashes.map(({ value }) => value))
      .toEqual(presentCanonicals.map(({ result }) => result));
    expect(presentHashes.map(({ result }) => result)).toEqual([
      legacy.manifest.payloadHash,
      ...administrativeArtifactValues(legacy.installed).map((value) =>
        EVIDENCE_INTEGRITY.hash(EVIDENCE_INTEGRITY.canonical(value))),
    ]);
    expect(harness.calls.evidenceSigns.slice(signsBeforePresent)).toEqual([]);
    expect({
      findReady: harness.calls.readyPackageCountries.length,
      latestCatalogs: harness.calls.catalogReads.filter((value) =>
        value.startsWith("catalog.latest:")).length,
      source: harness.calls.source.length,
      fixedInputs: harness.calls.fixedRouteInputs.length,
      fixedOutputs: harness.calls.fixedRouteOutputs.length,
      safetySearchInputs: harness.calls.safetySearchInputs.length,
      safetySearchOutputs: harness.calls.safetySearchOutputs.length,
      safetyDocumentInputs: harness.calls.safetyDocumentInputs.length,
      safetyDocumentOutputs: harness.calls.safetyDocumentOutputs.length,
      clocks: harness.calls.clocks.length,
      deadlinePolicy: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      flightIdentities: harness.calls.flightIdentityCanonicals.length,
      genericSeals: genericSealHarness.calls,
      evidenceSeals: harness.calls.evidenceSeals.length,
      knowledgePublishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
      publications: harness.calls.publications.length,
    }).toEqual(forbiddenBeforePresent);
    harness.calls.reloads.splice(0);
    harness.calls.authorityOrder.splice(0);
    harness.calls.rankingReads.splice(0);
    harness.calls.rankingResults.splice(0);
    harness.calls.catalogReads.splice(0);
    harness.calls.exactPackageKeys.splice(0);
    harness.calls.installedPackageResults.splice(0);
    harness.calls.manifestKeys.splice(0);
    harness.calls.manifestResults.splice(0);
    harness.calls.evidenceCanonicals.splice(0);
    harness.calls.evidenceHashes.splice(0);
    harness.calls.evidenceSigns.splice(0);
    harness.calls.flightIdentityCanonicals.splice(0);
    const beforeMissPrepareEffects = nonStructuralEffects(harness);
    const missPrepareReloadOffset = harness.calls.reloads.length;
    const missPrepareOrderOffset = harness.calls.authorityOrder.length;
    const missPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: legacy.root.runId,
      expectedRevisionId: legacy.root.id,
      commandId: "continue:legacy-miss",
    });
    expect(nonStructuralEffects(harness)).toEqual(beforeMissPrepareEffects);
    expect(harness.calls.reloads.slice(missPrepareReloadOffset)).toEqual([
      `frontier.command:${legacy.root.runId}:continue:legacy-miss`,
      `frontier.head:${legacy.root.runId}`,
    ]);
    expect(harness.calls.authorityOrder.slice(missPrepareOrderOffset)).toEqual([
      `frontier.command:${legacy.root.runId}:continue:legacy-miss`,
      `frontier.head:${legacy.root.runId}`,
    ]);
    const gateEffects = () => ({
      evaluations: harness.fixture.policyCalls.evaluations.length,
      values: harness.fixture.policyCalls.values.length,
      sourcePeriods: harness.fixture.policyCalls.sourcePeriods.length,
      criteriaReads: harness.calls.reloads.filter((value) => value.startsWith("criteria:")).length,
      branchReads: harness.calls.reloads.filter((value) => value.startsWith("branch:")).length,
      evidenceCallbacks: harness.calls.authorityOrder.filter((value) =>
        value.startsWith("evidence.")).length,
      knowledgeCallbacks: harness.calls.authorityOrder.filter((value) =>
        value.startsWith("knowledge.")).length,
      selectionCallbacks: harness.calls.selectionHistory.length,
      fixed: harness.calls.fixedRouteInputs.length,
      safety: harness.calls.source.length,
      clocks: harness.calls.clocks.length,
      deadlines: harness.calls.deadlinePolicyDates.length,
      scheduled: harness.calls.scheduledDeadlines.length,
      seals: harness.calls.evidenceSeals.length,
      publishes: harness.calls.knowledgePublishes.length,
      appends: harness.calls.appends.length,
      forbiddenCallbacks: harness.calls.forbiddenPrepareCallbacks.length,
      findReady: harness.calls.readyPackageCountries.length,
      latestCatalogs: harness.calls.catalogReads.filter((value) =>
        value.startsWith("catalog.latest:")).length,
      flightIdentities: harness.calls.flightIdentityCanonicals.length,
      genericSeals: genericSealHarness.calls,
      fixedPlanReconstructs: planGateHarness.fixed.length,
      directoryReconstructs: planGateHarness.directories.length,
      safetyPlanReconstructs: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    });
    const beforeMissGate = gateEffects();
    const emitted = vi.fn();
    const missErrors: Error[] = [];
    const missContinueReloads = [
      `frontier.command:${legacy.root.runId}:continue:legacy-miss`,
      `frontier.head:${legacy.root.runId}`,
      `ranking:${legacy.ranking.id}`,
    ];
    const missContinueOrder = [
      ...missContinueReloads,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${legacy.installed.catalog.id}`,
    ];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const keyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        missPrepared,
        emitted,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      missErrors.push(error);
      expect(error.message).toBe("city_catalog_upgrade_required");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(missContinueReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(missContinueOrder);
      expect(harness.calls.exactPackageKeys[keyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expect(harness.calls.manifestKeys[manifestKeyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expectManifestAuthority(
        harness.calls.manifestResults[manifestResultOffset] as InstalledCityPackageManifest,
        harness.calls.manifestKeys[manifestKeyOffset]!,
        legacy.manifest.id,
      );
      const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
      const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
      expect(canonicalCalls.map(({ value }) => value)).toEqual([manifestPayload(legacy.manifest)]);
      expect(hashCalls).toHaveLength(1);
      expect(hashCalls[0]!.value).toBe(canonicalCalls[0]!.result);
      expect(hashCalls[0]!.result).toBe(legacy.manifest.payloadHash);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(missErrors[0]).not.toBe(missErrors[1]);
    expect(gateEffects()).toEqual(beforeMissGate);

    const marker = syntheticMarker();
    const committed = sealCityFrontierRevision({
      runId: legacy.root.runId,
      predecessorRevisionId: legacy.root.id,
      rankingSnapshotId: legacy.ranking.id,
      markers: [marker],
      projection: {
        kind: "working",
        nextUncheckedRank: 2,
        selectableCityIds: [marker.cityId],
        phase: "verification_required",
      },
      operation: {
        kind: "city_completed",
        commandId: "continue:legacy-hit",
        expectedHeadRevisionId: legacy.root.id,
        cityId: marker.cityId,
        cityCheckRunId: `city-check:${"a".repeat(64)}`,
      },
      createdAt: START_AT,
    }, DECISION_INTEGRITY);
    harness.state.replaceChain([legacy.root, committed]);
    const beforeHitPrepareEffects = nonStructuralEffects(harness);
    const hitPrepareReloadOffset = harness.calls.reloads.length;
    const hitPrepareOrderOffset = harness.calls.authorityOrder.length;
    const hitPrepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: legacy.root.runId,
      expectedRevisionId: legacy.root.id,
      commandId: "continue:legacy-hit",
    });
    expect(nonStructuralEffects(harness)).toEqual(beforeHitPrepareEffects);
    expect(harness.calls.reloads.slice(hitPrepareReloadOffset)).toEqual([
      `frontier.command:${legacy.root.runId}:continue:legacy-hit`,
      `frontier.revision:${legacy.root.id}`,
    ]);
    expect(harness.calls.authorityOrder.slice(hitPrepareOrderOffset)).toEqual([
      `frontier.command:${legacy.root.runId}:continue:legacy-hit`,
      `frontier.revision:${legacy.root.id}`,
    ]);
    const beforeHitGate = gateEffects();
    const hitErrors: Error[] = [];
    const hitContinueReloads = [
      `frontier.command:${legacy.root.runId}:continue:legacy-hit`,
      `frontier.revision:${legacy.root.id}`,
      `ranking:${legacy.ranking.id}`,
    ];
    const hitContinueOrder = [
      ...hitContinueReloads,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${legacy.installed.catalog.id}`,
    ];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const keyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        hitPrepared,
        emitted,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      hitErrors.push(error);
      expect(error.message).toBe("city_catalog_upgrade_required");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(hitContinueReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(hitContinueOrder);
      expect(harness.calls.exactPackageKeys[keyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expect(harness.calls.manifestKeys[manifestKeyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expectManifestAuthority(
        harness.calls.manifestResults[manifestResultOffset] as InstalledCityPackageManifest,
        harness.calls.manifestKeys[manifestKeyOffset]!,
        legacy.manifest.id,
      );
      const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
      const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
      expect(canonicalCalls.map(({ value }) => value)).toEqual([manifestPayload(legacy.manifest)]);
      expect(hashCalls).toHaveLength(1);
      expect(hashCalls[0]!.value).toBe(canonicalCalls[0]!.result);
      expect(hashCalls[0]!.result).toBe(legacy.manifest.payloadHash);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(hitErrors[0]).not.toBe(hitErrors[1]);
    expect(gateEffects()).toEqual(beforeHitGate);
    expect(emitted).not.toHaveBeenCalled();
    expect(harness.calls.fixedRouteInputs).toEqual([]);
    expect(harness.calls.source).toEqual([]);
    expect(harness.calls.evidenceSeals).toEqual([]);
    expect(harness.calls.knowledgePublishes).toEqual([]);
    expect(harness.calls.appends).toEqual([]);
  });

  test("rejects public @1 Present when its exact independently anchored manifest is absent", async () => {
    // Break caught: allowing historical presentation to bypass the independent manifest anchor.
    const harness = await syntheticApplicationHarness();
    await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:legacy-present-missing-manifest",
    });
    const legacy = await harness.state.bindLegacyStart();
    harness.state.overrideManifestResult("missing");
    resetContinuationPreflightObservations(harness);
    const beforeDownstream = manifestBoundaryDownstreamEffects(harness);
    const beforePlanGate = {
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    };
    const expectedReloads = [
      `frontier.chain:${legacy.root.runId}`,
      `ranking:${legacy.ranking.id}`,
    ];
    const expectedOrder = [...expectedReloads, "package.exact", "manifest.exact"];
    const errors: Error[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const packageKeyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.presentCityFrontier(
        legacy.root.runId,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      errors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
      const rankingKey = harness.calls.rankingResults[rankingOffset]!.installedPackageContext;
      expect(harness.calls.exactPackageKeys[packageKeyOffset]).toBe(rankingKey);
      expect(harness.calls.manifestKeys[manifestKeyOffset]).toBe(rankingKey);
      expect(harness.calls.evidenceCanonicals.slice(canonicalOffset)).toEqual([]);
      expect(harness.calls.evidenceHashes.slice(hashOffset)).toEqual([]);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(errors[0]).not.toBe(errors[1]);
    expect(harness.calls.manifestResults).toEqual([]);
    expect(harness.calls.catalogReads).toEqual([]);
    expect(manifestBoundaryDownstreamEffects(harness)).toEqual(beforeDownstream);
    expect({
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    }).toEqual(beforePlanGate);
    expect(harness.calls.readyPackageCountries).toEqual([]);
  });

  test("rejects an exact @1 package paired with a different authentic manifest before upgrade", async () => {
    // Break caught: checking @1 before matching the independently loaded manifest to the package.
    const harness = await syntheticApplicationHarness();
    await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:legacy-manifest-mismatch",
    });
    const legacy = await harness.state.bindLegacyStart();
    const currentManifest = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        legacy.current.installedPackageManifest.key,
      ))!;
    expectManifestAuthority(
      currentManifest,
      legacy.current.installedPackageManifest.key,
      legacy.current.installedPackageManifest.id,
    );
    harness.state.overrideManifestResult("alternate", currentManifest);
    const beforePrepare = nonStructuralEffects(harness);
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: legacy.root.runId,
      expectedRevisionId: legacy.root.id,
      commandId: "continue:legacy-manifest-mismatch",
    });
    expect(nonStructuralEffects(harness)).toEqual(beforePrepare);
    resetContinuationPreflightObservations(harness);
    const beforeDownstream = manifestBoundaryDownstreamEffects(harness);
    const beforePlanGate = {
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    };
    const errors: Error[] = [];
    const expectedReloads = [
      `frontier.command:${legacy.root.runId}:continue:legacy-manifest-mismatch`,
      `frontier.head:${legacy.root.runId}`,
      `ranking:${legacy.ranking.id}`,
    ];
    const expectedOrder = [...expectedReloads, "package.exact", "manifest.exact"];
    const emitted = vi.fn();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const packageKeyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        prepared,
        emitted,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      errors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(error.message).not.toBe("city_catalog_upgrade_required");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
      const rankingKey = harness.calls.rankingResults[rankingOffset]!.installedPackageContext;
      expect(harness.calls.exactPackageKeys[packageKeyOffset]).toBe(rankingKey);
      expect(harness.calls.manifestKeys[manifestKeyOffset]).toBe(rankingKey);
      expect(harness.calls.manifestResults.at(-1)).toEqual(currentManifest);
      expect(harness.calls.evidenceCanonicals.slice(canonicalOffset)).toEqual([]);
      expect(harness.calls.evidenceHashes.slice(hashOffset)).toEqual([]);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(errors[0]).not.toBe(errors[1]);
    expect(manifestBoundaryDownstreamEffects(harness)).toEqual(beforeDownstream);
    expect({
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    }).toEqual(beforePlanGate);
    expect(harness.calls.catalogReads).toEqual([]);
    expect(emitted).not.toHaveBeenCalled();
  });

  test("rejects a Ranking lookup key whose package schema drifts from the signed package", async () => {
    // Break caught: trusting the audit shell's requested key without matching package definition.
    const harness = await syntheticApplicationHarness();
    await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:package-schema-drift",
    });
    const rebound = harness.state.bindPackageSchemaDriftStart();
    expect(rebound.ranking.packageSchemaVersion).toBe("city-catalog@2");
    expect(rebound.ranking.installedPackageContext.packageSchemaVersion)
      .toBe("city-catalog@2");
    expect(rebound.installed.installedPackageManifest.key.packageSchemaVersion)
      .toBe("city-catalog@2");
    expect(rebound.installed.definition.packageSchemaVersion)
      .toBe("si-city-package@1");
    expect(rebound.installed.catalog.packageSchemaVersion)
      .toBe("si-city-package@1");
    expect(rebound.root.runId).toBe(rebound.ranking.runId);
    const beforePrepare = nonStructuralEffects(harness);
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: rebound.root.runId,
      expectedRevisionId: rebound.root.id,
      commandId: "continue:package-schema-drift",
    });
    expect(nonStructuralEffects(harness)).toEqual(beforePrepare);
    resetContinuationPreflightObservations(harness);
    const beforeDownstream = exactPackageBoundaryEffects(harness);
    const beforePlanGate = {
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    };
    const expectedReloads = [
      `frontier.command:${rebound.root.runId}:continue:package-schema-drift`,
      `frontier.head:${rebound.root.runId}`,
      `ranking:${rebound.ranking.id}`,
    ];
    const expectedOrder = [...expectedReloads, "package.exact"];
    const errors: Error[] = [];
    const emitted = vi.fn();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const keyOffset = harness.calls.exactPackageKeys.length;
      const resultOffset = harness.calls.installedPackageResults.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        prepared,
        emitted,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      errors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(error.message).not.toBe("city_catalog_upgrade_required");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
      expect(harness.calls.exactPackageKeys[keyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      const returnedPackage = harness.calls.installedPackageResults[resultOffset]!;
      expect(returnedPackage.installedPackageManifest.key.packageSchemaVersion)
        .toBe("city-catalog@2");
      expect(returnedPackage.definition.packageSchemaVersion)
        .toBe("si-city-package@1");
    }
    expect(errors[0]).not.toBe(errors[1]);
    expect(exactPackageBoundaryEffects(harness)).toEqual(beforeDownstream);
    expect({
      fixed: planGateHarness.fixed.length,
      directories: planGateHarness.directories.length,
      safetyPlans: planGateHarness.safetyPlans.length,
      semanticEntries: planGateHarness.semanticEntries.length,
    }).toEqual(beforePlanGate);
    expect(harness.calls.manifestKeys).toEqual([]);
    expect(harness.calls.manifestResults).toEqual([]);
    expect(harness.calls.evidenceCanonicals).toEqual([]);
    expect(harness.calls.evidenceHashes).toEqual([]);
    expect(harness.calls.evidenceSigns).toEqual([]);
    expect(harness.calls.catalogReads).toEqual([]);
    expect(harness.calls.readyPackageCountries).toEqual([]);
    expect(emitted).not.toHaveBeenCalled();
  });

  test("rejects closed C/H-valid hostile unknown Catalog rules and future Catalog schema before callbacks", async () => {
    // Break caught: treating closed adversarial port data as authenticated @1 authority.
    for (const variant of ["unknown-rules", "future-schema"] as const) {
      const harness = await syntheticApplicationHarness();
      await harness.assembly.application.startCityFrontier({
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
        commandId: `start:catalog-${variant}`,
      });
      const rebound = await harness.state.bindInvalidCatalogStart(variant);
      expect(rebound.ranking.runId).toBe(rebound.root.runId);
      const { id: catalogId, ...catalogPayload } = rebound.installed.catalog;
      expect(catalogId).toBe(
        `city-catalog:${DECISION_INTEGRITY.hash(DECISION_INTEGRITY.canonical(catalogPayload))}`,
      );
      expect(rebound.installed.officialAuthorityDirectory.catalogRevisionId).toBe(catalogId);
      expect(rebound.installed.safetySourcePlan.catalogRevisionId).toBe(catalogId);
      expect(rebound.installed.safetySourcePlan.authorityDirectoryId)
        .toBe(rebound.installed.officialAuthorityDirectory.id);
      expect(rebound.installed.installedPackageManifest.key.catalogRevisionId).toBe(catalogId);
      const { id: directoryId, ...directoryPayload } =
        rebound.installed.officialAuthorityDirectory;
      expect(directoryId).toBe(`official-authority-directory:${DECISION_INTEGRITY.hash(
        DECISION_INTEGRITY.canonical(directoryPayload),
      )}`);
      const { id: sourcePlanId, ...sourcePlanPayload } = rebound.installed.safetySourcePlan;
      expect(sourcePlanId).toBe(`city-safety-source-plan:${DECISION_INTEGRITY.hash(
        DECISION_INTEGRITY.canonical(sourcePlanPayload),
      )}`);
      expect(rebound.ranking.catalogRevisionId).toBe(catalogId);
      expect(rebound.ranking.registryRevisionId).toBe(rebound.installed.registry.id);
      expect(rebound.ranking.installedPackageContext)
        .toEqual(rebound.installed.installedPackageManifest.key);
      expect(rebound.root.rankingSnapshotId).toBe(rebound.ranking.id);
      expect(rebound.root.operation.kind).toBe("start");
      const catalogRulesVersion = (rebound.installed.catalog as unknown as {
        readonly rulesVersion: string;
      }).rulesVersion;
      const expectedRunIdentity = {
        schemaVersion: "city-frontier-run@1",
        resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
        countryCode: "SI",
        registryRevisionId: rebound.installed.registry.id,
        installedPackageContext: rebound.installed.installedPackageManifest.key,
        criteriaPayloadHash: rebound.root.operation.kind === "start"
          ? rebound.root.operation.criteriaPayloadHash
          : "unreachable",
        catalogRulesVersion,
        rankingRulesVersion: rebound.ranking.rulesVersion,
        verificationBudget: rebound.ranking.verificationBudget,
      } as const;
      expect(rebound.root.runId).toBe(
        `city-frontier:${DECISION_INTEGRITY.hash(
          DECISION_INTEGRITY.canonical(expectedRunIdentity),
        )}`,
      );
      expect(withInfrastructurePlanGateRead(() =>
        harness.fixture.manifestStore.loadVerified(rebound.manifest.key))).toBeUndefined();
      expectManifestAuthority(
        rebound.manifest,
        rebound.ranking.installedPackageContext,
        rebound.installed.installedPackageManifest.id,
      );
      expectAdministrativeManifestBindings(rebound.manifest, rebound.installed);
      const commandId = `continue:catalog-${variant}`;
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: rebound.root.runId,
        expectedRevisionId: rebound.root.id,
        commandId,
      });
      harness.calls.reloads.splice(0);
      harness.calls.authorityOrder.splice(0);
      harness.calls.rankingReads.splice(0);
      harness.calls.rankingResults.splice(0);
      harness.calls.catalogReads.splice(0);
      harness.calls.exactPackageKeys.splice(0);
      harness.calls.installedPackageResults.splice(0);
      harness.calls.manifestKeys.splice(0);
      harness.calls.manifestResults.splice(0);
      harness.calls.evidenceCanonicals.splice(0);
      harness.calls.evidenceHashes.splice(0);
      harness.calls.evidenceSigns.splice(0);
      harness.calls.flightIdentityCanonicals.splice(0);
      const beforeDownstream = planGateDownstreamEffects(harness);
      const beforePlanGate = {
        fixed: planGateHarness.fixed.length,
        directories: planGateHarness.directories.length,
        safetyPlans: planGateHarness.safetyPlans.length,
        semanticEntries: planGateHarness.semanticEntries.length,
      };
      const emitted = vi.fn();
      const errors: Error[] = [];
      const expectedReloads = [
        `frontier.command:${rebound.root.runId}:${commandId}`,
        `frontier.head:${rebound.root.runId}`,
        `ranking:${rebound.ranking.id}`,
      ];
      const requiredOrderPrefix = [...expectedReloads, "package.exact"];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reloadOffset = harness.calls.reloads.length;
        const orderOffset = harness.calls.authorityOrder.length;
        const rankingOffset = harness.calls.rankingResults.length;
        const keyOffset = harness.calls.exactPackageKeys.length;
        const signOffset = harness.calls.evidenceSigns.length;
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emitted,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(error.message).not.toBe("city_catalog_upgrade_required");
        expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
        expect(harness.calls.authorityOrder.slice(orderOffset, orderOffset +
          requiredOrderPrefix.length)).toEqual(requiredOrderPrefix);
        expect(harness.calls.exactPackageKeys[keyOffset])
          .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
        expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
      }
      expect(errors[0]).not.toBe(errors[1]);
      expect(harness.calls.catalogReads).toEqual([]);
      expect(planGateDownstreamEffects(harness)).toEqual(beforeDownstream);
      expect({
        fixed: planGateHarness.fixed.length,
        directories: planGateHarness.directories.length,
        safetyPlans: planGateHarness.safetyPlans.length,
        semanticEntries: planGateHarness.semanticEntries.length,
      }).toEqual(beforePlanGate);
      expect(emitted).not.toHaveBeenCalled();
    }
  });

  test("rejects an authentic historical Catalog B returned for frozen exact package A", async () => {
    // Break caught: accepting any independently valid Catalog bundle after exact package replay.
    const harness = await syntheticApplicationHarness();
    const started = await harness.assembly.application.startCityFrontier({
      resolvedCountryShortlistRevisionId: harness.fixture.resolved.id,
      countryCode: "SI",
      criteriaDraft: structuredClone(DERIVED_V1_DRAFT),
      commandId: "start:historical-catalog-equality",
    });
    const packageA = harness.fixture.installed;
    const packageB = await harness.fixture.installLaterPackage();
    expect(packageB.registry.id).not.toBe(packageA.registry.id);
    expect(packageB.catalog.id).not.toBe(packageA.catalog.id);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findExact(packageA.installedPackageManifest.key))?.catalog)
      .toEqual(packageA.catalog);
    expect(withInfrastructurePlanGateRead(() =>
      harness.fixture.installedPackages.findReady("SI"))?.catalog).toEqual(packageB.catalog);
    const manifestA = withInfrastructurePlanGateRead(() =>
      harness.fixture.manifestStore.loadVerified(
        packageA.installedPackageManifest.key,
      ))!;
    harness.state.overrideHistoricalCatalogResult({
      registry: packageB.registry,
      catalog: packageB.catalog,
    });
    const commandId = "continue:historical-catalog-equality";
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: started.runId,
      expectedRevisionId: started.revision.id,
      commandId,
    });
    harness.calls.reloads.splice(0);
    harness.calls.authorityOrder.splice(0);
    harness.calls.rankingReads.splice(0);
    harness.calls.rankingResults.splice(0);
    harness.calls.catalogReads.splice(0);
    harness.calls.readyPackageCountries.splice(0);
    harness.calls.exactPackageKeys.splice(0);
    harness.calls.installedPackageResults.splice(0);
    harness.calls.manifestKeys.splice(0);
    harness.calls.manifestResults.splice(0);
    harness.calls.evidenceCanonicals.splice(0);
    harness.calls.evidenceHashes.splice(0);
    harness.calls.evidenceSigns.splice(0);
    harness.calls.flightIdentityCanonicals.splice(0);
    const beforeDownstream = planGateDownstreamEffects(harness);
    const emitted = vi.fn();
    const errors: Error[] = [];
    const expectedReloads = [
      `frontier.command:${started.runId}:${commandId}`,
      `frontier.head:${started.runId}`,
      `ranking:${started.ranking.id}`,
    ];
    const expectedOrder = [
      ...expectedReloads,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${packageA.catalog.id}`,
    ];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reloadOffset = harness.calls.reloads.length;
      const orderOffset = harness.calls.authorityOrder.length;
      const rankingOffset = harness.calls.rankingResults.length;
      const keyOffset = harness.calls.exactPackageKeys.length;
      const manifestKeyOffset = harness.calls.manifestKeys.length;
      const manifestResultOffset = harness.calls.manifestResults.length;
      const canonicalOffset = harness.calls.evidenceCanonicals.length;
      const hashOffset = harness.calls.evidenceHashes.length;
      const signOffset = harness.calls.evidenceSigns.length;
      const caught = await harness.assembly.application.continueCityFrontier(
        prepared,
        emitted,
        new AbortController().signal,
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error;
      errors.push(error);
      expect(error.message).toBe("integrity_mismatch");
      expect(harness.calls.reloads.slice(reloadOffset)).toEqual(expectedReloads);
      expect(harness.calls.authorityOrder.slice(orderOffset)).toEqual(expectedOrder);
      expect(harness.calls.exactPackageKeys[keyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expect(harness.calls.manifestKeys[manifestKeyOffset])
        .toBe(harness.calls.rankingResults[rankingOffset]!.installedPackageContext);
      expectManifestAuthority(
        harness.calls.manifestResults[manifestResultOffset] as InstalledCityPackageManifest,
        harness.calls.manifestKeys[manifestKeyOffset]!,
        manifestA.id,
      );
      const canonicalCalls = harness.calls.evidenceCanonicals.slice(canonicalOffset);
      const hashCalls = harness.calls.evidenceHashes.slice(hashOffset);
      expect(canonicalCalls.map(({ value }) => value)).toEqual([manifestPayload(manifestA)]);
      expect(hashCalls).toHaveLength(1);
      expect(hashCalls[0]!.value).toBe(canonicalCalls[0]!.result);
      expect(hashCalls[0]!.result).toBe(manifestA.payloadHash);
      expect(harness.calls.evidenceSigns.slice(signOffset)).toEqual([]);
    }
    expect(errors[0]).not.toBe(errors[1]);
    expect(harness.calls.catalogReads).toEqual([
      `catalog.historical:${packageA.catalog.id}`,
      `catalog.historical:${packageA.catalog.id}`,
    ]);
    expect(harness.calls.installedPackageResults.every(({ catalog }) =>
      catalog.id === packageA.catalog.id)).toBe(true);
    expect(planGateDownstreamEffects(harness)).toEqual(beforeDownstream);
    expect(emitted).not.toHaveBeenCalled();
  });

  test("reaches the real semantic verifier once before preserving a completed-Evidence sentinel", async () => {
    // Break caught: skipping semantic replay or relabeling a native completed-Evidence read failure.
    const harness = await syntheticApplicationHarness();
    const seeded = await seedCurrentSemanticKnowledge(harness, "positive");
    const rankingResult = rankSemanticAuthority(
      harness,
      seeded.templateRanking,
      seeded.criteria,
      seeded.knowledge,
    );
    const authority = sealSemanticAuthority(harness, {
      commandId: "start:semantic-positive",
      templateRanking: seeded.templateRanking,
      criteria: seeded.criteria,
      knowledge: seeded.knowledge,
      rankingResult,
    });
    const sentinel = new Error("after_semantic_gate");
    harness.state.failCompletedEvidenceRead(sentinel);
    resetSemanticGateObservations(harness);
    const beforePrepare = semanticDownstreamEffects(harness);
    const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
      runId: authority.root.runId,
      expectedRevisionId: authority.root.id,
      commandId: "continue:semantic-positive",
    });
    expectSemanticPrepareOnly(harness, authority, "continue:semantic-positive");
    expect(planGateHarness.semanticEntries).toEqual([]);
    expect(semanticDownstreamEffects(harness)).toEqual(beforePrepare);
    resetSemanticGateObservations(harness);
    planGateHarness.beforeSemantic = () => {
      harness.calls.authorityOrder.push("semantic-verifier");
      return {
        evidenceCanonicals: structuredClone(harness.calls.evidenceCanonicals),
        evidenceHashes: structuredClone(harness.calls.evidenceHashes),
        evidenceSigns: structuredClone(harness.calls.evidenceSigns),
      };
    };
    const emitted = vi.fn();
    const caught = await harness.assembly.application.continueCityFrontier(
      prepared,
      emitted,
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(caught).toBe(sentinel);
    expect(planGateHarness.semanticEntries).toHaveLength(1);
    const entry = planGateHarness.semanticEntries[0]!;
    expectSemanticGateEntry(harness, entry, authority, harness.calls.rankingResults[0]!);
    const knowledgeOrder = authority.knowledge.map(({ knowledgeRevisionId }) =>
      `knowledge.load:${knowledgeRevisionId!}`);
    const semanticIndex = harness.calls.authorityOrder.indexOf("semantic-verifier");
    expect(semanticIndex).toBeGreaterThan(-1);
    for (const boundary of [
      `frontier.command:${authority.root.runId}:continue:semantic-positive`,
      `frontier.head:${authority.root.runId}`,
      `ranking:${authority.ranking.id}`,
      "package.exact",
      "manifest.exact",
      `catalog.historical:${harness.fixture.installed.catalog.id}`,
      `frontier.chain:${authority.root.runId}`,
      `frontier.command:${authority.root.runId}:start:semantic-positive`,
      `criteria:${authority.criteria.id}`,
      `branch:${authority.ranking.preCityBranchCommitId}`,
      ...knowledgeOrder,
    ]) {
      const matches = harness.calls.authorityOrder
        .map((value, index) => value === boundary ? index : -1)
        .filter((index) => index >= 0);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toBeLessThan(semanticIndex);
    }
    const evidenceIndex = harness.calls.authorityOrder.findIndex((value) =>
      /^evidence\.find:city-check:[0-9a-f]{64}$/.test(value));
    expect(evidenceIndex).toBeGreaterThan(semanticIndex);
    expect(harness.fixture.policyCalls.evaluations).toHaveLength(
      harness.fixture.installed.catalog.members.length * CITY_CRITERION_IDS.length,
    );
    expect(semanticDownstreamEffects(harness)).toEqual(beforePrepare);
    expect(harness.calls.authorityOrder.filter((value) => value.startsWith("evidence.find:")))
      .toHaveLength(1);
    expect(emitted).not.toHaveBeenCalled();
  });

  test("rejects six independently re-sealed semantic drifts before irreversible effects", async () => {
    // Break caught: accepting stale ranking outputs, borrowing a behavior, or checking only IDs.
    const rows = [
      "criteria",
      "knowledge-outcome",
      "evaluator-behavior",
      "order",
      "factor",
      "screened-exclusion",
    ] as const;
    for (const row of rows) {
      const harness = await syntheticApplicationHarness();
      const seed = row === "knowledge-outcome"
        ? await (async () => {
            const baselineHarness = await syntheticApplicationHarness();
            const baseline = await seedCurrentSemanticKnowledge(
              baselineHarness,
              `${row}:baseline`,
            );
            harness.state.overrideFixedDisposition("si-city-fixed-broadband", "all_rejected");
            let changed: Awaited<ReturnType<typeof seedCurrentSemanticKnowledge>>;
            try {
              changed = await seedCurrentSemanticKnowledge(
                harness,
                `${row}:changed`,
                harness.fixture.alternateResolved.id,
              );
            } finally {
              harness.state.overrideFixedDisposition("si-city-fixed-broadband", undefined);
            }
            expect(changed.started.runId).not.toBe(baseline.started.runId);
            expect(changed.templateRanking.id).not.toBe(baseline.templateRanking.id);
            const baselineByCity = new Map(baseline.knowledge.map((projection) => [
              projection.cityId,
              projection,
            ]));
            const original = changed.knowledge.map((projection) => {
              const baselineProjection = baselineByCity.get(projection.cityId)!;
              if (projection.knowledgeRevisionId === null ||
                baselineProjection.knowledgeRevisionId === null) {
                throw new Error(`missing_semantic_knowledge:${projection.cityId}`);
              }
              const baselineRevision = withInfrastructurePlanGateRead(() =>
                baselineHarness.fixture.knowledgeStore.loadVerified(
                  baselineProjection.knowledgeRevisionId,
                ));
              const changedRevision = withInfrastructurePlanGateRead(() =>
                harness.fixture.knowledgeStore.loadVerified(projection.knowledgeRevisionId));
              expect(changedRevision.evidenceSnapshotId).not.toBe(
                baselineRevision.evidenceSnapshotId,
              );
              const baselineEvidence = withInfrastructurePlanGateRead(() =>
                baselineHarness.fixture.evidenceStore.loadVerified(
                  baselineRevision.evidenceSnapshotId,
                ));
              const changedEvidence = withInfrastructurePlanGateRead(() =>
                harness.fixture.evidenceStore.loadVerified(changedRevision.evidenceSnapshotId));
              expect(changedEvidence.snapshot.cityCheckRunId).not.toBe(
                baselineEvidence.snapshot.cityCheckRunId,
              );
              return freezeDeep({
                ...structuredClone(baselineProjection),
                knowledgeRevisionId: projection.knowledgeRevisionId,
              });
            });
            return { seeded: changed, originalKnowledge: original };
          })()
        : await (async () => {
            const seeded = await seedCurrentSemanticKnowledge(harness, row);
            return { seeded, originalKnowledge: seeded.knowledge };
          })();
      const { seeded, originalKnowledge } = seed;
      const priorRankingResult = rankSemanticAuthority(
        harness,
        seeded.templateRanking,
        seeded.criteria,
        originalKnowledge,
      );
      let criteria = seeded.criteria;
      let knowledge = originalKnowledge;
      let rankingResult = priorRankingResult;
      const changedEvaluatorCalls: CityCriterionEvaluationInput[] = [];

      if (row === "criteria") {
        const draft = structuredClone(seeded.criteria.criteria) as unknown as CityCriterionDraft[];
        draft[0] = {
          ...draft[0]!,
          importance: draft[0]!.importance === 5 ? 4 : 5,
        };
        criteria = confirmCityCriteria({
          draft,
          profileSnapshotId: seeded.criteria.profileSnapshotId,
          preferenceProfileSnapshotId: seeded.criteria.preferenceProfileSnapshotId,
          confirmedAt: seeded.criteria.confirmedAt,
        }, harness.fixture.installed.evaluatorRegistry, DECISION_INTEGRITY);
        expect(criteria.id).not.toBe(seeded.criteria.id);
        expect(DECISION_INTEGRITY.canonical(rankSemanticAuthority(
          harness,
          seeded.templateRanking,
          criteria,
          originalKnowledge,
        ))).not.toBe(DECISION_INTEGRITY.canonical(priorRankingResult));
      }

      if (row === "knowledge-outcome") {
        knowledge = seeded.knowledge;
        expect(DECISION_INTEGRITY.canonical(rankSemanticAuthority(
          harness,
          seeded.templateRanking,
          seeded.criteria,
          knowledge,
        ))).not.toBe(DECISION_INTEGRITY.canonical(priorRankingResult));
      }

      if (row === "evaluator-behavior") {
        const changedRegistry = changedEvaluatorRegistry(
          harness.fixture.installed,
          changedEvaluatorCalls,
        );
        expect(DECISION_INTEGRITY.canonical(rankSemanticAuthority(
          harness,
          seeded.templateRanking,
          seeded.criteria,
          originalKnowledge,
          changedRegistry,
        ))).not.toBe(DECISION_INTEGRITY.canonical(priorRankingResult));
        harness.state.overrideEvaluatorRegistry(changedRegistry);
      }
      if (row === "order" || row === "factor" || row === "screened-exclusion") {
        rankingResult = driftSemanticRankingResult(priorRankingResult, row);
      }
      const authority = sealSemanticAuthority(harness, {
        commandId: `start:semantic-drift:${row}`,
        templateRanking: seeded.templateRanking,
        criteria,
        knowledge,
        rankingResult,
      });
      expect(authority.ranking.id).toMatch(/^city-ranking:[0-9a-f]{64}$/);
      expect(authority.root.rankingSnapshotId).toBe(authority.ranking.id);
      expect(authority.root.runId).toBe(authority.ranking.runId);
      resetSemanticGateObservations(harness);
      const prepared = await harness.assembly.application.prepareCityFrontierContinuation({
        runId: authority.root.runId,
        expectedRevisionId: authority.root.id,
        commandId: `continue:semantic-drift:${row}`,
      });
      expectSemanticPrepareOnly(harness, authority, `continue:semantic-drift:${row}`);
      expect(planGateHarness.semanticEntries).toEqual([]);
      const zeroDownstream = semanticDownstreamEffects(harness);
      expect(Object.values(zeroDownstream).every((value) => value === 0)).toBe(true);
      const errors: Error[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        resetSemanticGateObservations(harness);
        changedEvaluatorCalls.splice(0);
        planGateHarness.beforeSemantic = () => {
          harness.calls.authorityOrder.push("semantic-verifier");
          return {
            evidenceCanonicals: structuredClone(harness.calls.evidenceCanonicals),
            evidenceHashes: structuredClone(harness.calls.evidenceHashes),
            evidenceSigns: structuredClone(harness.calls.evidenceSigns),
          };
        };
        const emitted = vi.fn();
        const caught = await harness.assembly.application.continueCityFrontier(
          prepared,
          emitted,
          new AbortController().signal,
        ).catch((error: unknown) => error);
        expect(caught).toBeInstanceOf(Error);
        const error = caught as Error;
        errors.push(error);
        expect(error.message).toBe("integrity_mismatch");
        expect(planGateHarness.semanticEntries.length).toBeLessThanOrEqual(1);
        const entry = planGateHarness.semanticEntries[0];
        if (entry !== undefined) {
          expectSemanticGateEntry(harness, entry, authority, harness.calls.rankingResults[0]!);
          expect(harness.calls.authorityOrder.filter((value) => value === "semantic-verifier"))
            .toHaveLength(1);
          const evaluatedCriteria = [
            ...harness.fixture.policyCalls.evaluations.map(({ criterionId }) => criterionId),
            ...changedEvaluatorCalls.map(() => "fixed_broadband"),
          ];
          expect(evaluatedCriteria).toHaveLength(
            harness.fixture.installed.catalog.members.length * CITY_CRITERION_IDS.length,
          );
          for (const criterionId of CITY_CRITERION_IDS) {
            expect(evaluatedCriteria.filter((value) => value === criterionId)).toHaveLength(
              harness.fixture.installed.catalog.members.length,
            );
          }
        } else {
          expect(harness.calls.authorityOrder).not.toContain("semantic-verifier");
        }
        expect(harness.calls.authorityOrder.some((value) => value.startsWith("evidence.find:")))
          .toBe(false);
        expect(Object.values(semanticDownstreamEffects(harness)).every((value) => value === 0))
          .toBe(true);
        expect(emitted).not.toHaveBeenCalled();
      }
      expect(errors[0]).not.toBe(errors[1]);
    }
  });
});
