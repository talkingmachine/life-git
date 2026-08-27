import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildCityCatalogRevision, buildCityRegistryRevision } from "../../src/decision/city-catalog";
import {
  confirmCityCriteria,
  type CityCriterionEvaluatorRegistry,
  type CityCriterionId,
  type CityRankingFactInput,
  type CityUnknownReason,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import { rankCities } from "../../src/decision/city-ranker";
import { createCitySafetyEvaluator } from "../../src/decision/city-safety";
import {
  buildCityKnowledgeRevision,
  projectCityKnowledgeForRanking,
  reconstructCityKnowledgeRevision,
  type BuildCityKnowledgeInput,
  type CityKnowledgeEvidenceView,
  type CityKnowledgeFactContract,
  type CityKnowledgeFactContractTuple,
  type CityKnowledgeRevision,
} from "../../src/research/city-knowledge";
import {
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
} from "../../src/research/city-evidence";
import type { InstalledCityPackageExactKey } from "../../src/research/city-package";

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};

const integrity: CityDecisionIntegrity = {
  canonical,
  hash: (value) => createHash("sha256").update(value).digest("hex"),
};

const CHECKED_AT = "2026-03-01T12:00:09.000Z";
const CREATED_AT = "2026-03-01T12:00:10.000Z";
const NEXT_CHECKED_AT = "2026-03-02T12:00:09.000Z";
const NEXT_CREATED_AT = "2026-03-02T12:00:10.000Z";
const PACKAGE_KEY: InstalledCityPackageExactKey = {
  countryCode: "SI",
  packageId: "si-cities",
  packageSchemaVersion: "si-cities@1",
  catalogRevisionId: "catalog:1",
  evidenceRulesVersion: "si-city-evidence@1",
};
const CONTRACTS: CityKnowledgeFactContractTuple = [
  {
    ...SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
    scope: "municipality:061",
    officialAreaId: "061",
  },
  {
    sourceId: "si-city-long-term-rent", criterionId: "long_term_rent",
    definitionId: "si-rent@1", scope: "settlement:061001", geoScope: "settlement",
    officialAreaId: "061001", unit: "eur_per_month", denominator: "dwelling",
    freshnessPolicyVersion: "monthly@1",
  },
  {
    sourceId: "si-city-urban-transit", criterionId: "urban_transit",
    definitionId: "si-transit@1", scope: "settlement:061001", geoScope: "settlement",
    officialAreaId: "061001", unit: "stops_per_10000_residents", denominator: "settlement_population",
    freshnessPolicyVersion: "daily@1",
  },
  {
    sourceId: "si-city-fixed-broadband", criterionId: "fixed_broadband",
    definitionId: "si-broadband@1", scope: "settlement:061001", geoScope: "settlement",
    officialAreaId: "061001", unit: "percent", denominator: "households",
    freshnessPolicyVersion: "quarterly@1",
  },
];

function claim(
  contract: CityKnowledgeFactContract,
  index: number,
): CityKnowledgeEvidenceView["genericEvidence"]["snapshot"]["claims"][number] {
  return {
    sourceId: contract.sourceId,
    criterionId: contract.criterionId,
    definitionId: contract.definitionId,
    scope: contract.scope,
    officialAreaId: contract.officialAreaId,
    geoScope: contract.geoScope,
    unit: contract.unit,
    denominator: contract.denominator,
    freshnessPolicyVersion: contract.freshnessPolicyVersion,
    sourcePeriod: contract.criterionId === "safety" ? "2025" : "2026-02",
    value: contract.criterionId === "safety"
      ? { kind: "municipal_safety" as const, quantity: {
          offenceCount: "1434", population: "56978",
          rateBasis: "offences_per_100000_residents" as const,
        } }
      : { kind: "canonical_scalar" as const, value: String(index + 1) },
    anchor: {
      artifactId: `${contract.sourceId}:artifact`,
      locator: `https://official.example/${contract.sourceId}#fact`,
      excerptSha256: String(index + 1).repeat(64),
    },
  };
}

function evidence(
  unknown: Partial<Record<CityCriterionId, CityUnknownReason>> = {},
): CityKnowledgeEvidenceView {
  const claims = CONTRACTS.flatMap((contract, index) => unknown[contract.criterionId] === undefined
    ? [claim(contract, index)]
    : []);
  const blockers = CONTRACTS.flatMap((contract) => {
    const reason = unknown[contract.criterionId];
    return reason === undefined ? [] : [{
      sourceId: contract.sourceId,
      kind: reason,
      navigationUrl: `https://official.example/${contract.sourceId}`,
      resolvedUrl: `https://official.example/${contract.sourceId}/reviewed`,
      artifactIds: [`${contract.sourceId}:artifact`],
    }];
  });
  const coverage = Object.fromEntries(CONTRACTS.map((contract) => [
    contract.sourceId,
    unknown[contract.criterionId] === undefined ? "verified" : "unavailable",
  ])) as Record<(typeof SLOVENIA_CITY_FACT_SOURCE_IDS)[number], "verified" | "unavailable">;
  const genericSnapshot = {
    id: "city-check:1:evidence", claims, blockers, coverage,
  };
  const entries = CONTRACTS.map((contract) => ({
    sourceId: contract.sourceId,
    navigationUrl: `https://official.example/${contract.sourceId}`,
    resolvedEvidenceUrl: `https://official.example/${contract.sourceId}/reviewed`,
    artifactIds: [`${contract.sourceId}:artifact`],
  }));
  return {
    snapshot: {
      id: "city-check:1:evidence", cityId: "si:ljubljana", countryCode: "SI",
      packageId: "si-cities", packageSchemaVersion: "si-cities@1", catalogRevisionId: "catalog:1",
      evidenceRulesVersion: "si-city-evidence@1", completedAt: CHECKED_AT,
    },
    genericEvidence: {
      snapshot: genericSnapshot,
      manifest: {
        entries,
        artifacts: CONTRACTS.map((contract) => ({
          artifactId: `${contract.sourceId}:artifact`, sourceId: contract.sourceId,
        })),
      },
      entries: CONTRACTS.map((contract) => ({
        sourceId: contract.sourceId,
        navigationUrl: `https://official.example/${contract.sourceId}`,
        resolvedEvidenceUrl: `https://official.example/${contract.sourceId}/reviewed`,
        artifacts: [{
          artifactId: `${contract.sourceId}:artifact`, sourceId: contract.sourceId,
        }],
      })),
    },
  };
}

function input(currentEvidence = evidence(), predecessor?: CityKnowledgeRevision): BuildCityKnowledgeInput {
  return {
    packageKey: PACKAGE_KEY,
    evidence: currentEvidence,
    factContracts: CONTRACTS,
    createdAt: CREATED_AT,
    ...(predecessor === undefined ? {} : { predecessor }),
  };
}

type Mutable<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly [unknown, ...unknown[]]
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T extends readonly (infer Item)[]
      ? Mutable<Item>[]
      : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutable<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function checkedEvidence(
  current = evidence(),
  checkedAt = NEXT_CHECKED_AT,
): Mutable<CityKnowledgeEvidenceView> {
  const next = mutable(current);
  next.snapshot.id = "city-check:2:evidence";
  next.snapshot.completedAt = checkedAt;
  next.genericEvidence.snapshot.id = next.snapshot.id;
  return next;
}

function sourceIndex(sourceId: string): number {
  return SLOVENIA_CITY_FACT_SOURCE_IDS.indexOf(sourceId as never);
}

function reconstruct(
  revision: CityKnowledgeRevision,
  currentEvidence: CityKnowledgeEvidenceView,
  predecessor?: CityKnowledgeRevision,
  packageKey: InstalledCityPackageExactKey = PACKAGE_KEY,
  factContracts: CityKnowledgeFactContractTuple = CONTRACTS,
): CityKnowledgeRevision {
  return reconstructCityKnowledgeRevision({
    revision,
    packageKey,
    evidence: currentEvidence,
    factContracts,
    ...(predecessor === undefined ? {} : { predecessor }),
  }, integrity);
}

function realRankerFixture() {
  const safety = createCitySafetyEvaluator({ zeroScoreBoundary: "10000" });
  const fixedEvaluators = Object.fromEntries(CONTRACTS.slice(1).map((contract) => [
    contract.criterionId,
    {
      definition: {
        criterionId: contract.criterionId,
        definitionId: contract.definitionId,
        direction: "at_least" as const,
        unit: contract.unit,
        denominator: contract.denominator,
        compatibleGeoScopes: [contract.geoScope],
        freshnessPolicyVersion: contract.freshnessPolicyVersion,
        evaluatorVersion: `${contract.criterionId}-evaluator@1`,
      },
      canonicalizeTarget: (target: unknown) => String(target),
      evaluate: ({ fact }: { readonly fact: CityRankingFactInput }) =>
        fact.outcome.kind === "unknown"
          ? { state: "unknown" as const, factor: "0", targetComparison: "unknown" as const,
              unknownReason: fact.outcome.reason }
          : { state: "verified" as const, factor: "1", targetComparison: "matches" as const },
    },
  ]));
  const evaluators = { safety, ...fixedEvaluators } as CityCriterionEvaluatorRegistry;
  const criteria = confirmCityCriteria({
    draft: CONTRACTS.map((contract, index) => ({
      criterionId: contract.criterionId,
      definitionId: contract.definitionId,
      mode: contract.criterionId === "safety" ? "required" : "weighted",
      importance: (index + 1) as 1 | 2 | 3 | 4,
      target: contract.criterionId === "safety" ? "3000" : "1",
    })),
    profileSnapshotId: "profile:1",
    preferenceProfileSnapshotId: "preferences:1",
    confirmedAt: "2026-03-01T00:00:00.000Z",
  }, evaluators, integrity);
  const registry = buildCityRegistryRevision({
    packageId: PACKAGE_KEY.packageId,
    packageSchemaVersion: PACKAGE_KEY.packageSchemaVersion,
    countryCode: PACKAGE_KEY.countryCode,
    evidenceSnapshotId: "catalog-evidence:1",
    createdAt: "2026-03-01T00:00:00.000Z",
    entries: [{
      cityId: "si:ljubljana",
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.0569, lng: 14.5058 },
      administrativeType: "municipality",
      administrativeTerritory: "061",
      capitalRoles: ["national" as const],
      evidenceReferenceIds: ["registry:ljubljana"],
    }],
  }, integrity);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: "catalog-evidence:1",
    populationDefinition: { definitionId: "si-population@1", geoScope: "municipality", unit: "people" },
    candidateBasis: [{
      cityId: "si:ljubljana",
      comparablePopulation: { kind: "verified" as const, value: "300000", referencePeriod: "2025" },
    }],
    coverage: { status: "complete" },
    createdAt: "2026-03-01T00:00:00.000Z",
  }, integrity);
  return { evaluators, criteria, registry, catalog };
}

describe("City Knowledge", () => {
  it("builds exactly four current verified facts and a ranking-only projection", () => {
    const revision = buildCityKnowledgeRevision(input(), integrity);
    expect(revision).toMatchObject({
      schemaVersion: "city-knowledge@1", cityId: "si:ljubljana", countryCode: "SI",
      packageId: "si-cities", packageSchemaVersion: "si-cities@1", rulesVersion: "si-city-evidence@1",
      evidenceSnapshotId: "city-check:1:evidence", lastCheckedAt: CHECKED_AT,
      knowledgeUpdatedAt: CHECKED_AT, createdAt: CREATED_AT,
    });
    expect(revision.facts.map(({ criterionId }) => criterionId)).toEqual([
      "safety", "long_term_rent", "urban_transit", "fixed_broadband",
    ]);
    expect(revision.facts.every(({ evidenceRefs }) => evidenceRefs.length > 0)).toBe(true);
    expect(revision.facts[0]!.outcome).toEqual({
      kind: "verified",
      basis: { kind: "municipal_safety", quantity: { offenceCount: "1434", population: "56978", rateBasis: "offences_per_100000_residents" } },
    });
    expect(revision.facts[0]!.evidenceRefs[0]).toMatchObject({
      kind: "claim", sourceId: "si-city-safety", artifactId: "si-city-safety:artifact",
      excerptHash: "1".repeat(64),
    });
    const projection = projectCityKnowledgeForRanking(revision);
    expect(projection).toEqual({
      cityId: "si:ljubljana",
      knowledgeRevisionId: revision.id,
      facts: revision.facts.map((fact) => ({
        criterionId: fact.criterionId,
        definitionId: fact.definitionId,
        geoScope: fact.geoScope.kind,
        referencePeriod: fact.referencePeriod,
        freshnessBasis: fact.freshnessBasis.policyVersion,
        unit: fact.unit,
        denominator: fact.denominator,
        outcome: fact.outcome,
      })),
    });
    const ranker = realRankerFixture();
    expect(rankCities({
      assessmentAt: NEXT_CHECKED_AT,
      ...ranker,
      knowledge: [projection],
    }).ordered[0]).toMatchObject({ cityId: "si:ljubljana", rank: 1, coverage: "1" });
    const serialized = JSON.stringify(revision);
    for (const forbidden of ["profile", "target", "importance", "score", "suitability", "attempts", "queries", "provider", "bytes"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.facts)).toBe(true);
    expect(Object.isFrozen(revision.facts[0]!.outcome)).toBe(true);
  });

  it.each<CityUnknownReason>(["not_found", "stale", "conflict", "not_comparable", "source_unavailable"])(
    "publishes evidence-backed unknown %s without carrying a value",
    (reason) => {
      const revision = buildCityKnowledgeRevision(input(evidence({ urban_transit: reason })), integrity);
      expect(revision.facts[2]).toEqual({
        criterionId: "urban_transit",
        definitionId: "si-transit@1",
        geoScope: { kind: "settlement", officialAreaId: "061001" },
        referencePeriod: null,
        freshnessBasis: { policyVersion: "daily@1" },
        unit: "stops_per_10000_residents",
        denominator: "settlement_population",
        outcome: { kind: "unknown", reason },
        evidenceRefs: [{
          kind: "blocker",
          sourceId: "si-city-urban-transit",
          blocker: reason,
          artifactIds: ["si-city-urban-transit:artifact"],
          navigationUrl: "https://official.example/si-city-urban-transit",
          resolvedEvidenceUrl: "https://official.example/si-city-urban-transit/reviewed",
        }],
      });
      expect(revision.facts[2]!.outcome).not.toHaveProperty("basis");
    },
  );

  it("rejects the ranking-only no_knowledge_revision reason", () => {
    const borrowed = mutable(evidence({ safety: "not_found" }));
    (borrowed.genericEvidence.snapshot.blockers[0] as { kind: string }).kind = "no_knowledge_revision";
    expect(() => buildCityKnowledgeRevision(input(borrowed), integrity)).toThrow("integrity_mismatch");
  });

  it.each([
    ["missing", (contracts: CityKnowledgeFactContract[]) => contracts.pop()],
    ["duplicate", (contracts: CityKnowledgeFactContract[]) => { contracts[3] = contracts[2]!; }],
    ["foreign", (contracts: CityKnowledgeFactContract[]) => { (contracts[2] as { criterionId: string }).criterionId = "air_quality"; }],
  ])("rejects a %s criterion contract", (_label, mutate) => {
    const borrowed = mutable(input());
    mutate(borrowed.factContracts as unknown as CityKnowledgeFactContract[]);
    expect(() => buildCityKnowledgeRevision(borrowed, integrity)).toThrow("invalid_city_knowledge_input");
  });

  it.each([
    "definitionId", "scope", "officialAreaId", "geoScope", "unit", "denominator",
    "freshnessPolicyVersion",
  ] as const)("rejects installed contract %s drift", (field) => {
    const borrowed = mutable(input());
    (borrowed.factContracts[1] as unknown as Record<string, unknown>)[field] = "wrong";
    expect(() => buildCityKnowledgeRevision(borrowed, integrity)).toThrow("integrity_mismatch");
  });

  it.each([
    "definitionId", "geoScope", "unit", "denominator", "freshnessPolicyVersion",
  ] as const)("rejects safety contract %s that differs from the installed policy", (field) => {
    const borrowed = mutable(input());
    (borrowed.factContracts[0] as unknown as Record<string, unknown>)[field] = "wrong";
    const safetyClaim = borrowed.evidence.genericEvidence.snapshot.claims[0] as unknown as Record<string, unknown>;
    safetyClaim[field] = "wrong";
    expect(() => buildCityKnowledgeRevision(borrowed, integrity)).toThrow("invalid_city_knowledge_input");
  });

  it("rejects malformed caller-owned build and contract containers", () => {
    const extraInput = mutable(input()) as unknown as Record<string, unknown>;
    extraInput.extra = true;
    expect(() => buildCityKnowledgeRevision(extraInput as unknown as BuildCityKnowledgeInput, integrity))
      .toThrow("invalid_city_knowledge_input");

    const missingInput = mutable(input()) as unknown as Record<string, unknown>;
    delete missingInput.createdAt;
    expect(() => buildCityKnowledgeRevision(missingInput as unknown as BuildCityKnowledgeInput, integrity))
      .toThrow("invalid_city_knowledge_input");

    const augmentedTuple = mutable(input());
    (augmentedTuple.factContracts as unknown as Record<string, unknown>).extra = true;
    expect(() => buildCityKnowledgeRevision(augmentedTuple, integrity)).toThrow("invalid_city_knowledge_input");

    const sparseTuple = mutable(input());
    delete (sparseTuple.factContracts as unknown as Record<string, unknown>)["2"];
    expect(() => buildCityKnowledgeRevision(sparseTuple, integrity)).toThrow("invalid_city_knowledge_input");

    const extraContract = mutable(input());
    (extraContract.factContracts[1] as unknown as Record<string, unknown>).extra = true;
    expect(() => buildCityKnowledgeRevision(extraContract, integrity)).toThrow("invalid_city_knowledge_input");

    const customContract = mutable(input());
    Object.setPrototypeOf(customContract.factContracts[1], { inherited: true });
    expect(() => buildCityKnowledgeRevision(customContract, integrity)).toThrow("invalid_city_knowledge_input");

    const symbolContract = mutable(input());
    Object.defineProperty(symbolContract.factContracts[1], Symbol("hidden"), { value: true });
    expect(() => buildCityKnowledgeRevision(symbolContract, integrity)).toThrow("invalid_city_knowledge_input");

    const accessorContract = mutable(input());
    let getterCalls = 0;
    Object.defineProperty(accessorContract.factContracts[1], "scope", {
      enumerable: true,
      get: () => { getterCalls += 1; return CONTRACTS[1].scope; },
    });
    expect(() => buildCityKnowledgeRevision(accessorContract, integrity)).toThrow("invalid_city_knowledge_input");
    expect(getterCalls).toBe(0);
  });

  it("rejects noncanonical build timestamps for first revisions", () => {
    expect(() => buildCityKnowledgeRevision({ ...input(), createdAt: "2026-03-01" }, integrity))
      .toThrow("invalid_city_knowledge_input");
    expect(() => buildCityKnowledgeRevision({
      ...input(), createdAt: "2026-03-01T12:00:08.000Z",
    }, integrity)).toThrow("invalid_city_knowledge_input");
  });

  it("requires an exact closed package key without invoking accessors", () => {
    const missing = mutable(input()) as unknown as { packageKey: Record<string, unknown> } & BuildCityKnowledgeInput;
    delete (missing.packageKey as Record<string, unknown>).catalogRevisionId;
    expect(() => buildCityKnowledgeRevision(missing, integrity)).toThrow("integrity_mismatch");

    const extra = mutable(input()) as unknown as { packageKey: Record<string, unknown> } & BuildCityKnowledgeInput;
    extra.packageKey.extra = true;
    expect(() => buildCityKnowledgeRevision(extra, integrity)).toThrow("integrity_mismatch");

    const accessor = mutable(input());
    let getterCalls = 0;
    Object.defineProperty(accessor.packageKey, "packageId", {
      enumerable: true,
      get: () => { getterCalls += 1; return PACKAGE_KEY.packageId; },
    });
    expect(() => buildCityKnowledgeRevision(accessor, integrity)).toThrow("integrity_mismatch");
    expect(getterCalls).toBe(0);
  });

  it.each([
    ["countryCode", "ZZ"],
    ["packageId", "other-package"],
    ["packageSchemaVersion", "other@1"],
    ["catalogRevisionId", "catalog:other"],
    ["evidenceRulesVersion", "other-rules@1"],
  ] as const)("rejects package key %s drift before integrity callbacks", (field, value) => {
    const borrowed = mutable(input());
    borrowed.packageKey[field] = value;
    let callbacks = 0;
    const untouched: CityDecisionIntegrity = {
      canonical: () => { callbacks += 1; return "unexpected"; },
      hash: () => { callbacks += 1; return "unexpected"; },
    };
    expect(() => buildCityKnowledgeRevision(borrowed, untouched)).toThrow("integrity_mismatch");
    expect(callbacks).toBe(0);
  });

  it.each([
    ["id", ""],
    ["cityId", ""],
    ["countryCode", "ZZ"],
    ["packageId", "other-package"],
    ["packageSchemaVersion", "other@1"],
    ["catalogRevisionId", "catalog:other"],
    ["evidenceRulesVersion", "other-rules@1"],
    ["completedAt", "2026-03-01"],
  ] as const)("rejects required Evidence snapshot %s drift before integrity callbacks", (field, value) => {
    const borrowed = mutable(input());
    (borrowed.evidence.snapshot as unknown as Record<string, unknown>)[field] = value;
    let callbacks = 0;
    const untouched: CityDecisionIntegrity = {
      canonical: () => { callbacks += 1; return "unexpected"; },
      hash: () => { callbacks += 1; return "unexpected"; },
    };
    expect(() => buildCityKnowledgeRevision(borrowed, untouched)).toThrow("integrity_mismatch");
    expect(callbacks).toBe(0);
  });

  it.each([
    ["definitionId", "wrong@1"], ["scope", "wrong"], ["geoScope", "country"], ["officialAreaId", "999"],
    ["unit", "wrong"], ["denominator", "wrong"], ["freshnessPolicyVersion", "wrong@1"],
  ] as const)("rejects claim %s drift", (field, value) => {
    const borrowed = mutable(evidence());
    (borrowed.genericEvidence.snapshot.claims[1] as unknown as Record<string, unknown>)[field] = value;
    expect(() => buildCityKnowledgeRevision(input(borrowed), integrity)).toThrow("integrity_mismatch");
  });

  it("rejects claim and blocker artifact ownership drift", () => {
    const verified = mutable(evidence());
    verified.genericEvidence.snapshot.claims[0]!.anchor.artifactId = "foreign";
    expect(() => buildCityKnowledgeRevision(input(verified), integrity)).toThrow("integrity_mismatch");
    const unknown = mutable(evidence({ fixed_broadband: "source_unavailable" }));
    unknown.genericEvidence.snapshot.blockers[0]!.artifactIds = ["foreign"];
    expect(() => buildCityKnowledgeRevision(input(unknown), integrity)).toThrow("integrity_mismatch");
  });

  it("preserves a producer-valid empty blocker artifact set", () => {
    const unavailable = mutable(evidence({ fixed_broadband: "source_unavailable" }));
    unavailable.genericEvidence.snapshot.blockers[0]!.artifactIds = [];
    const revision = buildCityKnowledgeRevision(input(unavailable), integrity);
    expect(revision.facts[3]!.evidenceRefs).toEqual([{
      kind: "blocker",
      sourceId: "si-city-fixed-broadband",
      blocker: "source_unavailable",
      artifactIds: [],
      navigationUrl: "https://official.example/si-city-fixed-broadband",
      resolvedEvidenceUrl: "https://official.example/si-city-fixed-broadband/reviewed",
    }]);
  });

  it.each([
    ["missing coverage", (view: Mutable<CityKnowledgeEvidenceView>) => {
      delete (view.genericEvidence.snapshot.coverage as Record<string, unknown>)["si-city-long-term-rent"];
    }],
    ["extra coverage", (view: Mutable<CityKnowledgeEvidenceView>) => {
      (view.genericEvidence.snapshot.coverage as Record<string, unknown>).foreign = "verified";
    }],
    ["duplicate claim", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims.push(mutable(view.genericEvidence.snapshot.claims[0]!));
    }],
    ["verified blocker", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.blockers.push({
        sourceId: "si-city-safety", kind: "not_found",
        navigationUrl: "https://official.example/si-city-safety",
        resolvedUrl: "https://official.example/si-city-safety/reviewed",
        artifactIds: ["si-city-safety:artifact"],
      });
    }],
    ["missing verified claim", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims.shift();
    }],
    ["duplicate blocker", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.blockers.push(mutable(view.genericEvidence.snapshot.blockers[0]!));
    }],
    ["unknown claim", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims.push(claim(CONTRACTS[2], 2));
    }],
    ["duplicate manifest source", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.manifest.entries.push(mutable(view.genericEvidence.manifest.entries[0]!));
    }],
    ["missing captured source", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.entries.pop();
    }],
    ["duplicate manifest artifact", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.manifest.artifacts.push(mutable(view.genericEvidence.manifest.artifacts[0]!));
    }],
    ["manifest/captured set mismatch", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.entries[1]!.artifacts = [];
    }],
  ])("rejects nonterminal Evidence shape: %s", (_label, mutateEvidence) => {
    const unavailable = _label.includes("blocker") || _label.includes("unknown")
      ? evidence({ urban_transit: "not_found" })
      : evidence();
    const borrowed = mutable(unavailable);
    mutateEvidence(borrowed);
    expect(() => buildCityKnowledgeRevision(input(borrowed), integrity)).toThrow("integrity_mismatch");
  });

  it("rejects valid artifacts owned by the wrong source", () => {
    const claimCrossSource = mutable(evidence());
    claimCrossSource.genericEvidence.snapshot.claims[0]!.anchor.artifactId =
      "si-city-long-term-rent:artifact";
    expect(() => buildCityKnowledgeRevision(input(claimCrossSource), integrity))
      .toThrow("integrity_mismatch");

    const blockerCrossSource = mutable(evidence({ fixed_broadband: "not_found" }));
    blockerCrossSource.genericEvidence.snapshot.blockers[0]!.artifactIds =
      ["si-city-urban-transit:artifact"];
    expect(() => buildCityKnowledgeRevision(input(blockerCrossSource), integrity))
      .toThrow("integrity_mismatch");
  });

  it.each([
    ["safety scalar basis", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims[0]!.value = { kind: "canonical_scalar", value: "1" };
    }],
    ["fixed municipal basis", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims[1]!.value = {
        kind: "municipal_safety",
        quantity: { offenceCount: "1", population: "100", rateBasis: "offences_per_100000_residents" },
      };
    }],
    ["invalid safety population", (view: Mutable<CityKnowledgeEvidenceView>) => {
      const basis = view.genericEvidence.snapshot.claims[0]!.value;
      if (basis.kind !== "municipal_safety") throw new Error("fixture_error");
      basis.quantity.population = "0";
    }],
    ["noncanonical scalar", (view: Mutable<CityKnowledgeEvidenceView>) => {
      const basis = view.genericEvidence.snapshot.claims[1]!.value;
      if (basis.kind !== "canonical_scalar") throw new Error("fixture_error");
      basis.value = "";
    }],
  ])("rejects %s from the verified Evidence projection", (_label, corrupt) => {
    const borrowed = mutable(evidence());
    corrupt(borrowed);
    expect(() => buildCityKnowledgeRevision(input(borrowed), integrity)).toThrow("integrity_mismatch");
  });

  it("rejects source and accepted/reviewed URL ownership drift", () => {
    const wrongClaimUrl = mutable(evidence());
    wrongClaimUrl.genericEvidence.entries[0]!.resolvedEvidenceUrl = "https://official.example/wrong";
    expect(() => buildCityKnowledgeRevision(input(wrongClaimUrl), integrity)).toThrow("integrity_mismatch");

    const wrongBlockerUrl = mutable(evidence({ safety: "not_found" }));
    wrongBlockerUrl.genericEvidence.snapshot.blockers[0]!.resolvedUrl = "https://official.example/wrong";
    expect(() => buildCityKnowledgeRevision(input(wrongBlockerUrl), integrity)).toThrow("integrity_mismatch");
  });

  it("does not traverse irrelevant verified Evidence fields", () => {
    const view = mutable(evidence()) as unknown as {
      snapshot: Record<string, unknown>;
      genericEvidence: CityKnowledgeEvidenceView["genericEvidence"];
    };
    let getterCalls = 0;
    for (const key of ["fixedAttemptLedgers", "safetyAttemptLedger"] as const) {
      Object.defineProperty(view.snapshot, key, {
        enumerable: true,
        get: () => { getterCalls += 1; throw new Error("irrelevant_getter_invoked"); },
      });
    }
    const artifact = view.genericEvidence.entries[0]!.artifacts[0]! as unknown as Record<string, unknown>;
    Object.defineProperty(artifact, "bytes", {
      enumerable: true,
      get: () => { getterCalls += 1; throw new Error("irrelevant_getter_invoked"); },
    });
    const revision = buildCityKnowledgeRevision(input(view as CityKnowledgeEvidenceView), integrity);
    expect(revision.cityId).toBe("si:ljubljana");
    expect(getterCalls).toBe(0);
  });

  it.each([
    ["required getter", (borrowed: Mutable<BuildCityKnowledgeInput>, touched: () => void) => {
      Object.defineProperty(borrowed.evidence.snapshot, "packageId", {
        enumerable: true,
        get: () => { touched(); return PACKAGE_KEY.packageId; },
      });
    }],
    ["required symbol", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      Object.defineProperty(borrowed.evidence.genericEvidence.snapshot.coverage, Symbol("hidden"), {
        enumerable: true, value: "verified",
      });
    }],
    ["non-enumerable required field", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      Object.defineProperty(borrowed.evidence.snapshot, "cityId", {
        enumerable: false, value: "si:ljubljana",
      });
    }],
    ["sparse selected array", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      delete (borrowed.evidence.genericEvidence.manifest.entries as unknown as
        Record<string, unknown>)["1"];
    }],
    ["augmented selected array", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      (borrowed.evidence.genericEvidence.entries as unknown as Record<string, unknown>).extra = true;
    }],
    ["custom selected prototype", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      Object.setPrototypeOf(borrowed.evidence.genericEvidence.snapshot.coverage, { inherited: true });
    }],
    ["selected cycle", (borrowed: Mutable<BuildCityKnowledgeInput>) => {
      const basis = borrowed.evidence.genericEvidence.snapshot.claims[0]!.value;
      if (basis.kind !== "municipal_safety") throw new Error("fixture_error");
      (basis.quantity as unknown as Record<string, unknown>).population = basis.quantity;
    }],
  ])("rejects descriptor-unsafe %s without invoking getters or integrity", (_label, corrupt) => {
    const borrowed = mutable(input());
    let getterCalls = 0;
    let integrityCalls = 0;
    corrupt(borrowed, () => { getterCalls += 1; });
    const untouched: CityDecisionIntegrity = {
      canonical: () => { integrityCalls += 1; return "unexpected"; },
      hash: () => { integrityCalls += 1; return "unexpected"; },
    };
    expect(() => buildCityKnowledgeRevision(borrowed, untouched)).toThrow("integrity_mismatch");
    expect(getterCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  it("preserves update time for the same semantics even when Evidence references change", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence();
    const index = sourceIndex("si-city-safety");
    const newArtifactId = "si-city-safety:artifact:replacement";
    const newNavigationUrl = "https://official.example/si-city-safety/accepted";
    const newResolvedUrl = "https://official.example/si-city-safety/reviewed-v2";
    nextEvidence.genericEvidence.snapshot.claims[0]!.anchor = {
      artifactId: newArtifactId,
      locator: "https://official.example/new#fact",
      excerptSha256: "f".repeat(64),
    };
    nextEvidence.genericEvidence.manifest.entries[index]!.artifactIds = [newArtifactId];
    nextEvidence.genericEvidence.manifest.entries[index]!.navigationUrl = newNavigationUrl;
    nextEvidence.genericEvidence.manifest.entries[index]!.resolvedEvidenceUrl = newResolvedUrl;
    nextEvidence.genericEvidence.manifest.artifacts[index]!.artifactId = newArtifactId;
    nextEvidence.genericEvidence.entries[index]!.navigationUrl = newNavigationUrl;
    nextEvidence.genericEvidence.entries[index]!.resolvedEvidenceUrl = newResolvedUrl;
    nextEvidence.genericEvidence.entries[index]!.artifacts[0]!.artifactId = newArtifactId;
    const next = buildCityKnowledgeRevision({
      ...input(nextEvidence, first), createdAt: NEXT_CREATED_AT,
    }, integrity);
    expect(next.predecessorRevisionId).toBe(first.id);
    expect(next.lastCheckedAt).toBe(NEXT_CHECKED_AT);
    expect(next.knowledgeUpdatedAt).toBe(first.knowledgeUpdatedAt);
    expect(next.facts[0]!.evidenceRefs).not.toEqual(first.facts[0]!.evidenceRefs);
  });

  it("excludes source scope and package/rules lineage from semantic update equality", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence();
    nextEvidence.snapshot.packageId = "si-cities-v2";
    nextEvidence.snapshot.packageSchemaVersion = "si-cities@2";
    nextEvidence.snapshot.catalogRevisionId = "catalog:2";
    nextEvidence.snapshot.evidenceRulesVersion = "si-city-evidence@2";
    const nextKey = {
      countryCode: "SI",
      packageId: "si-cities-v2",
      packageSchemaVersion: "si-cities@2",
      catalogRevisionId: "catalog:2",
      evidenceRulesVersion: "si-city-evidence@2",
    } as const;
    const nextContracts = mutable(CONTRACTS) as unknown as CityKnowledgeFactContractTuple;
    (nextContracts[1] as unknown as { scope: string }).scope = "settlement:061001:reconstructed-v2";
    nextEvidence.genericEvidence.snapshot.claims[1]!.scope = nextContracts[1].scope;
    const next = buildCityKnowledgeRevision({
      packageKey: nextKey,
      evidence: nextEvidence,
      factContracts: nextContracts,
      predecessor: first,
      createdAt: NEXT_CREATED_AT,
    }, integrity);
    expect(next.packageId).toBe("si-cities-v2");
    expect(next.packageSchemaVersion).toBe("si-cities@2");
    expect(next.rulesVersion).toBe("si-city-evidence@2");
    expect(next.knowledgeUpdatedAt).toBe(first.knowledgeUpdatedAt);
    expect(reconstruct(next, nextEvidence, first, nextKey, nextContracts)).toEqual(next);
  });

  it.each([
    ["definition", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].definitionId = "si-rent@2";
      view.genericEvidence.snapshot.claims[1]!.definitionId = "si-rent@2";
    }],
    ["geo kind", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].geoScope = "municipality";
      view.genericEvidence.snapshot.claims[1]!.geoScope = "municipality";
    }],
    ["official area", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].officialAreaId = "061";
      view.genericEvidence.snapshot.claims[1]!.officialAreaId = "061";
    }],
    ["reference period", (view: Mutable<CityKnowledgeEvidenceView>) => {
      view.genericEvidence.snapshot.claims[1]!.sourcePeriod = "2026-03";
    }],
    ["freshness policy", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].freshnessPolicyVersion = "monthly@2";
      view.genericEvidence.snapshot.claims[1]!.freshnessPolicyVersion = "monthly@2";
    }],
    ["unit", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].unit = "eur_per_week";
      view.genericEvidence.snapshot.claims[1]!.unit = "eur_per_week";
    }],
    ["denominator", (view: Mutable<CityKnowledgeEvidenceView>, contracts: Mutable<CityKnowledgeFactContractTuple>) => {
      contracts[1].denominator = "room";
      view.genericEvidence.snapshot.claims[1]!.denominator = "room";
    }],
    ["known value", (view: Mutable<CityKnowledgeEvidenceView>) => {
      const basis = view.genericEvidence.snapshot.claims[1]!.value;
      if (basis.kind !== "canonical_scalar") throw new Error("fixture_error");
      basis.value = "999";
    }],
  ])("sets update time from the current check for a semantic %s change", (_label, change) => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence();
    const nextContracts = mutable(CONTRACTS);
    change(nextEvidence, nextContracts);
    const next = buildCityKnowledgeRevision({
      packageKey: PACKAGE_KEY,
      evidence: nextEvidence,
      factContracts: nextContracts as unknown as CityKnowledgeFactContractTuple,
      predecessor: first,
      createdAt: NEXT_CREATED_AT,
    }, integrity);
    expect(next.knowledgeUpdatedAt).toBe(NEXT_CHECKED_AT);
    expect(next.facts[1]).not.toEqual(first.facts[1]);
  });

  it("updates semantic time and drops the old basis on known-to-unknown", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence(evidence({ safety: "source_unavailable" }));
    const next = buildCityKnowledgeRevision({ ...input(nextEvidence, first), createdAt: NEXT_CREATED_AT }, integrity);
    expect(next.knowledgeUpdatedAt).toBe(next.lastCheckedAt);
    expect(next.facts[0]!.outcome).toEqual({ kind: "unknown", reason: "source_unavailable" });
    expect(next.facts[0]!.outcome).not.toHaveProperty("basis");
  });

  it("uses the content hash equation without including id in its payload", () => {
    const revision = buildCityKnowledgeRevision(input(), integrity);
    const { id, ...payload } = revision;
    expect(id).toBe(`city-knowledge:${integrity.hash(integrity.canonical(payload))}`);
    expect(Object.hasOwn(payload, "id")).toBe(false);
  });

  it("snapshots caller state before mutating and re-entrant integrity callbacks", () => {
    const borrowed = mutable(input());
    let nested: CityKnowledgeRevision | undefined;
    let canonicalCalls = 0;
    const mutatingIntegrity: CityDecisionIntegrity = {
      canonical: (value) => {
        canonicalCalls += 1;
        if (canonicalCalls === 1) {
          const safetyBasis = borrowed.evidence.genericEvidence.snapshot.claims[0]!.value;
          if (safetyBasis.kind !== "municipal_safety") throw new Error("fixture_error");
          safetyBasis.quantity.offenceCount = "999999";
          borrowed.createdAt = "2099-01-01T00:00:00.000Z";
          nested = buildCityKnowledgeRevision(input(), integrity);
        }
        return canonical(value);
      },
      hash: integrity.hash,
    };
    const revision = buildCityKnowledgeRevision(borrowed, mutatingIntegrity);
    expect(revision.createdAt).toBe(CREATED_AT);
    expect(revision.facts[0]!.outcome).toEqual({
      kind: "verified",
      basis: {
        kind: "municipal_safety",
        quantity: {
          offenceCount: "1434",
          population: "56978",
          rateBasis: "offences_per_100000_residents",
        },
      },
    });
    expect(nested?.facts[0]!.outcome).toEqual(revision.facts[0]!.outcome);
  });

  it.each([
    ["equal predecessor check", CHECKED_AT, CHECKED_AT],
    ["equal predecessor creation", CREATED_AT, NEXT_CREATED_AT],
    ["created before checked", NEXT_CHECKED_AT, "2026-03-02T12:00:08.000Z"],
  ])("rejects invalid time ordering: %s", (_label, checkedAt, createdAt) => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence(evidence(), checkedAt);
    expect(() => buildCityKnowledgeRevision({ ...input(nextEvidence, first), createdAt }, integrity))
      .toThrow("invalid_city_knowledge_input");
  });

  it("accepts equality between the current check and creation instants", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const nextEvidence = checkedEvidence(evidence(), NEXT_CHECKED_AT);
    const next = buildCityKnowledgeRevision({
      ...input(nextEvidence, first), createdAt: NEXT_CHECKED_AT,
    }, integrity);
    expect(next.lastCheckedAt).toBe(next.createdAt);
  });

  it("requires the exact same-city, same-country predecessor and validates its own hash", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const forged = mutable(first);
    forged.facts[1]!.outcome = { kind: "verified", basis: { kind: "canonical_scalar", value: "999" } };
    expect(() => buildCityKnowledgeRevision({
      ...input(checkedEvidence(), forged), createdAt: NEXT_CREATED_AT,
    }, integrity)).toThrow("invalid_city_knowledge_input");

    const otherCityEvidence = mutable(evidence());
    otherCityEvidence.snapshot.cityId = "si:maribor";
    const otherCity = buildCityKnowledgeRevision(input(otherCityEvidence), integrity);
    expect(() => buildCityKnowledgeRevision({
      ...input(checkedEvidence(), otherCity), createdAt: NEXT_CREATED_AT,
    }, integrity)).toThrow("invalid_city_knowledge_input");

    const otherCountryKey = { ...PACKAGE_KEY, countryCode: "HR" };
    const otherCountryEvidence = mutable(evidence());
    otherCountryEvidence.snapshot.countryCode = "HR";
    const otherCountry = buildCityKnowledgeRevision({
      ...input(otherCountryEvidence), packageKey: otherCountryKey,
    }, integrity);
    expect(() => buildCityKnowledgeRevision({
      ...input(checkedEvidence(), otherCountry), createdAt: NEXT_CREATED_AT,
    }, integrity)).toThrow("invalid_city_knowledge_input");
  });

  it("reconstructs a successor only with the exact predecessor named by the revision", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const currentEvidence = checkedEvidence();
    const successor = buildCityKnowledgeRevision({
      ...input(currentEvidence, first), createdAt: NEXT_CREATED_AT,
    }, integrity);
    expect(reconstruct(successor, currentEvidence, first)).toEqual(successor);
    expect(() => reconstruct(successor, currentEvidence)).toThrow("integrity_mismatch");
    expect(() => reconstruct(first, evidence(), first)).toThrow("integrity_mismatch");

    const changedEvidence = mutable(evidence());
    const basis = changedEvidence.genericEvidence.snapshot.claims[1]!.value;
    if (basis.kind !== "canonical_scalar") throw new Error("fixture_error");
    basis.value = "777";
    const substituted = buildCityKnowledgeRevision(input(changedEvidence), integrity);
    expect(() => reconstruct(successor, currentEvidence, substituted)).toThrow("integrity_mismatch");
  });

  it("rejects every successor predecessor-link tamper", () => {
    const first = buildCityKnowledgeRevision(input(), integrity);
    const currentEvidence = checkedEvidence();
    const successor = buildCityKnowledgeRevision({
      ...input(currentEvidence, first), createdAt: NEXT_CREATED_AT,
    }, integrity);

    const wrongLink = mutable(successor);
    wrongLink.predecessorRevisionId = "city-knowledge:substituted";
    expect(() => reconstruct(wrongLink, currentEvidence, first)).toThrow("integrity_mismatch");

    const missingLink = mutable(successor) as unknown as Record<string, unknown>;
    delete missingLink.predecessorRevisionId;
    expect(() => reconstruct(
      missingLink as unknown as CityKnowledgeRevision,
      currentEvidence,
      first,
    )).toThrow("integrity_mismatch");

    const forgedPredecessor = mutable(first);
    forgedPredecessor.knowledgeUpdatedAt = NEXT_CHECKED_AT;
    expect(() => reconstruct(successor, currentEvidence, forgedPredecessor)).toThrow("integrity_mismatch");
  });

  it.each([
    ["countryCode", "ZZ"],
    ["packageId", "other-package"],
    ["packageSchemaVersion", "other@1"],
    ["catalogRevisionId", "catalog:other"],
    ["evidenceRulesVersion", "other-rules@1"],
  ] as const)("rejects reconstructed package key %s drift", (field, value) => {
    const currentEvidence = evidence();
    const revision = buildCityKnowledgeRevision(input(currentEvidence), integrity);
    const key = mutable(PACKAGE_KEY);
    key[field] = value;
    expect(() => reconstruct(revision, currentEvidence, undefined, key)).toThrow("integrity_mismatch");
  });

  it.each([
    ["id", "other-evidence"],
    ["cityId", "si:maribor"],
    ["countryCode", "HR"],
    ["packageId", "other-package"],
    ["packageSchemaVersion", "other@1"],
    ["catalogRevisionId", "catalog:other"],
    ["evidenceRulesVersion", "other-rules@1"],
    ["completedAt", NEXT_CHECKED_AT],
  ] as const)("rejects reconstructed Evidence %s drift", (field, value) => {
    const original = evidence();
    const revision = buildCityKnowledgeRevision(input(original), integrity);
    const currentEvidence = mutable(original);
    (currentEvidence.snapshot as unknown as Record<string, unknown>)[field] = value;
    if (field === "id") currentEvidence.genericEvidence.snapshot.id = value;
    expect(() => reconstruct(revision, currentEvidence)).toThrow("integrity_mismatch");
  });

  it("snapshots predecessor descriptors before integrity callbacks", () => {
    const first = mutable(buildCityKnowledgeRevision(input(), integrity));
    let getterCalls = 0;
    Object.defineProperty(first, "createdAt", {
      enumerable: true,
      get: () => { getterCalls += 1; return CREATED_AT; },
    });
    let integrityCalls = 0;
    const untouched: CityDecisionIntegrity = {
      canonical: () => { integrityCalls += 1; return "unexpected"; },
      hash: () => { integrityCalls += 1; return "unexpected"; },
    };
    expect(() => buildCityKnowledgeRevision({
      ...input(checkedEvidence(), first), createdAt: NEXT_CREATED_AT,
    }, untouched)).toThrow("invalid_city_knowledge_input");
    expect(getterCalls).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  it.each([
    ["schema", (revision: Record<string, unknown>) => { revision.schemaVersion = "city-knowledge@2"; }],
    ["fact order", (revision: Record<string, unknown>) => {
      (revision.facts as unknown[]).reverse();
    }],
    ["criterion", (revision: Record<string, unknown>) => {
      (revision.facts as Array<Record<string, unknown>>)[0]!.criterionId = "long_term_rent";
    }],
    ["definition", (revision: Record<string, unknown>) => {
      (revision.facts as Array<Record<string, unknown>>)[1]!.definitionId = "wrong@1";
    }],
    ["geo kind", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[1]!;
      (fact.geoScope as Record<string, unknown>).kind = "country";
    }],
    ["official area", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[1]!;
      (fact.geoScope as Record<string, unknown>).officialAreaId = "999";
    }],
    ["status", (revision: Record<string, unknown>) => {
      const facts = revision.facts as Array<Record<string, unknown>>;
      (facts[0]!.outcome as Record<string, unknown>).kind = "unknown";
    }],
    ["basis value", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[1]!;
      const outcome = fact.outcome as Record<string, unknown>;
      (outcome.basis as Record<string, unknown>).value = "999";
    }],
    ["safety quantity", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      const basis = (fact.outcome as Record<string, unknown>).basis as Record<string, unknown>;
      (basis.quantity as Record<string, unknown>).offenceCount = "999";
    }],
    ["reference period", (revision: Record<string, unknown>) => {
      (revision.facts as Array<Record<string, unknown>>)[1]!.referencePeriod = "1900";
    }],
    ["freshness policy", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[1]!;
      (fact.freshnessBasis as Record<string, unknown>).policyVersion = "wrong@1";
    }],
    ["unit", (revision: Record<string, unknown>) => {
      (revision.facts as Array<Record<string, unknown>>)[1]!.unit = "wrong";
    }],
    ["denominator", (revision: Record<string, unknown>) => {
      (revision.facts as Array<Record<string, unknown>>)[1]!.denominator = "wrong";
    }],
    ["Evidence artifact", (revision: Record<string, unknown>) => {
      const facts = revision.facts as Array<Record<string, unknown>>;
      const references = facts[0]!.evidenceRefs as Array<Record<string, unknown>>;
      references[0]!.artifactId = "foreign";
    }],
    ["Evidence source", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      (fact.evidenceRefs as Array<Record<string, unknown>>)[0]!.sourceId = "si-city-long-term-rent";
    }],
    ["Evidence locator", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      (fact.evidenceRefs as Array<Record<string, unknown>>)[0]!.locator = "https://official.example/tampered";
    }],
    ["Evidence excerpt", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      (fact.evidenceRefs as Array<Record<string, unknown>>)[0]!.excerptHash = "0".repeat(64);
    }],
    ["Evidence navigation URL", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      (fact.evidenceRefs as Array<Record<string, unknown>>)[0]!.navigationUrl = "https://official.example/tampered";
    }],
    ["Evidence resolved URL", (revision: Record<string, unknown>) => {
      const fact = (revision.facts as Array<Record<string, unknown>>)[0]!;
      (fact.evidenceRefs as Array<Record<string, unknown>>)[0]!.resolvedEvidenceUrl = "https://official.example/tampered";
    }],
    ["package", (revision: Record<string, unknown>) => { revision.packageId = "foreign"; }],
    ["package schema", (revision: Record<string, unknown>) => { revision.packageSchemaVersion = "foreign@1"; }],
    ["city", (revision: Record<string, unknown>) => { revision.cityId = "si:maribor"; }],
    ["country", (revision: Record<string, unknown>) => { revision.countryCode = "HR"; }],
    ["rules", (revision: Record<string, unknown>) => { revision.rulesVersion = "wrong@1"; }],
    ["Evidence snapshot", (revision: Record<string, unknown>) => { revision.evidenceSnapshotId = "wrong"; }],
    ["last checked", (revision: Record<string, unknown>) => { revision.lastCheckedAt = NEXT_CHECKED_AT; }],
    ["knowledge updated", (revision: Record<string, unknown>) => { revision.knowledgeUpdatedAt = NEXT_CHECKED_AT; }],
    ["created", (revision: Record<string, unknown>) => { revision.createdAt = NEXT_CREATED_AT; }],
    ["id", (revision: Record<string, unknown>) => { revision.id = "city-knowledge:forged"; }],
    ["missing key", (revision: Record<string, unknown>) => { delete revision.rulesVersion; }],
    ["extra key", (revision: Record<string, unknown>) => { revision.extra = true; }],
  ])("rejects reconstructed %s tampering", (_label, mutateRevision) => {
    const currentEvidence = evidence();
    const revision = mutable(buildCityKnowledgeRevision(input(currentEvidence), integrity));
    mutateRevision(revision as unknown as Record<string, unknown>);
    expect(() => reconstruct(revision, currentEvidence)).toThrow("integrity_mismatch");
  });

  it("rejects every blocker-reference field tamper", () => {
    const currentEvidence = evidence({ fixed_broadband: "not_found" });
    const built = buildCityKnowledgeRevision(input(currentEvidence), integrity);
    const mutators: Array<(reference: Record<string, unknown>) => void> = [
      (reference) => { reference.kind = "claim"; },
      (reference) => { reference.sourceId = "si-city-urban-transit"; },
      (reference) => { reference.blocker = "stale"; },
      (reference) => { reference.artifactIds = []; },
      (reference) => { reference.navigationUrl = "https://official.example/tampered"; },
      (reference) => { reference.resolvedEvidenceUrl = "https://official.example/tampered"; },
    ];
    for (const tamper of mutators) {
      const revision = mutable(built);
      const reference = revision.facts[3]!.evidenceRefs[0] as unknown as Record<string, unknown>;
      tamper(reference);
      expect(() => reconstruct(revision, currentEvidence)).toThrow("integrity_mismatch");
    }
  });

  it("rejects descriptor-unsafe revisions before integrity callbacks", () => {
    const currentEvidence = evidence();
    const cases: Array<(revision: Mutable<CityKnowledgeRevision>, touched: () => void) => void> = [
      (revision, touched) => {
        Object.defineProperty(revision, "cityId", {
          enumerable: true,
          get: () => { touched(); return "si:ljubljana"; },
        });
      },
      (revision) => { Object.defineProperty(revision.facts[0]!, Symbol("hidden"), { value: true }); },
      (revision) => { delete (revision.facts as unknown as Record<string, unknown>)["1"]; },
      (revision) => { (revision.facts as unknown as Record<string, unknown>).extra = true; },
      (revision) => { Object.setPrototypeOf(revision.facts[0]!.geoScope, { inherited: true }); },
    ];
    for (const corrupt of cases) {
      const revision = mutable(buildCityKnowledgeRevision(input(currentEvidence), integrity));
      let getterCalls = 0;
      let integrityCalls = 0;
      corrupt(revision, () => { getterCalls += 1; });
      const untouched: CityDecisionIntegrity = {
        canonical: () => { integrityCalls += 1; return "unexpected"; },
        hash: () => { integrityCalls += 1; return "unexpected"; },
      };
      expect(() => reconstructCityKnowledgeRevision({
        revision,
        packageKey: PACKAGE_KEY,
        evidence: currentEvidence,
        factContracts: CONTRACTS,
      }, untouched)).toThrow("integrity_mismatch");
      expect(getterCalls).toBe(0);
      expect(integrityCalls).toBe(0);
    }
  });

  it("returns a fresh deeply frozen reconstruction without freezing callers", () => {
    const currentEvidence = evidence();
    const revision = mutable(buildCityKnowledgeRevision(input(currentEvidence), integrity));
    const reconstructed = reconstruct(revision, currentEvidence);
    expect(reconstructed).toEqual(revision);
    expect(reconstructed).not.toBe(revision);
    expect(reconstructed.facts).not.toBe(revision.facts);
    expect(Object.isFrozen(reconstructed.facts[0]!.evidenceRefs)).toBe(true);
    expect(Object.isFrozen(reconstructed.facts[0]!.outcome)).toBe(true);
    const safetyOutcome = reconstructed.facts[0]!.outcome;
    if (safetyOutcome.kind !== "verified" || safetyOutcome.basis.kind !== "municipal_safety") {
      throw new Error("fixture_error");
    }
    expect(Object.isFrozen(safetyOutcome.basis.quantity)).toBe(true);
    expect(Object.isFrozen(revision)).toBe(false);
    expect(Object.isFrozen(currentEvidence)).toBe(false);
  });

  it("returns fresh recursively frozen build and ranking values without caller aliases", () => {
    const borrowed = mutable(input());
    const revision = buildCityKnowledgeRevision(borrowed, integrity);
    expect(revision.facts).not.toBe(borrowed.evidence.genericEvidence.snapshot.claims);
    expect(revision.facts[0]!.outcome).not.toBe(borrowed.evidence.genericEvidence.snapshot.claims[0]!.value);
    borrowed.evidence.genericEvidence.snapshot.claims[0]!.anchor.locator = "https://official.example/mutated";
    const reference = revision.facts[0]!.evidenceRefs[0];
    expect(reference?.kind).toBe("claim");
    if (reference?.kind !== "claim") throw new Error("fixture_error");
    expect(reference.locator).not.toBe("https://official.example/mutated");

    const projection = projectCityKnowledgeForRanking(revision);
    expect(projection.facts).not.toBe(revision.facts);
    expect(projection.facts[0]!.outcome).not.toBe(revision.facts[0]!.outcome);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.facts[0]!.outcome)).toBe(true);
    expect(Object.keys(projection.facts[0]!).sort()).toEqual([
      "criterionId", "definitionId", "denominator", "freshnessBasis", "geoScope", "outcome",
      "referencePeriod", "unit",
    ]);
    expect(JSON.stringify(projection)).not.toContain("evidenceRefs");
    expect(JSON.stringify(projection)).not.toContain("createdAt");
  });
});
