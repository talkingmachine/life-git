import { describe, expect, test } from "vitest";

import {
  assertCountryResolutionTransition,
  deriveYellowUncertaintyBasis,
  effectiveCountryStatus,
  reconstructCountryResolution,
  type CountryResolutionSemanticState,
  type ResolutionMarkerProjection,
  type YellowDecision,
} from "../../src/decision/country-resolution-policy";
import {
  assessFormalResidence,
  type FormalEvidenceReference,
  type ResidenceRouteOutcome,
} from "../../src/decision/formal-residence-verdict";

function evidence(sourceId: string): FormalEvidenceReference {
  return {
    evidenceSnapshotId: "evidence-1",
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
      summary: `Human summary for ${routeId}.`,
      claimIds: [`claim-${routeId}`],
      evidence: status === "unknown" ? [] : [reference],
      navigation: [{
        sourceId: `navigation-${routeId}`,
        url: `https://example.test/navigation/${routeId}`,
        label: `Read ${routeId}`,
      }],
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
        evidenceSnapshotIds: ["evidence-1"],
      };
}

const ORDERED_COUNTRY_CODES = ["AA", "BB", "CC", "DD", "EE", "FF"] as const;

const YELLOW_BASIS = {
  unknownRoutes: [{ routeId: "unknown-route", reasons: [] }],
} as const;

function marker(
  countryCode: string,
  rank: number,
  formalStatus: ResolutionMarkerProjection["formalStatus"],
): ResolutionMarkerProjection {
  return {
    countryCode,
    rank,
    formalStatus,
    formalMarkerDigest: `digest-${countryCode}`,
    ...(formalStatus === "yellow" ? { expectedUncertaintyBasis: YELLOW_BASIS } : {}),
  };
}

function decision(
  countryCode: string,
  kind: YellowDecision["decision"],
): YellowDecision {
  return {
    countryCode,
    decision: kind,
    formalMarkerDigest: `digest-${countryCode}`,
    uncertaintyBasis: YELLOW_BASIS,
    warningCopyVersion: "yellow-risk@1",
    decidedAt: "2026-08-12T00:00:00.000Z",
    commandId: `command-${countryCode}`,
  };
}

function reconstruct(
  markers: readonly ResolutionMarkerProjection[],
  decisions: readonly YellowDecision[] = [],
) {
  return reconstructCountryResolution({
    orderedCountryCodes: ORDERED_COUNTRY_CODES,
    markers,
    decisions,
  });
}

function semanticState(
  markers: readonly ResolutionMarkerProjection[],
  decisions: readonly YellowDecision[] = [],
): CountryResolutionSemanticState {
  const projection = reconstruct(markers, decisions);
  return projection.terminal === undefined
    ? {
        kind: "working",
        decisions,
        markerProjections: markers,
        nextUncheckedRank: projection.nextUncheckedRank,
        unresolvedCountryCodes: projection.unresolvedCountryCodes,
        slotCountryCodes: projection.slotCountryCodes,
        resolvedEntries: [],
        phase: projection.phase,
      }
    : {
        kind: "resolved",
        decisions,
        markerProjections: markers,
        nextUncheckedRank: projection.nextUncheckedRank,
        unresolvedCountryCodes: projection.unresolvedCountryCodes,
        slotCountryCodes: projection.slotCountryCodes,
        resolvedEntries: projection.terminal.resolvedEntries,
        stopCondition: projection.terminal.stopCondition,
      };
}

describe("country resolution policy", () => {
  test("maps every formal status and yellow decision to its effective status", () => {
    expect(effectiveCountryStatus("green")).toBe("green");
    expect(effectiveCountryStatus("red")).toBe("red");
    expect(effectiveCountryStatus("yellow")).toBe("yellow");
    expect(effectiveCountryStatus("yellow", "accepted_at_own_risk")).toBe("green");
    expect(effectiveCountryStatus("yellow", "rejected")).toBe("red");
  });

  test("preserves only unknown-route and catalog-completeness uncertainty in verdict order", () => {
    const verdict = assessFormalResidence({
      profileSnapshotId: "profile-1",
      verdictAsOf: "2026-08-12",
      routes: [route("impossible", "impossible"), route("unknown-one", "unknown"), route("unknown-two", "unknown")],
    });

    expect(deriveYellowUncertaintyBasis(verdict)).toEqual({
      unknownRoutes: [
        {
          routeId: "unknown-one",
          reasons: [{
            code: "unknown-one_unknown",
            claimIds: ["claim-unknown-one"],
            evidence: [],
            navigation: [{
              sourceId: "navigation-unknown-one",
              url: "https://example.test/navigation/unknown-one",
              label: "Read unknown-one",
            }],
          }],
        },
        {
          routeId: "unknown-two",
          reasons: [{
            code: "unknown-two_unknown",
            claimIds: ["claim-unknown-two"],
            evidence: [],
            navigation: [{
              sourceId: "navigation-unknown-two",
              url: "https://example.test/navigation/unknown-two",
              label: "Read unknown-two",
            }],
          }],
        },
      ],
      catalogCompletenessUnprovable: {
        code: "catalog_completeness_unprovable",
        claimIds: [],
        evidence: [],
        navigation: [],
      },
    });
  });

  test("keeps catalog-only uncertainty non-empty without inventing Evidence", () => {
    const verdict = assessFormalResidence({
      profileSnapshotId: "profile-1",
      verdictAsOf: "2026-08-12",
      routes: [route("impossible", "impossible")],
    });

    expect(deriveYellowUncertaintyBasis(verdict)).toEqual({
      unknownRoutes: [],
      catalogCompletenessUnprovable: {
        code: "catalog_completeness_unprovable",
        claimIds: [],
        evidence: [],
        navigation: [],
      },
    });
  });

  test("returns a deeply immutable uncertainty basis", () => {
    const verdict = assessFormalResidence({
      profileSnapshotId: "profile-1",
      verdictAsOf: "2026-08-12",
      routes: [route("unknown", "unknown")],
    });

    const basis = deriveYellowUncertaintyBasis(verdict);

    expect(Object.isFrozen(basis)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0])).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons[0])).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons[0]?.claimIds)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons[0]?.evidence)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons[0]?.navigation)).toBe(true);
    expect(Object.isFrozen(basis.unknownRoutes[0]?.reasons[0]?.navigation[0])).toBe(true);
    expect(() => {
      (basis.unknownRoutes as unknown as Array<unknown>).push({});
    }).toThrow(TypeError);
    expect(basis.unknownRoutes).toHaveLength(1);
  });

  test("occupies five slots with unresolved yellow and prompts the lowest-ranked country", () => {
    expect(reconstruct([
      marker("AA", 1, "green"),
      marker("BB", 2, "yellow"),
      marker("CC", 3, "green"),
      marker("DD", 4, "yellow"),
      marker("EE", 5, "green"),
    ])).toEqual({
      unresolvedCountryCodes: ["BB", "DD"],
      slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      resolvedCountryCodes: ["AA", "CC", "EE"],
      nextUncheckedRank: 6,
      currentPromptCountryCode: "BB",
      phase: "awaiting_decision",
    });
  });

  test("accepting yellow keeps its slot and makes it effective green", () => {
    expect(reconstruct([
      marker("AA", 1, "green"),
      marker("BB", 2, "yellow"),
      marker("CC", 3, "green"),
      marker("DD", 4, "yellow"),
      marker("EE", 5, "green"),
    ], [decision("BB", "accepted_at_own_risk")])).toMatchObject({
      unresolvedCountryCodes: ["DD"],
      slotCountryCodes: ["AA", "BB", "CC", "DD", "EE"],
      resolvedCountryCodes: ["AA", "BB", "CC", "EE"],
      currentPromptCountryCode: "DD",
      phase: "awaiting_decision",
    });
  });

  test("rejecting yellow requires the next unchecked replacement rank", () => {
    expect(reconstruct([
      marker("AA", 1, "green"),
      marker("BB", 2, "yellow"),
      marker("CC", 3, "green"),
      marker("DD", 4, "yellow"),
      marker("EE", 5, "green"),
    ], [decision("BB", "rejected")])).toMatchObject({
      unresolvedCountryCodes: ["DD"],
      slotCountryCodes: ["AA", "CC", "DD", "EE"],
      resolvedCountryCodes: ["AA", "CC", "EE"],
      nextUncheckedRank: 6,
      phase: "replacement_required",
    });
  });

  test("advances past a red replacement and globally queues a yellow replacement", () => {
    const afterRed = reconstruct([
      marker("AA", 1, "green"),
      marker("BB", 2, "yellow"),
      marker("CC", 3, "green"),
      marker("DD", 4, "yellow"),
      marker("EE", 5, "green"),
      marker("FF", 6, "red"),
    ], [decision("BB", "rejected")]);

    expect(afterRed).toMatchObject({
      nextUncheckedRank: 7,
      phase: "awaiting_decision",
      currentPromptCountryCode: "DD",
    });

    expect(reconstructCountryResolution({
      orderedCountryCodes: ["AA", "BB", "CC", "DD", "EE", "FF", "GG"],
      markers: [
        marker("AA", 1, "green"),
        marker("BB", 2, "yellow"),
        marker("CC", 3, "green"),
        marker("DD", 4, "yellow"),
        marker("EE", 5, "green"),
        marker("FF", 6, "red"),
        marker("GG", 7, "yellow"),
      ],
      decisions: [decision("BB", "rejected")],
    })).toMatchObject({
      slotCountryCodes: ["AA", "CC", "DD", "EE", "GG"],
      unresolvedCountryCodes: ["DD", "GG"],
      currentPromptCountryCode: "DD",
      phase: "awaiting_decision",
    });
  });

  test("terminates with five effective green entries or ranking exhaustion", () => {
    expect(reconstruct([
      marker("AA", 1, "green"), marker("BB", 2, "green"), marker("CC", 3, "green"),
      marker("DD", 4, "green"), marker("EE", 5, "green"),
    ])).toMatchObject({
      terminal: { stopCondition: "five_effective_green" },
    });

    expect(reconstruct([], [])).toEqual({
      unresolvedCountryCodes: [],
      slotCountryCodes: [],
      resolvedCountryCodes: [],
      nextUncheckedRank: 1,
      phase: "replacement_required",
    });

    expect(reconstructCountryResolution({
      orderedCountryCodes: [],
      markers: [],
      decisions: [],
    })).toEqual({
      unresolvedCountryCodes: [],
      slotCountryCodes: [],
      resolvedCountryCodes: [],
      nextUncheckedRank: 1,
      terminal: { resolvedEntries: [], stopCondition: "ranking_exhausted" },
    });

    expect(reconstruct([
      marker("AA", 1, "red"), marker("BB", 2, "red"), marker("CC", 3, "red"),
      marker("DD", 4, "red"), marker("EE", 5, "red"), marker("FF", 6, "red"),
    ])).toEqual({
      unresolvedCountryCodes: [],
      slotCountryCodes: [],
      resolvedCountryCodes: [],
      nextUncheckedRank: 7,
      terminal: { resolvedEntries: [], stopCondition: "ranking_exhausted" },
    });
  });

  test("rejects malformed decisions, marker projections, and persisted projections", () => {
    const markers = [marker("AA", 1, "yellow")];
    const invalidCases = [
      () => reconstruct(markers, [{ ...decision("AA", "accepted_at_own_risk"), formalMarkerDigest: "other" }]),
      () => reconstruct(markers, [{ ...decision("AA", "accepted_at_own_risk"), decidedAt: "2026-08-12" }]),
      () => reconstruct(markers, [{ ...decision("AA", "accepted_at_own_risk"), warningCopyVersion: "other" as "yellow-risk@1" }]),
      () => reconstruct(markers, [decision("AA", "accepted_at_own_risk"), decision("AA", "rejected")]),
      () => reconstruct([marker("AA", 1, "green")], [decision("AA", "rejected")]),
      () => reconstruct([marker("BB", 2, "green")]),
      () => reconstruct([marker("AA", 1, "green"), marker("AA", 2, "green")]),
      () => reconstruct([
        marker("AA", 1, "green"), marker("BB", 2, "green"), marker("CC", 3, "green"),
        marker("DD", 4, "green"), marker("EE", 5, "green"), marker("FF", 6, "green"),
      ]),
      () => reconstruct([{ ...marker("AA", 1, "yellow"), expectedUncertaintyBasis: { unknownRoutes: [] } }]),
      () => reconstruct([{ ...marker("AA", 1, "green"), expectedUncertaintyBasis: YELLOW_BASIS }]),
      () => reconstructCountryResolution({
        orderedCountryCodes: ORDERED_COUNTRY_CODES,
        markers,
        decisions: [],
        persisted: {
          unresolvedCountryCodes: [],
          slotCountryCodes: [],
          resolvedCountryCodes: [],
          nextUncheckedRank: 1,
        },
      }),
    ];

    for (const invalid of invalidCases) expect(invalid).toThrow("integrity_mismatch");
  });

  test("permits a decision for the first unresolved country while awaiting a decision", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];

    expect(() => assertCountryResolutionTransition({
      predecessor: semanticState(markers),
      successor: semanticState(markers, [decision("BB", "rejected")]),
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).not.toThrow();
  });

  test("permits the exact next-rank marker while replacement is required", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];
    const decisions = [decision("BB", "rejected")];

    expect(() => assertCountryResolutionTransition({
      predecessor: semanticState(markers, decisions),
      successor: semanticState([...markers, marker("FF", 6, "red")], decisions),
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).not.toThrow();
  });

  test("rejects a replacement marker while awaiting a decision", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];

    expect(() => assertCountryResolutionTransition({
      predecessor: semanticState(markers),
      successor: semanticState([...markers, marker("FF", 6, "red")]),
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).toThrow("integrity_mismatch");
  });

  test("rejects a decision while replacement is required", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];
    const decisions = [decision("BB", "rejected")];

    expect(() => assertCountryResolutionTransition({
      predecessor: semanticState(markers, decisions),
      successor: semanticState(markers, [...decisions, decision("DD", "accepted_at_own_risk")]),
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).toThrow("integrity_mismatch");
  });

  test("rejects a decision for a later unresolved country", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];

    expect(() => assertCountryResolutionTransition({
      predecessor: semanticState(markers),
      successor: semanticState(markers, [decision("DD", "accepted_at_own_risk")]),
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).toThrow("integrity_mismatch");
  });

  test("rejects no-op successors and any successor after resolution", () => {
    const markers = [marker("AA", 1, "green"), marker("BB", 2, "yellow"), marker("CC", 3, "green"), marker("DD", 4, "yellow"), marker("EE", 5, "green")];
    const predecessor = semanticState(markers);
    const resolved = semanticState([
      marker("AA", 1, "green"), marker("BB", 2, "green"), marker("CC", 3, "green"),
      marker("DD", 4, "green"), marker("EE", 5, "green"),
    ]);

    expect(() => assertCountryResolutionTransition({
      predecessor,
      successor: predecessor,
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).toThrow("integrity_mismatch");
    expect(() => assertCountryResolutionTransition({
      predecessor: resolved,
      successor: resolved,
      orderedCountryCodes: ORDERED_COUNTRY_CODES,
    })).toThrow("integrity_mismatch");
  });
});
