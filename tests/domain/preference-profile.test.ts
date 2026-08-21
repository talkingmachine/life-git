import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  confirmPreferenceProfile,
  reconstructPreferenceProfileV2,
  type PreferenceProfileV2Snapshot,
} from "../../src/decision/preference-profile";

const CONFIRMED_AT = "2026-08-12T08:00:00.000Z";
const PREFERENCE_V2_ID = "42ba7cadd707fc7b9a15e2b17fac544bd5605b50234ad1fcdec0ee29d712dea0";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function preferencePayload() {
  return {
    schemaVersion: "preference-profile@2" as const,
    countryCriteria: [
      { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
      { id: "europe", mode: "weighted", importance: 4, target: "maximize" },
      { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
      { id: "infrastructure", mode: "weighted", importance: 3, target: "maximize" },
      { id: "peace_and_stability", mode: "required", importance: 5, target: "required_true" },
    ] as const,
    cityCriteria: [
      { id: "safety", mode: "required", importance: 5, target: "low violent crime" },
      { id: "long_term_rent", mode: "weighted", importance: 4, target: "under 1200 EUR" },
      { id: "urban_transit", mode: "weighted", importance: 3, target: "frequent service" },
      { id: "fixed_broadband", mode: "weighted", importance: 2, target: "500 Mbps" },
    ] as const,
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

describe("preference profiles", () => {
  test("preserves the established subset-based preference-profile@1 value and ID exactly", () => {
    const snapshot = confirmPreferenceProfile({
      criteria: [
        { id: "peace_and_stability", mode: "weighted", importance: 2, target: "maximize" },
        { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
        { id: "infrastructure", mode: "weighted", importance: 3, target: "maximize" },
      ],
    }, () => new Date(CONFIRMED_AT));

    expect(snapshot).toEqual({
      schemaVersion: "preference-profile@1",
      id: "0e262ae57dba3937dfd93c8820a8bc7a4ce0b14149e0a218355bd021e4b80127",
      confirmedAt: CONFIRMED_AT,
      criteria: [
        { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
        { id: "infrastructure", mode: "weighted", importance: 3, target: "maximize" },
        { id: "peace_and_stability", mode: "weighted", importance: 2, target: "maximize" },
      ],
    });
  });

  test("reconstructs exact five-country and four-city tuples as fresh frozen values", () => {
    const payload = { ...preferencePayload(), confirmedAt: "2026-08-22T10:00:00.000Z" };
    const borrowed = { ...payload, id: PREFERENCE_V2_ID } as PreferenceProfileV2Snapshot;

    const reconstructed = reconstructPreferenceProfileV2(borrowed);

    expect(reconstructed).toEqual(borrowed);
    expect(reconstructed).not.toBe(borrowed);
    expect(reconstructed.countryCriteria).toHaveLength(5);
    expect(reconstructed.cityCriteria).toHaveLength(4);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.countryCriteria[0])).toBe(true);
  });

  test("rejects tuple drift, mode-target mismatch, tampering, and hostile records", () => {
    const payload = { ...preferencePayload(), confirmedAt: "2026-08-22T10:00:00.000Z" };
    const snapshot = { ...payload, id: PREFERENCE_V2_ID };

    expect(() => reconstructPreferenceProfileV2({ ...snapshot, id: "0".repeat(64) })).toThrow(TypeError);
    const missing = structuredClone(snapshot) as unknown as { countryCriteria: unknown[] };
    missing.countryCriteria.pop();
    expect(() => reconstructPreferenceProfileV2(withContentId(missing))).toThrow(TypeError);
    const wrongOrder = structuredClone(snapshot) as unknown as { cityCriteria: unknown[] };
    wrongOrder.cityCriteria.reverse();
    expect(() => reconstructPreferenceProfileV2(withContentId(wrongOrder))).toThrow(TypeError);
    const mismatch = structuredClone(snapshot) as unknown as {
      countryCriteria: { target: string }[];
    };
    mismatch.countryCriteria[0]!.target = "maximize";
    expect(() => reconstructPreferenceProfileV2(withContentId(mismatch))).toThrow(TypeError);
    const extra = structuredClone(snapshot) as Record<string, unknown>;
    extra.transcript = "forbidden";
    expect(() => reconstructPreferenceProfileV2(extra)).toThrow(TypeError);
    const withGetter = structuredClone(snapshot);
    Object.defineProperty(withGetter, "schemaVersion", { enumerable: true, get: () => "preference-profile@2" });
    expect(() => reconstructPreferenceProfileV2(withGetter)).toThrow(TypeError);
  });
});
