import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogRevision,
} from "../../src/decision/city-catalog";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type { CitySafetyQuantity } from "../../src/decision/city-safety";
import { runCitySafetyDiscovery } from "../../src/application/run-city-safety-discovery";
import type {
  CitySafetyCandidateInspection,
  CitySafetyCandidateInspectionInput,
  CitySafetyOfficialDocumentPort,
} from "../../src/application/city-safety-contracts";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import { createSloveniaCitySafetyAdapter } from
  "../../src/infrastructure/sources/slovenia-city-safety-adapter";
import {
  projectCitySafetyEvidenceLinks,
  reconstructCitySafetyAttemptLedger,
  type CitySafetyAttemptLedger,
  type CitySafetyLedgerReconstructionContext,
} from "../../src/research/city-safety-evidence";
import {
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
  type CitySafetySourcePlan,
  type OfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";

const INTEGRITY: CityDecisionIntegrity = {
  canonical(value) {
    return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" &&
      !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item);
  },
  hash(value) { return `hash:${value}`; },
};

interface FixtureContext {
  readonly catalog: CityCatalogRevision;
  readonly directory: OfficialAuthorityDirectory;
  readonly plan: CitySafetySourcePlan;
  readonly reconstruction: CitySafetyLedgerReconstructionContext;
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function buildContext(
  retentionMode: "seal_raw_artifact" | "seal_hash_locator_then_delete_transient" =
  "seal_raw_artifact",
  sursAllowedMediaTypes: readonly string[] = ["application/pdf"],
): FixtureContext {
  const registry = buildCityRegistryRevision({
    packageId: "si-cities",
    packageSchemaVersion: "si-cities@1",
    countryCode: "SI",
    evidenceSnapshotId: "catalog-evidence:1",
    entries: [{
      cityId: "ljubljana",
      countryCode: "SI",
      officialName: "Ljubljana",
      coordinate: { lat: 46.05, lng: 14.51 },
      administrativeType: "central_urban_settlement",
      administrativeTerritory: "Mestna občina Ljubljana",
      capitalRoles: ["national"],
      evidenceReferenceIds: ["catalog-evidence:1"],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
  }, INTEGRITY);
  const catalog = buildCityCatalogRevision({
    registry,
    evidenceSnapshotId: "catalog-evidence:1",
    populationDefinition: {
      definitionId: "surs-settlement-population@1",
      geoScope: "settlement",
      unit: "people",
    },
    candidateBasis: [{
      cityId: "ljubljana",
      comparablePopulation: { kind: "verified", value: "300000", referencePeriod: "2026-01-01" },
    }],
    coverage: { status: "complete" },
    createdAt: "2026-01-01T00:00:00.000Z",
  }, INTEGRITY);
  const policy = (
    publisherId: string,
    authorityKind: "police" | "government" | "open_data" | "statistics" | "municipality",
    navigationUrl: string,
    allowedMediaTypes: readonly string[] = ["application/pdf"],
  ) => ({
    publisherId,
    authorityKind,
    navigationUrl,
    allowedHosts: [new URL(navigationUrl).hostname],
    delegatedDocumentHosts: [],
    allowedMediaTypes,
    maxBytes: 1_000_000,
    redirectPolicyVersion: "official-chain@1" as const,
    documentLocatorPolicyId: `${publisherId}-locator@1`,
    retentionPolicyId: `${publisherId}-retention@1`,
    retentionMode,
  });
  const directory = buildOfficialAuthorityDirectory({
    schemaVersion: "official-authority-directory@1",
    countryCode: "SI",
    catalogRevisionId: catalog.id,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [
      policy("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
      policy("police", "police", "https://policija.si/"),
      policy("gov", "government", "https://gov.si/"),
      policy("opsi", "open_data", "https://podatki.gov.si/"),
      policy("surs", "statistics", "https://pxweb.stat.si/", sursAllowedMediaTypes),
    ],
    municipalities: [{
      cityId: "ljubljana",
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherId: "municipality-ljubljana",
      officialHost: "ljubljana.si",
    }],
    rulesVersion: "slovenia-official-authorities@1",
  }, INTEGRITY);
  const plan = buildCitySafetySourcePlan({
    catalog,
    directory,
    entries: [{
      cityId: "ljubljana",
      settlementCode: "061001",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Mestna občina Ljubljana"],
      publisherIds: ["municipality-ljubljana", "police", "surs"],
      configuredRoutes: [{
        publisherId: "municipality-ljubljana",
        navigationUrl: "https://ljubljana.si/safety",
      }],
    }],
  }, INTEGRITY);
  return {
    catalog,
    directory,
    plan,
    reconstruction: {
      runId: "run-1",
      catalog,
      integrity: INTEGRITY,
      sourcePlan: plan,
      authorityDirectory: directory,
    },
  };
}

const EXPECTED_QUERIES = [
  'site:ljubljana.si "Mestna občina Ljubljana" policija "kazniva dejanja" 2025',
  'site:policija.si "Mestna občina Ljubljana" "kazniva dejanja" 2025',
  '"Ljubljana" "Mestna občina Ljubljana" policija poročilo 2024',
] as const;

function baselineLedger(context = buildContext()): CitySafetyAttemptLedger {
  return {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: context.catalog.id,
    authorityDirectoryId: context.directory.id,
    sourcePlanId: context.plan.id,
    cityId: "ljubljana",
    municipalityCode: "061",
    assessmentAt: "2026-03-01T00:00:00.000Z",
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: EXPECTED_QUERIES.map((query, index) => ({
      index,
      queryId: `city-safety-query:run-1:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1",
      providerId: "provider-a",
      query,
      searchedAt: `2026-03-01T12:00:0${index}.000Z`,
      outcome: { kind: "completed", returnedUrls: [] },
    })),
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: "https://ljubljana.si/safety",
      officialTrace: {
        initialUrl: "https://ljubljana.si/safety",
        edges: [],
        lastTrustedUrl: "https://ljubljana.si/safety",
        officialHops: 0,
        failure: {
          captureKind: "http_error",
          responseStatus: 404,
          responseUrl: "https://ljubljana.si/safety",
        },
      },
      artifactRefs: [],
      disposition: "rejected",
      reason: "http_not_found",
    }],
    counters: { queries: 3, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "unknown", reason: "not_found" },
    completedAt: "2026-03-01T12:00:03.000Z",
  };
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function preferredLedger(context = buildContext()): CitySafetyAttemptLedger {
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  return {
    ...baselineLedger(context),
    queries: [],
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: "https://ljubljana.si/safety",
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: "https://ljubljana.si/safety",
      resolvedEvidenceUrl: "https://ljubljana.si/safety",
      officialTrace: {
        initialUrl: "https://ljubljana.si/safety",
        edges: [],
        lastTrustedUrl: "https://ljubljana.si/safety",
        officialHops: 0,
      },
      mediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: false,
      artifactRefs: [{
        role: "municipal_source",
        documentRole: "terminal_claim",
        artifactId: "municipal-2025",
        artifactSha256: SHA_A,
        sourceSha256: SHA_A,
        locator: "https://ljubljana.si/safety",
      }, {
        role: "surs_denominator",
        artifactId: "surs-2025",
        artifactSha256: SHA_B,
        sourceSha256: SHA_B,
        locator: "https://pxweb.stat.si/population",
      }],
      disposition: "usable",
      referenceYear: 2025,
      periodDisposition: "preferred",
      quantity,
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: "2025-01-01",
        population: "300000",
        artifactId: "surs-2025",
        mediaType: "application/pdf",
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted: false,
      },
    }],
    counters: { queries: 0, candidates: 1, maxOfficialHops: 0 },
    result: {
      kind: "verified",
      quantity,
      referenceYear: 2025,
      acceptedCandidateIndex: 0,
    },
  };
}

function fallbackLedger(
  context = buildContext(),
  laterOffenceCount = "1100",
): CitySafetyAttemptLedger {
  const ledger = mutableClone(preferredLedger(context));
  const first = ledger.candidates[0] as unknown as Record<string, unknown>;
  const firstQuantity = first.quantity as Record<string, unknown>;
  first.referenceYear = 2024;
  first.periodDisposition = "fallback";
  firstQuantity.offenceCount = "1100";
  firstQuantity.population = "299000";
  const firstDenominator = first.denominator as Record<string, unknown>;
  firstDenominator.referenceDate = "2024-01-01";
  firstDenominator.population = "299000";
  firstDenominator.artifactId = "surs-2024";
  const firstRefs = first.artifactRefs as Record<string, unknown>[];
  firstRefs[0]!.artifactId = "municipal-configured-2024";
  firstRefs[1]!.artifactId = "surs-2024";

  const second = mutableClone(first);
  second.index = 1;
  second.origin = { kind: "search", queryId: "city-safety-query:run-1:1" };
  second.canonicalUrl = "https://policija.si/fallback.pdf";
  second.publisherId = "police";
  second.publisherNavigationUrl = "https://policija.si/";
  second.resolvedEvidenceUrl = "https://policija.si/fallback.pdf";
  second.officialTrace = {
    initialUrl: "https://policija.si/fallback.pdf",
    edges: [],
    lastTrustedUrl: "https://policija.si/fallback.pdf",
    officialHops: 0,
  };
  second.retentionPolicyId = "police-retention@1";
  (second.quantity as Record<string, unknown>).offenceCount = laterOffenceCount;
  const secondRefs = second.artifactRefs as Record<string, unknown>[];
  secondRefs[0] = {
    ...secondRefs[0],
    artifactId: "municipal-search-2024",
    locator: "https://policija.si/fallback.pdf",
  };

  ledger.queries = EXPECTED_QUERIES.map((query, index) => ({
    index,
    queryId: `city-safety-query:run-1:${index + 1}`,
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    providerId: "provider-a",
    query,
    searchedAt: `2026-03-01T12:00:0${index}.000Z`,
    outcome: {
      kind: "completed" as const,
      returnedUrls: index === 0 ? ["https://policija.si/fallback.pdf"] : [],
    },
  }));
  ledger.candidates = [first, second] as Mutable<CitySafetyAttemptLedger["candidates"]>;
  ledger.counters = { queries: 3, candidates: 2, maxOfficialHops: 0 };
  ledger.result = laterOffenceCount === "1100"
    ? {
        kind: "verified",
        quantity: first.quantity as Mutable<CitySafetyQuantity>,
        referenceYear: 2024,
        acceptedCandidateIndex: 0,
      }
    : { kind: "unknown", reason: "conflict" };
  return ledger as CitySafetyAttemptLedger;
}

function reviewedScopeLedger(context = buildContext()): CitySafetyAttemptLedger {
  const ledger = mutableClone(baselineLedger(context));
  ledger.candidates = [{
    index: 0,
    origin: { kind: "configured", configuredRouteIndex: 0 },
    canonicalUrl: "https://ljubljana.si/safety",
    officialTrace: {
      initialUrl: "https://ljubljana.si/safety",
      edges: [],
      lastTrustedUrl: "https://ljubljana.si/safety",
      officialHops: 0,
    },
    reviewedOfficial: {
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: "https://ljubljana.si/safety",
      resolvedEvidenceUrl: "https://ljubljana.si/safety",
      referenceYear: 2025,
    },
    mediaType: "application/pdf",
    retentionPolicyId: "municipality-ljubljana-retention@1",
    transientRawDeleted: false,
    artifactRefs: [{
      role: "municipal_source",
      documentRole: "terminal_claim",
      artifactId: "scope-terminal",
      artifactSha256: SHA_A,
      sourceSha256: SHA_A,
      locator: "https://ljubljana.si/safety",
    }],
    disposition: "rejected",
    reason: "scope_mismatch",
  }];
  ledger.result = { kind: "unknown", reason: "not_comparable" };
  return ledger as unknown as CitySafetyAttemptLedger;
}

function trustedExternalAuthorityLedger(context = buildContext()): CitySafetyAttemptLedger {
  const ledger = mutableClone(baselineLedger(context));
  ledger.candidates[0] = {
    index: 0,
    origin: { kind: "configured", configuredRouteIndex: 0 },
    canonicalUrl: "https://ljubljana.si/safety",
    officialTrace: {
      initialUrl: "https://ljubljana.si/safety",
      edges: [],
      lastTrustedUrl: "https://ljubljana.si/safety",
      officialHops: 0,
      failure: { captureKind: "navigation_mismatch" },
    },
    reviewedOfficial: {
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "gov",
      publisherNavigationUrl: "https://ljubljana.si/safety",
      resolvedEvidenceUrl: "https://ljubljana.si/safety",
      referenceYear: 2025,
    },
    artifactRefs: [],
    disposition: "rejected",
    reason: "authority_untrusted",
  };
  return ledger as unknown as CitySafetyAttemptLedger;
}

function internalConflictLedger(context = buildContext()): CitySafetyAttemptLedger {
  const ledger = mutableClone(reviewedScopeLedger(context));
  const candidate = ledger.candidates[0] as Mutable<CitySafetyAttemptLedger["candidates"][number]>;
  if (candidate.disposition !== "rejected") throw new Error("expected rejected fixture");
  candidate.reason = "conflict";
  candidate.artifactRefs.push({
    role: "surs_denominator",
    artifactId: "surs-conflict",
    artifactSha256: SHA_B,
    sourceSha256: SHA_B,
    locator: "https://pxweb.stat.si/population",
  });
  candidate.conflictBasis = {
    referenceYear: 2025,
    quantities: [{
      offenceCount: "1100",
      population: "300000",
      rateBasis: "offences_per_100000_residents",
    }, {
      offenceCount: "1200",
      population: "300000",
      rateBasis: "offences_per_100000_residents",
    }],
    denominator: {
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      artifactId: "surs-conflict",
      mediaType: "application/pdf",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: false,
    },
  };
  ledger.result = { kind: "unknown", reason: "conflict" };
  return ledger as unknown as CitySafetyAttemptLedger;
}

function previousPreferredFixture(): {
  readonly ledger: CitySafetyAttemptLedger;
  readonly context: FixtureContext;
  readonly reconstruction: CitySafetyLedgerReconstructionContext;
} {
  const context = buildContext();
  const previous = {
    cityId: "ljubljana",
    municipalityCode: "061",
    sourcePlanId: "city-safety-source-plan:older",
    definitionId: "si-municipal-police-offences-per-100000@1" as const,
    publisherId: "police",
    navigationUrl: "https://policija.si/",
    resolvedEvidenceUrl: "https://policija.si/previous.pdf",
    referenceYear: 2025,
    evidenceSnapshotId: "city-evidence:older",
  };
  const ledger = mutableClone(preferredLedger(context));
  const candidate = ledger.candidates[0];
  if (candidate?.disposition !== "usable") throw new Error("expected usable fixture");
  candidate.origin = {
    kind: "previous",
    priorSourcePlanId: previous.sourcePlanId,
    priorEvidenceSnapshotId: previous.evidenceSnapshotId,
  };
  candidate.canonicalUrl = previous.resolvedEvidenceUrl;
  candidate.publisherId = "police";
  candidate.publisherNavigationUrl = previous.navigationUrl;
  candidate.resolvedEvidenceUrl = previous.resolvedEvidenceUrl;
  candidate.officialTrace = {
    initialUrl: previous.resolvedEvidenceUrl,
    edges: [],
    lastTrustedUrl: previous.resolvedEvidenceUrl,
    officialHops: 0,
  };
  candidate.retentionPolicyId = "police-retention@1";
  const terminal = candidate.artifactRefs[0];
  if (terminal?.role !== "municipal_source") throw new Error("expected terminal fixture");
  terminal.locator = previous.resolvedEvidenceUrl;
  return {
    ledger: ledger as CitySafetyAttemptLedger,
    context,
    reconstruction: { ...context.reconstruction, previousAccepted: previous },
  };
}

function capturedArtifact(id: string, url: string): LiveCapturedArtifact<"si-city-safety"> {
  const bytes = new TextEncoder().encode(id);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: id,
    runId: "run-1",
    sourceId: "si-city-safety",
    role: id.startsWith("surs") ? "surs_denominator" : "municipal_source",
    url,
    mediaType: "application/pdf",
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-03-01T12:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

function usableInspection(
  input: CitySafetyCandidateInspectionInput,
  referenceYear: number,
): CitySafetyCandidateInspection {
  const municipal = capturedArtifact(`municipal-${referenceYear}`, input.candidateUrl);
  const denominator = capturedArtifact(`surs-${referenceYear}`, "https://pxweb.stat.si/population");
  const population = referenceYear === 2025 ? "300000" : "299000";
  const publisherId = input.publisherContext?.publisherId ?? "police";
  return {
    kind: "usable",
    detail: {
      publisherId,
      dataAuthorityId: "police",
      publisherNavigationUrl: input.publisherContext?.publisherNavigationUrl ?? "https://policija.si/",
      resolvedEvidenceUrl: input.candidateUrl,
      officialTrace: {
        initialUrl: input.candidateUrl,
        edges: [],
        lastTrustedUrl: input.candidateUrl,
        officialHops: 0,
      },
      mediaType: "application/pdf",
      retentionPolicyId: `${publisherId}-retention@1`,
      transientRawDeleted: false,
      artifactRefs: [{
        role: "municipal_source",
        documentRole: "terminal_claim",
        artifactId: municipal.artifactId,
        artifactSha256: municipal.sha256,
        sourceSha256: municipal.sha256,
        locator: municipal.url,
      }, {
        role: "surs_denominator",
        artifactId: denominator.artifactId,
        artifactSha256: denominator.sha256,
        sourceSha256: denominator.sha256,
        locator: denominator.url,
      }],
      disposition: "usable",
      referenceYear,
      periodDisposition: referenceYear === 2025 ? "preferred" : "fallback",
      quantity: {
        offenceCount: "1200",
        population,
        rateBasis: "offences_per_100000_residents",
      },
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: `${referenceYear}-01-01`,
        population,
        artifactId: denominator.artifactId,
        mediaType: "application/pdf",
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted: false,
      },
    },
    artifacts: [municipal, denominator],
  };
}

function discoveryInput(context: FixtureContext) {
  return {
    runId: "run-1",
    catalog: context.catalog,
    integrity: INTEGRITY,
    sourcePlan: context.plan,
    authorityDirectory: context.directory,
    cityId: "ljubljana",
    assessmentAt: "2026-03-01T00:00:00.000Z",
    signal: new AbortController().signal,
  } as const;
}

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function expectMutationRejected(
  mutate: (ledger: Record<string, unknown>) => void,
  fixture = buildContext(),
): void {
  const valid = mutableClone(baselineLedger(fixture));
  expect(reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction)).toEqual(valid);
  const forged = mutableClone(valid) as unknown as Record<string, unknown>;
  mutate(forged);
  expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
    .toThrow("integrity_mismatch");
}

describe("city-safety ledger closed context and queue", () => {
  test("reconstructs a field-for-field S2-compatible exhausted ledger", () => {
    // Break caught: a valid bounded producer ledger cannot cross the Research replay boundary.
    const fixture = buildContext();
    const ledger = baselineLedger(fixture);

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test.each([
    ["top-level extra field", (ledger: Record<string, unknown>) => { ledger.profile = { secret: true }; }],
    ["catalog binding", (ledger: Record<string, unknown>) => { ledger.catalogRevisionId = "forged"; }],
    ["query index", (ledger: Record<string, unknown>) => {
      (ledger.queries as Record<string, unknown>[])[1]!.index = 7;
    }],
    ["run-derived query ID", (ledger: Record<string, unknown>) => {
      (ledger.queries as Record<string, unknown>[])[0]!.queryId = "city-safety-query:other:1";
    }],
    ["regenerated query text", (ledger: Record<string, unknown>) => {
      (ledger.queries as Record<string, unknown>[])[2]!.query = "profile canary";
    }],
    ["empty provider identity", (ledger: Record<string, unknown>) => {
      (ledger.queries as Record<string, unknown>[])[0]!.providerId = "";
    }],
    ["query outcome extra field", (ledger: Record<string, unknown>) => {
      ((ledger.queries as Record<string, unknown>[])[0]!.outcome as Record<string, unknown>).snippet = "forbidden";
    }],
    ["configured route origin", (ledger: Record<string, unknown>) => {
      ((ledger.candidates as Record<string, unknown>[])[0]!.origin as Record<string, unknown>)
        .configuredRouteIndex = 1;
    }],
    ["configured route URL", (ledger: Record<string, unknown>) => {
      (ledger.candidates as Record<string, unknown>[])[0]!.canonicalUrl = "https://policija.si/other.pdf";
    }],
  ] as const)("rejects a one-field mutation of %s", (_name, mutate) => {
    expectMutationRejected(mutate);
  });

  test("rejects malformed context run IDs before trusting matching forged query IDs", () => {
    // Break caught: a forged run namespace becomes accepted merely because ledger IDs mirror it.
    const fixture = buildContext();
    const ledger = mutableClone(baselineLedger(fixture));
    ledger.queries.forEach((query, index) => {
      (query as { queryId: string }).queryId = `city-safety-query:bad run:${index + 1}`;
    });
    expect(() => reconstructCitySafetyAttemptLedger(ledger, {
      ...fixture.reconstruction,
      runId: "bad run",
    })).toThrow("integrity_mismatch");
  });

  test("projector rejects a forged typed ledger by reconstructing it first", () => {
    // Break caught: projection trusts a TypeScript assertion and exposes a forged official URL.
    const fixture = buildContext();
    const ledger = mutableClone(baselineLedger(fixture));
    (ledger as unknown as Record<string, unknown>).copy = "forged";

    expect(() => projectCitySafetyEvidenceLinks(ledger, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });
});

describe("city-safety trusted trace, artifacts and denominator", () => {
  test("reconstructs a raw-retained preferred official result", () => {
    // Break caught: strict replay rejects the exact preferred ledger that S2 can produce.
    const fixture = buildContext();
    const ledger = preferredLedger(fixture);

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test("accepts raw SURS JSON independently of the municipal PDF media type", () => {
    // Break caught: replay incorrectly couples denominator media to the municipal document media.
    const fixture = buildContext("seal_raw_artifact", ["application/json"]);
    const ledger = mutableClone(preferredLedger(fixture));
    const candidate = ledger.candidates[0];
    if (candidate?.disposition !== "usable") throw new Error("expected usable fixture");
    candidate.denominator.mediaType = "application/json";

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test("rejects an untrusted host relabeled as a publisher-allowed hop-limit target", () => {
    // Break caught: changing only an allowed hop-limit target to an external host remains trusted.
    const fixture = buildContext();
    const valid = mutableClone(baselineLedger(fixture));
    const candidate = valid.candidates[0];
    if (candidate?.disposition !== "rejected") throw new Error("expected rejected fixture");
    candidate.reason = "untrusted_redirect";
    candidate.officialTrace = {
      initialUrl: "https://ljubljana.si/safety",
      edges: [{
        kind: "http_redirect",
        fromUrl: "https://ljubljana.si/safety",
        toUrl: "https://ljubljana.si/redirect-one",
      }, {
        kind: "http_redirect",
        fromUrl: "https://ljubljana.si/redirect-one",
        toUrl: "https://ljubljana.si/redirect-two",
      }],
      lastTrustedUrl: "https://ljubljana.si/redirect-two",
      officialHops: 2,
      failure: {
        captureKind: "navigation_mismatch",
        rejectedTarget: { kind: "hop_limit", url: "https://ljubljana.si/redirect-three" },
      },
    };
    valid.counters = { ...valid.counters, maxOfficialHops: 2 };
    expect(reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction)).toEqual(valid);

    const relabeled = mutableClone(valid);
    const relabeledCandidate = relabeled.candidates[0];
    if (relabeledCandidate?.disposition !== "rejected" ||
      relabeledCandidate.officialTrace.failure?.rejectedTarget?.kind !== "hop_limit") {
      throw new Error("expected hop-limit fixture");
    }
    relabeledCandidate.officialTrace.failure.rejectedTarget.url =
      "https://untrusted.example/redirect-three";
    expect(() => reconstructCitySafetyAttemptLedger(relabeled, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("binds an extra retained navigation to the last trusted URL", async () => {
    // Break caught: a fully captured page can be rebound after its confirmed next link is rejected.
    const fixture = buildContext();
    const officialDocuments = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: capturedArtifact(
          request.url.endsWith("safety") ? "navigation-first" : "navigation-extra",
          request.url,
        ),
        redirectChain: [request.url],
      }),
      analyze: async ({ artifact }) => ({
        kind: "navigate",
        confirmedDocumentUrl: artifact.url.endsWith("safety")
          ? "https://ljubljana.si/report.pdf"
          : "https://mirror.example/rejected.pdf",
      }),
      loadPopulation: async () => { throw new Error("navigation rejection must suppress SURS"); },
    });
    const produced = await runCitySafetyDiscovery(discoveryInput(fixture), {
      officialDocuments,
      search: { search: async () => ({ kind: "completed", providerId: "provider-a", urls: [] }) },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });
    const valid = mutableClone(produced.ledger);
    const candidate = valid.candidates[0];
    if (candidate?.disposition !== "rejected") throw new Error("expected rejected fixture");
    expect(candidate.officialTrace.edges.filter(({ kind }) => kind === "confirmed_document_link"))
      .toHaveLength(1);
    expect(candidate.artifactRefs.filter((ref) => ref.role === "municipal_source" &&
      ref.documentRole === "navigation")).toHaveLength(2);
    expect(reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction)).toEqual(valid);

    const forged = mutableClone(valid);
    const forgedCandidate = forged.candidates[0];
    const extraNavigation = forgedCandidate?.artifactRefs[1];
    if (forgedCandidate?.disposition !== "rejected" ||
      extraNavigation?.role !== "municipal_source" || extraNavigation.documentRole !== "navigation") {
      throw new Error("expected extra navigation fixture");
    }
    extraNavigation.locator = "https://ljubljana.si/other.pdf";
    expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["candidate extra field", (candidate: Record<string, unknown>) => { candidate.userCopy = "forbidden"; }],
    ["trace hop count", (candidate: Record<string, unknown>) => {
      (candidate.officialTrace as Record<string, unknown>).officialHops = 1;
    }],
    ["trace discontinuity", (candidate: Record<string, unknown>) => {
      const trace = candidate.officialTrace as Record<string, unknown>;
      trace.edges = [{
        kind: "http_redirect",
        fromUrl: "https://policija.si/wrong",
        toUrl: "https://ljubljana.si/safety",
      }];
      trace.officialHops = 1;
    }],
    ["non-Police data authority", (candidate: Record<string, unknown>) => { candidate.dataAuthorityId = "gov"; }],
    ["publisher navigation context", (candidate: Record<string, unknown>) => {
      candidate.publisherNavigationUrl = "https://ljubljana.si/other";
    }],
    ["publisher retention policy", (candidate: Record<string, unknown>) => {
      candidate.retentionPolicyId = "forged-retention@1";
    }],
    ["raw deletion disposition", (candidate: Record<string, unknown>) => {
      candidate.transientRawDeleted = true;
    }],
    ["malformed artifact hash", (candidate: Record<string, unknown>) => {
      ((candidate.artifactRefs as Record<string, unknown>[])[0]!).artifactSha256 = "BAD";
    }],
    ["raw artifact/source mismatch", (candidate: Record<string, unknown>) => {
      ((candidate.artifactRefs as Record<string, unknown>[])[0]!).sourceSha256 = SHA_B;
    }],
    ["artifact role order", (candidate: Record<string, unknown>) => {
      candidate.artifactRefs = [...candidate.artifactRefs as unknown[]].reverse();
    }],
    ["missing terminal artifact", (candidate: Record<string, unknown>) => {
      candidate.artifactRefs = (candidate.artifactRefs as unknown[]).slice(1);
    }],
    ["denominator publisher", (candidate: Record<string, unknown>) => {
      (candidate.denominator as Record<string, unknown>).publisherId = "gov";
    }],
    ["denominator municipality", (candidate: Record<string, unknown>) => {
      (candidate.denominator as Record<string, unknown>).municipalityCode = "999";
    }],
    ["denominator date", (candidate: Record<string, unknown>) => {
      (candidate.denominator as Record<string, unknown>).referenceDate = "2024-01-01";
    }],
    ["denominator population", (candidate: Record<string, unknown>) => {
      (candidate.denominator as Record<string, unknown>).population = "299999";
    }],
    ["denominator artifact binding", (candidate: Record<string, unknown>) => {
      (candidate.denominator as Record<string, unknown>).artifactId = "other-surs";
    }],
  ] as const)("rejects a one-field mutation of %s", (_name, mutate) => {
    const fixture = buildContext();
    const valid = mutableClone(preferredLedger(fixture));
    expect(reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction)).toEqual(valid);
    const forged = mutableClone(valid);
    mutate(forged.candidates[0] as unknown as Record<string, unknown>);

    expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });
});

describe("city-safety rejection and result reducer closure", () => {
  test("preserves trusted reviewed semantic provenance field by field", () => {
    // Break caught: replay drops reviewed official fields needed by later Evidence link projection.
    const fixture = buildContext();
    const ledger = reviewedScopeLedger(fixture);

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test("selects the earliest compatible fallback only after full exhaustion", () => {
    // Break caught: replay either rejects global SURS reuse or accepts a later equal fallback.
    const fixture = buildContext();
    const ledger = mutableClone(fallbackLedger(fixture));

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test("derives terminal conflict from incompatible same-year usable fallbacks", () => {
    // Break caught: a forged verified fallback hides incompatible official quantities.
    const fixture = buildContext();
    const ledger = fallbackLedger(fixture, "1200");

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
    const forged = mutableClone(ledger);
    const first = forged.candidates[0];
    if (first?.disposition !== "usable") throw new Error("expected usable fixture");
    forged.result = {
      kind: "verified",
      quantity: first.quantity,
      referenceYear: first.referenceYear,
      acceptedCandidateIndex: first.index,
    };
    expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("rejects compatible fallback selection before budget exhaustion", () => {
    // Break caught: a held Y-2 result suppresses remaining preferred-source queries.
    const fixture = buildContext();
    const ledger = mutableClone(fallbackLedger(fixture));
    ledger.queries = ledger.queries.slice(0, 2);
    ledger.counters = { ...ledger.counters, queries: 2 };

    expect(() => reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["query counter", (ledger: Mutable<CitySafetyAttemptLedger>) => {
      ledger.counters = { ...ledger.counters, queries: 2 };
    }],
    ["candidate counter", (ledger: Mutable<CitySafetyAttemptLedger>) => {
      ledger.counters = { ...ledger.counters, candidates: 7 };
    }],
    ["maximum hops", (ledger: Mutable<CitySafetyAttemptLedger>) => {
      ledger.counters = { ...ledger.counters, maxOfficialHops: 2 };
    }],
    ["unknown reason", (ledger: Mutable<CitySafetyAttemptLedger>) => {
      ledger.result = { kind: "unknown", reason: "source_unavailable" };
    }],
  ] as const)("rejects forged %s", (_name, mutate) => {
    const fixture = buildContext();
    const valid = mutableClone(reviewedScopeLedger(fixture));
    expect(reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction)).toEqual(valid);
    mutate(valid);
    expect(() => reconstructCitySafetyAttemptLedger(valid, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });
});

describe("city-safety lineage, projection and immutability", () => {
  test("accepts both older previous lineage and trusted-publication external authority review", () => {
    // Break caught: current plan equality is incorrectly required for caller-verified prior Evidence lineage.
    const previous = previousPreferredFixture();
    expect(reconstructCitySafetyAttemptLedger(previous.ledger, previous.reconstruction))
      .toEqual(previous.ledger);

    const external = buildContext();
    const externalLedger = trustedExternalAuthorityLedger(external);
    expect(reconstructCitySafetyAttemptLedger(externalLedger, external.reconstruction))
      .toEqual(externalLedger);
    const emptyAuthority = mutableClone(externalLedger);
    const rejected = emptyAuthority.candidates[0];
    if (rejected?.disposition !== "rejected" || rejected.reviewedOfficial === undefined) {
      throw new Error("expected reviewed fixture");
    }
    rejected.reviewedOfficial.dataAuthorityId = "";
    expect(() => reconstructCitySafetyAttemptLedger(emptyAuthority, external.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("rejects trusted authority-untrusted capture without reviewed publication provenance", () => {
    // Break caught: configured publisher context is accepted as if its authority were unresolved.
    const fixture = buildContext();
    const forged = mutableClone(trustedExternalAuthorityLedger(fixture));
    const candidate = forged.candidates[0];
    if (candidate?.disposition !== "rejected" || candidate.reviewedOfficial === undefined) {
      throw new Error("expected trusted publication fixture");
    }
    delete candidate.reviewedOfficial;

    expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");
    expect(() => projectCitySafetyEvidenceLinks(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("rejects an extra field in caller-verified previous lineage", () => {
    // Break caught: caller verification becomes permission to smuggle an unbound lineage field.
    const fixture = previousPreferredFixture();
    const previousAccepted = {
      ...fixture.reconstruction.previousAccepted!,
      copiedProfileId: "forbidden",
    };

    expect(() => reconstructCitySafetyAttemptLedger(fixture.ledger, {
      ...fixture.reconstruction,
      previousAccepted,
    })).toThrow("integrity_mismatch");
  });

  test("closes an in-document conflict basis and rejects equal quantities", () => {
    // Break caught: an adapter-owned conflict lacks its exact two-quantity replay basis.
    const fixture = buildContext();
    const ledger = internalConflictLedger(fixture);
    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
    const forged = mutableClone(ledger);
    const candidate = forged.candidates[0];
    if (candidate?.disposition !== "rejected" || candidate.conflictBasis === undefined) {
      throw new Error("expected conflict fixture");
    }
    candidate.conflictBasis.quantities[1].offenceCount = "1100";
    expect(() => reconstructCitySafetyAttemptLedger(forged, fixture.reconstruction))
      .toThrow("integrity_mismatch");

    const forgedMedia = mutableClone(ledger);
    const mediaCandidate = forgedMedia.candidates[0];
    if (mediaCandidate?.disposition !== "rejected" || mediaCandidate.conflictBasis === undefined) {
      throw new Error("expected conflict fixture");
    }
    mediaCandidate.conflictBasis.denominator.mediaType = "text/plain";
    expect(() => reconstructCitySafetyAttemptLedger(forgedMedia, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("accepts a raw SURS JSON denominator in an internal conflict", () => {
    // Break caught: rejected conflict replay couples raw SURS media to the municipal PDF.
    const fixture = buildContext("seal_raw_artifact", ["application/json"]);
    const ledger = mutableClone(internalConflictLedger(fixture));
    const candidate = ledger.candidates[0];
    if (candidate?.disposition !== "rejected" || candidate.conflictBasis === undefined) {
      throw new Error("expected conflict fixture");
    }
    candidate.conflictBasis.denominator.mediaType = "application/json";

    expect(reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction)).toEqual(ledger);
  });

  test("rejects conflicting global reuse of one SURS artifact identity", () => {
    // Break caught: one denominator artifact ID means different hashes in two candidate attempts.
    const fixture = buildContext();
    const ledger = mutableClone(fallbackLedger(fixture));
    const second = ledger.candidates[1];
    if (second?.disposition !== "usable") throw new Error("expected usable fixture");
    const denominator = second.artifactRefs.find((ref) => ref.role === "surs_denominator");
    if (denominator === undefined) throw new Error("expected denominator fixture");
    denominator.artifactSha256 = SHA_A;
    denominator.sourceSha256 = SHA_A;

    expect(() => reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("rejects divergent global reuse of a municipal artifact identity", () => {
    // Break caught: one municipal artifact ID is rebound to another locator across attempts.
    const fixture = buildContext();
    const ledger = mutableClone(fallbackLedger(fixture));
    const first = ledger.candidates[0];
    const second = ledger.candidates[1];
    if (first?.disposition !== "usable" || second?.disposition !== "usable") {
      throw new Error("expected usable fixtures");
    }
    const firstMunicipal = first.artifactRefs.find((ref) => ref.role === "municipal_source");
    const secondMunicipal = second.artifactRefs.find((ref) => ref.role === "municipal_source");
    if (firstMunicipal === undefined || secondMunicipal === undefined) {
      throw new Error("expected municipal fixtures");
    }
    secondMunicipal.artifactId = firstMunicipal.artifactId;

    expect(() => reconstructCitySafetyAttemptLedger(ledger, fixture.reconstruction))
      .toThrow("integrity_mismatch");
  });

  test("projects accepted, reviewed and derived conflict links in closed order", () => {
    // Break caught: provider/candidate URLs leak or derived conflicts precede trusted reviewed rejections.
    const preferred = buildContext();
    expect(projectCitySafetyEvidenceLinks(preferredLedger(preferred), preferred.reconstruction)).toEqual([{
      disposition: "accepted",
      navigationUrl: "https://ljubljana.si/safety",
      resolvedEvidenceUrl: "https://ljubljana.si/safety",
      referenceYear: 2025,
    }]);

    const reviewed = buildContext();
    expect(projectCitySafetyEvidenceLinks(reviewedScopeLedger(reviewed), reviewed.reconstruction)).toEqual([{
      disposition: "reviewed_rejected",
      navigationUrl: "https://ljubljana.si/safety",
      resolvedEvidenceUrl: "https://ljubljana.si/safety",
      referenceYear: 2025,
      rejectionReason: "scope_mismatch",
    }]);

    const conflicted = buildContext();
    expect(projectCitySafetyEvidenceLinks(
      fallbackLedger(conflicted, "1200"),
      conflicted.reconstruction,
    )).toEqual([
      {
        disposition: "reviewed_rejected",
        navigationUrl: "https://ljubljana.si/safety",
        resolvedEvidenceUrl: "https://ljubljana.si/safety",
        referenceYear: 2024,
        rejectionReason: "conflict",
      },
      {
        disposition: "reviewed_rejected",
        navigationUrl: "https://policija.si/",
        resolvedEvidenceUrl: "https://policija.si/fallback.pdf",
        referenceYear: 2024,
        rejectionReason: "conflict",
      },
    ]);
  });

  test("excludes unreviewed candidate and rejected-target URLs from projection", () => {
    // Break caught: a rejected redirect target is presented as reviewed official evidence.
    const fixture = buildContext();
    const ledger = mutableClone(baselineLedger(fixture));
    const candidate = ledger.candidates[0];
    if (candidate?.disposition !== "rejected") throw new Error("expected rejected fixture");
    candidate.reason = "untrusted_redirect";
    candidate.officialTrace.failure = {
      captureKind: "navigation_mismatch",
      rejectedTarget: { kind: "untrusted_target", url: "https://mirror.example/rejected.pdf" },
    };

    expect(projectCitySafetyEvidenceLinks(ledger, fixture.reconstruction)).toEqual([]);
  });

  test("returns fresh deeply frozen values without freezing or aliasing caller input", () => {
    // Break caught: replay freezes a persistence DTO in place or returns nested mutable aliases.
    const fixture = buildContext();
    const input = mutableClone(preferredLedger(fixture));
    const reconstructed = reconstructCitySafetyAttemptLedger(input, fixture.reconstruction);
    const links = projectCitySafetyEvidenceLinks(input, fixture.reconstruction);

    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.candidates[0])).toBe(false);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.candidates[0])).toBe(true);
    expect(Object.isFrozen(links)).toBe(true);
    expect(Object.isFrozen(links[0])).toBe(true);
    input.cityId = "mutable-caller";
    expect(reconstructed.cityId).toBe("ljubljana");
  });
});

describe("city-safety real S2 producer compatibility", () => {
  test("reconstructs preferred raw/transient, held fallback and untrusted-initial results unchanged", async () => {
    // Break caught: Research invents a rule that rejects a genuine field-for-field S2 producer result.
    for (const retentionMode of [
      "seal_raw_artifact",
      "seal_hash_locator_then_delete_transient",
    ] as const) {
      const fixture = buildContext(retentionMode);
      const officialDocuments = createSloveniaCitySafetyAdapter({
        capture: async (request) => ({
          artifact: capturedArtifact(`municipal-source-${retentionMode}`, request.url),
          redirectChain: [request.url],
        }),
        analyze: async () => ({
          kind: "terminal",
          dataAuthorityId: "police",
          municipalityCodes: ["061"],
          definitionId: "si-municipal-police-offences-per-100000@1",
          referenceYear: 2025,
          offenceCounts: ["1200"],
        }),
        loadPopulation: async ({ runId }) => ({
          kind: "captured",
          publisherId: "surs",
          municipalityCode: "061",
          referenceDate: "2025-01-01",
          population: "300000",
          artifact: { ...capturedArtifact(`surs-source-${retentionMode}`, "https://pxweb.stat.si/population"), runId },
        }),
      });
      const produced = await runCitySafetyDiscovery(discoveryInput(fixture), {
        officialDocuments,
        search: { search: async () => { throw new Error("preferred must suppress search"); } },
        clock: () => new Date("2026-03-01T12:00:00.000Z"),
      });
      expect(reconstructCitySafetyAttemptLedger(produced.ledger, fixture.reconstruction))
        .toEqual(produced.ledger);
    }

    const fallback = buildContext();
    const fallbackProduced = await runCitySafetyDiscovery(discoveryInput(fallback), {
      officialDocuments: { inspect: async (candidate) => usableInspection(candidate, 2024) },
      search: {
        search: async () => ({ kind: "completed", providerId: "provider / deployment", urls: [] }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(fallbackProduced.ledger.queries).toHaveLength(3);
    expect(reconstructCitySafetyAttemptLedger(fallbackProduced.ledger, fallback.reconstruction))
      .toEqual(fallbackProduced.ledger);

    const untrusted = buildContext();
    let queryIndex = 0;
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => candidate.candidateUrl === "https://unknown.example/report.pdf"
        ? {
            kind: "rejected",
            detail: {
              officialTrace: {
                initialUrl: candidate.candidateUrl,
                edges: [],
                officialHops: 0,
                failure: { captureKind: "navigation_mismatch" },
              },
              artifactRefs: [],
              disposition: "rejected",
              reason: "authority_untrusted",
            },
            artifacts: [],
          }
        : {
            kind: "rejected",
            detail: {
              officialTrace: {
                initialUrl: candidate.candidateUrl,
                edges: [],
                lastTrustedUrl: candidate.candidateUrl,
                officialHops: 0,
                failure: {
                  captureKind: "http_error",
                  responseStatus: 404,
                  responseUrl: candidate.candidateUrl,
                },
              },
              artifactRefs: [],
              disposition: "rejected",
              reason: "http_not_found",
            },
            artifacts: [],
          },
    };
    const untrustedProduced = await runCitySafetyDiscovery(discoveryInput(untrusted), {
      officialDocuments,
      search: {
        search: async () => ({
          kind: "completed",
          providerId: "provider-a",
          urls: queryIndex++ === 0 ? ["https://unknown.example/report.pdf"] : [],
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(reconstructCitySafetyAttemptLedger(untrustedProduced.ledger, untrusted.reconstruction))
      .toEqual(untrustedProduced.ledger);
  });

  test("reconstructs a non-identifier reviewed authority emitted by S2", async () => {
    // Break caught: Research rejects a non-empty external authority identity accepted by S2.
    const fixture = buildContext();
    const produced = await runCitySafetyDiscovery(discoveryInput(fixture), {
      officialDocuments: {
        inspect: async (candidate) => ({
          kind: "rejected",
          detail: {
            officialTrace: {
              initialUrl: candidate.candidateUrl,
              edges: [],
              lastTrustedUrl: candidate.candidateUrl,
              officialHops: 0,
              failure: { captureKind: "navigation_mismatch" },
            },
            reviewedOfficial: {
              publisherId: "municipality-ljubljana",
              dataAuthorityId: "external / authority",
              publisherNavigationUrl: "https://ljubljana.si/safety",
              resolvedEvidenceUrl: candidate.candidateUrl,
              referenceYear: 2025,
            },
            artifactRefs: [],
            disposition: "rejected",
            reason: "authority_untrusted",
          },
          artifacts: [],
        }),
      },
      search: { search: async () => ({ kind: "completed", providerId: "provider-a", urls: [] }) },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(reconstructCitySafetyAttemptLedger(produced.ledger, fixture.reconstruction))
      .toEqual(produced.ledger);
  });

  test("canonicalizes noncanonical previous URLs accepted and emitted canonically by S2", async () => {
    // Break caught: Research requires caller context URLs to already match S2's canonical ledger URLs.
    const fixture = buildContext();
    const previousAccepted = {
      cityId: "ljubljana",
      municipalityCode: "061",
      sourcePlanId: "city-safety-source-plan:older",
      definitionId: "si-municipal-police-offences-per-100000@1" as const,
      publisherId: "police",
      navigationUrl: "https://POLICIJA.SI:443/#official",
      resolvedEvidenceUrl: "https://POLICIJA.SI:443/previous.pdf#claim",
      referenceYear: 2025,
      evidenceSnapshotId: "city-evidence:older",
    };
    const produced = await runCitySafetyDiscovery({
      ...discoveryInput(fixture),
      previousAccepted,
    }, {
      officialDocuments: { inspect: async (candidate) => usableInspection(candidate, 2025) },
      search: { search: async () => { throw new Error("preferred must suppress search"); } },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(reconstructCitySafetyAttemptLedger(produced.ledger, {
      ...fixture.reconstruction,
      previousAccepted,
    })).toEqual(produced.ledger);
  });
});
