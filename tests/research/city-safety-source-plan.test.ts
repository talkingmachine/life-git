import { describe, expect, test } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogRevision,
  type CityRegistryEntry,
} from "../../src/decision/city-catalog";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
  reconstructCitySafetySourcePlan,
  reconstructOfficialAuthorityDirectory,
  type CitySafetySourcePlanEntry,
  type OfficialAuthorityDirectory,
  type OfficialMunicipalityPolicy,
  type OfficialPublisherPolicy,
} from "../../src/research/city-safety-source-plan";

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

function registryEntry(cityId: string): CityRegistryEntry {
  return {
    cityId,
    countryCode: "SI",
    officialName: `Registry ${cityId}`,
    coordinate: { lat: 46, lng: 15 },
    administrativeType: "central_urban_settlement",
    administrativeTerritory: `Municipality ${cityId}`,
    capitalRoles: [],
    evidenceReferenceIds: [`evidence:${cityId}`],
  };
}

function catalog(): CityCatalogRevision {
  const registry = buildCityRegistryRevision({
    packageId: "si-city-package",
    packageSchemaVersion: "si-city-package@1",
    countryCode: "SI",
    evidenceSnapshotId: "city-evidence:1",
    entries: [registryEntry("city-b"), registryEntry("city-a")],
    createdAt: "2026-08-14T12:00:00.000Z",
  }, INTEGRITY);
  return buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: "city-evidence:1",
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: ["city-b", "city-a"].map((cityId) => ({
      cityId,
      comparablePopulation: {
        kind: "verified" as const,
        value: "20000",
        referencePeriod: "2026-01-01",
      },
    })),
    coverage: { status: "complete" },
    createdAt: "2026-08-14T12:00:00.000Z",
  }, INTEGRITY);
}

function publisher(
  publisherId: string,
  authorityKind: OfficialPublisherPolicy["authorityKind"],
  navigationUrl: string,
  allowedHosts: readonly string[],
  delegatedDocumentHosts: readonly string[] = [],
): OfficialPublisherPolicy {
  return {
    publisherId,
    authorityKind,
    navigationUrl,
    allowedHosts,
    delegatedDocumentHosts,
    allowedMediaTypes: ["text/html", "application/pdf"],
    maxBytes: 8_000_000,
    redirectPolicyVersion: "official-chain@1",
    documentLocatorPolicyId: `${publisherId}-locator@1`,
    retentionPolicyId: `${publisherId}-retention@1`,
    retentionMode: "seal_hash_locator_then_delete_transient",
  };
}

function municipality(
  cityId: "city-a" | "city-b",
  names?: { readonly city: readonly string[]; readonly municipality: readonly string[] },
): OfficialMunicipalityPolicy {
  const suffix = cityId === "city-a" ? "a" : "b";
  return {
    cityId,
    settlementCode: cityId === "city-a" ? "001001" : "002001",
    municipalityCode: cityId === "city-a" ? "001" : "002",
    officialCityNames: names?.city ?? [`City ${suffix.toUpperCase()}`],
    officialMunicipalityNames: names?.municipality ?? [`Municipality ${suffix.toUpperCase()}`],
    publisherId: `si-municipality-${suffix}`,
    officialHost: `${suffix}.example.si`,
  };
}

function directoryInput(cityCatalog = catalog()): Omit<OfficialAuthorityDirectory, "id"> {
  return {
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: cityCatalog.id,
    requiredPublisherIds: {
      police: "si-police",
      gov: "si-gov",
      opsi: "si-opsi",
      surs: "si-surs",
    },
    publishers: [
      publisher("si-surs", "statistics", "https://pxweb.stat.si/SiStatData/pxweb/sl/Data", ["pxweb.stat.si"]),
      publisher("si-municipality-b", "municipality", "https://b.example.si/", ["b.example.si"]),
      publisher("si-police", "police", "https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta", ["www.policija.si", "policija.si"], ["policija.si"]),
      publisher("si-opsi", "open_data", "https://podatki.gov.si/", ["podatki.gov.si"]),
      publisher("si-municipality-a", "municipality", "https://a.example.si/", ["a.example.si"], ["docs.a.example.si"]),
      publisher("si-gov", "government", "https://www.gov.si/", ["www.gov.si"]),
    ],
    municipalities: [municipality("city-b"), municipality("city-a")],
    rulesVersion: "slovenia-official-authorities@1",
  };
}

function entry(policy: OfficialMunicipalityPolicy): CitySafetySourcePlanEntry {
  const suffix = policy.cityId === "city-a" ? "a" : "b";
  return {
    cityId: policy.cityId,
    settlementCode: policy.settlementCode,
    municipalityCode: policy.municipalityCode,
    officialCityNames: policy.officialCityNames,
    officialMunicipalityNames: policy.officialMunicipalityNames,
    publisherIds: [policy.publisherId, "si-police", "si-surs"],
    configuredRoutes: [
      {
        publisherId: policy.publisherId,
        navigationUrl: `https://${suffix}.example.si/porocila`,
        ...(suffix === "a" ? { resolvedEvidenceUrl: "https://docs.a.example.si/report.pdf" } : {}),
      },
      {
        publisherId: "si-police",
        navigationUrl: "https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta",
      },
    ],
  };
}

function builtDirectory(cityCatalog = catalog()): OfficialAuthorityDirectory {
  return buildOfficialAuthorityDirectory(directoryInput(cityCatalog), INTEGRITY);
}

function buildPlan(cityCatalog = catalog(), directory = builtDirectory(cityCatalog)) {
  return buildCitySafetySourcePlan({
    catalog: cityCatalog,
    directory,
    entries: directory.municipalities.map(entry).reverse(),
  }, INTEGRITY);
}

function withTrailingHole<T>(values: readonly T[]): T[] {
  const sparse = new Array<T>(values.length + 1);
  values.forEach((value, index) => { sparse[index] = value; });
  return sparse;
}

describe("official city-safety authority directory", () => {
  test("canonicalizes set-like fields while preserving ordered names and seals an immutable stable ID", () => {
    // Break caught: caller order changes an ID, canonical names lose priority, or sealed policy remains mutable.
    const cityCatalog = catalog();
    const first = builtDirectory(cityCatalog);
    const input = directoryInput(cityCatalog);
    const second = buildOfficialAuthorityDirectory({
      ...input,
      publishers: [...input.publishers].reverse().map((item) => ({
        ...item,
        allowedHosts: [...item.allowedHosts].reverse(),
        delegatedDocumentHosts: [...item.delegatedDocumentHosts].reverse(),
        allowedMediaTypes: [...item.allowedMediaTypes].reverse(),
      })),
      municipalities: [...input.municipalities].reverse(),
    }, INTEGRITY);

    expect(second).toEqual(first);
    expect(first.id.startsWith("official-authority-directory:test-hash:")).toBe(true);
    expect(first.publishers.map(({ publisherId }) => publisherId)).toEqual([
      "si-gov", "si-municipality-a", "si-municipality-b", "si-opsi", "si-police", "si-surs",
    ]);
    expect(first.municipalities.map(({ cityId }) => cityId)).toEqual(["city-a", "city-b"]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.publishers[0]!.allowedHosts)).toBe(true);
    expect(() => (first.municipalities[0]!.officialCityNames as string[]).push("forged"))
      .toThrow(TypeError);
  });

  test("reconstructs only a hash-bound SI directory with one exact policy per catalog member", () => {
    // Break caught: persisted membership, country/catalog binding, required roles, or hash is trusted.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    expect(reconstructOfficialAuthorityDirectory(directory, cityCatalog, INTEGRITY)).toEqual(directory);

    const invalid: readonly unknown[] = [
      { ...directory, id: `${directory.id}:tampered` },
      { ...directory, countryCode: "ZZ" },
      { ...directory, catalogRevisionId: "city-catalog:foreign" },
      { ...directory, municipalities: directory.municipalities.slice(1) },
      { ...directory, municipalities: [...directory.municipalities, directory.municipalities[0]] },
      { ...directory, municipalities: [directory.municipalities[1], directory.municipalities[0]] },
      { ...directory, unexpected: true },
    ];
    for (const value of invalid) {
      expect(() => reconstructOfficialAuthorityDirectory(value, cityCatalog, INTEGRITY))
        .toThrow("integrity_mismatch");
    }
  });

  test("rejects incomplete authorities, dangling municipality bindings, and non-versioned policies", () => {
    // Break caught: a host/publisher label alone is treated as a closed official authority policy.
    const base = directoryInput();
    const policy = base.publishers.find(({ publisherId }) => publisherId === "si-police")!;
    const municipal = base.publishers.find(({ publisherId }) => publisherId === "si-municipality-a")!;
    const invalid: readonly Omit<OfficialAuthorityDirectory, "id">[] = [
      { ...base, requiredPublisherIds: { ...base.requiredPublisherIds, gov: "si-police" } },
      { ...base, publishers: base.publishers.filter(({ publisherId }) => publisherId !== "si-surs") },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === "si-police" ? { ...item, authorityKind: "government" } : item) },
      { ...base, publishers: [...base.publishers, publisher("unused", "municipality", "https://unused.example.si/", ["unused.example.si"])] },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === municipal.publisherId ? { ...item, authorityKind: "government" } : item) },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === municipal.publisherId ? {
        ...item,
        navigationUrl: "https://other.example.si/",
        allowedHosts: ["a.example.si", "other.example.si"],
      } : item) },
      { ...base, municipalities: base.municipalities.map((item) => item.cityId === "city-a" ? { ...item, publisherId: "missing" } : item) },
      { ...base, municipalities: base.municipalities.map((item) => item.cityId === "city-a" ? { ...item, officialHost: "other.example.si" } : item) },
      { ...base, municipalities: base.municipalities.map((item) => item.cityId === "city-a" ? { ...item, settlementCode: "999001" } : item) },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === policy.publisherId ? { ...item, documentLocatorPolicyId: "unversioned" } : item) },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === policy.publisherId ? { ...item, maxBytes: 0 } : item) },
      { ...base, publishers: base.publishers.map((item) => item.publisherId === policy.publisherId ? { ...item, unexpected: true } as OfficialPublisherPolicy : item) },
    ];
    for (const value of invalid) expect(() => buildOfficialAuthorityDirectory(value, INTEGRITY)).toThrow();
  });

  test("rejects sparse arrays at every directory boundary", () => {
    // Break caught: Array.every/map skip holes, allowing undefined policy/name values into a sealed hash payload.
    const base = directoryInput();
    const sparseNames = new Array<string>(2);
    sparseNames[0] = "City A";
    const invalid: readonly Omit<OfficialAuthorityDirectory, "id">[] = [
      { ...base, publishers: withTrailingHole(base.publishers) },
      { ...base, municipalities: withTrailingHole(base.municipalities) },
      {
        ...base,
        publishers: base.publishers.map((item) => item.publisherId === "si-police"
          ? { ...item, allowedHosts: withTrailingHole(item.allowedHosts) }
          : item),
      },
      {
        ...base,
        municipalities: base.municipalities.map((item) => item.cityId === "city-a"
          ? { ...item, officialCityNames: sparseNames }
          : item),
      },
    ];
    for (const value of invalid) expect(() => buildOfficialAuthorityDirectory(value, INTEGRITY)).toThrow();
  });

  test.each([
    "http://www.policija.si/path",
    "https://user:secret@www.policija.si/path",
    "https://www.policija.si/path#fragment",
    "https://www.policija.si/path#",
    "https://*.policija.si/path",
    "https://WWW.POLICIJA.SI/path",
    "https://www.policija.si./path",
    "https://www.policija.si:443/path",
    "https://www.policija.si:8443/path",
    "https://www.policija.si/a/../path",
    "https://www.policija.si/path/",
    "https://www.policija.si/%70ath",
    "https://www.policija.si/path%0A",
    "https://www.policija.si/path\n",
  ])("rejects non-canonical official URL %s", (navigationUrl) => {
    // Break caught: WHATWG normalization silently widens the sealed trust boundary.
    const base = directoryInput();
    expect(() => buildOfficialAuthorityDirectory({
      ...base,
      publishers: base.publishers.map((item) => item.publisherId === "si-police"
        ? { ...item, navigationUrl }
        : item),
    }, INTEGRITY)).toThrow("invalid_official_publisher");
  });
});

describe("city safety source plan", () => {
  test("covers the exact catalog in canonical order and preserves configured route priority", () => {
    // Break caught: a source plan omits a city, changes the authority crosswalk, or reorders route attempts.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const first = buildPlan(cityCatalog, directory);
    const permuted = buildCitySafetySourcePlan({
      catalog: cityCatalog,
      directory,
      entries: [...directory.municipalities].reverse().map((policy) => ({
        ...entry(policy),
        publisherIds: [...entry(policy).publisherIds].reverse(),
      })),
    }, INTEGRITY);

    expect(permuted).toEqual(first);
    expect(first.id.startsWith("city-safety-source-plan:test-hash:")).toBe(true);
    expect(first.entries.map(({ cityId }) => cityId)).toEqual(["city-a", "city-b"]);
    expect(first.entries[0]!.configuredRoutes).toEqual(entry(directory.municipalities[0]!).configuredRoutes);
    expect(first.entries[0]!.publisherIds).toEqual(["si-municipality-a", "si-police", "si-surs"]);
    expect(Object.isFrozen(first.entries[0]!.configuredRoutes[0])).toBe(true);
    expect(reconstructCitySafetySourcePlan(first, cityCatalog, directory, INTEGRITY)).toEqual(first);
  });

  test("rejects missing, extra, duplicate, foreign, reordered, and second-crosswalk entries", () => {
    // Break caught: persisted plan membership/order or entry-owned identity is accepted without directory replay.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const plan = buildPlan(cityCatalog, directory);
    const first = plan.entries[0]!;
    const invalidBuildEntries: readonly (readonly CitySafetySourcePlanEntry[])[] = [
      plan.entries.slice(1),
      [...plan.entries, { ...first, cityId: "foreign" }],
      [...plan.entries, first],
      plan.entries.map((item) => item.cityId === first.cityId ? { ...item, settlementCode: "001999" } : item),
      plan.entries.map((item) => item.cityId === first.cityId ? { ...item, officialCityNames: [...item.officialCityNames].reverse().concat("Alias") } : item),
      plan.entries.map((item) => item.cityId === first.cityId ? { ...item, publisherIds: item.publisherIds.filter((id) => id !== "si-police") } : item),
      plan.entries.map((item) => item.cityId === first.cityId ? { ...item, publisherIds: [...item.publisherIds, "missing"] } : item),
      plan.entries.map((item) => item.cityId === first.cityId ? { ...item, unexpected: true } as CitySafetySourcePlanEntry : item),
    ];
    for (const entries of invalidBuildEntries) {
      expect(() => buildCitySafetySourcePlan({ catalog: cityCatalog, directory, entries }, INTEGRITY)).toThrow();
    }

    const persistedInvalid: readonly unknown[] = [
      { ...plan, id: `${plan.id}:tampered` },
      { ...plan, catalogRevisionId: "city-catalog:foreign" },
      { ...plan, entries: [plan.entries[1], plan.entries[0]] },
      { ...plan, unexpected: true },
    ];
    for (const value of persistedInvalid) {
      expect(() => reconstructCitySafetySourcePlan(value, cityCatalog, directory, INTEGRITY))
        .toThrow("integrity_mismatch");
    }
  });

  test("rejects sparse entries, publisher IDs, and configured routes", () => {
    // Break caught: sparse source-plan arrays bypass membership and route validation through skipped callbacks.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const entries = directory.municipalities.map(entry);
    const sparseEntries = new Array<CitySafetySourcePlanEntry>(entries.length);
    sparseEntries[0] = entries[0]!;
    const sparsePublisherIds = withTrailingHole(entries[0]!.publisherIds);
    const sparseRoutes = withTrailingHole(entries[0]!.configuredRoutes);
    const invalid: readonly (readonly CitySafetySourcePlanEntry[])[] = [
      sparseEntries,
      entries.map((item, index) => index === 0 ? { ...item, publisherIds: sparsePublisherIds } : item),
      entries.map((item, index) => index === 0 ? { ...item, configuredRoutes: sparseRoutes } : item),
    ];
    for (const candidateEntries of invalid) {
      expect(() => buildCitySafetySourcePlan({
        catalog: cityCatalog,
        directory,
        entries: candidateEntries,
      }, INTEGRITY)).toThrow();
    }
  });

  test("binds every configured navigation and resolved document URL to its declared publisher", () => {
    // Break caught: a route smuggles an unapproved host or uses another publisher's delegation.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const entries = directory.municipalities.map(entry);
    const invalidRoutes = [
      { ...entries[0]!.configuredRoutes[0]!, publisherId: "missing" },
      { ...entries[0]!.configuredRoutes[0]!, publisherId: "si-police" },
      { ...entries[0]!.configuredRoutes[0]!, navigationUrl: "https://evil.example/porocila" },
      { ...entries[0]!.configuredRoutes[0]!, resolvedEvidenceUrl: "https://evil.example/report.pdf" },
      { ...entries[0]!.configuredRoutes[0]!, navigationUrl: "https://a.example.si/porocila#result" },
      { ...entries[0]!.configuredRoutes[0]!, navigationUrl: "https://a.example.si/porocila#" },
      { ...entries[0]!.configuredRoutes[0]!, resolvedEvidenceUrl: "https://docs.a.example.si/report.pdf#" },
      { ...entries[0]!.configuredRoutes[0]!, unexpected: true },
    ];
    for (const route of invalidRoutes) {
      expect(() => buildCitySafetySourcePlan({
        catalog: cityCatalog,
        directory,
        entries: entries.map((item, index) => index === 0
          ? { ...item, configuredRoutes: [route] as CitySafetySourcePlanEntry["configuredRoutes"] }
          : item),
      }, INTEGRITY)).toThrow();
    }
  });

  test("enforces SI and the exact catalog/directory revision on both build and reconstruction paths", () => {
    // Break caught: a valid-looking plan is replayed against another national catalog or directory revision.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const plan = buildPlan(cityCatalog, directory);
    const foreignCatalog = { ...cityCatalog, countryCode: "ZZ" } as CityCatalogRevision;
    expect(() => buildCitySafetySourcePlan({
      catalog: foreignCatalog,
      directory,
      entries: plan.entries,
    }, INTEGRITY)).toThrow();
    expect(() => buildCitySafetySourcePlan({
      catalog: cityCatalog,
      directory: { ...directory, catalogRevisionId: "city-catalog:foreign" },
      entries: plan.entries,
    }, INTEGRITY)).toThrow();
    expect(() => reconstructCitySafetySourcePlan(plan, foreignCatalog, directory, INTEGRITY))
      .toThrow("integrity_mismatch");
  });

  test("emits exact January/June and July/December queries from the first sealed names", () => {
    // Break caught: freshness boundary/year or canonical name priority changes the bounded public query schedule.
    const cityCatalog = catalog();
    const named = directoryInput(cityCatalog);
    const escapedPolicy = municipality("city-a", {
      city: ["Ci\\ty \"A\"", "City Alias"],
      municipality: ["Municipality \\ \"A\"", "Municipality Alias"],
    });
    const directory = buildOfficialAuthorityDirectory({
      ...named,
      municipalities: named.municipalities.map((item) => item.cityId === "city-a" ? escapedPolicy : item),
    }, INTEGRITY);
    const sourceEntry = entry(directory.municipalities[0]!);
    const expectedPreferred = [
      "site:a.example.si \"Municipality \\\\ \\\"A\\\"\" policija \"kazniva dejanja\" 2025",
      "site:policija.si \"Municipality \\\\ \\\"A\\\"\" \"kazniva dejanja\" 2025",
    ];
    expect(buildCitySafetyQueries(sourceEntry, directory, "2026-01-01T00:00:00.000Z", cityCatalog, INTEGRITY))
      .toEqual([...expectedPreferred, "\"Ci\\\\ty \\\"A\\\"\" \"Municipality \\\\ \\\"A\\\"\" policija poročilo 2024"]);
    expect(buildCitySafetyQueries(sourceEntry, directory, "2026-06-30T23:59:59.999Z", cityCatalog, INTEGRITY))
      .toEqual([...expectedPreferred, "\"Ci\\\\ty \\\"A\\\"\" \"Municipality \\\\ \\\"A\\\"\" policija poročilo 2024"]);
    expect(buildCitySafetyQueries(sourceEntry, directory, "2026-07-01T00:00:00.000Z", cityCatalog, INTEGRITY))
      .toEqual([...expectedPreferred, "\"Ci\\\\ty \\\"A\\\"\" \"Municipality \\\\ \\\"A\\\"\" policija poročilo 2025"]);
    expect(buildCitySafetyQueries(sourceEntry, directory, "2026-12-31T23:59:59.999Z", cityCatalog, INTEGRITY))
      .toEqual([...expectedPreferred, "\"Ci\\\\ty \\\"A\\\"\" \"Municipality \\\\ \\\"A\\\"\" policija poročilo 2025"]);
  });

  test("rejects forged structurally valid directory names and host even with a plausible arbitrary ID", () => {
    // Break caught: query text trusts a caller-built directory without reconstructing its catalog-bound hash.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const municipalityPolicy = directory.municipalities[0]!;
    const forgedDirectory: OfficialAuthorityDirectory = {
      ...directory,
      id: "official-authority-directory:forged",
      publishers: directory.publishers.map((policy) => policy.publisherId === municipalityPolicy.publisherId
        ? {
            ...policy,
            navigationUrl: "https://forged.example.si/",
            allowedHosts: ["forged.example.si"],
            delegatedDocumentHosts: [],
          }
        : policy),
      municipalities: directory.municipalities.map((policy) => policy.cityId === municipalityPolicy.cityId
        ? {
            ...policy,
            officialCityNames: ["Forged City"],
            officialMunicipalityNames: ["Forged Municipality"],
            officialHost: "forged.example.si",
          }
        : policy),
    };
    const forgedEntry: CitySafetySourcePlanEntry = {
      ...entry(forgedDirectory.municipalities[0]!),
      configuredRoutes: [
        {
          publisherId: municipalityPolicy.publisherId,
          navigationUrl: "https://forged.example.si/reports",
        },
        {
          publisherId: "si-police",
          navigationUrl: "https://www.policija.si/o-slovenski-policiji/statistika/kriminaliteta",
        },
      ],
    };

    expect(() => buildCitySafetyQueries(
      forgedEntry,
      forgedDirectory,
      "2026-08-14T12:00:00.000Z",
      cityCatalog,
      INTEGRITY,
    )).toThrow("integrity_mismatch");
  });

  test("rejects forged query identities and non-canonical assessment instants", () => {
    // Break caught: query text can be influenced by a caller-owned name/host or ambiguous local time.
    const cityCatalog = catalog();
    const directory = builtDirectory(cityCatalog);
    const sourceEntry = entry(directory.municipalities[0]!);
    expect(() => buildCitySafetyQueries(
      { ...sourceEntry, officialMunicipalityNames: ["Injected"] },
      directory,
      "2026-08-14T12:00:00.000Z",
      cityCatalog,
      INTEGRITY,
    )).toThrow("invalid_city_safety_source_entry");
    expect(() => buildCitySafetyQueries(sourceEntry, directory, "2026-08-14", cityCatalog, INTEGRITY))
      .toThrow("invalid_assessment_at");
  });
});
