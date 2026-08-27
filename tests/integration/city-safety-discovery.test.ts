import { createHash } from "node:crypto";
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

function buildContext(
  retentionMode: "seal_raw_artifact" | "seal_hash_locator_then_delete_transient" =
  "seal_raw_artifact",
): {
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
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: id,
    runId: "run-1",
    sourceId: "si-city-safety",
    role: id.startsWith("surs") ? "surs_denominator" : "municipal_source",
    url,
    mediaType: "application/pdf",
    sha256: digest,
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
  const urlTag = createHash("sha256").update(input.candidateUrl).digest("hex").slice(0, 8);
  const municipal = artifact(`municipal-${referenceYear}-${quantity.offenceCount}-${urlTag}`, input.candidateUrl);
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
      transientRawDeleted: false,
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
        transientRawDeleted: false,
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
  function missingAt(candidate: CitySafetyCandidateInspectionInput): CitySafetyCandidateInspection {
    return {
      kind: "rejected",
      detail: {
        officialTrace: {
          initialUrl: candidate.candidateUrl,
          edges: [],
          lastTrustedUrl: candidate.candidateUrl,
          officialHops: 0,
          failure: { captureKind: "http_error", responseStatus: 404, responseUrl: candidate.candidateUrl },
        },
        artifactRefs: [],
        disposition: "rejected",
        reason: "http_not_found",
      },
      artifacts: [],
    };
  }

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

  test.each([
    ["extra detail key", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      detail: { ...inspection.detail, unexpected: true },
    })],
    ["extra trace key", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      detail: {
        ...inspection.detail,
        officialTrace: { ...inspection.detail.officialTrace, unexpected: true },
      },
    })],
    ["failure on usable detail", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      detail: {
        ...inspection.detail,
        officialTrace: {
          ...inspection.detail.officialTrace,
          failure: { captureKind: "http_error" },
        },
      },
    })],
    ["extra artifact key", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: inspection.artifacts.map((item, index) => index === 0
        ? { ...item, unexpected: true }
        : item),
    })],
    ["forged live artifact role", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: inspection.artifacts.map((item, index) => index === 1
        ? { ...item, role: "municipal_source" }
        : item),
    })],
    ["forged reference source hash", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      detail: {
        ...inspection.detail,
        artifactRefs: inspection.detail.artifactRefs.map((ref, index) => index === 0
          ? { ...ref, sourceSha256: "forged-source-sha" }
          : ref),
      },
    })],
    ["mutated bytes under unchanged artifact hash", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: inspection.artifacts.map((item, index) => index === 0
        ? { ...item, bytes: new TextEncoder().encode("mutated-after-hash") }
        : item),
    })],
    ["extra denominator key", (inspection: CitySafetyCandidateInspection) => inspection.kind === "usable"
      ? { ...inspection, detail: {
          ...inspection.detail,
          denominator: { ...inspection.detail.denominator, unexpected: true },
        } }
      : inspection],
    ["forged detail media type", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      detail: { ...inspection.detail, mediaType: "text/html" },
    })],
    ["extra quantity key", (inspection: CitySafetyCandidateInspection) => inspection.kind === "usable"
      ? { ...inspection, detail: {
          ...inspection.detail,
          quantity: { ...inspection.detail.quantity, unexpected: true },
        } }
      : inspection],
    ["forged denominator response provenance", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: inspection.artifacts.map((item, index) => index === 1
        ? { ...item, responseUrl: "https://mirror.example/population" }
        : item),
    })],
    ["missing terminal artifact and reference", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: inspection.artifacts.slice(1),
      detail: { ...inspection.detail, artifactRefs: inspection.detail.artifactRefs.slice(1) },
    })],
    ["reversed terminal and denominator order", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: [...inspection.artifacts].reverse(),
      detail: { ...inspection.detail, artifactRefs: [...inspection.detail.artifactRefs].reverse() },
    })],
    ["duplicate artifact identity", (inspection: CitySafetyCandidateInspection) => ({
      ...inspection,
      artifacts: [...inspection.artifacts, inspection.artifacts[0]!],
      detail: { ...inspection.detail, artifactRefs: [...inspection.detail.artifactRefs, inspection.detail.artifactRefs[0]!] },
    })],
  ] as const)("fails closed for usable inspection with %s", async (_name, mutate) => {
    // Break caught: an outer adapter-controlled field crosses into the immutable ledger unsanitized.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => mutate(usable(candidate, 2025, {
        offenceCount: "1200",
        population: "300000",
        rateBasis: "offences_per_100000_residents",
      })) as CitySafetyCandidateInspection,
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("rejects a semantic conclusion without reviewed official provenance", async () => {
    // Break caught: terminal semantic data is accepted without a closed publisher/Police review context.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const base = usable(candidate, 2025, {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        });
        if (base.kind !== "usable") throw new Error("expected usable fixture");
        return {
          kind: "rejected",
          detail: {
            officialTrace: base.detail.officialTrace,
            mediaType: base.detail.mediaType,
            retentionPolicyId: base.detail.retentionPolicyId,
            transientRawDeleted: base.detail.transientRawDeleted,
            artifactRefs: [base.detail.artifactRefs[0]!],
            disposition: "rejected",
            reason: "scope_mismatch",
          },
          artifacts: [base.artifacts[0]!],
        };
      },
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test.each([
    { name: "missing review", dataAuthorityId: undefined, accepted: false },
    { name: "empty authority", dataAuthorityId: "", accepted: false },
    { name: "required Police authority", dataAuthorityId: "police", accepted: false },
    { name: "nonempty external authority", dataAuthorityId: "external / authority", accepted: true },
  ] as const)("closes $name in a trusted authority-untrusted publication", async (scenario) => {
    // Break caught: trusted publication provenance is absent, empty, Police, or rejects a valid external authority.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
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
          ...(scenario.dataAuthorityId === undefined ? {} : {
            reviewedOfficial: {
              publisherId: "municipality-ljubljana",
              dataAuthorityId: scenario.dataAuthorityId,
              publisherNavigationUrl: "https://ljubljana.si/safety",
              resolvedEvidenceUrl: candidate.candidateUrl,
              referenceYear: 2025,
            },
          }),
          artifactRefs: [],
          disposition: "rejected",
          reason: "authority_untrusted",
        },
        artifacts: [],
      }),
    };

    const discovery = runCitySafetyDiscovery(input(context), {
      officialDocuments,
      search: { search: async () => ({ kind: "completed", providerId: "provider-a", urls: [] }) },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });
    if (!scenario.accepted) {
      await expect(discovery).rejects.toThrow("invalid_city_safety_inspection");
      return;
    }
    const result = await discovery;
    expect(result.ledger.candidates[0]).toEqual(expect.objectContaining({
      reviewedOfficial: expect.objectContaining({ dataAuthorityId: scenario.dataAuthorityId }),
    }));
  });

  test("rejects a semantic conclusion whose unreviewed edge leaves the configured publisher", async () => {
    // Break caught: omitting reviewedOfficial bypasses publisher-policy validation for trusted edges.
    const context = buildContext();
    const terminal = artifact("semantic-terminal", "https://mirror.example/report.pdf");
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => ({
        kind: "rejected",
        detail: {
          officialTrace: {
            initialUrl: candidate.candidateUrl,
            edges: [{
              kind: "confirmed_document_link",
              fromUrl: candidate.candidateUrl,
              toUrl: terminal.url,
            }],
            lastTrustedUrl: terminal.url,
            officialHops: 1,
          },
          mediaType: "application/pdf",
          retentionPolicyId: "municipality-ljubljana-retention@1",
          transientRawDeleted: true,
          artifactRefs: [{
            role: "municipal_source",
            documentRole: "terminal_claim",
            artifactId: terminal.artifactId,
            artifactSha256: terminal.sha256,
            sourceSha256: terminal.sha256,
            locator: terminal.url,
          }],
          disposition: "rejected",
          reason: "scope_mismatch",
        },
        artifacts: [terminal],
      }),
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("rejects malformed internal conflict quantities and denominator provenance", async () => {
    // Break caught: an unsorted/duplicate conflict basis becomes replay-significant ledger truth.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const base = usable(candidate, 2025, {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        });
        if (base.kind !== "usable") throw new Error("expected usable fixture");
        return {
          kind: "rejected",
          detail: {
            officialTrace: base.detail.officialTrace,
            reviewedOfficial: {
              publisherId: base.detail.publisherId,
              dataAuthorityId: "police",
              publisherNavigationUrl: base.detail.publisherNavigationUrl,
              resolvedEvidenceUrl: base.detail.resolvedEvidenceUrl,
              referenceYear: 2025,
            },
            mediaType: base.detail.mediaType,
            retentionPolicyId: base.detail.retentionPolicyId,
            transientRawDeleted: base.detail.transientRawDeleted,
            artifactRefs: base.detail.artifactRefs,
            disposition: "rejected",
            reason: "conflict",
            conflictBasis: {
              referenceYear: 2025,
              quantities: [base.detail.quantity, base.detail.quantity],
              denominator: { ...base.detail.denominator, artifactId: "forged-denominator" },
            },
          },
          artifacts: base.artifacts,
        };
      },
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("rejects lexically ordered but numerically reversed conflict quantities", async () => {
    // Break caught: Application accepts canonical counts ordered as 10 then 9.
    const context = buildContext();
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const base = usable(candidate, 2025, {
          offenceCount: "10",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        });
        if (base.kind !== "usable") throw new Error("expected usable fixture");
        const conflictBasis = {
          referenceYear: 2025,
          quantities: [
            base.detail.quantity,
            { ...base.detail.quantity, offenceCount: "9" },
          ] as const,
          denominator: base.detail.denominator,
        };
        return {
          kind: "rejected",
          detail: {
            officialTrace: base.detail.officialTrace,
            reviewedOfficial: {
              publisherId: base.detail.publisherId,
              dataAuthorityId: "police",
              publisherNavigationUrl: base.detail.publisherNavigationUrl,
              resolvedEvidenceUrl: base.detail.resolvedEvidenceUrl,
              referenceYear: 2025,
            },
            mediaType: base.detail.mediaType,
            retentionPolicyId: base.detail.retentionPolicyId,
            transientRawDeleted: base.detail.transientRawDeleted,
            artifactRefs: base.detail.artifactRefs,
            disposition: "rejected",
            reason: "conflict",
            conflictBasis,
          },
          artifacts: base.artifacts,
        };
      },
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: {
        search: async () => ({ kind: "completed", providerId: "numeric-order-test", urls: [] }),
      },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("rejects a canonically rehashed retained projection with forged city and outcome", async () => {
    // Break caught: projection envelope provenance is valid, but its semantic payload is not bound to the attempt.
    const context = buildContext("seal_hash_locator_then_delete_transient");
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("projection-terminal-source", request.url),
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
      loadPopulation: async ({ runId, referenceYear }) => ({
        kind: "captured",
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: `${referenceYear}-01-01`,
        population: "300000",
        artifact: { ...artifact("projection-surs-source", "https://pxweb.stat.si/population"), runId },
      }),
    });
    const officialDocuments: CitySafetyOfficialDocumentPort = {
      inspect: async (candidate) => {
        const inspected = await adapter.inspect(candidate);
        if (inspected.kind !== "usable") return inspected;
        const projection = JSON.parse(new TextDecoder().decode(inspected.artifacts[0]!.bytes)) as Record<string, unknown>;
        projection.cityId = "forged-city";
        projection.outcome = { kind: "rejected", basis: { kind: "missing_numerator" } };
        const bytes = new TextEncoder().encode(INTEGRITY.canonical(projection));
        const digest = createHash("sha256").update(bytes).digest("hex");
        return {
          ...inspected,
          artifacts: inspected.artifacts.map((item, index) => index === 0
            ? { ...item, bytes, sha256: digest, artifactId: `forged:${digest}` }
            : item),
          detail: {
            ...inspected.detail,
            artifactRefs: inspected.detail.artifactRefs.map((ref, index) => index === 0
              ? { ...ref, artifactId: `forged:${digest}`, artifactSha256: digest }
              : ref),
          },
        };
      },
    };

    await expect(runCitySafetyDiscovery(input(context), {
      search: { search: vi.fn() },
      officialDocuments,
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("accepts a bound retained navigation projection before an untrusted confirmed link", async () => {
    const context = buildContext("seal_hash_locator_then_delete_transient");
    const officialDocuments = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("application-rejected-navigation", request.url),
        redirectChain: [request.url],
      }),
      analyze: async () => ({ kind: "navigate", confirmedDocumentUrl: "https://mirror.example/report.pdf" }),
      loadPopulation: async () => ({ kind: "missing" }),
    });

    const result = await runCitySafetyDiscovery(input(context), {
      officialDocuments,
      search: {
        search: async () => ({
          kind: "unavailable",
          providerId: "provider-a",
          reason: "provider_unavailable",
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(result.ledger.candidates[0]).toEqual(expect.objectContaining({
      disposition: "rejected",
      reason: "untrusted_redirect",
      artifactRefs: [expect.objectContaining({ documentRole: "navigation" })],
    }));
  });

  test("closes the exact three-query, ten-candidate and two-hop budgets sequentially", async () => {
    const context = buildContext();
    const inspected: CitySafetyCandidateInspectionInput[] = [];
    const limits: number[] = [];
    let query = 0;
    const result = await runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          inspected.push(candidate);
          return missingAt(candidate);
        },
      },
      search: {
        search: async ({ resultLimit }) => {
          limits.push(resultLimit);
          query += 1;
          return {
            kind: "completed",
            providerId: "provider-a",
            urls: Array.from({ length: 3 }, (_item, index) =>
              `https://policija.si/query-${query}-${index}.pdf`),
          };
        },
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(result.ledger.counters).toEqual({ queries: 3, candidates: 10, maxOfficialHops: 0 });
    expect(limits).toEqual([9, 6, 3]);
    expect(inspected).toHaveLength(10);
    expect(inspected.every(({ officialHopLimit }) => officialHopLimit === 2)).toBe(true);
  });

  test.each([
    { name: "compatible", laterCount: "1100", expected: "verified" },
    { name: "conflicting", laterCount: "1200", expected: "unknown" },
  ] as const)("keeps exact $name same-year fallback claims and deduplicates the SURS artifact", async (scenario) => {
    const context = buildContext();
    let inspection = 0;
    let query = 0;
    const result = await runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          inspection += 1;
          return usable(candidate, 2024, {
            offenceCount: inspection === 1 ? "1100" : scenario.laterCount,
            population: "299000",
            rateBasis: "offences_per_100000_residents",
          });
        },
      },
      search: {
        search: async () => ({
          kind: "completed",
          providerId: "provider-a",
          urls: query++ === 0 ? ["https://policija.si/fallback.pdf"] : [],
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(result.ledger.result.kind).toBe(scenario.expected);
    if (scenario.expected === "unknown") {
      expect(result.ledger.result).toEqual({ kind: "unknown", reason: "conflict" });
    }
    expect(result.ledger.candidates.filter(({ disposition }) => disposition === "usable")).toHaveLength(2);
    expect(result.artifacts.filter(({ role }) => role === "surs_denominator")).toHaveLength(1);
  });

  test("aborts when a repeated artifact identity carries divergent valid bytes and provenance", async () => {
    const context = buildContext();
    let inspection = 0;
    let query = 0;
    await expect(runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          inspection += 1;
          const base = usable(candidate, 2024, {
            offenceCount: "1100",
            population: "299000",
            rateBasis: "offences_per_100000_residents",
          });
          if (inspection === 1 || base.kind !== "usable") return base;
          const bytes = new TextEncoder().encode("divergent-surs-bytes");
          const digest = createHash("sha256").update(bytes).digest("hex");
          return {
            ...base,
            artifacts: base.artifacts.map((item) => item.role === "surs_denominator"
              ? { ...item, bytes, sha256: digest }
              : item),
            detail: {
              ...base.detail,
              artifactRefs: base.detail.artifactRefs.map((ref) => ref.role === "surs_denominator"
                ? { ...ref, artifactSha256: digest, sourceSha256: digest }
                : ref),
            },
          };
        },
      },
      search: {
        search: async () => ({
          kind: "completed",
          providerId: "provider-a",
          urls: query++ === 0 ? ["https://policija.si/fallback.pdf"] : [],
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("city_safety_artifact_conflict");
  });

  test.each([
    { name: "artifact identity", mutate: (denominator: Record<string, unknown>) => { denominator.artifactId = "forged-surs-id"; } },
    { name: "artifact media", mutate: (denominator: Record<string, unknown>) => { denominator.mediaType = "application/pdf"; } },
  ])("rejects a rehashed retained denominator with forged $name", async ({ mutate }) => {
    // Break caught: a rejection projection can name SURS evidence other than the returned ref/artifact.
    const context = buildContext("seal_hash_locator_then_delete_transient");
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({ artifact: artifact("forged-denominator-terminal", request.url), redirectChain: [request.url] }),
      analyze: async () => ({
        kind: "terminal", dataAuthorityId: "police", municipalityCodes: ["061"],
        definitionId: "si-municipal-police-offences-per-100000@1", referenceYear: 2025, offenceCounts: ["1200"],
      }),
      loadPopulation: async ({ runId }) => ({
        kind: "captured", publisherId: "surs", municipalityCode: "061", referenceDate: "2025-01-01",
        population: "0", artifact: { ...artifact("forged-denominator-surs", "https://pxweb.stat.si/population"), runId },
      }),
    });
    await expect(runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          const inspected = await adapter.inspect(candidate);
          if (inspected.kind !== "rejected") return inspected;
          const terminalIndex = inspected.detail.artifactRefs.findIndex((ref) =>
            ref.role === "municipal_source" && ref.documentRole === "terminal_claim");
          const projection = JSON.parse(new TextDecoder().decode(inspected.artifacts[terminalIndex]!.bytes)) as {
            outcome: { basis: { observedDenominator: Record<string, unknown> } };
          };
          mutate(projection.outcome.basis.observedDenominator);
          const bytes = new TextEncoder().encode(INTEGRITY.canonical(projection));
          const digest = createHash("sha256").update(bytes).digest("hex");
          const artifactId = `forged-terminal:${digest}`;
          return {
            ...inspected,
            artifacts: inspected.artifacts.map((item, index) => index === terminalIndex
              ? { ...item, artifactId, sha256: digest, bytes }
              : item),
            detail: {
              ...inspected.detail,
              artifactRefs: inspected.detail.artifactRefs.map((ref, index) => index === terminalIndex
                ? { ...ref, artifactId, artifactSha256: digest }
                : ref),
            },
          };
        },
      },
      search: { search: async () => ({ kind: "unavailable", providerId: "provider-a", reason: "provider_unavailable" }) },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test.each([
    { name: "non-array", artifacts: { forged: true } },
    { name: "non-empty", artifacts: [{}] },
    { name: "sparse", artifacts: Object.assign([], { length: 1 }) },
  ])("rejects $name artifacts when publisher authority is unresolved", async ({ artifacts: malformedArtifacts }) => {
    // Break caught: the unresolved-publisher branch must validate, not discard, the adapter payload.
    const context = buildContext();
    let query = 0;
    await expect(runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => candidate.candidateUrl.includes("unknown.example")
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
              artifacts: malformedArtifacts,
            } as unknown as CitySafetyCandidateInspection
          : missingAt(candidate),
      },
      search: {
        search: async () => ({
          kind: "completed", providerId: "provider-a",
          urls: query++ === 0 ? ["https://unknown.example/report.pdf"] : [],
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test.each(["seal_raw_artifact", "seal_hash_locator_then_delete_transient"] as const)(
    "preserves exact PXWeb POST provenance under %s",
    async (retentionMode) => {
      // Break caught: SURS POST provenance is either rejected or silently rewritten to GET.
      const context = buildContext(retentionMode);
      const bodySha256 = "a".repeat(64);
      const officialDocuments = createSloveniaCitySafetyAdapter({
        capture: async (request) => ({ artifact: artifact("post-terminal", request.url), redirectChain: [request.url] }),
        analyze: async () => ({
          kind: "terminal", dataAuthorityId: "police", municipalityCodes: ["061"],
          definitionId: "si-municipal-police-offences-per-100000@1", referenceYear: 2025, offenceCounts: ["1200"],
        }),
        loadPopulation: async ({ runId }) => ({
          kind: "captured", publisherId: "surs", municipalityCode: "061", referenceDate: "2025-01-01",
          population: "300000",
          artifact: {
            ...artifact("post-surs", "https://pxweb.stat.si/population"),
            runId,
            request: {
              method: "POST",
              url: "https://pxweb.stat.si/population",
              bodyMediaType: "application/json",
              bodySha256,
            },
          },
        }),
      });

      const result = await runCitySafetyDiscovery(input(context), {
        officialDocuments,
        search: { search: vi.fn() },
        clock: () => new Date("2026-03-01T12:00:00.000Z"),
      });

      expect(result.artifacts.find(({ role }) => role === "surs_denominator")?.request).toEqual({
        method: "POST",
        url: "https://pxweb.stat.si/population",
        bodyMediaType: "application/json",
        bodySha256,
      });
    },
  );

  test.each([
    { name: "POST missing media", request: { method: "POST", url: "https://pxweb.stat.si/population", bodySha256: "a".repeat(64) } },
    { name: "POST malformed hash", request: { method: "POST", url: "https://pxweb.stat.si/population", bodyMediaType: "application/json", bodySha256: "bad" } },
    { name: "POST extra field", request: { method: "POST", url: "https://pxweb.stat.si/population", bodyMediaType: "application/json", bodySha256: "a".repeat(64), extra: true } },
    { name: "GET body metadata", request: { method: "GET", url: "https://pxweb.stat.si/population", bodyMediaType: "application/json", bodySha256: "a".repeat(64) } },
  ])("rejects malformed SURS request provenance: $name", async ({ request }) => {
    const context = buildContext();
    await expect(runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          const inspected = usable(candidate, 2025, {
            offenceCount: "1200", population: "300000", rateBasis: "offences_per_100000_residents",
          });
          return {
            ...inspected,
            artifacts: inspected.artifacts.map((item) => item.role === "surs_denominator"
              ? { ...item, request }
              : item),
          } as CitySafetyCandidateInspection;
        },
      },
      search: { search: vi.fn() },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("rejects POST provenance on a municipal document artifact", async () => {
    const context = buildContext();
    await expect(runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => {
          const inspected = usable(candidate, 2025, {
            offenceCount: "1200", population: "300000", rateBasis: "offences_per_100000_residents",
          });
          return {
            ...inspected,
            artifacts: inspected.artifacts.map((item) => item.role === "municipal_source"
              ? {
                  ...item,
                  request: {
                    method: "POST", url: item.request.url, bodyMediaType: "application/json",
                    bodySha256: "a".repeat(64),
                  },
                }
              : item),
          } as CitySafetyCandidateInspection;
        },
      },
      search: { search: vi.fn() },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    })).rejects.toThrow("invalid_city_safety_inspection");
  });

  test("records retention_unapproved as source unavailable without artifacts", async () => {
    const context = buildContext();
    const result = await runCitySafetyDiscovery(input(context), {
      officialDocuments: {
        inspect: async (candidate) => ({
          kind: "rejected",
          detail: {
            officialTrace: {
              initialUrl: candidate.candidateUrl, edges: [], lastTrustedUrl: candidate.candidateUrl, officialHops: 0,
            },
            artifactRefs: [], disposition: "rejected", reason: "retention_unapproved",
          },
          artifacts: [],
        }),
      },
      search: { search: async () => ({ kind: "unavailable", providerId: "provider-a", reason: "provider_unavailable" }) },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(result.ledger.result).toEqual({ kind: "unknown", reason: "source_unavailable" });
    expect(result.artifacts).toEqual([]);
  });

  test("records all three search_provider_unconfigured outcomes", async () => {
    const context = buildContext();
    const result = await runCitySafetyDiscovery(input(context), {
      officialDocuments: { inspect: async (candidate) => missingAt(candidate) },
      search: {
        search: async () => ({
          kind: "unavailable", providerId: "unconfigured", reason: "search_provider_unconfigured",
        }),
      },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(result.ledger.queries.map(({ outcome }) => outcome)).toEqual([
      { kind: "unavailable", reason: "search_provider_unconfigured" },
      { kind: "unavailable", reason: "search_provider_unconfigured" },
      { kind: "unavailable", reason: "search_provider_unconfigured" },
    ]);
    expect(result.ledger.result).toEqual({ kind: "unknown", reason: "source_unavailable" });
  });

  test("propagates the exact caller abort reason without sealing a ledger", async () => {
    const context = buildContext();
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    const promise = runCitySafetyDiscovery({ ...input(context), signal: controller.signal }, {
      officialDocuments: {
        inspect: async () => {
          controller.abort(reason);
          throw reason;
        },
      },
      search: { search: vi.fn() },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    await expect(promise).rejects.toBe(reason);
  });

  test("accepts previous preferred Y-1 before configured routes and suppresses search", async () => {
    const context = buildContext();
    const inspected: string[] = [];
    const search = vi.fn();
    const result = await runCitySafetyDiscovery({
      ...input(context),
      previousAccepted: {
        cityId: "ljubljana", municipalityCode: "061", sourcePlanId: "prior-plan:1",
        definitionId: "si-municipal-police-offences-per-100000@1", publisherId: "police",
        navigationUrl: "https://policija.si/", resolvedEvidenceUrl: "https://policija.si/previous.pdf",
        referenceYear: 2025, evidenceSnapshotId: "evidence:previous",
      },
    }, {
      officialDocuments: {
        inspect: async (candidate) => {
          inspected.push(candidate.candidateUrl);
          return usable(candidate, 2025, {
            offenceCount: "1200", population: "300000", rateBasis: "offences_per_100000_residents",
          });
        },
      },
      search: { search },
      clock: () => new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(inspected).toEqual(["https://policija.si/previous.pdf"]);
    expect(search).not.toHaveBeenCalled();
    expect(result.ledger.result).toEqual(expect.objectContaining({ kind: "verified", acceptedCandidateIndex: 0 }));
  });
});

describe("Slovenia city-safety official adapter", () => {
  function inspectionInput(
    context = buildContext("seal_hash_locator_then_delete_transient"),
  ): CitySafetyCandidateInspectionInput {
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
    // Break caught: a successful cache entry retains and rereads the raw SURS artifact.
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
    let rawPopulationAccessible = true;
    const loadPopulation: CitySafetyPopulationLoader & ReturnType<typeof vi.fn> = vi.fn(
      async ({ runId, referenceYear }) => {
        const rawArtifact = { ...artifact(
          `surs-source-${referenceYear}`,
          "https://pxweb.stat.si/population",
        ), runId };
        const rawBytes = rawArtifact.bytes;
        Object.defineProperty(rawArtifact, "bytes", {
          enumerable: true,
          get() {
            if (!rawPopulationAccessible) throw new Error("raw_population_cache_canary");
            return rawBytes;
          },
        });
        return {
          kind: "captured" as const,
          publisherId: "surs",
          municipalityCode: "061",
          referenceDate: `${referenceYear}-01-01`,
          population: "300000",
          artifact: rawArtifact,
        };
      },
    );
    const adapter = createSloveniaCitySafetyAdapter({ capture, analyze, loadPopulation });

    const first = await adapter.inspect(inspectionInput());
    rawPopulationAccessible = false;
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

  test("owns every resolved and missing population cache seed", async () => {
    // Break caught: caller or loader mutation corrupts private same-year population cache authority.
    const capture = vi.fn(async (request: { readonly url: string }) => ({
      artifact: artifact(
        request.url.endsWith("safety") ? "navigation-source" : "terminal-source",
        request.url,
      ),
      redirectChain: [request.url],
    }));
    const analyze: CitySafetyMunicipalDocumentAnalyzer = vi.fn(async ({ artifact: captured }) =>
      captured.url.endsWith("safety")
        ? { kind: "navigate" as const, confirmedDocumentUrl: "https://ljubljana.si/report.pdf" }
        : terminalAnalysis);
    const loadPopulation = populationLoader();
    const adapter = createSloveniaCitySafetyAdapter({ capture, analyze, loadPopulation });
    const first = await adapter.inspect(inspectionInput());
    expect(first.kind).toBe("usable");
    if (first.kind !== "usable") throw new Error("expected usable");
    const firstArtifact = first.artifacts.find(({ role }) => role === "surs_denominator");
    const firstReference = first.detail.artifactRefs.find(({ role }) => role === "surs_denominator");
    expect(firstArtifact).toBeDefined();
    expect(firstReference).toBeDefined();
    const expectedBytes = new Uint8Array(firstArtifact!.bytes);
    const expectedReference = structuredClone(firstReference!);
    const expectedDenominator = structuredClone(first.detail.denominator);

    firstArtifact!.bytes.fill(0);
    (firstReference as unknown as { locator: string }).locator = "https://poison.invalid/reference";
    (first.detail.denominator as unknown as { population: string }).population = "1";

    const second = await adapter.inspect({
      ...inspectionInput(),
      candidateUrl: "https://ljubljana.si/another.pdf",
    });
    expect(second.kind).toBe("usable");
    if (second.kind !== "usable") throw new Error("expected usable");
    const secondArtifact = second.artifacts.find(({ role }) => role === "surs_denominator");
    const secondReference = second.detail.artifactRefs.find(({ role }) => role === "surs_denominator");
    expect(second.detail.denominator).toEqual(expectedDenominator);
    expect(secondReference).toEqual(expectedReference);
    expect(secondArtifact?.bytes).toEqual(expectedBytes);
    expect(loadPopulation).toHaveBeenCalledTimes(1);

    const borrowedMissing = { kind: "missing" } as { kind: "missing" | "captured" };
    const loadMissing: CitySafetyPopulationLoader & ReturnType<typeof vi.fn> = vi.fn(
      async () => borrowedMissing as { readonly kind: "missing" },
    );
    const missingAdapter = createSloveniaCitySafetyAdapter({ capture, analyze, loadPopulation: loadMissing });
    const firstMissing = await missingAdapter.inspect(inspectionInput());
    expect(firstMissing).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({ reason: "denominator_missing" }),
    }));
    borrowedMissing.kind = "captured";

    const secondMissing = await missingAdapter.inspect({
      ...inspectionInput(),
      candidateUrl: "https://ljubljana.si/missing-again.pdf",
    });
    expect(secondMissing).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({ reason: "denominator_missing" }),
    }));
    expect(loadMissing).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: "ordinary rejection", error: new Error("population_loader_failure") },
    { name: "loader AbortError", error: new DOMException("loader aborted", "AbortError") },
  ])("evicts a rejected population load after $name", async ({ error }) => {
    // Break caught: a rejected population Promise permanently poisons the same cache key.
    const loadPopulation: CitySafetyPopulationLoader & ReturnType<typeof vi.fn> = vi.fn(
      async ({ runId, referenceYear }) => {
        if (loadPopulation.mock.calls.length === 1) throw error;
        return {
          kind: "captured" as const,
          publisherId: "surs",
          municipalityCode: "061",
          referenceDate: `${referenceYear}-01-01`,
          population: "300000",
          artifact: { ...artifact(
            `surs-retry-${referenceYear}`,
            "https://pxweb.stat.si/population",
          ), runId },
        };
      },
    );
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("population-retry-terminal", request.url),
        redirectChain: [request.url],
      }),
      analyze: async () => terminalAnalysis,
      loadPopulation,
    });
    const firstInput = inspectionInput();

    await expect(adapter.inspect(firstInput)).rejects.toBe(error);
    expect(firstInput.signal.aborted).toBe(false);
    const retry = await adapter.inspect({
      ...inspectionInput(),
      candidateUrl: "https://ljubljana.si/population-retry.pdf",
    });

    expect(retry.kind).toBe("usable");
    expect(loadPopulation).toHaveBeenCalledTimes(2);
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

  test.each([
    { name: "definition", analysis: { definitionId: "wrong-definition@1" }, population: "300000", reason: "definition_mismatch", surs: false },
    { name: "numerator", analysis: { offenceCounts: [] }, population: "300000", reason: "missing_numerator", surs: false },
    { name: "stale", analysis: { referenceYear: 2023 }, population: "300000", reason: "stale", surs: true },
    { name: "zero denominator", analysis: {}, population: "0", reason: "denominator_zero", surs: true },
  ] as const)("retains the class-sensitive terminal basis for $name rejection", async (scenario) => {
    const loadPopulation = populationLoader(scenario.population);
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({ artifact: artifact(`semantic-${scenario.name}`, request.url), redirectChain: [request.url] }),
      analyze: async () => ({ ...terminalAnalysis, ...scenario.analysis }),
      loadPopulation,
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result.kind).toBe("rejected");
    expect(result.detail).toEqual(expect.objectContaining({
      reason: scenario.reason,
      reviewedOfficial: expect.objectContaining({ dataAuthorityId: "police" }),
    }));
    expect(result.detail.artifactRefs.map((ref) => ref.role)).toEqual(
      scenario.surs ? ["municipal_source", "surs_denominator"] : ["municipal_source"],
    );
  });

  test.each([
    { name: "missing", result: { kind: "missing" as const }, reason: "denominator_missing" },
    {
      name: "year",
      result: {
        kind: "captured" as const, publisherId: "surs", municipalityCode: "061",
        referenceDate: "2024-01-01", population: "300000",
      },
      reason: "denominator_period_mismatch",
    },
    {
      name: "scope",
      result: {
        kind: "captured" as const, publisherId: "surs", municipalityCode: "999",
        referenceDate: "2025-01-01", population: "300000",
      },
      reason: "denominator_scope_mismatch",
    },
  ] as const)("closes $name denominator failure with exact SURS cardinality", async (scenario) => {
    const loadPopulation: CitySafetyPopulationLoader = async ({ runId }) => scenario.result.kind === "missing"
      ? scenario.result
      : {
          ...scenario.result,
          artifact: { ...artifact(`surs-${scenario.name}`, "https://pxweb.stat.si/population"), runId },
        };
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({ artifact: artifact(`denominator-${scenario.name}`, request.url), redirectChain: [request.url] }),
      analyze: async () => terminalAnalysis,
      loadPopulation,
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") throw new Error("expected rejected");
    expect(result.detail.reason).toBe(scenario.reason);
    expect(result.detail.artifactRefs.map((ref) => ref.role)).toEqual(scenario.result.kind === "missing"
      ? ["municipal_source"]
      : ["municipal_source", "surs_denominator"]);
  });

  test.each([
    { kind: "http_error", status: 404, reason: "http_not_found" },
    { kind: "timeout", status: undefined, reason: "transport_unavailable" },
    { kind: "wrong_media_type", status: 200, reason: "wrong_media_type" },
    { kind: "too_large", status: 200, reason: "too_large" },
  ] as const)("maps $kind capture failure to $reason without a terminal artifact", async (scenario) => {
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => {
        throw new SourceCaptureError(scenario.kind, scenario.kind, undefined, {
          redirectChain: [request.url],
          ...(scenario.status === undefined ? {} : { responseStatus: scenario.status }),
          responseUrl: request.url,
          ...(scenario.kind === "wrong_media_type" ? { mediaType: "text/html" } : {}),
        });
      },
      analyze: async () => terminalAnalysis,
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") throw new Error("expected rejected");
    expect(result.detail.reason).toBe(scenario.reason);
    expect(result.detail.artifactRefs).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });

  test("retains raw navigation, terminal and SURS bytes under raw retention", async () => {
    const context = buildContext("seal_raw_artifact");
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact(request.url.endsWith("safety") ? "raw-navigation" : "raw-terminal", request.url),
        redirectChain: [request.url],
      }),
      analyze: async ({ artifact: captured }) => captured.url.endsWith("safety")
        ? { kind: "navigate", confirmedDocumentUrl: "https://ljubljana.si/report.pdf" }
        : terminalAnalysis,
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput(context));

    expect(result.kind).toBe("usable");
    expect(result.artifacts.map(({ mediaType }) => mediaType)).toEqual([
      "application/pdf", "application/pdf", "application/pdf",
    ]);
    expect(result.detail.artifactRefs.every((ref) => ref.artifactSha256 === ref.sourceSha256)).toBe(true);
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

  test("retains an earlier complete navigation page before rejecting terminal authority", async () => {
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact(request.url.endsWith("safety") ? "authority-navigation" : "authority-terminal", request.url),
        redirectChain: [request.url],
      }),
      analyze: async ({ artifact: captured }) => captured.url.endsWith("safety")
        ? { kind: "navigate", confirmedDocumentUrl: "https://ljubljana.si/report.pdf" }
        : { ...terminalAnalysis, dataAuthorityId: "gov" },
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result.kind).toBe("rejected");
    expect(result.detail.artifactRefs).toEqual([
      expect.objectContaining({ role: "municipal_source", documentRole: "navigation" }),
    ]);
    expect(result.artifacts).toHaveLength(1);
  });

  test.each([
    {
      name: "untrusted target",
      target: "https://mirror.example/report.pdf",
      redirectChain: ["https://ljubljana.si/safety"],
      terminalUrl: "https://ljubljana.si/safety",
      rejectedKind: "untrusted_target",
    },
    {
      name: "redirect plus confirmed-link hop limit",
      target: "https://ljubljana.si/third.pdf",
      redirectChain: [
        "https://ljubljana.si/safety",
        "https://ljubljana.si/one",
        "https://ljubljana.si/two",
      ],
      terminalUrl: "https://ljubljana.si/two",
      rejectedKind: "hop_limit",
    },
  ] as const)("retains a fully captured navigation page before rejecting $name", async (scenario) => {
    // Break caught: complete official navigation bytes disappear when their proposed next link is rejected.
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async () => ({
        artifact: artifact("rejected-navigation-source", scenario.terminalUrl),
        redirectChain: scenario.redirectChain,
      }),
      analyze: async () => ({ kind: "navigate", confirmedDocumentUrl: scenario.target }),
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({
        reason: "untrusted_redirect",
        officialTrace: expect.objectContaining({
          failure: expect.objectContaining({
            rejectedTarget: { kind: scenario.rejectedKind, url: scenario.target },
          }),
        }),
        artifactRefs: [expect.objectContaining({
          role: "municipal_source",
          documentRole: "navigation",
        })],
      }),
      artifacts: [expect.objectContaining({ role: "municipal_source" })],
    }));
    expect(JSON.parse(new TextDecoder().decode(result.artifacts[0]!.bytes)).schemaVersion)
      .toBe("city-safety-retained-navigation@1");
  });

  test("retains a captured page and rejects a confirmed-link loop without following it", async () => {
    // Break caught: analyzer-confirmed self-links are appended as trusted edges and requested again.
    const capture = vi.fn(async (request: { readonly url: string }) => ({
      artifact: artifact("loop-navigation-source", request.url),
      redirectChain: [request.url],
    }));
    const adapter = createSloveniaCitySafetyAdapter({
      capture,
      analyze: async () => ({
        kind: "navigate",
        confirmedDocumentUrl: "https://ljubljana.si/safety",
      }),
      loadPopulation: populationLoader(),
    });

    const result = await adapter.inspect(inspectionInput());

    expect(capture).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      kind: "rejected",
      detail: expect.objectContaining({
        reason: "untrusted_redirect",
        officialTrace: expect.objectContaining({
          edges: [],
          failure: expect.objectContaining({
            rejectedTarget: {
              kind: "redirect_loop",
              url: "https://ljubljana.si/safety",
            },
          }),
        }),
        artifactRefs: [expect.objectContaining({ documentRole: "navigation" })],
      }),
    }));
  });

  test("closes incompatible totals in one Police chain as an ordinal conflict basis", async () => {
    // Break caught: one official publication's incompatible totals are selected arbitrarily or lose replay basis.
    const adapter = createSloveniaCitySafetyAdapter({
      capture: async (request) => ({
        artifact: artifact("conflict-source", request.url),
        redirectChain: [request.url],
      }),
      analyze: async () => ({ ...terminalAnalysis, offenceCounts: ["10", "9"] }),
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
            expect.objectContaining({ offenceCount: "9" }),
            expect.objectContaining({ offenceCount: "10" }),
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
