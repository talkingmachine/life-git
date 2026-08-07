import { describe, expect, test } from "vitest";

import { confirmProfile } from "../../src/decision/profile";

const clock = () => new Date("2026-08-07T12:00:00.000Z");

const completeDraft = {
  currency: "ALL",
  availableResourcesAll: "408000.00",
  futureIncomeAll: "125000",
  incomeBasis: "foreign_contract",
  companionBasis: "none",
  relationship: "none",
};

describe("confirmProfile", () => {
  test("rejects extra PII and free-text relationship fields", () => {
    expect(() => confirmProfile({ ...completeDraft, name: "Ada Lovelace" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, passportNumber: "AA123456" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, companionBasis: "family", relationship: "spouse Anna" }, clock)).toThrow();
  });

  test("rejects a non-ALL currency and out-of-range decimal values", () => {
    expect(() => confirmProfile({ ...completeDraft, currency: "RUB" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, availableResourcesAll: "-1" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, futureIncomeAll: "1000000000" }, clock)).toThrow();
  });

  test("normalizes the profile, fixes confirmation time, and creates a stable SHA-256 id", () => {
    const first = confirmProfile(completeDraft, clock);
    const second = confirmProfile({ ...completeDraft, availableResourcesAll: "408000" }, clock);

    expect(first).toMatchObject({
      confirmedAt: "2026-08-07T12:00:00.000Z",
      profile: { ...completeDraft, availableResourcesAll: "408000" },
    });
    expect(first.id).toBe("4454d3425ce66ad76cc9f7371e29962f703c8ab10017a8b4689f0296c07f390a");
    expect(second.id).toBe(first.id);
  });

  test("returns an immutable snapshot including its nested profile", () => {
    const snapshot = confirmProfile(completeDraft, clock);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.profile)).toBe(true);
    expect(() => {
      (snapshot.profile as { currency: string }).currency = "RUB";
    }).toThrow();
  });
});
