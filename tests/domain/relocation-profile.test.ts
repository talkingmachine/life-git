import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { materializePreferenceProfileV2 } from "../../src/decision/preference-profile";
import {
  confirmRelocationProfile,
  materializeRelocationProfileV2,
  reconstructRelocationProfileV2,
  type RelocationProfileV2Snapshot,
} from "../../src/decision/relocation-profile";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const COMPANION_ID = "00000000-0000-4000-8000-000000000002";
const RELOCATION_V2_ID = "b97bc2dcebc6160a5f599ea0633f2f1f1e14fbdeebbb68e7b2b79ee60142388f";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function relocationPayload() {
  return {
    schemaVersion: "relocation-profile@2" as const,
    profile: {
      currentLocation: { countryCode: "RU", city: "Moscow" },
      moveHorizon: "within_3_months" as const,
      movingParty: "with_companions" as const,
      participants: [
        {
          participantId: SELF_ID,
          relationship: "self" as const,
          citizenships: ["RU"],
          passport: { validUntil: "2030-01-01" },
          currentWork: { applicability: "required" as const, value: { status: "employment" as const, occupation: "Engineer" } },
          remoteContinuation: { applicability: "required" as const, value: "yes" as const },
          monthlyIncome: { applicability: "required" as const, value: { amount: "0", currency: "RUB", basis: "net" as const } },
          education: { applicability: "required" as const, value: { level: "higher" as const, field: "Physics" } },
          relevantExperienceYears: { applicability: "required" as const, value: 0 },
        },
        {
          participantId: COMPANION_ID,
          relationship: "minor_child" as const,
          citizenships: ["RU", "RS"],
          passport: "absent" as const,
          currentWork: { applicability: "not_applicable" as const },
          remoteContinuation: { applicability: "not_applicable" as const },
          monthlyIncome: { applicability: "not_applicable" as const },
          education: { applicability: "not_applicable" as const },
          relevantExperienceYears: { applicability: "not_applicable" as const },
        },
      ] as const,
      savings: { min: "0", max: "10000.50", currency: "EUR" },
    },
  };
}

function withContentId(value: object): unknown {
  const payload = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "id"),
  );
  return {
    ...payload,
    id: createHash("sha256").update(JSON.stringify(canonicalValue(payload))).digest("hex"),
  };
}

describe("relocation profiles", () => {
  test("preserves the established relocation-profile@1 value and ID exactly", () => {
    const snapshot = confirmRelocationProfile({
      currentCountryCode: "RU",
      citizenships: ["RU"],
      monthlyIncome: { amount: "210000.00", currency: "RUB", basis: "net" },
      remoteWork: { relation: "foreign_employment", legallyAllowed: true },
      education: "none",
      relevantExperienceYears: 6,
      passportValidUntil: "2029-11-30",
      healthInsurance: "confirmed",
      companions: [
        { relationship: "minor_child" },
        { relationship: "spouse" },
        { relationship: "minor_child" },
      ],
    }, () => new Date("2026-08-11T09:15:00.000Z"));

    expect(snapshot).toEqual({
      schemaVersion: "relocation-profile@1",
      id: "006f978ccb642469af54b2241b31f794c85123c211970fd4dac12c559fb6227e",
      confirmedAt: "2026-08-11T09:15:00.000Z",
      profile: {
        currentCountryCode: "RU",
        citizenships: ["RU"],
        monthlyIncome: { amount: "210000", currency: "RUB", basis: "net" },
        remoteWork: { relation: "foreign_employment", legallyAllowed: true },
        education: "none",
        relevantExperienceYears: 6,
        passportValidUntil: "2029-11-30",
        healthInsurance: "confirmed",
        companions: [
          { relationship: "spouse" },
          { relationship: "minor_child" },
          { relationship: "minor_child" },
        ],
      },
    });
  });

  test("reconstructs the exact participant-ordered @2 snapshot as a fresh frozen value", () => {
    const confirmedAt = "2026-08-22T10:00:00.000Z";
    const payload = { ...relocationPayload(), confirmedAt };
    const borrowed = { ...payload, id: RELOCATION_V2_ID } as RelocationProfileV2Snapshot;

    const reconstructed = reconstructRelocationProfileV2(borrowed);

    expect(reconstructed).toEqual(borrowed);
    expect(reconstructed).not.toBe(borrowed);
    expect(reconstructed.profile.participants.map(({ participantId }) => participantId)).toEqual([
      SELF_ID,
      COMPANION_ID,
    ]);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.participants[0]?.monthlyIncome)).toBe(true);
  });

  test("rejects tampered hashes, order, applicability, timestamps, and hostile records", () => {
    const confirmedAt = "2026-08-22T10:00:00.000Z";
    const payload = { ...relocationPayload(), confirmedAt };
    const snapshot = { ...payload, id: RELOCATION_V2_ID };

    expect(() => reconstructRelocationProfileV2({ ...snapshot, id: "0".repeat(64) })).toThrow(TypeError);
    expect(() => reconstructRelocationProfileV2({ ...snapshot, confirmedAt: "2026-08-22" })).toThrow(TypeError);
    const wrongOrder = structuredClone(snapshot) as unknown as {
      profile: { participants: unknown[] };
    };
    wrongOrder.profile.participants.reverse();
    expect(() => reconstructRelocationProfileV2(withContentId(wrongOrder))).toThrow(TypeError);
    const wrongApplicability = structuredClone(snapshot) as unknown as {
      profile: { participants: { monthlyIncome: unknown }[] };
    };
    wrongApplicability.profile.participants[1]!.monthlyIncome = {
      applicability: "required",
      value: { amount: "0", currency: "EUR", basis: "net" },
    } as never;
    expect(() => reconstructRelocationProfileV2(withContentId(wrongApplicability))).toThrow(TypeError);

    const duplicateParticipant = structuredClone(snapshot) as unknown as {
      profile: { participants: { participantId: string }[] };
    };
    duplicateParticipant.profile.participants[1]!.participantId = SELF_ID;
    expect(() => reconstructRelocationProfileV2(withContentId(duplicateParticipant))).toThrow(TypeError);

    const invalidParticipantId = structuredClone(snapshot) as unknown as {
      profile: { participants: { participantId: string }[] };
    };
    invalidParticipantId.profile.participants[1]!.participantId = "COMPANION";
    expect(() => reconstructRelocationProfileV2(withContentId(invalidParticipantId))).toThrow(TypeError);

    const withGetter = structuredClone(snapshot);
    let accessorReads = 0;
    Object.defineProperty(withGetter.profile, "movingParty", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return "with_companions";
      },
    });
    expect(() => reconstructRelocationProfileV2(withGetter)).toThrow(TypeError);
    expect(accessorReads).toBe(0);

    const withSymbol = structuredClone(snapshot);
    Object.defineProperty(withSymbol.profile, Symbol("hidden"), { value: true, enumerable: true });
    expect(() => reconstructRelocationProfileV2(withSymbol)).toThrow(TypeError);

    const withHiddenKey = structuredClone(snapshot);
    Object.defineProperty(withHiddenKey.profile.currentLocation, "hidden", {
      value: true,
      enumerable: false,
    });
    expect(() => reconstructRelocationProfileV2(withHiddenKey)).toThrow(TypeError);

    const withCustomPrototype = structuredClone(snapshot);
    Object.setPrototypeOf(withCustomPrototype.profile, { inherited: true });
    expect(() => reconstructRelocationProfileV2(withCustomPrototype)).toThrow(TypeError);

    const withSparseArray = structuredClone(snapshot) as unknown as {
      profile: { participants: unknown[] };
    };
    delete withSparseArray.profile.participants[0];
    expect(() => reconstructRelocationProfileV2(withSparseArray)).toThrow(TypeError);

    const withExtraArrayProperty = structuredClone(snapshot);
    Object.defineProperty(withExtraArrayProperty.profile.participants, "extra", {
      value: true,
      enumerable: true,
    });
    expect(() => reconstructRelocationProfileV2(withExtraArrayProperty)).toThrow(TypeError);

    const withCycle = structuredClone(snapshot) as unknown as {
      profile: { currentLocation: unknown };
    };
    withCycle.profile.currentLocation = withCycle.profile;
    expect(() => reconstructRelocationProfileV2(withCycle)).toThrow(TypeError);
  });

  test("rejects more than twenty participants at the standalone @2 boundary", () => {
    const value = structuredClone(relocationPayload()) as unknown as {
      profile: { participants: Array<Record<string, unknown>> };
    };
    const self = value.profile.participants[0]!;
    const companion = value.profile.participants[1]!;
    value.profile.participants = [
      self,
      ...Array.from({ length: 20 }, (_, index) => ({
        ...companion,
        participantId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      })),
    ];

    expect(() => materializeRelocationProfileV2({
      confirmedAt: "2026-08-22T10:00:00.000Z",
      profile: value as never,
    })).toThrow(TypeError);
  });

  test("materializes profile and preferences with one exact timestamp", () => {
    const profile = relocationPayload();
    const preferences = {
      schemaVersion: "preference-profile@2" as const,
      countryCriteria: [
        { id: "outside_cis", mode: "required", importance: 3, target: "required_true" },
        { id: "europe", mode: "required", importance: 3, target: "required_true" },
        { id: "personal_safety", mode: "required", importance: 3, target: "required_true" },
        { id: "infrastructure", mode: "required", importance: 3, target: "required_true" },
        { id: "peace_and_stability", mode: "required", importance: 3, target: "required_true" },
      ] as const,
      cityCriteria: [
        { id: "safety", mode: "weighted", importance: 3, target: "safe" },
        { id: "long_term_rent", mode: "weighted", importance: 3, target: "available" },
        { id: "urban_transit", mode: "weighted", importance: 3, target: "good" },
        { id: "fixed_broadband", mode: "weighted", importance: 3, target: "fast" },
      ] as const,
    };
    const confirmedAt = "2026-08-22T10:00:00.000Z";

    const snapshots = {
      profile: materializeRelocationProfileV2({ confirmedAt, profile }),
      preferences: materializePreferenceProfileV2({ confirmedAt, preferences }),
    };

    expect(snapshots.profile.confirmedAt).toBe(confirmedAt);
    expect(snapshots.preferences.confirmedAt).toBe(confirmedAt);
    expect(snapshots.profile.id).toBe(RELOCATION_V2_ID);
    expect(snapshots.preferences.id).toBe(
      "aa2f445dbeb13fd2c40c20dc5ad2ead4242956f5595f86e473211614036d8156",
    );
  });
});
