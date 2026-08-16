import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
  type CityCatalogRevision,
} from "../../src/decision/city-catalog";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import {
  runCitySafetyDiscovery,
} from "../../src/application/run-city-safety-discovery";
import type {
  CitySafetyCandidateInspection,
  CitySafetyCandidateInspectionInput,
  CitySafetyOfficialDocumentPort,
  CitySafetySearchPort,
} from "../../src/application/city-safety-contracts";
import type { CitySafetyQuantity } from "../../src/decision/city-safety";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  createSloveniaCitySafetyAdapter,
  type CitySafetyMunicipalDocumentAnalyzer,
  type CitySafetyPopulationLoader,
} from "../../src/infrastructure/sources/slovenia-city-safety-adapter";
import { SourceCaptureError } from "../../src/infrastructure/sources/gateway";
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

function buildContext(): {
  readonly catalog: CityCatalogRevision;
  readonly directory: OfficialAuthorityDirectory;
  readonly plan: CitySafetySourcePlan;
} {
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
  ) => ({
    publisherId,
    authorityKind,
    navigationUrl,
    allowedHosts: [new URL(navigationUrl).hostname],
    delegatedDocumentHosts: [],
    allowedMediaTypes: ["application/pdf"],
    maxBytes: 1_000_000,
    redirectPolicyVersion: "official-chain@1" as const,
    documentLocatorPolicyId: `${publisherId}-locator@1`,
    retentionPolicyId: `${publisherId}-retention@1`,
    retentionMode: "seal_hash_locator_then_delete_transient" as const,
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
      policy("surs", "statistics", "https://pxweb.stat.si/"),
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
  return { catalog, directory, plan };
}

function artifact(id: string, url: string): LiveCapturedArtifact<"si-city-safety"> {
  const bytes = new TextEncoder().encode(id);
  return {
    artifactId: id,
    runId: "run-1",
    sourceId: "si-city-safety",
    role: id.startsWith("surs") ? "surs_denominator" : "municipal_source",
    url,
    mediaType: "application/json",
    sha256: `${id}-sha`,
    bytes,
    origin: "live",
    capturedAt: "2026-03-01T12:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

function usable(
  input: CitySafetyCandidateInspectionInput,
  referenceYear: number,
  quantity: CitySafetyQuantity,
): CitySafetyCandidateInspection {
  const municipal = artifact(`municipal-${referenceYear}-${quantity.offenceCount}`, input.candidateUrl);
  const denominator = artifact(`surs-${referenceYear}-${quantity.population}`, "https://pxweb.stat.si/population");
  return {
    kind: "usable",
    detail: {
      publisherId: input.publisherContext?.publisherId ?? "police",
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
      retentionPolicyId: `${input.publisherContext?.publisherId ?? "police"}-retention@1`,
      transientRawDeleted: true,
      artifactRefs: [
        {
          role: "municipal_source",
          documentRole: "terminal_claim",
          artifactId: municipal.artifactId,
          artifactSha256: municipal.sha256,
          sourceSha256: municipal.sha256,
          locator: municipal.url,
        },
        {
          role: "surs_denominator",
          artifactId: denominator.artifactId,
          artifactSha256: denominator.sha256,
          sourceSha256: denominator.sha256,
          locator: denominator.url,
        },
      ],
      disposition: "usable",
      referenceYear,
      periodDisposition: referenceYear === 2025 ? "preferred" : "fallback",
      quantity,
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: `${referenceYear}-01-01`,
        population: quantity.population,
        artifactId: denominator.artifactId,
        mediaType: denominator.mediaType,
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted: true,
      },
    },
    artifacts: [municipal, denominator],
  };
}

function input(context = buildContext()) {
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

describe("runCitySafetyDiscovery", () => {
  test("stops before search when configured inspection returns preferred Y-1", async () => {
    // Break caught: bounded discovery spends queries after an exact preferred official result is closed.
    const context = buildContext();
    const search: CitySafetySearchPort = { search: vi.fn() };
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: vi.fn(async (candidate) => usable(candidate, 2025, {
        offenceCount: "1200",
        population: "300000",
        rateBasis: "offences_per_100000_residents",
      })),
    };

    const result = await runCitySafetyDiscovery(input(context), {
      search,
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(search.search).not.toHaveBeenCalled();
    expect(officialDocuments.inspect).toHaveBeenCalledWith(expect.objectContaining({
      candidateUrl: "https://ljubljana.si/safety",
      publisherContext: {
        publisherId: "municipality-ljubljana",
        publisherNavigationUrl: "https://ljubljana.si/safety",
      },
      officialHopLimit: 2,
    }));
    expect(result.ledger.counters).toEqual({ queries: 0, candidates: 1, maxOfficialHops: 0 });
    expect(result.ledger.result).toEqual(expect.objectContaining({
      kind: "verified",
      referenceYear: 2025,
      acceptedCandidateIndex: 0,
    }));
  });

  test("holds previous Y-2, records all repeated provider URLs, and inspects each canonical URL once", async () => {
    // Break caught: fallback closes early or repeated search ledger values consume candidate slots.
    const context = buildContext();
    const previousUrl = "https://policija.si/previous.pdf";
    const discoveredUrl = "https://policija.si/discovered.pdf";
    const inspected: string[] = [];
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        inspected.push(candidate.candidateUrl);
        if (candidate.candidateUrl === previousUrl) return usable(candidate, 2024, {
          offenceCount: "1100",
          population: "299000",
          rateBasis: "offences_per_100000_residents",
        });
        return {
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
        };
      },
    };
    let queryNumber = 0;
    const search: CitySafetySearchPort = {
      async search() {
        queryNumber += 1;
        return {
          kind: "completed",
          providerId: "provider-a",
          urls: queryNumber === 1
            ? [`${previousUrl}#duplicate`, discoveredUrl, discoveredUrl]
            : [discoveredUrl],
        };
      },
    };
    const clockValues = [
      "2026-03-01T12:00:00.000Z",
      "2026-03-01T12:00:01.000Z",
      "2026-03-01T12:00:02.000Z",
      "2026-03-01T12:00:03.000Z",
    ];

    const result = await runCitySafetyDiscovery({
      ...input(context),
      previousAccepted: {
        cityId: "ljubljana",
        municipalityCode: "061",
        sourcePlanId: "city-safety-source-plan:prior-revision",
        definitionId: "si-municipal-police-offences-per-100000@1",
        publisherId: "police",
        navigationUrl: "https://policija.si/",
        resolvedEvidenceUrl: previousUrl,
        referenceYear: 2024,
        evidenceSnapshotId: "evidence:previous",
      },
    }, {
      search,
      officialDocuments,
      clock: () => new Date(clockValues.shift()!),
    });

    expect(result.ledger.queries).toHaveLength(3);
    expect(result.ledger.queries[0]!.outcome).toEqual({
      kind: "completed",
      returnedUrls: [`${previousUrl}#duplicate`, discoveredUrl, discoveredUrl],
    });
    expect(inspected).toEqual([previousUrl, "https://ljubljana.si/safety", discoveredUrl]);
    expect(result.ledger.counters).toEqual({ queries: 3, candidates: 3, maxOfficialHops: 0 });
    expect(result.ledger.candidates[0]!.origin).toEqual({
      kind: "previous",
      priorSourcePlanId: "city-safety-source-plan:prior-revision",
      priorEvidenceSnapshotId: "evidence:previous",
    });
    expect(result.ledger.result).toEqual(expect.objectContaining({
      kind: "verified",
      referenceYear: 2024,
      acceptedCandidateIndex: 0,
    }));
    expect(result.ledger.completedAt).toBe("2026-03-01T12:00:03.000Z");
  });

  test("aborts instead of sealing malformed official detail", async () => {
    // Break caught: an adapter manufactures a different URL inside the Application-owned envelope.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const result = usable(candidate, 2025, {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        });
        if (result.kind !== "usable") throw new Error("expected usable fixture");
        return { ...result, detail: { ...result.detail, resolvedEvidenceUrl: "https://policija.si/forged" } };
      },
    };
    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("aborts when an official adapter forges the applied retention decision", async () => {
    // Break caught: Application trusts a retention policy that differs from the sealed publisher directory.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const result = usable(candidate, 2025, {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        });
        if (result.kind !== "usable") throw new Error("expected usable fixture");
        return {
          ...result,
          detail: { ...result.detail, retentionPolicyId: "forged-retention@1" },
        };
      },
    };
    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });
});

describe("Slovenia city-safety official adapter", () => {
  function inspectionInput(context = buildContext()): CitySafetyCandidateInspectionInput {
    return {
      runId: "run-1",
      cityId: "ljubljana",
      municipalityCode: "061",
      candidateUrl: "https://ljubljana.si/safety",
      publisherContext: {
        publisherId: "municipality-ljubljana",
        publisherNavigationUrl: "https://ljubljana.si/safety",
      },
      officialHopLimit: 2,
      assessmentAt: "2026-03-01T00:00:00.000Z",
      authorityDirectory: context.directory,
      signal: new AbortController().signal,
    };
  }

  const terminalAnalysis = {
    kind: "terminal" as const,
    dataAuthorityId: "police",
    municipalityCodes: ["061"],
    definitionId: "si-municipal-police-offences-per-100000@1",
    referenceYear: 2025,
    offenceCounts: ["1200"],
  };

  function populationLoader(population = "300000"): CitySafetyPopulationLoader {
    return vi.fn(async ({ runId, referenceYear }) => ({
      kind: "captured" as const,
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: `${referenceYear}-01-01`,
      population,
      artifact: { ...artifact(`surs-source-${referenceYear}`, "https://pxweb.stat.si/population"), runId },
    }));
  }

  test("retains ordered navigation/terminal/SURS projections and reuses the same-year denominator", async () => {
    // Break caught: confirmed navigation loses lineage/raw bytes survive, or SURS is recaptured per candidate.
    const capture = vi.fn(async (request: { readonly url: string }) => {
      const captured = artifact(
        request.url.endsWith("safety") ? "navigation-source" : "terminal-source",
        request.url,
      );
      return {
        artifact: {
          ...captured,
          bytes: new TextEncoder().encode(request.url.endsWith("safety")
            ? "PRIVATE_RAW_NAVIGATION_CANARY"
            : "PRIVATE_RAW_TERMINAL_CANARY"),
        },
        redirectChain: [request.url],
      };
    });
    const analyze: CitySafetyMunicipalDocumentAnalyzer = vi.fn(async ({ artifact: captured }) =>
      captured.url.endsWith("safety")
        ? { kind: "navigate" as const, confirmedDocumentUrl: "https://ljubljana.si/report.pdf" }
        : terminalAnalysis);
    const loadPopulation = populationLoader();
    const adapter = createSloveniaCitySafetyAdapter({ capture, analyze, loadPopulation });

    const first = await adapter.inspect(inspectionInput());
    const second = await adapter.inspect({
      ...inspectionInput(),
      candidateUrl: "https://ljubljana.si/another.pdf",
    });

    expect(first.kind).toBe("usable");
    if (first.kind !== "usable") throw new Error("expected usable");
    expect(first.detail.officialTrace.edges).toEqual([{
      kind: "confirmed_document_link",
      fromUrl: "https://ljubljana.si/safety",
      toUrl: "https://ljubljana.si/report.pdf",
    }]);
    expect(first.detail.artifactRefs.map((ref) => ref.role === "municipal_source"
      ? `${ref.role}:${ref.documentRole}`
      : ref.role)).toEqual([
      "municipal_source:navigation",
      "municipal_source:terminal_claim",
      "surs_denominator",
    ]);
    expect(first.artifacts.map((item) => JSON.parse(new TextDecoder().decode(item.bytes)).schemaVersion))
      .toEqual([
        "city-safety-retained-navigation@1",
        "city-safety-retained-inspection@1",
        "city-safety-retained-denominator@1",
      ]);
    expect(first.artifacts.some((item) => new TextDecoder().decode(item.bytes)
      .includes("PRIVATE_RAW_"))).toBe(false);
    expect(loadPopulation).toHaveBeenCalledTimes(1);
    expect(second.artifacts.filter(({ role }) => role === "surs_denominator")).toHaveLength(1);
  });

  test("rejects broad municipality scope from complete terminal bytes without loading SURS", async () => {
    // Break caught: a multi-municipality police aggregate is relabelled as an exact city fact.
    const loadPopulation = populationLoader();
    const analyze: CitySafetyMunicipalDocumentAnalyzer = async () => ({
      ...terminalAnalysis,
      municipalityCodes: ["061", "070"],
    });
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("broad-source", request.url),
        redirectChain: [request.url],
      }),
      analyze,
      loadPopulation,
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({ reason: "scope_mismatch" }),
    }));
    expect(result.detail.artifactRefs).toHaveLength(1);
    expect(loadPopulation).not.toHaveBeenCalled();
  });

  test("preserves an untrusted redirect target outside official edges", async () => {
    // Break caught: rejected redirect targets become reviewed official links or disappear from trace truth.
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => {
        throw new SourceCaptureError("navigation_mismatch", "untrusted", undefined, {
          redirectChain: [request.url],
          rejectedRedirectUrl: "https://mirror.example/report.pdf",
          responseStatus: 302,
          responseUrl: request.url,
        });
      },
      analyze: async () => terminalAnalysis,
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({
        reason: "untrusted_redirect",
        officialTrace: expect.objectContaining({
          edges: [],
          lastTrustedUrl: "https://ljubljana.si/safety",
          failure: expect.objectContaining({
            rejectedTarget: {
              kind: "untrusted_target",
              url: "https://mirror.example/report.pdf",
            },
          }),
        }),
      }),
    }));
  });

  test("keeps the last trusted URL when captured terminal bytes name a non-Police authority", async () => {
    // Break caught: a semantic authority rejection falsely claims that the initial official URL was never trusted.
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("wrong-authority-source", request.url),
        redirectChain: [request.url],
      }),
      analyze: async () => ({ ...terminalAnalysis, dataAuthorityId: "gov" }),
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({
        reason: "authority_untrusted",
        officialTrace: expect.objectContaining({
          lastTrustedUrl: "https://ljubljana.si/safety",
        }),
      }),
    }));
    expect(result.artifacts).toEqual([]);
  });

  test("closes incompatible totals in one Police chain as an ordinal conflict basis", async () => {
    // Break caught: one official publication's incompatible totals are selected arbitrarily or lose replay basis.
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("conflict-source", request.url),
        redirectChain: [request.url],
      }),
      analyze: async () => ({ ...terminalAnalysis, offenceCounts: ["1200", "1100"] }),
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({
        reason: "conflict",
        reviewedOfficial: expect.objectContaining({ dataAuthorityId: "police" }),
        conflictBasis: expect.objectContaining({
          referenceYear: 2025,
          quantities: [
            expect.objectContaining({ offenceCount: "1100" }),
            expect.objectContaining({ offenceCount: "1200" }),
          ],
        }),
      }),
    }));
  });
});

describe("city-safety browser boundary", () => {
  test("bundles Decision, Research and Application entry modules for a web target", async () => {
    // Break caught: Node, Infrastructure, deployment secrets, or provider SDKs leak into inward modules.
    const temporaryRoot = mkdtempSync(join(tmpdir(), "city-safety-browser-"));
    const entryPath = join(temporaryRoot, "entry.ts");
    const outputPath = join(temporaryRoot, "dist");
    const root = process.cwd();
    writeFileSync(entryPath, [
      `export { classifyCitySafetyPeriod } from ${JSON.stringify(resolve(root, "src/decision/city-safety.ts"))};`,
      `export { canonicalizeCitySafetyCandidateUrl } from ${JSON.stringify(resolve(root, "src/research/city-safety-discovery.ts"))};`,
      `export { runCitySafetyDiscovery } from ${JSON.stringify(resolve(root, "src/application/run-city-safety-discovery.ts"))};`,
    ].join("\n"));
    const require = createRequire(import.meta.url);
    const { webpack } = require("next/dist/compiled/webpack/webpack") as {
      readonly webpack: (config: object) => {
        run(callback: (error?: Error, stats?: {
          hasErrors(): boolean;
          toString(options: object): string;
        }) => void): void;
        close(callback: () => void): void;
      };
    };
    const compiler = webpack({
      mode: "production",
      target: "web",
      entry: entryPath,
      output: { filename: "bundle.js", path: outputPath },
      resolve: { extensions: [".ts", ".js"] },
      module: {
        rules: [{
          test: /\.ts$/,
          use: [{
            loader: resolve(root, "tests/fixtures/place-frontier-client/typescript-loader.cjs"),
          }],
        }],
      },
      optimization: { minimize: false },
    });
    try {
      await new Promise<void>((resolveBuild, rejectBuild) => {
        compiler.run((error, stats) => compiler.close(() => {
          if (error != null) rejectBuild(error);
          else if (stats?.hasErrors()) rejectBuild(new Error(stats.toString({ all: false, errors: true })));
          else resolveBuild();
        }));
      });
      const bundle = readFileSync(join(outputPath, "bundle.js"), "utf8");
      expect(bundle).not.toContain("node:crypto");
      expect(bundle).not.toContain("CITY_SAFETY_SEARCH_ENDPOINT");
      expect(bundle).not.toContain("CITY_SAFETY_SEARCH_BEARER_TOKEN");
      expect(bundle).not.toContain("city-safety-search-adapter");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
