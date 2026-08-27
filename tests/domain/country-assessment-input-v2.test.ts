import { describe, expect, test } from "vitest";

import {
  projectCountryAssessmentInputV2,
  reconstructCountryAssessmentInputV2,
} from "../../src/decision/country-assessment-input-v2";
import {
  materializeRelocationProfileV2,
  type RelocationProfileV2Snapshot,
} from "../../src/decision/relocation-profile";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const CHILD_ID = "00000000-0000-4000-8000-000000000002";
const CONFIRMED_AT = "2026-08-22T10:00:00.000Z";

function profile(): RelocationProfileV2Snapshot {
  return materializeRelocationProfileV2({
    confirmedAt: CONFIRMED_AT,
    profile: {
      schemaVersion: "relocation-profile@2",
      profile: {
        currentLocation: { countryCode: "RU", city: "Moscow" },
        moveHorizon: "3_to_6_months",
        movingParty: "with_companions",
        participants: [
          {
            participantId: SELF_ID,
            relationship: "self",
            citizenships: ["RU", "RS"],
            passport: { validUntil: "2031-05-20" },
            currentWork: {
              applicability: "required",
              value: { status: "employment", occupation: "Engineer" },
            },
            remoteContinuation: { applicability: "required", value: "yes" },
            monthlyIncome: {
              applicability: "required",
              value: { amount: "250000.5", currency: "RUB", basis: "net" },
            },
            education: {
              applicability: "required",
              value: { level: "higher", field: "Physics" },
            },
            relevantExperienceYears: { applicability: "required", value: 7 },
          },
          {
            participantId: CHILD_ID,
            relationship: "minor_child",
            citizenships: ["RU"],
            passport: "absent",
            currentWork: { applicability: "not_applicable" },
            remoteContinuation: { applicability: "not_applicable" },
            monthlyIncome: { applicability: "not_applicable" },
            education: { applicability: "not_applicable" },
            relevantExperienceYears: { applicability: "not_applicable" },
          },
        ],
        savings: { min: "1000", max: "15000.75", currency: "EUR" },
      },
    },
  });
}

describe("CountryAssessmentInputV2", () => {
  test("projects every profile field losslessly with the exact snapshot binding", () => {
    // Break caught: dropping or aggregating a participant/profile field in the assessment projection.
    const source = profile();
    const projected = projectCountryAssessmentInputV2(source);

    expect(projected).toEqual({
      schemaVersion: "country-assessment-input@2",
      profileSnapshotId: source.id,
      profile: source,
    });
    expect(projected.profile).not.toBe(source);
    expect(projected.profile.profile.participants).not.toBe(source.profile.participants);
    expect(projected.profile.profile.participants.map(({ participantId }) => participantId))
      .toEqual([SELF_ID, CHILD_ID]);
    expect(Object.keys(projected)).toEqual([
      "schemaVersion",
      "profileSnapshotId",
      "profile",
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/aggregate|route|verdict/i);
  });

  test("reconstructs a fresh deeply frozen value and isolates it from borrowed mutations", () => {
    // Break caught: returning the caller-owned graph or leaving a nested participant mutable.
    const source = profile();
    const borrowed = structuredClone({
      schemaVersion: "country-assessment-input@2" as const,
      profileSnapshotId: source.id,
      profile: source,
    });

    const reconstructed = reconstructCountryAssessmentInputV2(borrowed);
    (borrowed.profile.profile.currentLocation as { city: string }).city = "Changed";

    expect(reconstructed.profile.profile.currentLocation.city).toBe("Moscow");
    expect(reconstructed).not.toBe(borrowed);
    expect(reconstructed.profile).not.toBe(borrowed.profile);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile.currentLocation)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile.participants)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile.participants[0])).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile.participants[0]?.citizenships)).toBe(true);
    expect(Object.isFrozen(reconstructed.profile.profile.participants[0]?.monthlyIncome)).toBe(true);
  });

  test("requires exact schema, ID binding, participant order, and typed applicability", () => {
    // Break caught: accepting a profile under a different assessment binding or a lossy roster.
    const source = profile();
    const valid = {
      schemaVersion: "country-assessment-input@2" as const,
      profileSnapshotId: source.id,
      profile: source,
    };

    expect(() => reconstructCountryAssessmentInputV2({
      ...valid,
      schemaVersion: "country-assessment-input@1",
    })).toThrow(TypeError);
    expect(() => reconstructCountryAssessmentInputV2({
      ...valid,
      profileSnapshotId: "0".repeat(64),
    })).toThrow(TypeError);

    const reversed = structuredClone(valid) as unknown as {
      profile: RelocationProfileV2Snapshot & { profile: { participants: unknown[] } };
    };
    reversed.profile.profile.participants.reverse();
    expect(() => reconstructCountryAssessmentInputV2(reversed)).toThrow(TypeError);

    const invalidApplicability = structuredClone(valid) as unknown as {
      profile: RelocationProfileV2Snapshot & {
        profile: { participants: Array<{ monthlyIncome: unknown }> };
      };
    };
    invalidApplicability.profile.profile.participants[1]!.monthlyIncome = {
      applicability: "required",
      value: { amount: "0", currency: "EUR", basis: "net" },
    };
    expect(() => reconstructCountryAssessmentInputV2(invalidApplicability)).toThrow(TypeError);
  });

  test("rejects hostile descriptors without invoking accessors", () => {
    // Break caught: reading a borrowed accessor while validating the assessment envelope.
    const source = profile();
    const withTopLevelGetter = {
      schemaVersion: "country-assessment-input@2",
      profileSnapshotId: source.id,
      profile: source,
    };
    let topLevelReads = 0;
    Object.defineProperty(withTopLevelGetter, "profileSnapshotId", {
      enumerable: true,
      get: () => {
        topLevelReads += 1;
        return source.id;
      },
    });
    expect(() => reconstructCountryAssessmentInputV2(withTopLevelGetter)).toThrow(TypeError);
    expect(topLevelReads).toBe(0);

    const withNestedGetter = structuredClone({
      schemaVersion: "country-assessment-input@2",
      profileSnapshotId: source.id,
      profile: source,
    });
    let nestedReads = 0;
    Object.defineProperty(withNestedGetter.profile.profile.currentLocation, "city", {
      enumerable: true,
      get: () => {
        nestedReads += 1;
        return "Moscow";
      },
    });
    expect(() => reconstructCountryAssessmentInputV2(withNestedGetter)).toThrow(TypeError);
    expect(nestedReads).toBe(0);

    const withCustomPrototype = structuredClone({
      schemaVersion: "country-assessment-input@2",
      profileSnapshotId: source.id,
      profile: source,
    });
    Object.setPrototypeOf(withCustomPrototype, { inherited: true });
    expect(() => reconstructCountryAssessmentInputV2(withCustomPrototype)).toThrow(TypeError);
  });
});
