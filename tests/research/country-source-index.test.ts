import { describe, expect, test } from "vitest";

import { createInstalledCountrySourceIndex } from
  "../../src/infrastructure/sources/country-source-index";
import { createInstalledPlacePackages } from
  "../../src/infrastructure/sources/installed-place-packages";

describe("installed country source index", () => {
  test("lists only the frozen Slovenia package without unsupported factor facts", () => {
    const packages = createInstalledPlacePackages().list();

    expect(packages).toEqual([{
      countryCode: "SI",
      label: "Slovenia",
      flag: "🇸🇮",
      coordinate: { lat: 46.1512, lng: 14.9955 },
      supportedCriteria: [],
      routeCatalog: {
        revisionId: "si-routes@1",
        routeIds: ["si-temporary-residence-digital-nomad"],
        completeness: "unproven",
      },
    }]);
    expect(Object.isFrozen(packages)).toBe(true);
    expect(Object.isFrozen(packages[0])).toBe(true);
    expect(Object.isFrozen(packages[0]?.coordinate)).toBe(true);
    expect(Object.isFrozen(packages[0]?.supportedCriteria)).toBe(true);
    expect(Object.isFrozen(packages[0]?.routeCatalog)).toBe(true);
    expect(Object.isFrozen(packages[0]?.routeCatalog.routeIds)).toBe(true);
    expect(JSON.stringify(packages)).not.toMatch(
      /factorValue|threshold|sourceBytes|profile|salaryAmount|routeCount/i,
    );
  });

  test("returns the exact frozen Slovenia navigation set", () => {
    const result = createInstalledCountrySourceIndex().lookup("SI");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Slovenia must be installed");
    expect(result.candidates.map(({ candidateId, url, authorityRoot, claimKinds }) => ({
      candidateId,
      url,
      authorityRoot,
      claimKinds,
    }))).toEqual([
      {
        candidateId: "gov-route",
        url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
        authorityRoot: "https://www.gov.si",
        claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
      },
      {
        candidateId: "ztuj2",
        url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
      },
      {
        candidateId: "salary-publication",
        url: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["income"],
      },
      {
        candidateId: "sistat",
        url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
        authorityRoot: "https://pxweb.stat.si",
        claimKinds: ["income"],
      },
      {
        candidateId: "ess-companion",
        url: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
        authorityRoot: "https://www.ess.gov.si",
        claimKinds: ["companion_local_work_access"],
      },
      {
        candidateId: "zzsdt",
        url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["companion_local_work_access"],
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(result.candidates.every((candidate) =>
      Object.isFrozen(candidate) && Object.isFrozen(candidate.claimKinds)
    )).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /salaryAmount|threshold|profile|passport|citizenshipValue|prompt|model/i,
    );
  });

  test.each(["FR", "si", " Словения "])("fails closed for %j", (input) => {
    expect(createInstalledCountrySourceIndex().lookup(input)).toEqual({
      ok: false,
      kind: "country_not_installed",
      candidates: [],
    });
  });
});
