import { types } from "node:util";

import type Database from "better-sqlite3";

import {
  createCityFrontierApplication,
  type CityFrontierApplication,
  type CityFrontierFixedRoutePorts,
  type CityFrontierProfileReadPort,
  type CityFrontierResolvedCountryReadPort,
} from "../application/city-frontier";
import {
  createCitySelectionApplication,
  type CitySelectionApplication,
} from "../application/city-selection";
import type { CitySafetyOfficialDocumentPort } from
  "../application/city-safety-contracts";
import { APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY } from
  "../decision/approved-city-criteria-defaults";
import { getCityResearchPackageAvailability } from "../research/city-package";
import type { CityFixedDeadlineScheduler } from "../research/city-evidence";
import {
  createCityDecisionIntegrityView,
  createCityEvidenceReplayIntegrity,
  createEvidenceIntegrity,
} from "./integrity";
import {
  createCitySafetySearchPort,
  createUnconfiguredCitySafetySearchPort,
} from "./sources/city-safety-search-adapter";
import {
  createHttpCitySafetySearchStep,
  type CitySafetySearchHttpRequest,
  type HttpCitySafetySearchConfig,
} from "./sources/http-city-safety-search-step";
import {
  INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY,
  InstalledCityPackages,
} from "./sources/installed-city-packages";
import { SqliteCityBranchStore } from "./sqlite/city-branch-store";
import { SqliteCityCatalogStore } from "./sqlite/city-catalog-store";
import { SqliteCityCriteriaStore } from "./sqlite/city-criteria-store";
import { SqliteCityEvidenceStore } from "./sqlite/city-evidence-store";
import { SqliteCityFrontierStore } from "./sqlite/city-frontier-store";
import { SqliteCityKnowledgeStore } from "./sqlite/city-knowledge-store";
import { SqliteCitySelectionWriter } from "./sqlite/city-selection-writer";
import { SqliteCityPackageManifestStore } from "./sqlite/city-package-manifest-store";
import { SqliteCountryResolutionStore } from "./sqlite/country-resolution-store";

export type CityFrontierLiveSourceConfiguration =
  | { readonly kind: "unconfigured" }
  | {
      readonly kind: "configured";
      readonly fixedRoutes: CityFrontierFixedRoutePorts;
      readonly safetyDocuments: CitySafetyOfficialDocumentPort;
      readonly citySafetySearch?: Readonly<{
        readonly config: HttpCitySafetySearchConfig;
        readonly request: CitySafetySearchHttpRequest;
      }>;
    };

export interface CityFrontierFixedTiming {
  readonly fixedSourceDeadlineAt: (now: Date) => Date;
  readonly fixedDeadlineScheduler: CityFixedDeadlineScheduler;
}

export interface CityFrontierCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly resolvedCountries: CityFrontierResolvedCountryReadPort;
  readonly profiles: CityFrontierProfileReadPort;
  readonly liveSources: CityFrontierLiveSourceConfiguration;
  readonly resolveAvailability?: typeof getCityResearchPackageAvailability;
  readonly clock?: () => Date;
  readonly fixedTiming?: CityFrontierFixedTiming;
}

type PlainRecord = Record<string, unknown>;

const REQUIRED_OPTIONS = [
  "database", "hmacKey", "resolvedCountries", "profiles", "liveSources",
] as const;
const OPTIONAL_OPTIONS = [
  "resolveAvailability", "clock", "fixedTiming",
] as const;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!required.every((key) => keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))) mismatch();
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function functionValue(value: unknown): (...args: never[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value)) mismatch();
  return value as (...args: never[]) => unknown;
}

function exactMethodObject(value: unknown, keys: readonly string[]): PlainRecord {
  const record = exactRecord(value, keys);
  for (const key of keys) functionValue(record[key]);
  return record;
}

function captureSearchConfig(value: unknown): HttpCitySafetySearchConfig {
  const record = exactRecord(value, [
    "endpoint", "providerId", "timeoutMs", "maxResponseBytes",
  ], ["bearerToken"]);
  return Object.freeze({
    endpoint: record.endpoint as string,
    providerId: record.providerId as string,
    ...(record.bearerToken === undefined ? {} : { bearerToken: record.bearerToken as string }),
    timeoutMs: record.timeoutMs as number,
    maxResponseBytes: record.maxResponseBytes as 65536,
  });
}

function captureLiveSources(value: unknown): CityFrontierLiveSourceConfiguration {
  const tag = exactRecord(value, ["kind"], [
    "fixedRoutes", "safetyDocuments", "citySafetySearch",
  ]);
  if (tag.kind === "unconfigured") {
    if (Object.keys(tag).length !== 1) mismatch();
    return Object.freeze({ kind: "unconfigured" });
  }
  if (tag.kind !== "configured") mismatch();
  const configured = exactRecord(value, ["kind", "fixedRoutes", "safetyDocuments"], [
    "citySafetySearch",
  ]);
  const fixedRoutes = exactRecord(configured.fixedRoutes, [
    "si-city-long-term-rent", "si-city-urban-transit", "si-city-fixed-broadband",
  ]);
  for (const route of Object.values(fixedRoutes)) exactMethodObject(route, ["inspect"]);
  exactMethodObject(configured.safetyDocuments, ["inspect"]);
  if (configured.citySafetySearch === undefined) {
    return Object.freeze({
      kind: "configured",
      fixedRoutes: configured.fixedRoutes as CityFrontierFixedRoutePorts,
      safetyDocuments: configured.safetyDocuments as CitySafetyOfficialDocumentPort,
    });
  }
  const search = exactRecord(configured.citySafetySearch, ["config", "request"]);
  const request = functionValue(search.request) as CitySafetySearchHttpRequest;
  return Object.freeze({
    kind: "configured",
    fixedRoutes: configured.fixedRoutes as CityFrontierFixedRoutePorts,
    safetyDocuments: configured.safetyDocuments as CitySafetyOfficialDocumentPort,
    citySafetySearch: Object.freeze({
      config: captureSearchConfig(search.config),
      request,
    }),
  });
}

function defaultClock(): Date {
  return new Date();
}

function defaultDeadlineAt(now: Date): Date {
  return new Date(now.valueOf() + 45_000);
}

function defaultScheduler(): CityFixedDeadlineScheduler {
  return Object.freeze({
    schedule(deadlineAt: string, onDeadline: () => void) {
      if (typeof deadlineAt !== "string" || typeof onDeadline !== "function") mismatch();
      let parsed: Date;
      try {
        parsed = new Date(deadlineAt);
        if (parsed.toISOString() !== deadlineAt || parsed.valueOf() <= Date.now()) mismatch();
      } catch {
        mismatch();
      }
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = (): void => {
        if (!active) return;
        const remaining = parsed.valueOf() - Date.now();
        if (remaining <= 0) {
          active = false;
          onDeadline();
          return;
        }
        timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
      };
      arm();
      return Object.freeze({
        cancel() {
          if (!active) return;
          active = false;
          if (timer !== undefined) clearTimeout(timer);
        },
      });
    },
  });
}

function unavailableFixedRoutes(): CityFrontierFixedRoutePorts {
  const inspect = async (): Promise<never> => {
    throw new Error("city_source_adapter_unconfigured");
  };
  return Object.freeze({
    "si-city-long-term-rent": Object.freeze({ inspect }),
    "si-city-urban-transit": Object.freeze({ inspect }),
    "si-city-fixed-broadband": Object.freeze({ inspect }),
  }) as CityFrontierFixedRoutePorts;
}

function unavailableDocuments(): CitySafetyOfficialDocumentPort {
  return Object.freeze({
    async inspect(): Promise<never> {
      throw new Error("city_source_adapter_unconfigured");
    },
  });
}

export function createCityFrontierComposition(
  borrowedOptions: CityFrontierCompositionOptions,
): Readonly<CityFrontierApplication & CitySelectionApplication> {
  const options = exactRecord(borrowedOptions, REQUIRED_OPTIONS, OPTIONAL_OPTIONS);
  if (options.database === null || typeof options.database !== "object" ||
    typeof options.hmacKey !== "string" || options.hmacKey.length === 0) mismatch();
  exactMethodObject(options.resolvedCountries, ["requireResolvedCountryShortlistForCity"]);
  exactMethodObject(options.profiles, [
    "loadRelocationAnyVerified", "loadPreferenceForRankingVerified",
  ]);
  if (options.resolveAvailability !== undefined) functionValue(options.resolveAvailability);
  if (options.clock !== undefined) functionValue(options.clock);
  if (options.fixedTiming !== undefined) {
    const timing = exactRecord(options.fixedTiming, [
      "fixedSourceDeadlineAt", "fixedDeadlineScheduler",
    ]);
    functionValue(timing.fixedSourceDeadlineAt);
    exactMethodObject(timing.fixedDeadlineScheduler, ["schedule"]);
  }
  const liveSources = captureLiveSources(options.liveSources);
  const database = options.database as Database.Database;
  const integrity = createEvidenceIntegrity(options.hmacKey as string);
  const decisionIntegrity = createCityDecisionIntegrityView(integrity);
  const catalogStore = new SqliteCityCatalogStore(database, integrity);
  const manifestStore = new SqliteCityPackageManifestStore(
    database,
    integrity,
    APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY,
    INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY,
  );
  const installedPackages = new InstalledCityPackages(manifestStore);
  const criteriaStore = new SqliteCityCriteriaStore(database, integrity);
  const countryResolutionStore = new SqliteCountryResolutionStore(
    database,
    options.hmacKey as string,
  );
  const branchStore = new SqliteCityBranchStore(
    database,
    integrity,
    countryResolutionStore,
  );
  const frontierStore = new SqliteCityFrontierStore(database, integrity, {
    criteria: criteriaStore,
    branches: branchStore,
    catalogs: catalogStore,
  });
  const evidenceStore = new SqliteCityEvidenceStore(database, integrity, installedPackages);
  const knowledgeStore = new SqliteCityKnowledgeStore(database, integrity, installedPackages);
  const selectionWriter = new SqliteCitySelectionWriter(database, integrity, {
    catalogs: catalogStore,
    historicalPackages: manifestStore,
    branches: branchStore,
    rankings: frontierStore,
    frontier: frontierStore,
  });
  const manifestLoad = manifestStore.loadVerified.bind(manifestStore);
  const installedFindReady = installedPackages.findReady.bind(installedPackages);
  const installedFindExact = installedPackages.findExact.bind(installedPackages);
  const installedLatest = installedPackages.latestInstalledVerified.bind(installedPackages);
  const fixedRoutes = liveSources.kind === "configured"
    ? liveSources.fixedRoutes
    : unavailableFixedRoutes();
  const safetyDocuments = liveSources.kind === "configured"
    ? liveSources.safetyDocuments
    : unavailableDocuments();
  const safetySearch = liveSources.kind === "configured" && liveSources.citySafetySearch !== undefined
    ? createCitySafetySearchPort({
        step: createHttpCitySafetySearchStep(
          liveSources.citySafetySearch.config,
          liveSources.citySafetySearch.request,
        ),
        providerId: liveSources.citySafetySearch.config.providerId,
      })
    : createUnconfiguredCitySafetySearchPort();
  const fixedTiming = options.fixedTiming as CityFrontierFixedTiming | undefined;
  const clock = options.clock as (() => Date) | undefined ?? defaultClock;

  const assembly = createCityFrontierApplication({
    resolveAvailability: options.resolveAvailability as
      typeof getCityResearchPackageAvailability | undefined ?? getCityResearchPackageAvailability,
    resolvedCountries: options.resolvedCountries as CityFrontierResolvedCountryReadPort,
    profiles: options.profiles as CityFrontierProfileReadPort,
    installedPackages: Object.freeze({
      findReady: installedFindReady,
      findExact: installedFindExact,
    }),
    installedPackageManifests: Object.freeze({ loadVerified: manifestLoad }),
    latestInstalledCatalog: Object.freeze({ latestInstalledVerified: installedLatest }),
    historicalCatalogs: Object.freeze({
      loadVerified: catalogStore.loadVerified.bind(catalogStore),
    }),
    criteria: Object.freeze({
      loadCriteriaVerified: criteriaStore.loadCriteriaVerified.bind(criteriaStore),
    }),
    branches: Object.freeze({
      loadPreCityBranchVerified: branchStore.loadPreCityBranchVerified.bind(branchStore),
      findPreCityBranchBySourceVerified:
        branchStore.findPreCityBranchBySourceVerified.bind(branchStore),
    }),
    rankings: Object.freeze({
      loadRankingVerified: frontierStore.loadRankingVerified.bind(frontierStore),
    }),
    frontierRead: Object.freeze({
      loadRevisionVerified: frontierStore.loadRevisionVerified.bind(frontierStore),
      loadHeadVerified: frontierStore.loadHeadVerified.bind(frontierStore),
      loadChainVerified: frontierStore.loadChainVerified.bind(frontierStore),
      findCommandVerified: frontierStore.findCommandVerified.bind(frontierStore),
    }),
    frontierAppend: Object.freeze({
      appendRevision: frontierStore.appendRevision.bind(frontierStore),
    }),
    startWriter: Object.freeze({ publishStart: frontierStore.publishStart.bind(frontierStore) }),
    selectionHistory: selectionWriter,
    evidence: Object.freeze({
      loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
      findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      seal: evidenceStore.seal.bind(evidenceStore),
    }),
    evidenceReplay: Object.freeze({
      read: Object.freeze({
        loadVerified: evidenceStore.loadVerified.bind(evidenceStore),
        findVerifiedByCheckRunId: evidenceStore.findVerifiedByCheckRunId.bind(evidenceStore),
      }),
      integrity: createCityEvidenceReplayIntegrity(decisionIntegrity),
      package: Object.freeze({
        loadExactReplayContract: installedPackages.loadExactReplayContract.bind(installedPackages),
      }),
    }),
    knowledge: Object.freeze({
      publishFromEvidence: knowledgeStore.publishFromEvidence.bind(knowledgeStore),
      latestVerified: knowledgeStore.latestVerified.bind(knowledgeStore),
      loadVerified: knowledgeStore.loadVerified.bind(knowledgeStore),
      findByEvidenceVerified: knowledgeStore.findByEvidenceVerified.bind(knowledgeStore),
    }),
    fixedRoutes,
    fixedDeadlineScheduler: fixedTiming?.fixedDeadlineScheduler ?? defaultScheduler(),
    safetySearch,
    safetyDocuments,
    decisionIntegrity,
    evidenceIntegrity: integrity,
    clock,
    fixedSourceDeadlineAt: fixedTiming?.fixedSourceDeadlineAt ?? defaultDeadlineAt,
  });
  const selection = createCitySelectionApplication({
    frontier: assembly.selectionAuthority,
    writer: selectionWriter,
    integrity: decisionIntegrity,
    clock,
  });
  return Object.freeze({ ...assembly.application, ...selection });
}
