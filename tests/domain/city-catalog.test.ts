import { describe, expect, test } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  reconstructCityCatalog,
  type CityCatalogCandidateBasis,
  type CityCatalogRevision,
  type CityRegistryEntry,
} from "../../src/decision/city-catalog";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";

function ordinalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const INTEGRITY: CityDecisionIntegrity = {
  canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        return Object.fromEntries(Object.entries(item).sort(([left], [right]) => ordinalOrder(left, right)));
      }
      return item;
    });
  },
  hash(canonicalText: string): string {
    return `test-hash:${canonicalText}`;
  },
};

function city(
  cityId: string,
  capitalRoles: CityRegistryEntry["capitalRoles"] = [],
): CityRegistryEntry {
  return {
    cityId,
    countryCode: "ZZ",
    officialName: `Synthetic ${cityId}`,
    coordinate: { lat: 45, lng: 15 },
    administrativeType: "municipality",
    administrativeTerritory: "Synthetic Territory",
    capitalRoles,
    evidenceReferenceIds: [`evidence-${cityId}`],
  };
}

function basis(
  cityId: string,
  population: string | undefined,
): CityCatalogCandidateBasis {
  return population === undefined
    ? { cityId, comparablePopulation: { kind: "unknown", reason: "not_found" } }
    : {
      cityId,
      comparablePopulation: {
        kind: "verified",
        value: population,
        referencePeriod: "2025-01-01",
      },
    };
}

function registry(entries: readonly CityRegistryEntry[]) {
  return buildCityRegistryRevision({
    packageId: "synthetic-city-package",
    packageSchemaVersion: "synthetic-city-package@1",
    countryCode: "ZZ",
    evidenceSnapshotId: "evidence-snapshot-1",
    entries,
    createdAt: "2026-08-13T12:00:00.000Z",
  }, INTEGRITY);
}

function catalog(
  entries: readonly CityRegistryEntry[],
  candidateBasis: readonly CityCatalogCandidateBasis[],
  coverage: CityCatalogRevision["coverage"] = { status: "complete" },
) {
  return buildCityCatalogRevision({
    registry: registry(entries),
    evidenceSnapshotId: "evidence-snapshot-1",
    populationDefinition: {
      definitionId: "synthetic-population@1",
      geoScope: "municipality",
      unit: "people",
    },
    candidateBasis,
    coverage,
    createdAt: "2026-08-13T12:00:00.000Z",
  }, INTEGRITY);
}

describe("city registry and catalog policy", () => {
  test("includes populations at and above 20,000, low-population capitals, and fills to ten", () => {
    // Break caught: changing >= 20,000 to > 20,000, omitting capital inclusion, or ranking top-up ascending.
    const entries = [
      city("p19999"), city("p20000"), city("p20001"),
      city("national-low", ["national"]), city("regional-missing", ["regional"]),
      city("top-b", []), city("top-a", []), city("top-c", []), city("top-d", []), city("top-e", []),
    ];
    const result = catalog(entries, [
      basis("p19999", "19999"), basis("p20000", "20000"), basis("p20001", "20001"),
      basis("national-low", "1"), basis("regional-missing", undefined),
      basis("top-b", "7000"), basis("top-a", "7000"), basis("top-c", "6000"),
      basis("top-d", "5000"), basis("top-e", "4000"),
    ], { status: "incomplete", reasons: ["missing_population"] });

    expect(result.members).toEqual([
      { cityId: "national-low", inclusionReasons: ["national_capital"] },
      { cityId: "p19999", inclusionReasons: ["top_ten_fill"] },
      { cityId: "p20000", inclusionReasons: ["population_threshold"] },
      { cityId: "p20001", inclusionReasons: ["population_threshold"] },
      { cityId: "regional-missing", inclusionReasons: ["regional_capital"] },
      { cityId: "top-a", inclusionReasons: ["top_ten_fill"] },
      { cityId: "top-b", inclusionReasons: ["top_ten_fill"] },
      { cityId: "top-c", inclusionReasons: ["top_ten_fill"] },
      { cityId: "top-d", inclusionReasons: ["top_ten_fill"] },
      { cityId: "top-e", inclusionReasons: ["top_ten_fill"] },
    ]);
  });

  test("keeps all fourteen threshold cities and does not manufacture members when fewer than ten centers exist", () => {
    // Break caught: capping threshold members at ten or inventing top-up entries outside the official universe.
    const thresholdEntries = Array.from({ length: 14 }, (_, index) => city(`threshold-${index + 1}`));
    expect(catalog(thresholdEntries, thresholdEntries.map(({ cityId }) => basis(cityId, "20000")))
      .members).toHaveLength(14);

    const smallEntries = [city("only-a"), city("only-b")];
    expect(catalog(smallEntries, [basis("only-a", "100"), basis("only-b", "50")]).members).toEqual([
      { cityId: "only-a", inclusionReasons: ["top_ten_fill"] },
      { cityId: "only-b", inclusionReasons: ["top_ten_fill"] },
    ]);
  });

  test("canonicalizes city order and rejects incomplete or malformed considered universes", () => {
    // Break caught: trusting caller order, accepting an omitted candidate, or allowing duplicate/foreign/invalid registry rows.
    const entries = [city("b"), city("a")];
    const first = catalog(entries, [basis("b", "1"), basis("a", "2")]);
    const second = catalog([...entries].reverse(), [basis("a", "2"), basis("b", "1")]);
    expect(second).toEqual(first);
    expect(first.candidateBasis.map(({ cityId }) => cityId)).toEqual(["a", "b"]);
    expect(first.members.map(({ cityId }) => cityId)).toEqual(["a", "b"]);

    expect(() => catalog(entries, [basis("a", "2")])).toThrow("invalid_candidate_basis");
    expect(() => registry([city("a"), city("a")])).toThrow("invalid_registry_entry");
    expect(() => registry([{ ...city("a"), countryCode: "YY" }])).toThrow("invalid_registry_entry");
    expect(() => registry([{ ...city("a"), coordinate: { lat: 91, lng: 15 } }]))
      .toThrow("invalid_registry_entry");
    expect(() => registry([{ ...city("a"), evidenceReferenceIds: [] }])).toThrow("invalid_registry_entry");
    expect(() => registry([{ ...city("a"), unexpected: true } as unknown as CityRegistryEntry]))
      .toThrow("invalid_registry_entry");
  });

  test("rejects verified populations from mixed reference periods", () => {
    // Break caught: comparing population values that have different reference periods.
    const secondBasis = basis("second", "2");
    expect(() => catalog([city("first"), city("second")], [
      basis("first", "1"),
      {
        ...secondBasis,
        comparablePopulation: { ...secondBasis.comparablePopulation, referencePeriod: "2024-01-01" },
      } as CityCatalogCandidateBasis,
    ])).toThrow("invalid_candidate_basis");
  });

  test("uses ordinal UTF-16 city ordering for non-ASCII city IDs", () => {
    // Break caught: locale-sensitive ordering that puts ä ahead of the ordinally earlier z.
    const result = catalog([city("ä"), city("z")], [basis("ä", "1"), basis("z", "1")]);
    expect(result.candidateBasis.map(({ cityId }) => cityId)).toEqual(["z", "ä"]);
    expect(result.members.map(({ cityId }) => cityId)).toEqual(["z", "ä"]);
  });

  test("requires coverage to reflect unknown population and preserves its explicit partial-universe flag", () => {
    // Break caught: treating unknown population as complete coverage or accepting a missing/extra missing_population reason.
    const entries = [city("known"), city("unknown")];
    const candidates = [basis("known", "1"), basis("unknown", undefined)];
    expect(() => catalog(entries, candidates)).toThrow("invalid_catalog_coverage");
    expect(() => catalog(entries, candidates, { status: "incomplete", reasons: [] }))
      .toThrow("invalid_catalog_coverage");
    expect(catalog(entries, [basis("known", "1"), basis("unknown", undefined)], {
      status: "incomplete",
      reasons: ["missing_population", "official_universe_partial"],
    }).coverage).toEqual({
      status: "incomplete",
      reasons: ["missing_population", "official_universe_partial"],
    });
    expect(() => catalog([city("known")], [basis("known", "1")], {
      status: "incomplete",
      reasons: ["missing_population"],
    })).toThrow("invalid_catalog_coverage");
  });

  test("reconstructs only an untampered complete projection and returns deeply immutable semantic data", () => {
    // Break caught: trusting persisted membership/order/binding/rules/coverage/basis instead of recomputing from the full registry universe.
    const entries = [city("capital", ["national"]), city("ordinary")];
    const cityRegistry = registry(entries);
    const cityCatalog = catalog(entries, [basis("capital", "1"), basis("ordinary", "2")]);
    expect(reconstructCityCatalog({ registry: cityRegistry, catalog: cityCatalog })).toEqual({
      registry: cityRegistry,
      catalog: cityCatalog,
    });

    const tamperedCatalogs: readonly CityCatalogRevision[] = [
      { ...cityCatalog, members: [] },
      { ...cityCatalog, members: cityCatalog.members.map((member) =>
        member.cityId === "capital" ? { ...member, inclusionReasons: ["regional_capital"] as const } : member) },
      { ...cityCatalog, candidateBasis: [cityCatalog.candidateBasis[1]!, cityCatalog.candidateBasis[0]!] },
      {
        ...cityCatalog,
        candidateBasis: cityCatalog.candidateBasis.map((candidate) => candidate.cityId === "ordinary"
          ? {
            ...candidate,
            comparablePopulation: {
              kind: "verified" as const,
              value: "20000",
              referencePeriod: "2025-01-01",
            },
          }
          : candidate),
      },
      { ...cityCatalog, coverage: { status: "incomplete", reasons: ["missing_population"] as const } },
      { ...cityCatalog, registryRevisionId: "other-registry" },
      { ...cityCatalog, rulesVersion: "city-catalog@2" as "city-catalog@1" },
    ];
    for (const catalogValue of tamperedCatalogs) {
      expect(() => reconstructCityCatalog({ registry: cityRegistry, catalog: catalogValue }))
        .toThrow("integrity_mismatch");
    }
    expect(() => reconstructCityCatalog({
      registry: { ...cityRegistry, entries: cityRegistry.entries.slice(1) },
      catalog: cityCatalog,
    })).toThrow("integrity_mismatch");
    expect(() => reconstructCityCatalog({
      registry: { ...cityRegistry, entries: [...cityRegistry.entries].reverse() },
      catalog: cityCatalog,
    })).toThrow("integrity_mismatch");
    for (const malformedRegistry of [
      {
        ...cityRegistry,
        entries: [{ ...cityRegistry.entries[0]!, coordinate: { lat: "45", lng: 15 } }],
      },
      {
        ...cityRegistry,
        entries: [{ ...cityRegistry.entries[0]!, evidenceReferenceIds: [] }],
      },
    ]) {
      expect(() => reconstructCityCatalog({
        registry: malformedRegistry as unknown as typeof cityRegistry,
        catalog: cityCatalog,
      })).toThrow("integrity_mismatch");
    }

    const projection = reconstructCityCatalog({ registry: cityRegistry, catalog: cityCatalog });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.registry.entries)).toBe(true);
    expect(Object.isFrozen(projection.catalog.members[0]?.inclusionReasons)).toBe(true);
    expect(JSON.stringify(projection)).not.toMatch(/target|score|raw/i);
  });
});
