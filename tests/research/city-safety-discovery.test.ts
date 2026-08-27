import { describe, expect, test } from "vitest";

import {
  canonicalizeCitySafetyCandidateUrl,
  chooseCitySafetyUnknownReason,
} from "../../src/research/city-safety-discovery";
import type {
  CitySafetyCandidateAttempt,
  CitySafetyCandidateRejectionReason,
  CitySafetyQueryAttempt,
} from "../../src/research/city-safety-evidence";

const TRACE = {
  initialUrl: "https://official.example/report",
  edges: [],
  lastTrustedUrl: "https://official.example/report",
  officialHops: 0,
} as const;

function rejected(reason: CitySafetyCandidateRejectionReason): CitySafetyCandidateAttempt {
  return {
    index: 0,
    origin: { kind: "configured", configuredRouteIndex: 0 },
    canonicalUrl: TRACE.initialUrl,
    officialTrace: TRACE,
    artifactRefs: [],
    disposition: "rejected",
    reason,
  };
}

function unavailableQuery(reason: "provider_unavailable" | "search_provider_unconfigured"):
CitySafetyQueryAttempt {
  return {
    index: 0,
    queryId: "city-safety-query:run-1:1",
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    providerId: "provider-1",
    query: "exact query",
    searchedAt: "2026-03-01T12:00:00.000Z",
    outcome: { kind: "unavailable", reason },
  };
}

describe("city-safety candidate URL canonicalization", () => {
  test("normalizes only URL syntax while preserving query order and values", () => {
    // Break caught: dedup either misses equivalent syntax or strips discovery-significant query data.
    expect(canonicalizeCitySafetyCandidateUrl(
      "https://BÜCHER.Example:443/a/../report?utm_source=x&b=2&a=1#page=4",
    )).toBe("https://xn--bcher-kva.example/report?utm_source=x&b=2&a=1");
  });

  test.each([
    "http://official.example/report",
    "https://user:secret@official.example/report",
    "/relative/report",
    "not a url",
  ])("rejects non-official candidate syntax %s", (value) => {
    // Break caught: credentials, plaintext transport, or caller-relative locations enter the official queue.
    expect(() => canonicalizeCitySafetyCandidateUrl(value)).toThrow("invalid_city_safety_candidate_url");
  });
});

describe("city-safety terminal unknown policy", () => {
  test.each([
    ["transport_unavailable", "source_unavailable"],
    ["wrong_media_type", "source_unavailable"],
    ["too_large", "source_unavailable"],
    ["retention_unapproved", "source_unavailable"],
    ["stale", "stale"],
    ["scope_mismatch", "not_comparable"],
    ["definition_mismatch", "not_comparable"],
    ["missing_numerator", "not_comparable"],
    ["denominator_missing", "not_comparable"],
    ["denominator_zero", "not_comparable"],
    ["denominator_period_mismatch", "not_comparable"],
    ["denominator_scope_mismatch", "not_comparable"],
    ["http_not_found", "not_found"],
    ["authority_untrusted", "not_found"],
    ["untrusted_redirect", "not_found"],
  ] as const)("maps %s to %s", (reason, expected) => {
    // Break caught: a closed attempt class is published under the wrong Decision unknown reason.
    expect(chooseCitySafetyUnknownReason([rejected(reason)], [])).toBe(expected);
  });

  test("applies conflict then unavailable then stale then incomparable then not-found precedence", () => {
    // Break caught: queue order, rather than the approved safety precedence, selects terminal meaning.
    const attempts = [
      rejected("http_not_found"),
      rejected("scope_mismatch"),
      rejected("stale"),
      rejected("too_large"),
      rejected("conflict"),
    ];
    expect(chooseCitySafetyUnknownReason(attempts, [])).toBe("conflict");
    expect(chooseCitySafetyUnknownReason(attempts.slice(0, -1), [])).toBe("source_unavailable");
    expect(chooseCitySafetyUnknownReason(attempts.slice(0, -2), [])).toBe("stale");
    expect(chooseCitySafetyUnknownReason(attempts.slice(0, -3), [])).toBe("not_comparable");
    expect(chooseCitySafetyUnknownReason(attempts.slice(0, 1), [])).toBe("not_found");
  });

  test("treats either typed unavailable search outcome as source unavailable", () => {
    // Break caught: an exhausted search provider is silently reduced to not-found.
    expect(chooseCitySafetyUnknownReason([], [unavailableQuery("provider_unavailable")]))
      .toBe("source_unavailable");
    expect(chooseCitySafetyUnknownReason([], [unavailableQuery("search_provider_unconfigured")]))
      .toBe("source_unavailable");
  });
});
