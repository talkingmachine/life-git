import { describe, expect, test } from "vitest";

import {
  OfficialSourceDiscoveryError,
  reconstructOfficialSourceDiscoveryRequest,
} from "../../src/application/official-source-discovery";

function request(): Record<string, unknown> {
  return {
    schemaVersion: "official-source-discovery-request@1",
    entity: { entityId: "country-rs", kind: "country", countryCode: "RS", displayName: "Serbia" },
    fact: { factKey: "residence.permit", definitionId: "residence-permit@1", description: "Residence permit requirements" },
    failedSource: { url: "https://www.mup.gov.rs/", reason: "stale" },
    authorityRoots: [{ publisherName: "Ministry of Interior", url: "https://www.mup.gov.rs/" }],
    localeHints: ["en", "sr"],
    round: 1,
    signal: new AbortController().signal,
  };
}

describe("official source discovery request", () => {
  test("reconstructs and freezes only bounded public data", () => {
    const input = request() as { entity: { displayName: string } };
    const rebuilt = reconstructOfficialSourceDiscoveryRequest(input);
    input.entity.displayName = "changed after validation";

    expect(rebuilt.entity.displayName).toBe("Serbia");
    expect(Object.isFrozen(rebuilt)).toBe(true);
    expect(Object.isFrozen(rebuilt.authorityRoots)).toBe(true);
    expect(Object.isFrozen(rebuilt.authorityRoots[0])).toBe(true);
  });

  test.each([
    { ...request(), extra: true },
    Object.defineProperty(request(), "round", { enumerable: true, get: () => 1 }),
    new Proxy(request(), {}),
    { ...request(), authorityRoots: Array.from({ length: 9 }, () => ({ publisherName: "A", url: "https://a.example/" })) },
    { ...request(), localeHints: Array.from({ length: 9 }, () => "en") },
    { ...request(), failedSource: { url: "http://example.com/", reason: "stale" } },
    { ...request(), failedSource: { url: "https://user:pass@example.com/", reason: "stale" } },
    { ...request(), failedSource: { url: "https://example.com/#fragment", reason: "stale" } },
    { ...request(), failedSource: { url: "https://EXAMPLE.com/", reason: "stale" } },
  ])("rejects unsafe or noncanonical input before discovery", (input) => {
    expect(() => reconstructOfficialSourceDiscoveryRequest(input)).toThrow(OfficialSourceDiscoveryError);
  });
});
