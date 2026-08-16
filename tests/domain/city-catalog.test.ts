import { describe, expect, test } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  CityCatalogNeedsContextError,
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
  integrity: CityDecisionIntegrity = INTEGRITY,
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
  }, integrity);
}

describe("city registry and catalog policy", () => {
  test("writes city-catalog@2 and fills ordinary cities by comparable population up to 100", () => {
    // Break caught: retaining the @1 threshold/top-ten policy or capping ordinary members below 100.
    for (const count of [99, 100, 101]) {
      const entries = Array.from({ length: count }, (_, index) => city(`ordinary-${String(index).padStart(3, "0")}`));
      const result = catalog(entries, entries.map(({ cityId }, index) => basis(cityId, String(1000 - index))));
      expect(result.rulesVersion).toBe("city-catalog@2");
      expect(result.members).toHaveLength(Math.min(count, 100));
      expect(result.members.every(({ inclusionReasons }) => inclusionReasons[0] === "population_fill")).toBe(true);
    }
  });

  test("keeps low and missing-population mandatory capitals ahead of population fill", () => {
    // Break caught: excluding mandatory capitals for low/unknown population or counting a two-role city twice.
    const entries = [
      city("national-low", ["national"]), city("regional-missing", ["regional"]),
      city("both", ["regional", "national"]), city("ordinary", []),
    ];
    const result = catalog(entries, [
      basis("national-low", "1"), basis("regional-missing", undefined),
      basis("both", "2"), basis("ordinary", "999"),
    ], { status: "incomplete", reasons: ["missing_population"] });

    expect(result.members).toEqual([
      { cityId: "both", inclusionReasons: ["national_capital", "regional_capital"] },
      { cityId: "national-low", inclusionReasons: ["national_capital"] },
      { cityId: "ordinary", inclusionReasons: ["population_fill"] },
      { cityId: "regional-missing", inclusionReasons: ["regional_capital"] },
    ]);
  });

  test("allows 99 or 100 unique mandatory capitals and requires context for 101 before sealing", () => {
    // Break caught: silently dropping a mandatory capital or sealing an @2 revision after the 100-member limit.
    for (const count of [99, 100]) {
      const entries = Array.from({ length: count }, (_, index) => city(
        `capital-${String(index).padStart(3, "0")}`,
        index % 2 === 0 ? ["national"] : ["regional"],
      ));
      const candidates = entries.map(({ cityId }, index) => basis(cityId, index % 2 === 0 ? "1" : undefined));
      expect(catalog(entries, candidates, { status: "incomplete", reasons: ["missing_population"] }).members)
        .toHaveLength(count);
    }
    const tooMany = Array.from({ length: 101 }, (_, index) => city(
      `capital-${String(index).padStart(3, "0")}`,
      ["national"],
    ));
    let error: unknown;
    try {
      catalog(tooMany, tooMany.map(({ cityId }) => basis(cityId, "1")));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CityCatalogNeedsContextError);
    expect(error).toMatchObject({
      code: "mandatory_capitals_exceed_limit",
      mandatoryCapitalCount: 101,
      memberLimit: 100,
    });
    expect(() => catalog(tooMany, tooMany.map(({ cityId }) => basis(cityId, "1")), { status: "complete" }, {
      canonical: INTEGRITY.canonical,
      hash: (canonicalText) => {
        if (!canonicalText.includes('"schemaVersion":"city-registry@1"')) throw new Error("sealed");
        return `test-hash:${canonicalText}`;
      },
    })).toThrow(CityCatalogNeedsContextError);
  });

  test("fills fewer than 100 official centers and resolves equal-population overflow by ordinal city ID", () => {
    // Break caught: manufacturing cities outside the registry or using input/locale order for the 100th member.

    const smallEntries = [city("only-a"), city("only-b")];
    expect(catalog(smallEntries, [basis("only-a", "100"), basis("only-b", "50")]).members).toEqual([
      { cityId: "only-a", inclusionReasons: ["population_fill"] },
      { cityId: "only-b", inclusionReasons: ["population_fill"] },
    ]);
    const tied = Array.from({ length: 101 }, (_, index) => city(`tie-${String(index).padStart(3, "0")}`));
    const result = catalog([...tied].reverse(), tied.map(({ cityId }) => basis(cityId, "100")));
    expect(result.members.map(({ cityId }) => cityId)).toEqual(tied.slice(0, 100).map(({ cityId }) => cityId));
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
    const selectedAndUnselected = [
      city("selected"), ...Array.from({ length: 100 }, (_, index) => city(`unselected-${index}`)),
    ];
    expect(() => catalog(selectedAndUnselected, [
      basis("selected", "10"), ...Array.from({ length: 99 }, (_, index) => basis(`unselected-${index}`, "1")),
    ])).toThrow("invalid_candidate_basis");
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

  test("replays historical @1 rows exactly and rejects tampered @2 semantics", () => {
    // Break caught: applying @2 policy to @1 rows or trusting persisted @2 membership/order/binding/rules/coverage/basis.
    const entries = [city("capital", ["national"]), city("ordinary")];
    const cityRegistry = registry(entries);
    const historical: CityCatalogRevision = {
      schemaVersion: "city-catalog@1",
      id: "historical-v1",
      packageId: cityRegistry.packageId,
      packageSchemaVersion: cityRegistry.packageSchemaVersion,
      countryCode: cityRegistry.countryCode,
      registryRevisionId: cityRegistry.id,
      evidenceSnapshotId: "evidence-snapshot-1",
      populationDefinition: { definitionId: "synthetic-population@1", geoScope: "municipality", unit: "people" },
      candidateBasis: [basis("capital", "1"), basis("ordinary", "2")],
      members: [
        { cityId: "capital", inclusionReasons: ["national_capital"] },
        { cityId: "ordinary", inclusionReasons: ["top_ten_fill"] },
      ],
      coverage: { status: "complete" },
      rulesVersion: "city-catalog@1",
      createdAt: "2026-08-13T12:00:00.000Z",
    };
    expect(JSON.stringify(reconstructCityCatalog({ registry: cityRegistry, catalog: historical }).catalog))
      .toBe(JSON.stringify(historical));
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
            comparablePopulation: { kind: "unknown" as const, reason: "not_found" as const },
          }
          : candidate),
      },
      { ...cityCatalog, coverage: { status: "incomplete", reasons: ["missing_population"] as const } },
      { ...cityCatalog, registryRevisionId: "other-registry" },
      { ...cityCatalog, rulesVersion: "city-catalog@1" },
      {
        ...cityCatalog,
        members: cityCatalog.members.map((member) => member.cityId === "ordinary"
          ? { ...member, inclusionReasons: ["top_ten_fill"] as const }
          : member),
      },
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
