import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";

import {
  createCitySelectionApplication,
  type CitySelectionApplication,
  type CitySelectionApplicationPorts,
  type SelectCityInput,
} from "../../src/application/city-selection";
import {
  cityLiveMarkerDigest,
  createCitySelectionWithBranch,
  sealCityFrontierRevision,
  sealCityRankingSnapshot,
  type CityRankingSnapshot,
  type CityFrontierReadModel,
  type CitySelectionCommandIntent,
  type CitySelectionPublication,
  type CitySelectionWithBranch,
  type CitySelectionWriterPort,
  type TerminalCityShortlistSnapshot,
} from "../../src/application/city-frontier-contracts";
import type { CityFrontierSelectionAuthorityPort } from
  "../../src/application/city-frontier";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import {
  createPreCityBranchCommit,
  type PreCityBranchCommit,
  type PreCityBranchSourceProjection,
} from "../../src/branch/city";
import type {
  CityCommittedFactProjection,
  CityLiveMarker,
  CityTerminalEntry,
  ReconstructCityFrontierInput,
} from "../../src/decision/city-frontier-policy";
import type {
  CityCriteriaSnapshot,
  CityCriterionEvaluatorRegistry,
  CityCriterionId,
} from "../../src/decision/city-criteria";
import { citySelectionPublicationWorker } from
  "../support/city-selection-publication-worker";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { SqliteCitySelectionWriter } from
  "../../src/infrastructure/sqlite/city-selection-writer";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";

const UNUSED_WORKER = citySelectionPublicationWorker;
const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function emptyWriter(): SqliteCitySelectionWriter {
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  const unused = (): never => {
    throw new Error("unexpected_dependency_call");
  };
  return new SqliteCitySelectionWriter(
    database,
    createEvidenceIntegrity("task-15-city-selection-writer-key"),
    {
      catalogs: Object.freeze({ loadVerified: unused }),
      branches: Object.freeze({ loadPreCityBranchVerified: unused }),
      rankings: Object.freeze({ loadRankingVerified: unused }),
      frontier: Object.freeze({ loadRevisionVerified: unused }),
    },
  );
}

const WRITER_KEY = "task-15-city-selection-atomic-writer-key";
const RUN_ID = "city-frontier:selection-run-1";

function recursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      recursivelyFrozen(descriptor.value, seen);
    }
  }
}

function fact(
  criterionId: CityCriterionId,
  outcome: CityCommittedFactProjection["outcome"] = {
    kind: "verified",
    basis: { kind: "canonical_scalar", value: "1" },
  },
): CityCommittedFactProjection {
  return {
    criterionId,
    definitionId: `${criterionId}@1`,
    geoScope: "municipality",
    referencePeriod: "2025",
    freshnessBasis: "fresh@1",
    unit: "unit",
    denominator: "municipality",
    outcome,
    evidenceLinks: [],
    manualCheckLinks: [],
  };
}

function marker(cityId: "alpha" | "beta", rank: 1 | 2): CityLiveMarker {
  const yellow = cityId === "beta";
  const facts = [
    fact("safety"),
    fact("long_term_rent"),
    fact("urban_transit"),
    fact("fixed_broadband", yellow
      ? { kind: "unknown", reason: "not_found" }
      : { kind: "verified", basis: { kind: "canonical_scalar", value: "1" } }),
  ] as CityLiveMarker["facts"];
  return {
    cityId,
    rank,
    status: "selectable",
    visualStatus: yellow ? "yellow" : "green",
    knowledgeRevisionId: `knowledge:${cityId}@1`,
    evidenceSnapshotId: `city-evidence:${cityId}@1`,
    lastCheckedAt: "2026-01-05T00:00:00.000Z",
    requiredMismatches: [],
    unknownBasis: yellow ? [{
      criterionId: "fixed_broadband",
      definitionId: "fixed_broadband@1",
      reason: "not_found",
    }] : [],
    verificationCoverage: yellow ? "0.6" : "1",
    facts,
  };
}

function rankingFactors(): CityRankingSnapshot["ordered"][number]["factors"] {
  const definitions: ReadonlyArray<readonly [CityCriterionId, "required" | "weighted", number]> = [
    ["safety", "required", 1],
    ["long_term_rent", "weighted", 2],
    ["urban_transit", "weighted", 3],
    ["fixed_broadband", "weighted", 4],
  ];
  return definitions.map(([criterionId, mode, importance]) => ({
    criterionId,
    definitionId: `${criterionId}@1`,
    mode,
    importance,
    evaluatorVersion: "eval@1",
    freshnessPolicyVersion: "fresh@1",
    state: "verified" as const,
    factor: "1",
    weightedContribution: String(importance),
    targetComparison: "matches" as const,
    requiredMismatch: false,
  })) as unknown as CityRankingSnapshot["ordered"][number]["factors"];
}

interface PairFixture {
  readonly integrity: ReturnType<typeof createEvidenceIntegrity>;
  readonly preCityBranch: PreCityBranchCommit;
  readonly preCitySource: PreCityBranchSourceProjection;
  readonly ranking: CityRankingSnapshot;
  readonly terminal: TerminalCityShortlistSnapshot;
  readonly frontier: ReconstructCityFrontierInput;
  readonly readModel: CityFrontierReadModel;
  readonly pair: (
    cityId: "alpha" | "beta",
    commandId: string,
    createdAt: string,
  ) => CitySelectionWithBranch;
  readonly catalogBundle: {
    readonly registry: { readonly id: string };
    readonly catalog: {
      readonly id: string;
      readonly rulesVersion: "city-catalog@1" | "city-catalog@2";
    };
  };
}

function pairFixture(
  rulesVersion: "city-catalog@1" | "city-catalog@2" = "city-catalog@2",
): PairFixture {
  const integrity = createEvidenceIntegrity(WRITER_KEY);
  const preCitySource: PreCityBranchSourceProjection = {
    profileSnapshotId: "profile:selection-confirmed",
    preferenceProfileSnapshotId: "preferences:selection-confirmed",
    resolvedCountryShortlistRevisionId: "country-resolution:selection-terminal",
    resolvedCountryEntry: {
      countryCode: "SI",
      rank: 1,
      formalMarkerDigest: "1".repeat(64),
    },
  };
  const preCityBranch = createPreCityBranchCommit({
    source: preCitySource,
    createdAt: "2026-01-01T00:00:00.000Z",
  }, integrity);
  const ranking = sealCityRankingSnapshot({
    schemaVersion: "city-ranking@1",
    runId: RUN_ID,
    resolvedCountryShortlistRevisionId: preCityBranch.resolvedCountryShortlistRevisionId,
    countryCode: "SI",
    packageId: "slovenia-city",
    packageSchemaVersion: "package@1",
    preCityBranchCommitId: preCityBranch.id,
    profileSnapshotId: preCityBranch.profileSnapshotId,
    preferenceProfileSnapshotId: preCityBranch.preferenceProfileSnapshotId,
    registryRevisionId: "registry:selection@1",
    catalogRevisionId: "catalog:selection@2",
    installedPackageContext: {
      countryCode: "SI",
      packageId: "slovenia-city",
      packageSchemaVersion: "package@1",
      catalogRevisionId: "catalog:selection@2",
      evidenceRulesVersion: "evidence-rules@2",
    },
    criteriaSnapshotId: "criteria:selection",
    assessmentAt: "2026-01-02T00:00:00.000Z",
    knowledgeRevisionIds: {
      alpha: "knowledge:alpha@1",
      beta: "knowledge:beta@1",
    },
    ordered: [
      {
        cityId: "alpha",
        rank: 1,
        score: "1",
        coverage: "1",
        knowledgeRevisionId: "knowledge:alpha@1",
        factors: rankingFactors(),
      },
      {
        cityId: "beta",
        rank: 2,
        score: "1",
        coverage: "1",
        knowledgeRevisionId: "knowledge:beta@1",
        factors: rankingFactors(),
      },
    ],
    screenedExclusions: [],
    rulesVersion: "city-ranker@1",
    verificationBudget: {
      liveCityCandidateLimit: 10,
      targetSelectableCities: 3,
      rulesVersion: "city-frontier-budget@1",
    },
    createdAt: "2026-01-02T00:00:00.000Z",
  }, integrity);
  const markers = [marker("alpha", 1), marker("beta", 2)] as const;
  const entry = (value: CityLiveMarker): CityTerminalEntry => ({
    cityId: value.cityId,
    rank: value.rank,
    markerDigest: cityLiveMarkerDigest(value, integrity),
    knowledgeRevisionId: value.knowledgeRevisionId,
    evidenceSnapshotId: value.evidenceSnapshotId,
    unknownBasis: structuredClone(value.unknownBasis),
  });
  const predecessorRevisionId = `city-frontier-revision:${"2".repeat(64)}`;
  const terminal = sealCityFrontierRevision({
    runId: RUN_ID,
    predecessorRevisionId,
    rankingSnapshotId: ranking.id,
    markers,
    projection: {
      kind: "terminal",
      nextUncheckedRank: 3,
      selectableCityIds: ["alpha", "beta"],
      entries: markers.map(entry),
      stopCondition: "catalog_exhausted",
    },
    operation: {
      kind: "city_completed",
      commandId: "command:beta-completed",
      expectedHeadRevisionId: predecessorRevisionId,
      cityId: "beta",
      cityCheckRunId: "city-check:beta@1",
    },
    createdAt: "2026-01-06T00:00:00.000Z",
  }, integrity) as TerminalCityShortlistSnapshot;
  const criteria: CityCriteriaSnapshot = {
    schemaVersion: "city-criteria@1",
    id: ranking.criteriaSnapshotId,
    profileSnapshotId: ranking.profileSnapshotId,
    preferenceProfileSnapshotId: ranking.preferenceProfileSnapshotId,
    criteria: [
      { criterionId: "safety", definitionId: "safety@1", mode: "required", importance: 1, target: "1" },
      { criterionId: "long_term_rent", definitionId: "long_term_rent@1", mode: "weighted", importance: 2, target: "1" },
      { criterionId: "urban_transit", definitionId: "urban_transit@1", mode: "weighted", importance: 3, target: "1" },
      { criterionId: "fixed_broadband", definitionId: "fixed_broadband@1", mode: "weighted", importance: 4, target: "1" },
    ],
    rulesVersion: "city-criteria@1",
    confirmedAt: ranking.assessmentAt,
  };
  const evaluatorDefinitions: ReadonlyArray<
    readonly [CityCriterionId, "required" | "weighted", number]
  > = [
    ["safety", "required", 1],
    ["long_term_rent", "weighted", 2],
    ["urban_transit", "weighted", 3],
    ["fixed_broadband", "weighted", 4],
  ];
  const evaluators = Object.fromEntries(evaluatorDefinitions.map(([criterionId]) => [
    criterionId,
    {
      definition: {
        criterionId,
        definitionId: `${criterionId}@1`,
        direction: "at_least" as const,
        unit: "unit",
        denominator: "municipality",
        compatibleGeoScopes: ["municipality"],
        freshnessPolicyVersion: "fresh@1",
        evaluatorVersion: "eval@1",
      },
      canonicalizeTarget(target: unknown) {
        return String(target);
      },
      evaluate(input: { readonly fact: { readonly outcome: CityCommittedFactProjection["outcome"] } }) {
        return input.fact.outcome.kind === "unknown"
          ? {
              state: "unknown" as const,
              factor: "0",
              targetComparison: "unknown" as const,
              unknownReason: input.fact.outcome.reason,
            }
          : {
              state: "verified" as const,
              factor: "1",
              targetComparison: "matches" as const,
            };
      },
    },
  ])) as unknown as CityCriterionEvaluatorRegistry;
  const frontier: ReconstructCityFrontierInput = {
    ranking: {
      assessmentAt: ranking.assessmentAt,
      orderedCityIds: ["alpha", "beta"],
      screenedExclusionCityIds: [],
    },
    criteria,
    evaluators,
    predecessorMarkers: [structuredClone(markers[0])],
    markerBindings: markers.map((value) => ({
      marker: structuredClone(value),
      markerDigest: cityLiveMarkerDigest(value, integrity),
      authority: {
        cityId: value.cityId,
        knowledgeRevisionId: value.knowledgeRevisionId,
        evidenceSnapshotId: value.evidenceSnapshotId,
        lastCheckedAt: value.lastCheckedAt,
        facts: structuredClone(value.facts),
      },
    })),
    persisted: {
      kind: "terminal",
      nextUncheckedRank: terminal.nextUncheckedRank,
      selectableCityIds: ["alpha", "beta"],
      entries: structuredClone(terminal.entries),
      stopCondition: terminal.stopCondition,
    },
  };
  const readModel = {
    runId: ranking.runId,
    assessmentAt: ranking.assessmentAt,
    resolvedCountryShortlistRevisionId: ranking.resolvedCountryShortlistRevisionId,
    countryCode: ranking.countryCode,
    preCityBranchCommitId: preCityBranch.id,
    registry: { id: ranking.registryRevisionId },
    catalog: { id: ranking.catalogRevisionId, rulesVersion },
    criteria,
    ranking,
    revision: terminal,
    selections: [],
  } as unknown as CityFrontierReadModel;
  return {
    integrity,
    preCityBranch,
    preCitySource,
    ranking,
    terminal,
    frontier,
    readModel,
    pair: (cityId, commandId, createdAt) => {
      const selected = markers.find((candidate) => candidate.cityId === cityId)!;
      return createCitySelectionWithBranch({
        terminal,
        ranking,
        preCityBranch,
        commandId,
        selection: {
          entry: entry(selected),
          reviewedSourceLinks: [],
          ...(cityId === "beta"
            ? { warningCopyVersion: "city-unknown-risk@1" as const }
            : {}),
        },
        createdAt,
      }, integrity);
    },
    catalogBundle: {
      registry: { id: ranking.registryRevisionId },
      catalog: { id: ranking.catalogRevisionId, rulesVersion },
    },
  };
}

function seedRankingLocator(
  database: Database.Database,
  fixture: PairFixture,
): void {
  database.pragma("foreign_keys = OFF");
  const value = fixture.ranking;
  const payload = fixture.integrity.canonical(value);
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
    value.id,
    value.runId,
    value.resolvedCountryShortlistRevisionId,
    value.countryCode,
    value.packageId,
    value.packageSchemaVersion,
    value.registryRevisionId,
    value.catalogRevisionId,
    value.criteriaSnapshotId,
    value.preCityBranchCommitId,
    value.profileSnapshotId,
    value.preferenceProfileSnapshotId,
    value.installedPackageContext.evidenceRulesVersion,
    fixture.integrity.canonical(value.installedPackageContext),
    value.verificationBudget.liveCityCandidateLimit,
    value.verificationBudget.targetSelectableCities,
    value.verificationBudget.rulesVersion,
    value.schemaVersion,
    value.rulesVersion,
    value.assessmentAt,
    payload,
    fixture.integrity.hash(payload),
    fixture.integrity.sign(payload),
    value.createdAt,
  );
}

function publication(
  fixture: PairFixture,
  cityId: "alpha" | "beta",
  commandId: string,
  createdAt: string,
): CitySelectionPublication {
  const intent: CitySelectionCommandIntent = {
    terminalCityShortlistSnapshotId: fixture.terminal.id,
    cityId,
    ...(cityId === "beta" ? { warningCopyVersion: "city-unknown-risk@1" } : {}),
  };
  return {
    commandId,
    intent,
    pair: fixture.pair(cityId, commandId, createdAt),
  };
}

function writerFixture(
  rulesVersion: "city-catalog@1" | "city-catalog@2" = "city-catalog@2",
  database = openEvidenceDatabase(":memory:"),
): {
  readonly database: Database.Database;
  readonly fixture: PairFixture;
  readonly writer: SqliteCitySelectionWriter;
} {
  databases.push(database);
  const fixture = pairFixture(rulesVersion);
  seedRankingLocator(database, fixture);
  const writer = new SqliteCitySelectionWriter(database, fixture.integrity, {
    catalogs: {
      loadVerified: () => structuredClone(fixture.catalogBundle) as never,
    },
    branches: {
      loadPreCityBranchVerified: () => structuredClone(fixture.preCityBranch),
    },
    rankings: {
      loadRankingVerified: () => structuredClone(fixture.ranking),
    },
    frontier: {
      loadRevisionVerified: () => structuredClone(fixture.terminal),
    },
  });
  return { database, fixture, writer };
}

function rowCounts(database: Database.Database): { readonly selections: number; readonly branches: number } {
  const selections = database.prepare(
    "SELECT count(*) AS count FROM city_selection_snapshots",
  ).get() as { readonly count: number };
  const branches = database.prepare(
    "SELECT count(*) AS count FROM city_branch_commits WHERE kind = 'selection'",
  ).get() as { readonly count: number };
  return { selections: selections.count, branches: branches.count };
}

function boundaryPorts(): CitySelectionApplicationPorts {
  const frontier: CityFrontierSelectionAuthorityPort = Object.freeze({
    async loadCurrentTerminalSelectionAuthority() {
      throw new Error("unused_terminal_authority");
    },
  });
  const writer: CitySelectionWriterPort = Object.freeze({
    async publishSelection() {
      throw new Error("unused_writer");
    },
    async loadSelectionWithBranchVerified() {
      throw new Error("unused_writer");
    },
    async listSelectionsWithBranchesVerified() {
      return Object.freeze([]);
    },
  });
  const integrity: CityDecisionIntegrity = Object.freeze({
    canonical(value: unknown) {
      return JSON.stringify(value);
    },
    hash() {
      return "a".repeat(64);
    },
  });
  return { frontier, writer, integrity, clock: () => new Date("2026-01-07T00:00:00.000Z") };
}

describe("City Selection application boundary", () => {
  test("exposes the exact frozen Task 15 factory and closed public input", () => {
    // Break caught: composition or callers constructing Task 15 with leaked internal authority.
    expectTypeOf<SelectCityInput>().toEqualTypeOf<{
      readonly terminalCityShortlistSnapshotId: string;
      readonly cityId: string;
      readonly commandId: string;
      readonly warningCopyVersion?: "city-unknown-risk@1";
    }>();
    expectTypeOf(createCitySelectionApplication).toEqualTypeOf<(
      ports: CitySelectionApplicationPorts,
    ) => Readonly<CitySelectionApplication>>();

    const application = createCitySelectionApplication(boundaryPorts());

    expect(Reflect.ownKeys(application)).toEqual(["selectCity"]);
    expect(Object.isFrozen(application)).toBe(true);
    expect(UNUSED_WORKER).toBeTypeOf("function");
  });

  test("rejects extra constructible ports before any callback can run", () => {
    // Break caught: an outward or caller-controlled dependency silently entering the use case.
    expect(() => createCitySelectionApplication({
      ...boundaryPorts(),
      model: Object.freeze({}),
    } as unknown as CitySelectionApplicationPorts)).toThrowError("integrity_mismatch");
  });

  test("imports only inward authorities and stops on legacy authority before clock or writer", async () => {
    // Break caught: Task 15 importing an adapter or continuing after Task 14's Catalog gate.
    const source = readFileSync(
      join(process.cwd(), "src/application/city-selection.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["'][^"']*infrastructure/);
    let clockCalls = 0;
    let writerCalls = 0;
    const ports = boundaryPorts();
    const application = createCitySelectionApplication({
      ...ports,
      frontier: Object.freeze({
        async loadCurrentTerminalSelectionAuthority() {
          throw new Error("city_catalog_upgrade_required");
        },
      }),
      writer: Object.freeze({
        ...ports.writer,
        async publishSelection() {
          writerCalls += 1;
          throw new Error("must_not_write");
        },
      }),
      clock: () => {
        clockCalls += 1;
        return new Date("2026-01-07T00:00:00.000Z");
      },
    });

    await expect(application.selectCity({
      terminalCityShortlistSnapshotId: "city-frontier-revision:legacy-terminal",
      cityId: "alpha",
      commandId: "command:legacy-application",
    })).rejects.toThrowError("city_catalog_upgrade_required");
    expect({ clockCalls, writerCalls }).toEqual({ clockCalls: 0, writerCalls: 0 });
  });

  test("derives authority, constructs once, publishes once and requires the post-write history pair", async () => {
    // Break caught: caller authority, duplicate clock/wrapper/write, or returning before verified reload.
    const fixture = pairFixture();
    const calls = { authority: [] as string[], writer: 0, clock: 0 };
    let stored: CitySelectionWithBranch | undefined;
    const frontier = Object.freeze({
      async loadCurrentTerminalSelectionAuthority(id: string) {
        calls.authority.push(id);
        return Object.freeze({
          readModel: Object.freeze({
            ...fixture.readModel,
            selections: Object.freeze(stored === undefined ? [] : [stored]),
          }),
          terminal: fixture.terminal,
          ranking: fixture.ranking,
          preCityBranch: fixture.preCityBranch,
          preCitySource: fixture.preCitySource,
          frontier: fixture.frontier,
        });
      },
    });
    const writer: CitySelectionWriterPort = Object.freeze({
      async publishSelection(value: CitySelectionPublication) {
        calls.writer += 1;
        stored = value.pair;
        return value.pair;
      },
      async loadSelectionWithBranchVerified() {
        throw new Error("unexpected_by_id_load");
      },
      async listSelectionsWithBranchesVerified() {
        return Object.freeze(stored === undefined ? [] : [stored]);
      },
    });
    const integrity: CityDecisionIntegrity = Object.freeze({
      canonical: fixture.integrity.canonical,
      hash: fixture.integrity.hash,
    });
    const application = createCitySelectionApplication({
      frontier,
      writer,
      integrity,
      clock: () => {
        calls.clock += 1;
        return new Date("2026-01-07T00:00:00.000Z");
      },
    });

    const result = await application.selectCity({
      terminalCityShortlistSnapshotId: fixture.terminal.id,
      cityId: "alpha",
      commandId: "command:application-alpha",
    });

    expect(calls).toEqual({
      authority: [fixture.terminal.id, fixture.terminal.id],
      writer: 1,
      clock: 1,
    });
    expect(result.selection.runId).toBe(fixture.terminal.runId);
    expect(result.selection.terminalRevisionId).toBe(fixture.terminal.id);
    expect(result.commit.parentId).toBe(fixture.preCityBranch.id);
    expect(result.readModel.selections).toEqual([{
      selection: result.selection,
      commit: result.commit,
    }]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("rejects client run, basis, parent, facts and wrong warning presence before authority", async () => {
    // Break caught: caller-owned semantic authority entering the closed Select command.
    let authorityCalls = 0;
    const ports = boundaryPorts();
    const application = createCitySelectionApplication({
      ...ports,
      frontier: Object.freeze({
        async loadCurrentTerminalSelectionAuthority() {
          authorityCalls += 1;
          throw new Error("must_not_reach_authority");
        },
      }),
    });
    const base = {
      terminalCityShortlistSnapshotId: "city-frontier-revision:terminal",
      cityId: "alpha",
      commandId: "command:closed",
    };
    for (const key of ["runId", "basis", "parentId", "facts"] as const) {
      await expect(application.selectCity({
        ...base,
        [key]: key === "facts" ? [] : "caller-authority",
      } as unknown as SelectCityInput)).rejects.toThrowError("integrity_mismatch");
    }
    await expect(application.selectCity({
      ...base,
      warningCopyVersion: "city-unknown-risk@999",
    } as unknown as SelectCityInput)).rejects.toThrowError("integrity_mismatch");
    expect(authorityCalls).toBe(0);
  });
});

describe("SQLite City Selection writer boundary", () => {
  test("reports a missing selection by ID without accepting caller context", async () => {
    // Break caught: load-by-ID trusting runId/browser context or leaking an empty structural result.
    const writer = emptyWriter();

    await expect(writer.loadSelectionWithBranchVerified("city-selection:missing"))
      .rejects.toThrowError("city_selection_not_found");
    await expect(writer.loadSelectionWithBranchVerified({
      citySelectionSnapshotId: "city-selection:missing",
      runId: "caller-run",
    } as unknown as string)).rejects.toThrowError("integrity_mismatch");
  });

  test("rejects non-exact publication and timestamp-free intent envelopes before dependencies", async () => {
    // Break caught: future public Select fields silently entering command idempotency equality.
    const writer = emptyWriter();
    const shell = {
      commandId: "command:select-alpha",
      intent: {
        terminalCityShortlistSnapshotId: "city-frontier-revision:terminal",
        cityId: "alpha",
      },
      pair: { selection: { runId: "city-frontier:run-1" }, commit: {} },
    };

    await expect(writer.publishSelection({
      ...shell,
      basis: Object.freeze([]),
    } as unknown as CitySelectionPublication)).rejects.toThrowError("integrity_mismatch");
    await expect(writer.publishSelection({
      ...shell,
      intent: { ...shell.intent, commandId: "nested-command" },
    } as unknown as CitySelectionPublication)).rejects.toThrowError("integrity_mismatch");
  });

  test("rejects candidate drift on a command miss without inserting either sibling", async () => {
    // Break caught: a command miss persisting caller-drifted pair bytes before structural replay.
    const { database, fixture, writer } = writerFixture();
    const drifted = structuredClone(publication(
      fixture,
      "alpha",
      "command:drifted-miss",
      "2026-01-07T00:00:00.000Z",
    ));
    (drifted.pair.selection as { cityId: string }).cityId = "beta";

    await expect(writer.publishSelection(drifted))
      .rejects.toThrowError("integrity_mismatch");
    expect(rowCounts(database)).toEqual({ selections: 0, branches: 0 });
  });

  test("atomically publishes and reloads one verified Selection/Branch pair as fresh frozen data", async () => {
    // Break caught: independently persisted siblings or by-ID returning stored aliases.
    const { database, fixture, writer } = writerFixture();
    const input = publication(
      fixture,
      "alpha",
      "command:select-alpha",
      "2026-01-07T00:00:00.000Z",
    );

    const published = await writer.publishSelection(input);
    const loaded = await writer.loadSelectionWithBranchVerified(published.selection.id);

    expect(published).toEqual(input.pair);
    expect(loaded).toEqual(published);
    expect(loaded).not.toBe(published);
    expect(loaded.selection).not.toBe(published.selection);
    expect(rowCounts(database)).toEqual({ selections: 1, branches: 1 });
    expect(loaded.commit.citySelectionSnapshotId).toBe(loaded.selection.id);
    expect(loaded.commit.parentId).toBe(fixture.preCityBranch.id);
    expect(loaded.commit.forkedFrom).toBe(fixture.preCityBranch.id);
    recursivelyFrozen(published);
    recursivelyFrozen(loaded);
  });

  test("keys idempotency by derived run plus command and ignores all candidate bytes on a hit", async () => {
    // Break caught: candidate timestamp/ID entering hit equality or changed intent reusing a command.
    const { database, fixture, writer } = writerFixture();
    const first = publication(
      fixture,
      "alpha",
      "command:stable",
      "2026-01-07T00:00:00.000Z",
    );
    const later = publication(
      fixture,
      "alpha",
      "command:stable",
      "2026-01-08T00:00:00.000Z",
    );
    const hostileHit = structuredClone(later) as unknown as Record<string, unknown>;
    ((hostileHit.pair as Record<string, unknown>).selection as Record<string, unknown>)
      .createdAt = "not-an-instant";

    const winner = await writer.publishSelection(first);
    const retry = await writer.publishSelection(hostileHit as unknown as CitySelectionPublication);
    const conflict = publication(
      fixture,
      "beta",
      "command:stable",
      "2026-01-09T00:00:00.000Z",
    );

    expect(retry).toEqual(winner);
    expect(retry.selection.createdAt).toBe("2026-01-07T00:00:00.000Z");
    await expect(writer.publishSelection(conflict)).rejects.toThrowError("integrity_mismatch");
    expect(rowCounts(database)).toEqual({ selections: 1, branches: 1 });
  });

  test("rejects legacy Catalog rules on both command miss and exact stored hit before writes", async () => {
    // Break caught: Application-only upgrade gating allowing direct writer bypass or replay.
    const legacy = writerFixture("city-catalog@1");
    const legacyInput = publication(
      legacy.fixture,
      "alpha",
      "command:legacy-miss",
      "2026-01-07T00:00:00.000Z",
    );
    await expect(legacy.writer.publishSelection(legacyInput))
      .rejects.toThrowError("city_catalog_upgrade_required");
    expect(rowCounts(legacy.database)).toEqual({ selections: 0, branches: 0 });

    const current = writerFixture();
    const currentInput = publication(
      current.fixture,
      "alpha",
      "command:legacy-hit",
      "2026-01-07T00:00:00.000Z",
    );
    await current.writer.publishSelection(currentInput);
    (current.fixture.catalogBundle.catalog as { rulesVersion: string }).rulesVersion =
      "city-catalog@1";
    await expect(current.writer.publishSelection(structuredClone(currentInput)))
      .rejects.toThrowError("city_catalog_upgrade_required");
    expect(rowCounts(current.database)).toEqual({ selections: 1, branches: 1 });
  });

  test.each([
    [
      "before Selection",
      `CREATE TRIGGER task15_fail_before_selection
       BEFORE INSERT ON city_selection_snapshots
       BEGIN SELECT RAISE(ABORT, 'task15_fail_before_selection'); END`,
    ],
    [
      "between Selection and Branch",
      `CREATE TRIGGER task15_fail_before_branch
       BEFORE INSERT ON city_branch_commits WHEN NEW.kind = 'selection'
       BEGIN SELECT RAISE(ABORT, 'task15_fail_before_branch'); END`,
    ],
    [
      "after Branch",
      `CREATE TRIGGER task15_fail_after_branch
       AFTER INSERT ON city_branch_commits WHEN NEW.kind = 'selection'
       BEGIN SELECT RAISE(ABORT, 'task15_fail_after_branch'); END`,
    ],
  ] as const)("rolls back both siblings when failure is injected %s", async (_label, sql) => {
    // Break caught: a Selection or selection-kind Branch surviving alone.
    const { database, fixture, writer } = writerFixture();
    database.exec(sql);

    await expect(writer.publishSelection(publication(
      fixture,
      "alpha",
      "command:rollback",
      "2026-01-07T00:00:00.000Z",
    ))).rejects.toThrowError("integrity_mismatch");

    expect(rowCounts(database)).toEqual({ selections: 0, branches: 0 });
  });

  test("rolls back both siblings when verified reload fails after Branch insertion", async () => {
    // Break caught: committing siblings before the final loaded-pair authority check succeeds.
    const database = openEvidenceDatabase(":memory:");
    databases.push(database);
    const fixture = pairFixture();
    seedRankingLocator(database, fixture);
    let frontierLoads = 0;
    const writer = new SqliteCitySelectionWriter(database, fixture.integrity, {
      catalogs: {
        loadVerified: () => structuredClone(fixture.catalogBundle) as never,
      },
      branches: {
        loadPreCityBranchVerified: () => structuredClone(fixture.preCityBranch),
      },
      rankings: {
        loadRankingVerified: () => structuredClone(fixture.ranking),
      },
      frontier: {
        loadRevisionVerified: () => {
          frontierLoads += 1;
          if (frontierLoads === 2) throw new Error("injected_reload_failure");
          return structuredClone(fixture.terminal);
        },
      },
    });

    await expect(writer.publishSelection(publication(
      fixture,
      "alpha",
      "command:reload-rollback",
      "2026-01-07T00:00:00.000Z",
    ))).rejects.toThrowError("integrity_mismatch");
    expect(frontierLoads).toBe(2);
    expect(rowCounts(database)).toEqual({ selections: 0, branches: 0 });
  });

  test("orders verified sibling history by createdAt then Selection ID independent of insert order", async () => {
    // Break caught: rowid/insertion order leaking into structural or presented history.
    const { fixture, writer } = writerFixture();
    const createdAt = "2026-01-07T00:00:00.000Z";
    const beta = publication(fixture, "beta", "command:order-beta", createdAt);
    const alpha = publication(fixture, "alpha", "command:order-alpha", createdAt);
    await writer.publishSelection(beta);
    await writer.publishSelection(alpha);

    const listed = await writer.listSelectionsWithBranchesVerified(RUN_ID);
    const expected = [alpha.pair, beta.pair]
      .sort((left, right) => left.selection.id.localeCompare(right.selection.id));

    expect(listed.map(({ selection }) => selection.id))
      .toEqual(expected.map(({ selection }) => selection.id));
    expect(listed.map(({ commit }) => commit.parentId))
      .toEqual([fixture.preCityBranch.id, fixture.preCityBranch.id]);
    recursivelyFrozen(listed);
  });

  test("rejects tampered row mirrors and duplicate sibling commits on verified load", async () => {
    // Break caught: HMAC-valid payload authority masking relational duplication or mirror drift.
    const first = writerFixture();
    const stored = await first.writer.publishSelection(publication(
      first.fixture,
      "alpha",
      "command:tamper",
      "2026-01-07T00:00:00.000Z",
    ));
    first.database.exec("DROP TRIGGER city_selection_snapshots_no_update");
    first.database.prepare(
      "UPDATE city_selection_snapshots SET city_id = 'beta' WHERE id = ?",
    ).run(stored.selection.id);
    await expect(first.writer.loadSelectionWithBranchVerified(stored.selection.id))
      .rejects.toThrowError("integrity_mismatch");

    const second = writerFixture();
    const duplicated = await second.writer.publishSelection(publication(
      second.fixture,
      "alpha",
      "command:duplicate",
      "2026-01-07T00:00:00.000Z",
    ));
    second.database.exec("DROP INDEX city_branch_commits_one_selection");
    second.database.prepare(`
      INSERT INTO city_branch_commits (
        id, kind, profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, country_code,
        resolved_country_entry_digest, city_id, parent_id, forked_from,
        selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
      ) SELECT ?, kind, profile_snapshot_id, preference_profile_snapshot_id,
        resolved_country_shortlist_revision_id, country_code,
        resolved_country_entry_digest, city_id, parent_id, forked_from,
        selection_snapshot_id, schema_version, payload_json, payload_hash, hmac, created_at
      FROM city_branch_commits WHERE selection_snapshot_id = ?
    `).run(`city-branch:${"f".repeat(64)}`, duplicated.selection.id);
    await expect(second.writer.loadSelectionWithBranchVerified(duplicated.selection.id))
      .rejects.toThrowError("integrity_mismatch");
  });

  test("separate connections converge identical commands and conflict on changed remainder", async () => {
    // Break caught: native UNIQUE/BUSY leakage or two winners across real SQLite connections.
    const run = async (
      left: (fixture: PairFixture) => CitySelectionPublication,
      right: (fixture: PairFixture) => CitySelectionPublication,
    ) => {
      const directory = mkdtempSync(join(tmpdir(), "task15-city-selection-"));
      temporaryDirectories.push(directory);
      const databasePath = join(directory, "selection.sqlite");
      const database = openEvidenceDatabase(databasePath);
      const fixture = pairFixture();
      seedRankingLocator(database, fixture);
      database.close();
      const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
      const common = {
        databasePath,
        integrityKey: WRITER_KEY,
        gate,
        catalogBundle: fixture.catalogBundle,
        terminal: fixture.terminal,
        ranking: fixture.ranking,
        preCityBranch: fixture.preCityBranch,
      };
      const workers = [
        citySelectionPublicationWorker<CitySelectionWithBranch>({
          ...common,
          publication: left(fixture),
        }),
        citySelectionPublicationWorker<CitySelectionWithBranch>({
          ...common,
          publication: right(fixture),
        }),
      ];
      await Promise.all(workers.map(({ ready }) => ready));
      const state = new Int32Array(gate);
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1, 2);
      const outcomes = await Promise.allSettled(workers.map(({ result }) => result));
      await Promise.all(workers.map(({ terminate }) => terminate()));
      const verified = new Database(databasePath);
      const counts = rowCounts(verified);
      verified.close();
      return { outcomes, counts };
    };

    const identical = await run(
      (fixture) => publication(
        fixture,
        "alpha",
        "command:race-identical",
        "2026-01-07T00:00:00.000Z",
      ),
      (fixture) => publication(
        fixture,
        "alpha",
        "command:race-identical",
        "2026-01-08T00:00:00.000Z",
      ),
    );
    expect(identical.outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
    const identicalValues = identical.outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<CitySelectionWithBranch> =>
        outcome.status === "fulfilled")
      .map(({ value }) => value.selection.id);
    expect(new Set(identicalValues).size).toBe(1);
    expect(identical.counts).toEqual({ selections: 1, branches: 1 });

    const changed = await run(
      (fixture) => publication(
        fixture,
        "alpha",
        "command:race-conflict",
        "2026-01-07T00:00:00.000Z",
      ),
      (fixture) => publication(
        fixture,
        "beta",
        "command:race-conflict",
        "2026-01-07T00:00:00.000Z",
      ),
    );
    expect(changed.outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = changed.outcomes.find(({ status }) => status === "rejected") as
      PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(Error);
    expect((rejected.reason as Error).message).toBe("integrity_mismatch");
    expect((rejected.reason as Error).message).not.toMatch(/SQLITE_(?:BUSY|CONSTRAINT)/);
    expect(changed.counts).toEqual({ selections: 1, branches: 1 });
  });
});
