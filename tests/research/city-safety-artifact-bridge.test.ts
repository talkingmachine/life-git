import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildCityCatalogRevision,
  buildCityRegistryRevision,
} from "../../src/decision/city-catalog";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  reconstructCitySafetyArtifactBridge,
  type CitySafetyArtifactBridgeInput,
} from "../../src/research/city-safety-artifact-bridge";
import type {
  CityEvidenceReplayIntegrity,
} from "../../src/research/city-evidence";
import type {
  CitySafetyArtifactReference,
  CitySafetyAttemptLedger,
  CitySafetyPreviousAcceptedReference,
  CitySafetyRetainedDenominatorProjection,
  CitySafetyRetainedInspectionProjection,
  CitySafetyRetainedNavigationProjection,
} from "../../src/research/city-safety-evidence";
import { reconstructCitySafetyAttemptLedger } from "../../src/research/city-safety-evidence";
import {
  buildCitySafetyQueries,
  buildCitySafetySourcePlan,
  buildOfficialAuthorityDirectory,
  type OfficialRetentionMode,
} from "../../src/research/city-safety-source-plan";

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" &&
    !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item);
}

const DECISION_INTEGRITY: CityDecisionIntegrity = {
  canonical,
  hash(value) {
    return createHash("sha256").update(value).digest("hex");
  },
};

const REPLAY_INTEGRITY: CityEvidenceReplayIntegrity = {
  ...DECISION_INTEGRITY,
  hashBytes(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
  },
};

const ASSESSMENT_AT = "2026-03-01T00:00:00.000Z";
const CAPTURED_AT = "2026-03-01T12:00:00.000Z";
const COMPLETED_AT = "2026-03-01T12:00:01.000Z";
const CITY_CHECK_RUN_ID = "city-check:si:ljubljana:1";
const MUNICIPAL_URL = "https://ljubljana.si/safety";
const REDIRECTED_MUNICIPAL_URL = "https://ljubljana.si/safety-report.pdf";
const PREVIOUS_MUNICIPAL_URL = "https://ljubljana.si/previous-report.pdf";
const DENOMINATOR_URL = "https://pxweb.stat.si/population";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifact(
  artifactId: string,
  role: "municipal_source" | "surs_denominator",
  url: string,
  bytes: Uint8Array,
  mediaType: string,
): LiveCapturedArtifact<"si-city-safety"> {
  return {
    artifactId,
    runId: CITY_CHECK_RUN_ID,
    sourceId: "si-city-safety",
    role,
    url,
    mediaType,
    sha256: sha256(bytes),
    bytes,
    origin: "live",
    capturedAt: CAPTURED_AT,
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

function buildFixture(retentionMode: OfficialRetentionMode) {
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
  }, DECISION_INTEGRITY);
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
  }, DECISION_INTEGRITY);
  const publisher = (
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
      publisher("municipality-ljubljana", "municipality", "https://ljubljana.si/"),
      publisher("police", "police", "https://policija.si/"),
      publisher("gov", "government", "https://gov.si/"),
      publisher("opsi", "open_data", "https://podatki.gov.si/"),
      publisher("surs", "statistics", "https://pxweb.stat.si/"),
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
  }, DECISION_INTEGRITY);
  const sourcePlan = buildCitySafetySourcePlan({
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
        navigationUrl: MUNICIPAL_URL,
      }],
    }],
  }, DECISION_INTEGRITY);
  return { catalog, directory, sourcePlan };
}

function ledger(
  fixture: ReturnType<typeof buildFixture>,
  refs: readonly CitySafetyArtifactReference[],
  transientRawDeleted: boolean,
  mediaType: string,
): CitySafetyAttemptLedger {
  const denominatorRef = refs.find(({ role }) => role === "surs_denominator");
  if (denominatorRef === undefined) throw new Error("expected denominator fixture");
  const quantity = {
    offenceCount: "1200",
    population: "300000",
    rateBasis: "offences_per_100000_residents" as const,
  };
  return {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: fixture.catalog.id,
    authorityDirectoryId: fixture.directory.id,
    sourcePlanId: fixture.sourcePlan.id,
    cityId: "ljubljana",
    municipalityCode: "061",
    assessmentAt: ASSESSMENT_AT,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: [],
    candidates: [{
      index: 0,
      origin: { kind: "configured", configuredRouteIndex: 0 },
      canonicalUrl: MUNICIPAL_URL,
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: MUNICIPAL_URL,
      resolvedEvidenceUrl: MUNICIPAL_URL,
      officialTrace: {
        initialUrl: MUNICIPAL_URL,
        edges: [],
        lastTrustedUrl: MUNICIPAL_URL,
        officialHops: 0,
      },
      mediaType: transientRawDeleted ? "application/pdf" : mediaType,
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted,
      artifactRefs: refs,
      disposition: "usable",
      referenceYear: 2025,
      periodDisposition: "preferred",
      quantity,
      denominator: {
        publisherId: "surs",
        municipalityCode: "061",
        referenceDate: "2025-01-01",
        population: "300000",
        artifactId: denominatorRef.artifactId,
        mediaType,
        retentionPolicyId: "surs-retention@1",
        transientRawDeleted,
      },
    }],
    counters: { queries: 0, candidates: 1, maxOfficialHops: 0 },
    result: { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 0 },
    completedAt: COMPLETED_AT,
  };
}

function bridgeInput(
  fixture: ReturnType<typeof buildFixture>,
  attemptLedger: CitySafetyAttemptLedger,
  artifacts: readonly LiveCapturedArtifact<"si-city-safety">[],
): CitySafetyArtifactBridgeInput {
  return {
    cityCheckRunId: CITY_CHECK_RUN_ID,
    catalog: fixture.catalog,
    sourcePlan: fixture.sourcePlan,
    authorityDirectory: fixture.directory,
    ledger: attemptLedger,
    artifacts,
  };
}

describe("City safety artifact replay bridge", () => {
  test("binds raw municipal and denominator bytes and returns independent copies", () => {
    // Break caught: trusting stored SHA text without hashing bytes or returning an aliased SQLite/caller view.
    const fixture = buildFixture("seal_raw_artifact");
    const municipal = artifact(
      "municipal-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode("municipal raw bytes"),
      "application/pdf",
    );
    const denominator = artifact(
      "surs-2025",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode("denominator raw bytes"),
      "application/pdf",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: municipal.sha256,
      locator: MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominator.sha256,
      locator: DENOMINATOR_URL,
    }] as const;
    const result = reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, ledger(fixture, refs, false, "application/pdf"), [municipal, denominator]),
      REPLAY_INTEGRITY,
    );

    expect(result.ledger.result.kind).toBe("verified");
    expect(result.artifacts.map(({ sha256: digest }) => digest)).toEqual([
      municipal.sha256,
      denominator.sha256,
    ]);
    expect(result.artifacts[0]!.bytes).not.toBe(municipal.bytes);
    const firstByte = result.artifacts[0]!.bytes[0];
    municipal.bytes[0] = 0;
    expect(result.artifacts[0]!.bytes[0]).toBe(firstByte);
  });

  test("rejects a same-authority municipal request outside the exact candidate trace", () => {
    // Break caught: treating an allowed publisher host as proof of the captured request lineage.
    const fixture = buildFixture("seal_raw_artifact");
    const municipal = artifact(
      "municipal-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode("municipal raw bytes"),
      "application/pdf",
    );
    const denominator = artifact(
      "surs-2025",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode("denominator raw bytes"),
      "application/pdf",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: municipal.sha256,
      locator: MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominator.sha256,
      locator: DENOMINATOR_URL,
    }] as const;
    const attemptLedger = ledger(fixture, refs, false, "application/pdf");

    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      attemptLedger,
      [{
        ...municipal,
        request: { method: "GET", url: "https://ljubljana.si/unrelated" },
      }, denominator],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("binds a redirected terminal artifact to the request that started its trace occurrence", () => {
    // Break caught: accepting the final response URL as the request URL erases the recorded redirect lineage.
    const fixture = buildFixture("seal_raw_artifact");
    const municipal = {
      ...artifact(
        "municipal-redirected-2025",
        "municipal_source",
        REDIRECTED_MUNICIPAL_URL,
        new TextEncoder().encode("redirected municipal raw bytes"),
        "application/pdf",
      ),
      request: { method: "GET" as const, url: MUNICIPAL_URL },
    };
    const denominator = artifact(
      "surs-2025",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode("denominator raw bytes"),
      "application/pdf",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: municipal.sha256,
      locator: REDIRECTED_MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominator.sha256,
      locator: DENOMINATOR_URL,
    }] as const;
    const base = ledger(fixture, refs, false, "application/pdf");
    const candidate = base.candidates[0];
    if (candidate?.disposition !== "usable") throw new Error("expected usable fixture");
    const redirectedLedger: CitySafetyAttemptLedger = {
      ...base,
      candidates: [{
        ...candidate,
        resolvedEvidenceUrl: REDIRECTED_MUNICIPAL_URL,
        officialTrace: {
          initialUrl: MUNICIPAL_URL,
          edges: [{
            kind: "http_redirect",
            fromUrl: MUNICIPAL_URL,
            toUrl: REDIRECTED_MUNICIPAL_URL,
          }],
          lastTrustedUrl: REDIRECTED_MUNICIPAL_URL,
          officialHops: 1,
        },
      }],
      counters: { queries: 0, candidates: 1, maxOfficialHops: 1 },
    };

    expect(reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, redirectedLedger, [municipal, denominator]),
      REPLAY_INTEGRITY,
    ).ledger).toEqual(redirectedLedger);
    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      redirectedLedger,
      [{ ...municipal, request: { method: "GET", url: REDIRECTED_MUNICIPAL_URL } }, denominator],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("binds a SURS POST request to its exact denominator locator and closed body metadata", () => {
    // Break caught: any same-authority SURS endpoint could otherwise be substituted for the captured query.
    const fixture = buildFixture("seal_raw_artifact");
    const municipal = artifact(
      "municipal-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode("municipal raw bytes"),
      "application/pdf",
    );
    const denominator = {
      ...artifact(
        "surs-2025",
        "surs_denominator",
        DENOMINATOR_URL,
        new TextEncoder().encode("denominator raw bytes"),
        "application/pdf",
      ),
      request: {
        method: "POST" as const,
        url: DENOMINATOR_URL,
        bodyMediaType: "application/json" as const,
        bodySha256: "c".repeat(64),
      },
    };
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: municipal.sha256,
      locator: MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominator.sha256,
      locator: DENOMINATOR_URL,
    }] as const;
    const attemptLedger = ledger(fixture, refs, false, "application/pdf");

    expect(reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, attemptLedger, [municipal, denominator]),
      REPLAY_INTEGRITY,
    ).artifacts[1]?.request).toEqual(denominator.request);
    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      attemptLedger,
      [{ ...municipal }, {
        ...denominator,
        request: { ...denominator.request, url: "https://pxweb.stat.si/unrelated" },
      }],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      attemptLedger,
      [municipal, {
        ...denominator,
        request: {
          ...denominator.request,
          bodySha256: Object(denominator.request.bodySha256) as string,
        },
      }],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("validates canonical retained inspection and denominator projections after hashing private copies", () => {
    // Break caught: comparing the retained projection hash to sourceSha256 or letting hashBytes mutate decoded bytes.
    const fixture = buildFixture("seal_hash_locator_then_delete_transient");
    const municipalSourceSha = "a".repeat(64);
    const denominatorSourceSha = "b".repeat(64);
    const denominatorProjection: CitySafetyRetainedDenominatorProjection = {
      schemaVersion: "city-safety-retained-denominator@1",
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      sourceSha256: denominatorSourceSha,
      sourceLocator: DENOMINATOR_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    };
    const denominatorBytes = new TextEncoder().encode(canonical(denominatorProjection));
    const denominator = artifact(
      "surs-2025",
      "surs_denominator",
      DENOMINATOR_URL,
      denominatorBytes,
      "application/json",
    );
    const denominatorReference = {
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      artifactId: denominator.artifactId,
      mediaType: "application/json",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    };
    const inspectionProjection: CitySafetyRetainedInspectionProjection = {
      schemaVersion: "city-safety-retained-inspection@1",
      cityId: "ljubljana",
      municipalityCode: "061",
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: MUNICIPAL_URL,
      resolvedEvidenceUrl: MUNICIPAL_URL,
      officialTrace: {
        initialUrl: MUNICIPAL_URL,
        edges: [],
        lastTrustedUrl: MUNICIPAL_URL,
        officialHops: 0,
      },
      outcome: {
        kind: "usable",
        referenceYear: 2025,
        quantity: {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        },
        denominator: denominatorReference,
      },
      sourceSha256: municipalSourceSha,
      sourceLocator: MUNICIPAL_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: true,
    };
    const municipalBytes = new TextEncoder().encode(canonical(inspectionProjection));
    const municipal = artifact(
      "municipal-2025",
      "municipal_source",
      MUNICIPAL_URL,
      municipalBytes,
      "application/json",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: municipalSourceSha,
      locator: MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominatorSourceSha,
      locator: DENOMINATOR_URL,
    }] as const;
    const mutatingIntegrity: CityEvidenceReplayIntegrity = {
      ...REPLAY_INTEGRITY,
      hashBytes(bytes) {
        const digest = sha256(bytes);
        bytes.fill(0);
        return digest;
      },
    };

    const result = reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, ledger(fixture, refs, true, "application/json"), [municipal, denominator]),
      mutatingIntegrity,
    );

    expect(new TextDecoder().decode(result.artifacts[0]!.bytes)).toBe(canonical(inspectionProjection));
    expect(new TextDecoder().decode(result.artifacts[1]!.bytes)).toBe(canonical(denominatorProjection));
  });

  test("binds retained navigation and terminal requests to their distinct trace occurrences", () => {
    // Break caught: multiple captures on one official host can be swapped while every projection still looks valid.
    const fixture = buildFixture("seal_hash_locator_then_delete_transient");
    const denominatorSourceSha = "c".repeat(64);
    const denominatorProjection: CitySafetyRetainedDenominatorProjection = {
      schemaVersion: "city-safety-retained-denominator@1",
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      sourceSha256: denominatorSourceSha,
      sourceLocator: DENOMINATOR_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    };
    const denominator = artifact(
      "surs-navigation-case",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode(canonical(denominatorProjection)),
      "application/json",
    );
    const denominatorReference = {
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      artifactId: denominator.artifactId,
      mediaType: "application/json",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    };
    const trace = {
      initialUrl: MUNICIPAL_URL,
      edges: [{
        kind: "confirmed_document_link" as const,
        fromUrl: MUNICIPAL_URL,
        toUrl: REDIRECTED_MUNICIPAL_URL,
      }],
      lastTrustedUrl: REDIRECTED_MUNICIPAL_URL,
      officialHops: 1,
    };
    const navigationSourceSha = "a".repeat(64);
    const navigationProjection: CitySafetyRetainedNavigationProjection = {
      schemaVersion: "city-safety-retained-navigation@1",
      cityId: "ljubljana",
      municipalityCode: "061",
      publisherId: "municipality-ljubljana",
      publisherNavigationUrl: MUNICIPAL_URL,
      resolvedNavigationUrl: MUNICIPAL_URL,
      officialTrace: trace,
      confirmedDocumentUrl: REDIRECTED_MUNICIPAL_URL,
      documentLocatorPolicyId: "municipality-ljubljana-locator@1",
      sourceSha256: navigationSourceSha,
      sourceLocator: MUNICIPAL_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: true,
    };
    const navigation = artifact(
      "municipal-navigation-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode(canonical(navigationProjection)),
      "application/json",
    );
    const terminalSourceSha = "b".repeat(64);
    const terminalProjection: CitySafetyRetainedInspectionProjection = {
      schemaVersion: "city-safety-retained-inspection@1",
      cityId: "ljubljana",
      municipalityCode: "061",
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: MUNICIPAL_URL,
      resolvedEvidenceUrl: REDIRECTED_MUNICIPAL_URL,
      officialTrace: trace,
      outcome: {
        kind: "usable",
        referenceYear: 2025,
        quantity: {
          offenceCount: "1200",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        },
        denominator: denominatorReference,
      },
      sourceSha256: terminalSourceSha,
      sourceLocator: REDIRECTED_MUNICIPAL_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: true,
    };
    const terminal = artifact(
      "municipal-terminal-2025",
      "municipal_source",
      REDIRECTED_MUNICIPAL_URL,
      new TextEncoder().encode(canonical(terminalProjection)),
      "application/json",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "navigation" as const,
      artifactId: navigation.artifactId,
      artifactSha256: navigation.sha256,
      sourceSha256: navigationSourceSha,
      locator: MUNICIPAL_URL,
    }, {
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: terminal.artifactId,
      artifactSha256: terminal.sha256,
      sourceSha256: terminalSourceSha,
      locator: REDIRECTED_MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominatorSourceSha,
      locator: DENOMINATOR_URL,
    }] as const;
    const base = ledger(fixture, refs, true, "application/json");
    const candidate = base.candidates[0];
    if (candidate?.disposition !== "usable") throw new Error("expected usable fixture");
    const attemptLedger: CitySafetyAttemptLedger = {
      ...base,
      candidates: [{
        ...candidate,
        resolvedEvidenceUrl: REDIRECTED_MUNICIPAL_URL,
        officialTrace: trace,
      }],
      counters: { queries: 0, candidates: 1, maxOfficialHops: 1 },
    };

    expect(reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, attemptLedger, [navigation, terminal, denominator]),
      REPLAY_INTEGRITY,
    ).artifacts).toHaveLength(3);
    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      attemptLedger,
      [navigation, { ...terminal, request: { method: "GET", url: MUNICIPAL_URL } }, denominator],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("binds a retained rejected inspection to the reconstructed rejection basis", () => {
    // Break caught: a canonical retained rejection could describe a different semantic failure than its ledger.
    const fixture = buildFixture("seal_hash_locator_then_delete_transient");
    const sourceSha = "d".repeat(64);
    const trace = {
      initialUrl: MUNICIPAL_URL,
      edges: [],
      lastTrustedUrl: MUNICIPAL_URL,
      officialHops: 0,
    };
    const projection: CitySafetyRetainedInspectionProjection = {
      schemaVersion: "city-safety-retained-inspection@1",
      cityId: "ljubljana",
      municipalityCode: "061",
      publisherId: "municipality-ljubljana",
      dataAuthorityId: "police",
      publisherNavigationUrl: MUNICIPAL_URL,
      resolvedEvidenceUrl: MUNICIPAL_URL,
      officialTrace: trace,
      outcome: {
        kind: "rejected",
        basis: { kind: "missing_numerator", referenceYear: 2025 },
      },
      sourceSha256: sourceSha,
      sourceLocator: MUNICIPAL_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "municipality-ljubljana-retention@1",
      transientRawDeleted: true,
    };
    const municipal = artifact(
      "municipal-rejected-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode(canonical(projection)),
      "application/json",
    );
    const reference = {
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: sourceSha,
      locator: MUNICIPAL_URL,
    };
    const queries = buildCitySafetyQueries(
      fixture.sourcePlan.entries[0]!,
      fixture.directory,
      ASSESSMENT_AT,
      fixture.catalog,
      DECISION_INTEGRITY,
    ).map((query, index) => ({
      index,
      queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1" as const,
      providerId: "synthetic-search",
      query,
      searchedAt: `2026-03-01T12:00:0${index + 1}.000Z`,
      outcome: { kind: "completed" as const, returnedUrls: [] },
    }));
    const attemptLedger: CitySafetyAttemptLedger = {
      schemaVersion: "city-safety-attempt-ledger@1",
      catalogRevisionId: fixture.catalog.id,
      authorityDirectoryId: fixture.directory.id,
      sourcePlanId: fixture.sourcePlan.id,
      cityId: "ljubljana",
      municipalityCode: "061",
      assessmentAt: ASSESSMENT_AT,
      definitionId: "si-municipal-police-offences-per-100000@1",
      freshnessPolicyVersion: "municipal-annual-july-boundary@1",
      discoveryRulesVersion: "city-safety-discovery@1",
      queries,
      candidates: [{
        index: 0,
        origin: { kind: "configured", configuredRouteIndex: 0 },
        canonicalUrl: MUNICIPAL_URL,
        officialTrace: trace,
        reviewedOfficial: {
          publisherId: "municipality-ljubljana",
          dataAuthorityId: "police",
          publisherNavigationUrl: MUNICIPAL_URL,
          resolvedEvidenceUrl: MUNICIPAL_URL,
          referenceYear: 2025,
        },
        mediaType: "application/pdf",
        retentionPolicyId: "municipality-ljubljana-retention@1",
        transientRawDeleted: true,
        artifactRefs: [reference],
        disposition: "rejected",
        reason: "missing_numerator",
      }],
      counters: { queries: 3, candidates: 1, maxOfficialHops: 0 },
      result: { kind: "unknown", reason: "not_comparable" },
      completedAt: COMPLETED_AT,
    };

    expect(reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, attemptLedger, [municipal]),
      REPLAY_INTEGRITY,
    ).ledger).toEqual(attemptLedger);

    const forgedProjection = {
      ...projection,
      outcome: {
        kind: "rejected" as const,
        basis: { kind: "missing_numerator" as const, referenceYear: 2024 },
      },
    };
    const forgedBytes = new TextEncoder().encode(canonical(forgedProjection));
    const forgedSha = sha256(forgedBytes);
    const forgedLedger: CitySafetyAttemptLedger = {
      ...attemptLedger,
      candidates: [{
        ...attemptLedger.candidates[0]!,
        artifactRefs: [{ ...reference, artifactSha256: forgedSha }],
      }],
    };
    expect(() => reconstructCitySafetyArtifactBridge(bridgeInput(
      fixture,
      forgedLedger,
      [{ ...municipal, sha256: forgedSha, bytes: forgedBytes }],
    ), REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("rejects noncanonical projections, source binding drift, duplicate stored IDs and missing artifacts", () => {
    // Break caught: parsing merely valid JSON or resolving a reference against zero/multiple captured rows.
    const fixture = buildFixture("seal_hash_locator_then_delete_transient");
    const projection = {
      schemaVersion: "city-safety-retained-denominator@1",
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      sourceSha256: "b".repeat(64),
      sourceLocator: DENOMINATOR_URL,
      sourceMediaType: "application/pdf",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    } as const;
    const denominator = artifact(
      "surs-2025",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode(`${canonical(projection)}\n`),
      "application/json",
    );
    const municipal = artifact(
      "municipal-2025",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode("{}"),
      "application/json",
    );
    const refs = [{
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: municipal.artifactId,
      artifactSha256: municipal.sha256,
      sourceSha256: "a".repeat(64),
      locator: MUNICIPAL_URL,
    }, {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: projection.sourceSha256,
      locator: DENOMINATOR_URL,
    }] as const;
    const input = bridgeInput(
      fixture,
      ledger(fixture, refs, true, "application/json"),
      [municipal, denominator],
    );

    expect(() => reconstructCitySafetyArtifactBridge(input, REPLAY_INTEGRITY))
      .toThrow("integrity_mismatch");
    expect(() => reconstructCitySafetyArtifactBridge({
      ...input,
      artifacts: [municipal, municipal, denominator],
    }, REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
    expect(() => reconstructCitySafetyArtifactBridge({
      ...input,
      artifacts: [municipal],
    }, REPLAY_INTEGRITY)).toThrow("integrity_mismatch");
  });

  test("reconstructs previous-origin attempts and validates every repeated artifact occurrence", () => {
    // Break caught: the exported bridge trusted any ledger containing `previous` and skipped S3 replay entirely.
    const fixture = buildFixture("seal_raw_artifact");
    const previousMunicipal = artifact(
      "municipal-previous-2024",
      "municipal_source",
      PREVIOUS_MUNICIPAL_URL,
      new TextEncoder().encode("previous municipal raw bytes"),
      "application/pdf",
    );
    const configuredMunicipal = artifact(
      "municipal-configured-2024",
      "municipal_source",
      MUNICIPAL_URL,
      new TextEncoder().encode("configured municipal raw bytes"),
      "application/pdf",
    );
    const denominator = artifact(
      "surs-shared-2024",
      "surs_denominator",
      DENOMINATOR_URL,
      new TextEncoder().encode("shared denominator raw bytes"),
      "application/pdf",
    );
    const denominatorRef = {
      role: "surs_denominator" as const,
      artifactId: denominator.artifactId,
      artifactSha256: denominator.sha256,
      sourceSha256: denominator.sha256,
      locator: DENOMINATOR_URL,
    };
    const previousRef = {
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: previousMunicipal.artifactId,
      artifactSha256: previousMunicipal.sha256,
      sourceSha256: previousMunicipal.sha256,
      locator: PREVIOUS_MUNICIPAL_URL,
    };
    const configuredRef = {
      role: "municipal_source" as const,
      documentRole: "terminal_claim" as const,
      artifactId: configuredMunicipal.artifactId,
      artifactSha256: configuredMunicipal.sha256,
      sourceSha256: configuredMunicipal.sha256,
      locator: MUNICIPAL_URL,
    };
    const quantity = {
      offenceCount: "1200",
      population: "300000",
      rateBasis: "offences_per_100000_residents" as const,
    };
    const denominatorBinding = {
      publisherId: "surs",
      municipalityCode: "061",
      referenceDate: "2024-01-01",
      population: "300000",
      artifactId: denominator.artifactId,
      mediaType: "application/pdf",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: false,
    };
    const queries = buildCitySafetyQueries(
      fixture.sourcePlan.entries[0]!,
      fixture.directory,
      ASSESSMENT_AT,
      fixture.catalog,
      DECISION_INTEGRITY,
    ).map((query, index) => ({
      index,
      queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1" as const,
      providerId: "synthetic-search",
      query,
      searchedAt: `2026-03-01T12:00:0${index + 1}.000Z`,
      outcome: { kind: "completed" as const, returnedUrls: [] },
    }));
    const attemptLedger: CitySafetyAttemptLedger = {
      schemaVersion: "city-safety-attempt-ledger@1",
      catalogRevisionId: fixture.catalog.id,
      authorityDirectoryId: fixture.directory.id,
      sourcePlanId: fixture.sourcePlan.id,
      cityId: "ljubljana",
      municipalityCode: "061",
      assessmentAt: ASSESSMENT_AT,
      definitionId: "si-municipal-police-offences-per-100000@1",
      freshnessPolicyVersion: "municipal-annual-july-boundary@1",
      discoveryRulesVersion: "city-safety-discovery@1",
      queries,
      candidates: [{
        index: 0,
        origin: {
          kind: "previous",
          priorSourcePlanId: "prior-plan@1",
          priorEvidenceSnapshotId: "prior:evidence",
        },
        canonicalUrl: PREVIOUS_MUNICIPAL_URL,
        publisherId: "municipality-ljubljana",
        dataAuthorityId: "police",
        publisherNavigationUrl: MUNICIPAL_URL,
        resolvedEvidenceUrl: PREVIOUS_MUNICIPAL_URL,
        officialTrace: {
          initialUrl: PREVIOUS_MUNICIPAL_URL,
          edges: [],
          lastTrustedUrl: PREVIOUS_MUNICIPAL_URL,
          officialHops: 0,
        },
        mediaType: "application/pdf",
        retentionPolicyId: "municipality-ljubljana-retention@1",
        transientRawDeleted: false,
        artifactRefs: [previousRef, denominatorRef],
        disposition: "usable",
        referenceYear: 2024,
        periodDisposition: "fallback",
        quantity,
        denominator: denominatorBinding,
      }, {
        index: 1,
        origin: { kind: "configured", configuredRouteIndex: 0 },
        canonicalUrl: MUNICIPAL_URL,
        publisherId: "municipality-ljubljana",
        dataAuthorityId: "police",
        publisherNavigationUrl: MUNICIPAL_URL,
        resolvedEvidenceUrl: MUNICIPAL_URL,
        officialTrace: {
          initialUrl: MUNICIPAL_URL,
          edges: [],
          lastTrustedUrl: MUNICIPAL_URL,
          officialHops: 0,
        },
        mediaType: "application/pdf",
        retentionPolicyId: "municipality-ljubljana-retention@1",
        transientRawDeleted: false,
        artifactRefs: [configuredRef, denominatorRef],
        disposition: "usable",
        referenceYear: 2024,
        periodDisposition: "fallback",
        quantity,
        denominator: denominatorBinding,
      }],
      counters: { queries: 3, candidates: 2, maxOfficialHops: 0 },
      result: { kind: "verified", quantity, referenceYear: 2024, acceptedCandidateIndex: 0 },
      completedAt: COMPLETED_AT,
    };
    const previousAccepted: CitySafetyPreviousAcceptedReference = {
      cityId: "ljubljana",
      municipalityCode: "061",
      sourcePlanId: "prior-plan@1",
      definitionId: "si-municipal-police-offences-per-100000@1",
      publisherId: "municipality-ljubljana",
      navigationUrl: MUNICIPAL_URL,
      resolvedEvidenceUrl: PREVIOUS_MUNICIPAL_URL,
      referenceYear: 2024,
      evidenceSnapshotId: "prior:evidence",
    };
    const inputFor = (value: CitySafetyAttemptLedger): CitySafetyArtifactBridgeInput => ({
      ...bridgeInput(
        fixture,
        value,
        [previousMunicipal, configuredMunicipal, denominator],
      ),
      previousAccepted,
    });

    expect(reconstructCitySafetyArtifactBridge(inputFor(attemptLedger), REPLAY_INTEGRITY))
      .toEqual({
        ledger: attemptLedger,
        artifacts: [previousMunicipal, configuredMunicipal, denominator],
      });
    const configuredCandidate = attemptLedger.candidates[1];
    if (configuredCandidate?.disposition !== "usable") throw new Error("expected usable fixture");
    const conflictingOccurrenceLedger: CitySafetyAttemptLedger = {
      ...attemptLedger,
      candidates: [attemptLedger.candidates[0]!, {
        ...configuredCandidate,
        resolvedEvidenceUrl: PREVIOUS_MUNICIPAL_URL,
        officialTrace: {
          initialUrl: MUNICIPAL_URL,
          edges: [{
            kind: "http_redirect",
            fromUrl: MUNICIPAL_URL,
            toUrl: PREVIOUS_MUNICIPAL_URL,
          }],
          lastTrustedUrl: PREVIOUS_MUNICIPAL_URL,
          officialHops: 1,
        },
        artifactRefs: [previousRef, denominatorRef],
      }],
      counters: { queries: 3, candidates: 2, maxOfficialHops: 1 },
    };
    expect(reconstructCitySafetyAttemptLedger(conflictingOccurrenceLedger, {
      runId: CITY_CHECK_RUN_ID,
      catalog: fixture.catalog,
      integrity: DECISION_INTEGRITY,
      sourcePlan: fixture.sourcePlan,
      authorityDirectory: fixture.directory,
      previousAccepted,
    })).toEqual(conflictingOccurrenceLedger);
    expect(() => reconstructCitySafetyArtifactBridge(
      {
        ...bridgeInput(
          fixture,
          conflictingOccurrenceLedger,
          [previousMunicipal, denominator],
        ),
        previousAccepted,
      },
      REPLAY_INTEGRITY,
    )).toThrow("integrity_mismatch");
    for (const [name, forged] of [
      ["counter", {
        ...attemptLedger,
        counters: { ...attemptLedger.counters, candidates: 9 },
      }],
      ["result", {
        ...attemptLedger,
        result: { kind: "unknown" as const, reason: "not_found" as const },
      }],
      ["chronology", { ...attemptLedger, completedAt: "not-an-instant" }],
    ] as const) {
      expect(
        () => reconstructCitySafetyArtifactBridge(inputFor(forged), REPLAY_INTEGRITY),
        name,
      ).toThrow("integrity_mismatch");
    }
  });

  test("accepts a reconstructed untrusted search candidate that acquired no artifacts", () => {
    // Break caught: requiring a publisher solely to iterate an empty artifact-reference list.
    const fixture = buildFixture("seal_raw_artifact");
    const queries = buildCitySafetyQueries(
      fixture.sourcePlan.entries[0]!,
      fixture.directory,
      ASSESSMENT_AT,
      fixture.catalog,
      DECISION_INTEGRITY,
    ).map((query, index) => ({
      index,
      queryId: `city-safety-query:${CITY_CHECK_RUN_ID}:${index + 1}`,
      queryTemplateVersion: "slovenia-municipal-safety-query@1" as const,
      providerId: "synthetic-search",
      query,
      searchedAt: `2026-03-01T12:00:0${index + 1}.000Z`,
      outcome: {
        kind: "completed" as const,
        returnedUrls: index === 0 ? ["https://unknown.example/report.pdf"] : [],
      },
    }));
    const attemptLedger: CitySafetyAttemptLedger = {
      schemaVersion: "city-safety-attempt-ledger@1",
      catalogRevisionId: fixture.catalog.id,
      authorityDirectoryId: fixture.directory.id,
      sourcePlanId: fixture.sourcePlan.id,
      cityId: "ljubljana",
      municipalityCode: "061",
      assessmentAt: ASSESSMENT_AT,
      definitionId: "si-municipal-police-offences-per-100000@1",
      freshnessPolicyVersion: "municipal-annual-july-boundary@1",
      discoveryRulesVersion: "city-safety-discovery@1",
      queries,
      candidates: [{
        index: 0,
        origin: { kind: "configured", configuredRouteIndex: 0 },
        canonicalUrl: MUNICIPAL_URL,
        officialTrace: {
          initialUrl: MUNICIPAL_URL,
          edges: [],
          lastTrustedUrl: MUNICIPAL_URL,
          officialHops: 0,
          failure: {
            captureKind: "http_error",
            responseStatus: 404,
            responseUrl: MUNICIPAL_URL,
          },
        },
        artifactRefs: [],
        disposition: "rejected",
        reason: "http_not_found",
      }, {
        index: 1,
        origin: { kind: "search", queryId: queries[0]!.queryId },
        canonicalUrl: "https://unknown.example/report.pdf",
        officialTrace: {
          initialUrl: "https://unknown.example/report.pdf",
          edges: [],
          officialHops: 0,
          failure: { captureKind: "navigation_mismatch" },
        },
        artifactRefs: [],
        disposition: "rejected",
        reason: "authority_untrusted",
      }],
      counters: { queries: 3, candidates: 2, maxOfficialHops: 0 },
      result: { kind: "unknown", reason: "not_found" },
      completedAt: COMPLETED_AT,
    };

    expect(reconstructCitySafetyAttemptLedger(attemptLedger, {
      runId: CITY_CHECK_RUN_ID,
      catalog: fixture.catalog,
      integrity: DECISION_INTEGRITY,
      sourcePlan: fixture.sourcePlan,
      authorityDirectory: fixture.directory,
    })).toEqual(attemptLedger);

    expect(reconstructCitySafetyArtifactBridge(
      bridgeInput(fixture, attemptLedger, []),
      REPLAY_INTEGRITY,
    )).toEqual({ ledger: attemptLedger, artifacts: [] });
  });
});
