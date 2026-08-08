import { describe, expect, test } from "vitest";

import { confirmProfile } from "../../src/decision/profile";

const clock = () => new Date("2026-08-07T12:00:00.000Z");

const completeDraft = {
  availableResourcesAll: "408000.00",
  monthlyIncome: { amount: "210000.00", currency: "RUB" },
  incomeBasis: "foreign_contract",
  companionBasis: "none",
  relationship: "none",
  conditions: {
    incomeContinues12Months: true,
    lawfulStayPrerequisiteAccepted: true,
    stagedSpouseRouteAccepted: false,
  },
};

describe("confirmProfile", () => {
  test("rejects extra PII and free-text relationship fields", () => {
    expect(() => confirmProfile({ ...completeDraft, name: "Ada Lovelace" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, passportNumber: "AA123456" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, companionBasis: "family", relationship: "spouse Anna" }, clock)).toThrow();
  });

  test("requires strict RUB monthly income and rejects ambiguous or out-of-range amounts", () => {
    expect(() => confirmProfile({ ...completeDraft, monthlyIncome: { amount: "210000", currency: "ALL" } }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, futureIncomeAll: "210000" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, availableResourcesAll: "-1" }, clock)).toThrow();
    expect(() => confirmProfile({ ...completeDraft, monthlyIncome: { amount: "1000000000", currency: "RUB" } }, clock)).toThrow();
  });

  test("normalizes the profile, fixes confirmation time, and creates a stable SHA-256 id", () => {
    const first = confirmProfile(completeDraft, clock);
    const second = confirmProfile({ ...completeDraft, availableResourcesAll: "408000" }, clock);

    expect(first).toMatchObject({
      confirmedAt: "2026-08-07T12:00:00.000Z",
      profile: {
        ...completeDraft,
        availableResourcesAll: "408000",
        monthlyIncome: { amount: "210000", currency: "RUB" },
      },
    });
    expect(first.id).toBe("e825045bca4ae540729fdd656f365ce1a443f2058680e13f55006d58329b4386");
    expect(second.id).toBe(first.id);
  });

  test("returns an immutable snapshot including its nested profile", () => {
    const snapshot = confirmProfile(completeDraft, clock);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.profile)).toBe(true);
    expect(Object.isFrozen(snapshot.profile.monthlyIncome)).toBe(true);
    expect(Object.isFrozen(snapshot.profile.conditions)).toBe(true);
    expect(() => {
      (snapshot.profile.monthlyIncome as { amount: string }).amount = "1";
    }).toThrow();
  });

  test("requires exact typed scenario confirmations and binds them into the profile id", () => {
    expect(() => confirmProfile({
      ...completeDraft,
      conditions: { ...completeDraft.conditions, incomeContinues12Months: false },
    }, clock)).not.toThrow();
    expect(() => confirmProfile({
      ...completeDraft,
      conditions: { ...completeDraft.conditions, lawfulStayPrerequisiteAccepted: "yes" },
    }, clock)).toThrow();
    expect(() => confirmProfile({
      ...completeDraft,
      conditions: { ...completeDraft.conditions, stagedSpouseRouteAccepted: true },
    }, clock)).toThrow();
    expect(confirmProfile({
      ...completeDraft,
      conditions: { ...completeDraft.conditions, incomeContinues12Months: false },
    }, clock).id).not.toBe(confirmProfile(completeDraft, clock).id);
  });
});
