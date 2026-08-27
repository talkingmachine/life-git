import { describe, expect, test } from "vitest";

import {
  assessFormalResidence,
  reconstructFormalResidenceVerdict,
  type CatalogCompletenessAttestation,
  type FormalEvidenceReference,
  type ResidenceRouteOutcome,
} from "../../src/decision/formal-residence-verdict";

const VERDICT_AS_OF = "2026-08-12";
const EVIDENCE_SNAPSHOT_ID = "evidence-1";

function evidence(
  sourceId: string,
  evidenceSnapshotId = EVIDENCE_SNAPSHOT_ID,
): FormalEvidenceReference {
  return {
    evidenceSnapshotId,
    artifactId: `artifact-${sourceId}`,
    sourceId,
    navigationUrl: `https://example.test/${sourceId}`,
    resolvedEvidenceUrl: `https://example.test/${sourceId}.pdf`,
    sourcePeriod: "2026-08",
    locator: `section-${sourceId}`,
    excerptSha256: "a".repeat(64),
    validatorVersion: "test-validator@1",
  };
}

function route(
  routeId: string,
  status: ResidenceRouteOutcome["status"],
): ResidenceRouteOutcome {
  const reference = evidence(routeId);
  const base = {
    routeId,
    reasons: [{
      code: `${routeId}_${status}`,
      summary: `${routeId} is ${status}`,
      claimIds: [`claim-${routeId}`],
      evidence: status === "unknown" ? [] : [reference],
      navigation: [],
    }],
    proceduralActions: [],
    contingentActions: [],
  };
  return status === "unknown"
    ? { ...base, status, evidenceSnapshotIds: [] }
    : {
        ...base,
        status,
        ruleEffectiveFrom: "2026-01-01",
        evidenceSnapshotIds: [EVIDENCE_SNAPSHOT_ID],
      };
}

function complete(
  applicableRouteIds: readonly string[],
  excludedRouteIds: readonly string[] = [],
): CatalogCompletenessAttestation {
  return {
    catalogRevisionId: "catalog-si-1",
    jurisdiction: "SI",
    authority: "Slovenian Ministry of the Interior",
    scopeKind: "all_long_term_residence_routes_for_profile",
    profileSnapshotId: "profile-1",
    catalogRoutes: [
      ...applicableRouteIds.map((routeId) => ({
        routeId,
        applicability: "applicable" as const,
        evidence: [evidence(`catalog-${routeId}`)] as const,
      })),
      ...excludedRouteIds.map((routeId) => ({
        routeId,
        applicability: "excluded" as const,
        exclusionCode: "profile_not_eligible",
        claimIds: [`claim-excluded-${routeId}`] as const,
        evidence: [evidence(`catalog-${routeId}`)] as const,
      })),
    ] as unknown as CatalogCompletenessAttestation["catalogRoutes"],
    validatorVersion: "catalog-validator@1",
    effectiveFrom: "2026-01-01",
    evidenceSnapshotId: EVIDENCE_SNAPSHOT_ID,
    catalogEvidence: [evidence("catalog-completeness")],
  };
}

function assess(
  routes: readonly ResidenceRouteOutcome[],
  completeness?: CatalogCompletenessAttestation,
) {
  return assessFormalResidence({
    profileSnapshotId: "profile-1",
    verdictAsOf: VERDICT_AS_OF,
    routes,
    ...(completeness === undefined ? {} : { completeness }),
  });
}

describe("formal residence marker semantics", () => {
  test.each([
    ["reversed", "2026-08-13", "2026-08-11"],
    ["future", "2026-08-13", undefined],
    ["expired", undefined, "2026-08-11"],
  ] as const)("rejects a reconstructed unknown route with a %s interval", (
    _name,
    ruleEffectiveFrom,
    ruleEffectiveTo,
  ) => {
    const verdict = assess([route("dn", "unknown")]);
    const forged = structuredClone(verdict) as unknown as Record<string, unknown> & {
      routeOutcomes: Array<Record<string, unknown>>;
    };
    forged.routeOutcomes[0] = {
      ...forged.routeOutcomes[0],
      ...(ruleEffectiveFrom === undefined ? {} : { ruleEffectiveFrom }),
      ...(ruleEffectiveTo === undefined ? {} : { ruleEffectiveTo }),
    };

    expect(() => reconstructFormalResidenceVerdict(forged, {
      profileSnapshotId: "profile-1",
    })).toThrow("integrity_mismatch");
  });

  test.each([
    {
      name: "viable route wins over another unknown route",
      routes: [route("dn", "viable"), route("study", "unknown")],
      completeness: undefined,
      marker: "green",
    },
    {
      name: "failed route with unproven catalog stays yellow",
      routes: [route("dn", "impossible")],
      completeness: undefined,
      marker: "yellow",
    },
    {
      name: "unknown route with complete catalog stays yellow",
      routes: [route("dn", "impossible"), route("study", "unknown")],
      completeness: complete(["dn", "study"]),
      marker: "yellow",
    },
    {
      name: "complete effective all-impossible catalog is red",
      routes: [route("dn", "impossible"), route("study", "impossible")],
      completeness: complete(["dn", "study"]),
      marker: "red",
    },
  ])("$name", ({ routes, completeness, marker }) => {
    expect(assessFormalResidence({
      profileSnapshotId: "profile-1",
      verdictAsOf: "2026-08-12",
      routes,
      ...(completeness === undefined ? {} : { completeness }),
    }).marker).toBe(marker);
  });

  test("a non-empty complete catalog with every route proven excluded is red", () => {
    expect(assess([], complete([], ["study", "employment"])).marker).toBe("red");
  });

  test.each([
    [
      "applicable catalog route IDs do not exactly equal outcome IDs",
      [route("dn", "impossible")],
      complete(["dn", "study"]),
    ],
    [
      "catalog route coverage is duplicated",
      [route("dn", "impossible")],
      {
        ...complete(["dn"]),
        catalogRoutes: [
          complete(["dn"]).catalogRoutes[0]!,
          complete([], ["dn"]).catalogRoutes[0]!,
        ],
      },
    ],
    [
      "a catalog route is not uniquely applicable or excluded",
      [route("dn", "impossible")],
      {
        ...complete(["dn"]),
        catalogRoutes: [{
          ...complete(["dn"]).catalogRoutes[0]!,
          exclusionCode: "also_excluded",
          claimIds: ["claim-also-excluded"],
        }],
      },
    ],
    [
      "an excluded catalog route lacks evidence",
      [],
      {
        ...complete([], ["study"]),
        catalogRoutes: [{
          ...complete([], ["study"]).catalogRoutes[0]!,
          evidence: [],
        }],
      },
    ],
    [
      "catalog profile binding differs",
      [route("dn", "impossible")],
      { ...complete(["dn"]), profileSnapshotId: "profile-other" },
    ],
    [
      "catalog evidence snapshot binding differs",
      [route("dn", "impossible")],
      {
        ...complete(["dn"]),
        catalogEvidence: [evidence("catalog-completeness", "evidence-other")],
      },
    ],
    [
      "route and catalog Evidence snapshot binding differs",
      [{
        ...route("dn", "impossible"),
        reasons: [{
          ...route("dn", "impossible").reasons[0]!,
          evidence: [evidence("dn", "evidence-other")],
        }],
        evidenceSnapshotIds: ["evidence-other"],
      }],
      complete(["dn"]),
    ],
    [
      "catalog proof is empty",
      [route("dn", "impossible")],
      { ...complete(["dn"]), catalogEvidence: [] },
    ],
    [
      "attestation interval excludes the verdict date",
      [route("dn", "impossible")],
      { ...complete(["dn"]), effectiveTo: "2026-08-11" },
    ],
  ] as const)("fails closed when %s", (_name, routes, completeness) => {
    expect(assess(
      routes,
      completeness as CatalogCompletenessAttestation,
    ).marker).toBe("yellow");
  });

  test.each([
    [
      "verified route has no Evidence reference",
      {
        ...route("dn", "viable"),
        reasons: [{
          ...route("dn", "viable").reasons[0]!,
          evidence: [],
        }],
      },
    ],
    [
      "verified route has no current effective interval",
      { ...route("dn", "viable"), ruleEffectiveTo: "2026-08-11" },
    ],
    [
      "verified route Evidence snapshot binding differs",
      {
        ...route("dn", "viable"),
        reasons: [{
          ...route("dn", "viable").reasons[0]!,
          evidence: [evidence("dn", "evidence-other")],
        }],
      },
    ],
  ] as const)("normalizes to unknown when %s", (_name, untrustedRoute) => {
    const verdict = assess([
      untrustedRoute as ResidenceRouteOutcome,
    ], complete(["dn"]));

    expect(verdict.marker).toBe("yellow");
    expect(verdict.routeOutcomes[0]?.status).toBe("unknown");
  });

  test("normalizes a verified route when one determining reason lacks its own proof", () => {
    const unprovedReason = {
      code: "unproved_determining_fact",
      summary: "A determining fact has no verified proof.",
      claimIds: ["claim-unproved"],
      evidence: [],
      navigation: [{
        sourceId: "manual-source",
        url: "https://example.test/manual-source",
        label: "manual check",
      }],
    };
    const verdict = assess([{
      ...route("dn", "viable"),
      reasons: [...route("dn", "viable").reasons, unprovedReason],
    }], complete(["dn"]));

    expect(verdict.marker).toBe("yellow");
    expect(verdict.routeOutcomes[0]?.status).toBe("unknown");
  });

  test("keeps navigation-only reasons representable on an honest unknown route", () => {
    const verdict = assess([{
      ...route("dn", "unknown"),
      reasons: [{
        code: "manual_check_required",
        summary: "Manual checking remains necessary.",
        claimIds: [],
        evidence: [],
        navigation: [{
          sourceId: "manual-source",
          url: "https://example.test/manual-source",
          label: "manual check",
        }],
      }],
    }]);

    expect(verdict.marker).toBe("yellow");
    expect(verdict.routeOutcomes[0]?.reasons[0]?.navigation).toHaveLength(1);
  });

  test("accepts an unknown route without effective dates", () => {
    expect(assess([route("dn", "unknown")], complete(["dn"])).marker).toBe("yellow");
  });

  test("returns the fixed rules version and a deeply frozen verdict", () => {
    const verdict = assess([route("dn", "viable")]);

    expect(verdict.rulesVersion).toBe("formal-residence@1");
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.routeOutcomes)).toBe(true);
    expect(Object.isFrozen(verdict.routeOutcomes[0]?.reasons)).toBe(true);
  });
});
