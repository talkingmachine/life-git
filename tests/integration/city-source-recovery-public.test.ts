import { describe, expect, test } from "vitest";

import { reconstructPublicFactSourceV1 } from "../../src/application/city-source-recovery";

const green = () => ({
  schemaVersion: "public-fact-source@1" as const,
  factKey: "si-city-safety",
  status: "green" as const,
  publisherName: "Slovenian Police",
  sourceUrl: "https://www.policija.si/statistics",
  checkedAt: "2026-08-29T12:00:00.000Z",
});

describe("reconstructPublicFactSourceV1", () => {
  test("owns and freezes the closed public source projection", () => {
    const input = green();
    const source = reconstructPublicFactSourceV1(input);

    expect(source).toEqual(input);
    expect(source).not.toBe(input);
    expect(Object.isFrozen(source)).toBe(true);
    input.publisherName = "tampered";
    expect(source.publisherName).toBe("Slovenian Police");
    expect(() => { (source as { publisherName: string }).publisherName = "tampered"; })
      .toThrow();
  });

  test.each([
    ["an extra field", { ...green(), candidateUrl: "https://candidate.example/secret" }],
    ["a symbol field", (() => {
      const value = green();
      Object.defineProperty(value, Symbol("internal"), { value: "secret", enumerable: true });
      return value;
    })()],
    ["an accessor", (() => {
      const value = green();
      Object.defineProperty(value, "sourceUrl", { enumerable: true, get: () => "https://candidate.example/secret" });
      return value;
    })()],
    ["a proxy", new Proxy(green(), {})],
  ])("rejects %s before it can cross the public boundary", (_name, hostile) => {
    expect(() => reconstructPublicFactSourceV1(hostile)).toThrow("invalid_public_fact_source");
  });

  test.each([
    ["yellow with provenance", { ...green(), status: "yellow" as const }],
    ["green with absent provenance", { ...green(), publisherName: null, sourceUrl: null, checkedAt: null }],
    ["a noncanonical HTTPS URL", { ...green(), sourceUrl: "https://www.policija.si" }],
    ["a non-ISO timestamp", { ...green(), checkedAt: "2026-08-29" }],
  ])("rejects %s", (_name, source) => {
    expect(() => reconstructPublicFactSourceV1(source)).toThrow("invalid_public_fact_source");
  });

  test("accepts the intentionally provenance-free yellow terminal source", () => {
    const yellow = reconstructPublicFactSourceV1({
      schemaVersion: "public-fact-source@1",
      factKey: "si-city-safety",
      status: "yellow",
      publisherName: null,
      sourceUrl: null,
      checkedAt: null,
    });

    expect(yellow).toEqual({
      schemaVersion: "public-fact-source@1",
      factKey: "si-city-safety",
      status: "yellow",
      publisherName: null,
      sourceUrl: null,
      checkedAt: null,
    });
    expect(Object.isFrozen(yellow)).toBe(true);
  });
});
