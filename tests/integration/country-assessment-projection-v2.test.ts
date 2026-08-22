import { describe, expect, test } from "vitest";

import {
  reconstructCountryAssessmentProjectionV2,
} from "../../src/application/country-assessment-projection-v2";

const PROFILE_ID = "profile-v2";
const EVIDENCE_ID = "evidence-v3";
const ROUTE_ID = "si-temporary-residence-digital-nomad";
const SELF_ID = "participant-self";
const SPOUSE_ID = "participant-spouse";

function projection() {
  return {
    schemaVersion: "country-assessment-projection@2",
    profileSnapshotId: PROFILE_ID,
    evidenceSnapshotId: EVIDENCE_ID,
    participantAssessments: [
      {
        routeId: ROUTE_ID,
        participantId: SELF_ID,
        relationship: "self",
        status: "unknown",
        reasonCodes: ["remote_work_prerequisite_unknown"],
        claimIds: ["route:citizenship", "route:remote-work"],
      },
      {
        routeId: ROUTE_ID,
        participantId: SPOUSE_ID,
        relationship: "spouse",
        status: "verified",
        reasonCodes: ["route_requirements_verified"],
        claimIds: ["route:citizenship", "route:companion"],
      },
    ],
  };
}

function expectedOrder() {
  return {
    profileSnapshotId: PROFILE_ID,
    evidenceSnapshotId: EVIDENCE_ID,
    orderedPairs: [
      { routeId: ROUTE_ID, participantId: SELF_ID },
      { routeId: ROUTE_ID, participantId: SPOUSE_ID },
    ],
  };
}

function expectIntegrityMismatch(
  value: unknown,
  expected: unknown = expectedOrder(),
): void {
  expect(() => reconstructCountryAssessmentProjectionV2(
    value,
    expected as Parameters<typeof reconstructCountryAssessmentProjectionV2>[1],
  )).toThrowError(new Error("integrity_mismatch"));
}

const REASON_CODES = [
  "citizenship_excluded",
  "citizenship_applicability_unknown",
  "companion_route_unverified",
  "companion_route_impossible",
  "passport_validity_insufficient",
  "passport_validity_unknown",
  "remote_continuation_unavailable",
  "remote_work_prerequisite_unknown",
  "income_below_verified_threshold",
  "income_basis_not_comparable",
  "fx_rate_unavailable",
  "fx_rate_stale",
  "country_evidence_incomplete",
  "country_not_installed",
  "route_requirements_verified",
] as const;

describe("Country Assessment V2 projection reconstruction", () => {
  test("preserves the independently supplied dense route-participant order", () => {
    expect(reconstructCountryAssessmentProjectionV2(
      projection(),
      expectedOrder(),
    )).toEqual(projection());
  });

  test("accepts the exact no-route projection without inventing participants", () => {
    const value = projection();
    value.participantAssessments = [];
    const expected = expectedOrder();
    expected.orderedPairs = [];

    expect(reconstructCountryAssessmentProjectionV2(value, expected)).toEqual(value);
  });

  test.each(REASON_CODES)("accepts the closed reason code %s", (reasonCode) => {
    const value = projection();
    value.participantAssessments = [{
      ...value.participantAssessments[0]!,
      reasonCodes: [reasonCode],
      claimIds: [],
    }];
    const expected = expectedOrder();
    expected.orderedPairs = [expected.orderedPairs[0]!];

    expect(reconstructCountryAssessmentProjectionV2(value, expected)).toEqual(value);
  });

  test.each([
    ["self", "verified"],
    ["spouse", "unknown"],
    ["minor_child", "impossible"],
    ["other_family", "unknown"],
  ] as const)("accepts closed relationship %s and status %s", (relationship, status) => {
    const value = projection();
    value.participantAssessments = [{
      ...value.participantAssessments[0]!,
      relationship,
      status,
    }];
    const expected = expectedOrder();
    expected.orderedPairs = [expected.orderedPairs[0]!];

    expect(reconstructCountryAssessmentProjectionV2(value, expected)).toEqual(value);
  });
});

describe("Country Assessment V2 projection exact bindings", () => {
  test.each([
    ["schema version", (value: ReturnType<typeof projection>) => {
      value.schemaVersion = "country-assessment-projection@3";
    }],
    ["profile snapshot", (value: ReturnType<typeof projection>) => {
      value.profileSnapshotId = "profile-other";
    }],
    ["Evidence Snapshot", (value: ReturnType<typeof projection>) => {
      value.evidenceSnapshotId = "evidence-other";
    }],
    ["missing top-level key", (value: ReturnType<typeof projection>) => {
      delete (value as unknown as Record<string, unknown>).schemaVersion;
    }],
    ["extra top-level key", (value: ReturnType<typeof projection>) => {
      Object.assign(value, { dossier: "must-not-cross-projection-boundary" });
    }],
  ] as const)("rejects %s drift", (_label, mutate) => {
    const value = projection();
    mutate(value);

    expectIntegrityMismatch(value);
  });

  test("rejects empty IDs even when both sides match", () => {
    const value = projection();
    value.profileSnapshotId = "";
    const expected = expectedOrder();
    expected.profileSnapshotId = "";

    expectIntegrityMismatch(value, expected);
  });

  test.each([
    ["missing pair", (value: ReturnType<typeof projection>) => {
      value.participantAssessments.pop();
    }],
    ["extra pair", (value: ReturnType<typeof projection>) => {
      value.participantAssessments.push({
        ...value.participantAssessments[1]!,
        participantId: "participant-extra",
      });
    }],
    ["reordered pair", (value: ReturnType<typeof projection>) => {
      value.participantAssessments.reverse();
    }],
    ["changed route", (value: ReturnType<typeof projection>) => {
      value.participantAssessments[0]!.routeId = "route-other";
    }],
    ["changed participant", (value: ReturnType<typeof projection>) => {
      value.participantAssessments[0]!.participantId = "participant-other";
    }],
  ] as const)("rejects %s relative to independently derived order", (_label, mutate) => {
    const value = projection();
    mutate(value);

    expectIntegrityMismatch(value);
  });

  test("rejects a duplicate pair even when orderedPairs repeats it", () => {
    const value = projection();
    value.participantAssessments[1]!.participantId = SELF_ID;
    const expected = expectedOrder();
    expected.orderedPairs[1]!.participantId = SELF_ID;

    expectIntegrityMismatch(value, expected);
  });

  test.each([
    ["extra expected key", (expected: ReturnType<typeof expectedOrder>) => {
      Object.assign(expected, { profile: "must-not-be-used-as-ordering-oracle" });
    }],
    ["extra pair key", (expected: ReturnType<typeof expectedOrder>) => {
      Object.assign(expected.orderedPairs[0]!, { relationship: "self" });
    }],
    ["empty route ID", (expected: ReturnType<typeof expectedOrder>) => {
      expected.orderedPairs[0]!.routeId = "";
    }],
  ] as const)("rejects malformed expected order: %s", (_label, mutate) => {
    const expected = expectedOrder();
    mutate(expected);

    expectIntegrityMismatch(projection(), expected);
  });
});

describe("Country Assessment V2 participant assessment reconstruction", () => {
  test.each([
    ["empty routeId", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.routeId = "";
    }],
    ["empty participantId", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.participantId = "";
    }],
    ["open relationship", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.relationship = "dependent";
    }],
    ["open status", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.status = "pending";
    }],
    ["empty reasons", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.reasonCodes = [];
    }],
    ["open reason", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.reasonCodes = ["future_reason"];
    }],
    ["duplicate reason", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.reasonCodes = [
        "remote_work_prerequisite_unknown",
        "remote_work_prerequisite_unknown",
      ];
    }],
    ["empty claim ID", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.claimIds = [""];
    }],
    ["duplicate claim ID", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      participant.claimIds = ["claim-1", "claim-1"];
    }],
    ["extra participant key", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      Object.assign(participant, { rawProfile: true });
    }],
    ["missing participant key", (participant: ReturnType<typeof projection>["participantAssessments"][number]) => {
      delete (participant as unknown as Record<string, unknown>).relationship;
    }],
  ] as const)("rejects %s", (_label, mutate) => {
    const value = projection();
    mutate(value.participantAssessments[0]!);

    expectIntegrityMismatch(value);
  });
});

describe("Country Assessment V2 descriptor-safe ownership", () => {
  test.each([
    ["projection", (value: ReturnType<typeof projection>) => {
      Object.setPrototypeOf(value, { inherited: true });
    }],
    ["participant", (value: ReturnType<typeof projection>) => {
      Object.setPrototypeOf(value.participantAssessments[0]!, { inherited: true });
    }],
    ["expected", (_value: ReturnType<typeof projection>, expected: ReturnType<typeof expectedOrder>) => {
      Object.setPrototypeOf(expected, { inherited: true });
    }],
    ["ordered pair", (_value: ReturnType<typeof projection>, expected: ReturnType<typeof expectedOrder>) => {
      Object.setPrototypeOf(expected.orderedPairs[0]!, { inherited: true });
    }],
  ] as const)("rejects a custom %s prototype", (_label, mutate) => {
    const value = projection();
    const expected = expectedOrder();
    mutate(value, expected);

    expectIntegrityMismatch(value, expected);
  });

  test.each([
    ["projection", (value: ReturnType<typeof projection>) =>
      Object.defineProperty(value, Symbol("unexpected"), { enumerable: true, value: true })],
    ["participant", (value: ReturnType<typeof projection>) =>
      Object.defineProperty(value.participantAssessments[0]!, Symbol("unexpected"), {
        enumerable: true,
        value: true,
      })],
    ["expected pair", (_value: ReturnType<typeof projection>, expected: ReturnType<typeof expectedOrder>) =>
      Object.defineProperty(expected.orderedPairs[0]!, Symbol("unexpected"), {
        enumerable: true,
        value: true,
      })],
  ] as const)("rejects a symbol property on %s", (_label, mutate) => {
    const value = projection();
    const expected = expectedOrder();
    mutate(value, expected);

    expectIntegrityMismatch(value, expected);
  });

  test("rejects accessors without invoking them", () => {
    const value = projection();
    let reads = 0;
    Object.defineProperty(value.participantAssessments[0]!, "status", {
      enumerable: true,
      get() {
        reads += 1;
        return "unknown";
      },
    });

    expectIntegrityMismatch(value);
    expect(reads).toBe(0);
  });

  test("rejects an expected-order accessor without invoking it", () => {
    const expected = expectedOrder();
    let reads = 0;
    Object.defineProperty(expected, "profileSnapshotId", {
      enumerable: true,
      get() {
        reads += 1;
        return PROFILE_ID;
      },
    });

    expectIntegrityMismatch(projection(), expected);
    expect(reads).toBe(0);
  });

  test.each([
    ["projection", (value: ReturnType<typeof projection>) => new Proxy(value, {})],
    ["nested participant", (value: ReturnType<typeof projection>) => {
      value.participantAssessments[0] = new Proxy(value.participantAssessments[0]!, {});
      return value;
    }],
    ["revoked projection", (value: ReturnType<typeof projection>) => Proxy.revocable(value, {}).proxy],
  ] as const)("rejects a %s Proxy as integrity_mismatch", (_label, wrap) => {
    expectIntegrityMismatch(wrap(projection()));
  });

  test.each([
    ["participant assessments", (value: ReturnType<typeof projection>) => {
      delete value.participantAssessments[0];
    }],
    ["reason codes", (value: ReturnType<typeof projection>) => {
      delete value.participantAssessments[0]!.reasonCodes[0];
    }],
    ["claim IDs", (value: ReturnType<typeof projection>) => {
      delete value.participantAssessments[0]!.claimIds[0];
    }],
  ] as const)("rejects a sparse %s array", (_label, makeSparse) => {
    const value = projection();
    makeSparse(value);

    expectIntegrityMismatch(value);
  });

  test("rejects a sparse orderedPairs array", () => {
    const expected = expectedOrder();
    delete expected.orderedPairs[0];

    expectIntegrityMismatch(projection(), expected);
  });

  test("rejects extra array properties", () => {
    const value = projection();
    Object.assign(value.participantAssessments, { rawParticipants: true });

    expectIntegrityMismatch(value);
  });

  test("takes a fresh deeply frozen copy without mutating its borrower", () => {
    const value = projection();
    const before = structuredClone(value);
    const first = reconstructCountryAssessmentProjectionV2(value, expectedOrder());
    const second = reconstructCountryAssessmentProjectionV2(value, expectedOrder());
    value.participantAssessments[0]!.reasonCodes[0] = "country_not_installed";

    expect(before).toEqual(projection());
    expect(first).toEqual(before);
    expect(first).not.toBe(value);
    expect(second).not.toBe(first);
    expect(second.participantAssessments).not.toBe(first.participantAssessments);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.participantAssessments)).toBe(true);
    expect(Object.isFrozen(first.participantAssessments[0])).toBe(true);
    expect(Object.isFrozen(first.participantAssessments[0]?.reasonCodes)).toBe(true);
    expect(Object.isFrozen(first.participantAssessments[0]?.claimIds)).toBe(true);
  });
});
