import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { replayEvidence } from "../../src/application/replay-evidence";
import { canonicalJson, createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { SourceCaptureError } from "../../src/infrastructure/sources/gateway";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import type {
  CaptureResult,
  EvidenceSnapshot,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  RequestStep,
  ParserEntry,
  SourceId,
} from "../../src/research/contracts";
import type { EvidenceManifest } from "../../src/research/research-plan";
import {
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  EVIDENCE_SOURCE_IDS,
  runCurrentEvidence,
  type EvidenceParsers,
} from "../../src/research/run";

const KEY = "integration-test-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(KEY);
const REPLAY_INTEGRITY_FACTORY = Object.freeze({ create: createEvidenceIntegrity });
const ASSESSMENT_DATE = "2026-08-08";
const DEADLINE_AT = "2026-08-08T10:00:45.000Z";

const databases: Database.Database[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
}

type RunScopedHttpStepRequest = HttpStepRequest & { readonly runId: string };

function artifact(
  request: HttpStepRequest,
  suffix = request.role,
  overrides: Partial<LiveCapturedArtifact> & {
    readonly runId?: string;
    readonly sourceId?: SourceId;
  } = {},
): LiveCapturedArtifact {
  const runId = (request as RunScopedHttpStepRequest).runId;
  const bytes = new TextEncoder().encode(`${request.sourceId}:${suffix}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${request.sourceId}:${request.role}:${sha256}`,
    runId,
    sourceId: request.sourceId,
    role: request.role,
    url: request.url,
    mediaType: request.allowedMediaTypes[0]!,
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-08T10:00:01.000Z",
    responseStatus: 200,
    responseUrl: request.url,
    request: {
      method: request.method,
      url: request.url,
      ...(request.bodyMediaType === undefined ? {} : { bodyMediaType: request.bodyMediaType }),
    },
    ...overrides,
  } as LiveCapturedArtifact;
}

function httpRequest(
  sourceId: SourceId,
  role = "official-document",
  runId = "fixture-run",
): HttpStepRequest {
  return {
    runId,
    sourceId,
    role,
    method: "GET",
    url: `https://official.example/${sourceId}/${role}`,
    headers: { accept: "application/octet-stream" },
    allowedHosts: ["official.example"],
    allowedMediaTypes: ["application/octet-stream"],
  } as HttpStepRequest;
}

function parsers(
  onParse: (sourceId: SourceId) => void | Promise<void> = () => undefined,
): EvidenceParsers {
  return Object.fromEntries(EVIDENCE_SOURCE_IDS.map((sourceId) => [
    sourceId,
    async (entry: ParserEntry) => {
      await onParse(sourceId);
      const sourceArtifact = entry.artifacts[0]!;
      return {
        ok: true as const,
        facts: { sourceId, accepted: true },
        sourcePeriod: ASSESSMENT_DATE,
        anchors: [{
          artifactId: sourceArtifact.artifactId,
          locator: `${sourceId} fixture`,
          excerptSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }],
      };
    },
  ])) as unknown as EvidenceParsers;
}

function singleStepSource(
  beforeStep: (sourceId: SourceId) => void | Promise<void> = () => undefined,
): OfficialSourcePort {
  return {
    async capture(request, requestStep): Promise<CaptureResult> {
      await beforeStep(request.sourceId);
      const sourceArtifact = await requestStep(
        httpRequest(request.sourceId, "official-document", request.runId),
        request.signal,
      );
      return {
        ok: true,
        entry: {
          sourceId: request.sourceId,
          navigationUrl: `https://official.example/${request.sourceId}`,
          resolvedEvidenceUrl: sourceArtifact.responseUrl,
          artifacts: [sourceArtifact],
          versionHint: "fixture-v1",
        },
      };
    },
  };
}

function fixedVs1Artifact(
  artifactId: string,
  sourceId: SourceId,
  byte: number,
  sha256: string,
): LiveCapturedArtifact {
  return {
    artifactId,
    runId: "r",
    sourceId,
    role: "d",
    request: { method: "GET", url: "https://o/a" },
    url: "https://o/a",
    responseUrl: "https://o/a",
    capturedAt: "2026-08-08T00:00:00.000Z",
    responseStatus: 200,
    mediaType: "x",
    origin: "live",
    sha256,
    bytes: Uint8Array.of(byte),
  };
}

const FIXED_VS1_ARTIFACTS = [
  fixedVs1Artifact(
    "a1",
    "al-law-79",
    1,
    "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
  ),
  fixedVs1Artifact(
    "a2",
    "al-decision-858",
    2,
    "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986",
  ),
  fixedVs1Artifact(
    "a3",
    "cbr-eur",
    3,
    "084fed08b978af4d7d196a7446a86b58009e636b611db16211b65a9aadff29c5",
  ),
  fixedVs1Artifact(
    "a4",
    "boa-eur",
    4,
    "e52d9c508c502347344d8c07ad91cbd6068afc75ff6292f062a09ca381c89e71",
  ),
  fixedVs1Artifact(
    "a5",
    "tirana-urban-lines",
    5,
    "e77b9a9ae9e30b0dbdb6f510a264ef9de781501d7b6b92ae89eb059c5ab743db",
  ),
] as const;

const FIXED_VS1_SOURCE_IDS = [
  "al-law-79",
  "al-decision-858",
  "cbr-eur",
  "boa-eur",
  "tirana-urban-lines",
] as const satisfies readonly SourceId[];

const FIXED_VS1_CANONICAL_MANIFEST = '{"artifacts":[{"artifactId":"a1","byteLength":1,"capturedAt":"2026-08-08T00:00:00.000Z","mediaType":"x","origin":"live","request":{"method":"GET","url":"https://o/a"},"responseStatus":200,"responseUrl":"https://o/a","role":"d","runId":"r","sha256":"4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a","sourceId":"al-law-79","url":"https://o/a"},{"artifactId":"a2","byteLength":1,"capturedAt":"2026-08-08T00:00:00.000Z","mediaType":"x","origin":"live","request":{"method":"GET","url":"https://o/a"},"responseStatus":200,"responseUrl":"https://o/a","role":"d","runId":"r","sha256":"dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986","sourceId":"al-decision-858","url":"https://o/a"},{"artifactId":"a3","byteLength":1,"capturedAt":"2026-08-08T00:00:00.000Z","mediaType":"x","origin":"live","request":{"method":"GET","url":"https://o/a"},"responseStatus":200,"responseUrl":"https://o/a","role":"d","runId":"r","sha256":"084fed08b978af4d7d196a7446a86b58009e636b611db16211b65a9aadff29c5","sourceId":"cbr-eur","url":"https://o/a"},{"artifactId":"a4","byteLength":1,"capturedAt":"2026-08-08T00:00:00.000Z","mediaType":"x","origin":"live","request":{"method":"GET","url":"https://o/a"},"responseStatus":200,"responseUrl":"https://o/a","role":"d","runId":"r","sha256":"e52d9c508c502347344d8c07ad91cbd6068afc75ff6292f062a09ca381c89e71","sourceId":"boa-eur","url":"https://o/a"},{"artifactId":"a5","byteLength":1,"capturedAt":"2026-08-08T00:00:00.000Z","mediaType":"x","origin":"live","request":{"method":"GET","url":"https://o/a"},"responseStatus":200,"responseUrl":"https://o/a","role":"d","runId":"r","sha256":"e77b9a9ae9e30b0dbdb6f510a264ef9de781501d7b6b92ae89eb059c5ab743db","sourceId":"tirana-urban-lines","url":"https://o/a"}],"entries":[{"artifactIds":["a1"],"navigationUrl":"https://n","resolvedEvidenceUrl":"https://o/a","sourceId":"al-law-79"},{"artifactIds":["a2"],"navigationUrl":"https://n","resolvedEvidenceUrl":"https://o/a","sourceId":"al-decision-858"},{"artifactIds":["a3"],"navigationUrl":"https://n","resolvedEvidenceUrl":"https://o/a","sourceId":"cbr-eur"},{"artifactIds":["a4"],"navigationUrl":"https://n","resolvedEvidenceUrl":"https://o/a","sourceId":"boa-eur"},{"artifactIds":["a5"],"navigationUrl":"https://n","resolvedEvidenceUrl":"https://o/a","sourceId":"tirana-urban-lines"}],"snapshot":{"artifactIds":["a1","a2","a3","a4","a5"],"assessmentDate":"2026-08-08","blockers":[],"claims":[{"anchor":{"artifactId":"a1","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"al-law-79-facts-1","scope":"VS-1 confirmed-life","sourceId":"al-law-79","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a2","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"al-decision-858-facts-1","scope":"VS-1 confirmed-life","sourceId":"al-decision-858","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a3","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"cbr-eur-facts-1","scope":"VS-1 confirmed-life","sourceId":"cbr-eur","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a4","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"boa-eur-facts-1","scope":"VS-1 confirmed-life","sourceId":"boa-eur","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a5","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"tirana-urban-lines-facts-1","scope":"VS-1 confirmed-life","sourceId":"tirana-urban-lines","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}}],"coverage":{"al-decision-858":"verified","al-law-79":"verified","boa-eur":"verified","cbr-eur":"verified","tirana-urban-lines":"verified"},"id":"s","parserVersions":{"al-decision-858":"decision-858@1","al-law-79":"law-79@1","boa-eur":"boa-eur@1","cbr-eur":"cbr-eur@1","tirana-urban-lines":"tirana-urban-lines@1"},"rulesVersion":"vs1-evidence@1"}}';

const FIXED_VS1_CANONICAL_SNAPSHOT = '{"artifactIds":["a1","a2","a3","a4","a5"],"assessmentDate":"2026-08-08","blockers":[],"claims":[{"anchor":{"artifactId":"a1","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"al-law-79-facts-1","scope":"VS-1 confirmed-life","sourceId":"al-law-79","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a2","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"al-decision-858-facts-1","scope":"VS-1 confirmed-life","sourceId":"al-decision-858","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a3","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"cbr-eur-facts-1","scope":"VS-1 confirmed-life","sourceId":"cbr-eur","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a4","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"boa-eur-facts-1","scope":"VS-1 confirmed-life","sourceId":"boa-eur","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}},{"anchor":{"artifactId":"a5","excerptSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","locator":"x"},"claimId":"tirana-urban-lines-facts-1","scope":"VS-1 confirmed-life","sourceId":"tirana-urban-lines","sourcePeriod":"2026-08-08","status":"verified","value":{"accepted":true}}],"coverage":{"al-decision-858":"verified","al-law-79":"verified","boa-eur":"verified","cbr-eur":"verified","tirana-urban-lines":"verified"},"hmac":"44c1104916f6b9cad89e2e1ce55a4d26fe685b231dd9cc006b98a5b1368a1f8a","id":"s","manifestHash":"71ade3b5abf861e12b8cd54b575bffb4327aca34c6cabfbc60f03de7840b0848","parserVersions":{"al-decision-858":"decision-858@1","al-law-79":"law-79@1","boa-eur":"boa-eur@1","cbr-eur":"cbr-eur@1","tirana-urban-lines":"tirana-urban-lines@1"},"rulesVersion":"vs1-evidence@1"}';

describe("runCurrentEvidence", () => {
  test("starts five entries concurrently, shares one deadline signal, persists before awaited parsing, and seals after terminality", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const capturesStarted: SourceId[] = [];
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const captureSignals: AbortSignal[] = [];
    const stepSignals: AbortSignal[] = [];
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");

    const source: OfficialSourcePort = {
      async capture(request, requestStep) {
        capturesStarted.push(request.sourceId);
        captureSignals.push(request.signal);
        if (capturesStarted.length === EVIDENCE_SOURCE_IDS.length) releaseGate();
        await gate;
        const sourceArtifact = await requestStep(
          httpRequest(request.sourceId, "official-document", request.runId),
          request.signal,
        );
        return {
          ok: true,
          entry: {
            sourceId: request.sourceId,
            navigationUrl: `https://official.example/${request.sourceId}`,
            resolvedEvidenceUrl: sourceArtifact.responseUrl,
            artifacts: [sourceArtifact],
            versionHint: "fixture-v1",
          },
        };
      },
    };
    const requestStep: RequestStep = async (request, signal) => {
      stepSignals.push(signal);
      return artifact(request);
    };
    const asyncParserCalls: SourceId[] = [];
    const evidenceParsers = parsers(async (sourceId) => {
      expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE source_id = ?").get(sourceId)).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
      await Promise.resolve();
      if (sourceId === "al-law-79" || sourceId === "al-decision-858") {
        asyncParserCalls.push(sourceId);
      }
    });

    const snapshot = await runCurrentEvidence(
      { runId: "run-concurrent", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      { source, requestStep, store, integrity: INTEGRITY, parsers: evidenceParsers },
    );

    expect(new Set(capturesStarted)).toEqual(new Set(EVIDENCE_SOURCE_IDS));
    expect(new Set([...captureSignals, ...stepSignals]).size).toBe(1);
    expect(asyncParserCalls).toEqual(["al-law-79", "al-decision-858"]);
    expect(Object.values(snapshot.coverage)).toEqual([
      "verified", "verified", "verified", "verified", "verified",
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test("retries only the failed step once for timeout/429/5xx and does not retry non-retryable failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const attempts: string[] = [];
    const source: OfficialSourcePort = {
      async capture(request, requestStep) {
        const roles = request.sourceId === "cbr-eur" ? ["retry-me", "next-step"] : ["only-step"];
        const artifacts: LiveCapturedArtifact[] = [];
        try {
          for (const role of roles) {
            artifacts.push(await requestStep(
              httpRequest(request.sourceId, role, request.runId),
              request.signal,
            ));
          }
        } catch (error) {
          if (!(error instanceof SourceCaptureError)) throw error;
          return {
            ok: false,
            sourceId: request.sourceId,
            kind: error.kind,
            attempts: 1,
            partialArtifacts: artifacts,
          };
        }
        return {
          ok: true,
          entry: {
            sourceId: request.sourceId,
            navigationUrl: `https://official.example/${request.sourceId}`,
            resolvedEvidenceUrl: artifacts.at(-1)!.responseUrl,
            artifacts,
            versionHint: "fixture-v1",
          },
        };
      },
    };
    const requestStep: RequestStep = async (request) => {
      const key = `${request.sourceId}:${request.role}`;
      attempts.push(key);
      if (key === "cbr-eur:retry-me" && attempts.filter((item) => item === key).length === 1) {
        throw new SourceCaptureError("server_error", "retryable fixture");
      }
      if (key === "boa-eur:only-step") {
        throw new SourceCaptureError("wrong_media_type", "non-retryable fixture");
      }
      return artifact(request);
    };

    const snapshot = await runCurrentEvidence(
      { runId: "run-retry", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      { source, requestStep, store, integrity: INTEGRITY, parsers: parsers() },
    );

    expect(attempts.filter((item) => item === "cbr-eur:retry-me")).toHaveLength(2);
    expect(attempts.filter((item) => item === "cbr-eur:next-step")).toHaveLength(1);
    expect(attempts.filter((item) => item === "boa-eur:only-step")).toHaveLength(1);
    expect(snapshot.coverage["cbr-eur"]).toBe("verified");
    expect(snapshot.coverage["boa-eur"]).toBe("unavailable");
    expect(snapshot.blockers.find((blocker) => blocker.sourceId === "boa-eur")?.kind).toBe("wrong_media_type");
  });

  test("does not begin a retry after the shared deadline budget is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    let retryableAttempts = 0;
    const requestStep: RequestStep = async (request) => {
      if (request.sourceId === "cbr-eur") {
        retryableAttempts += 1;
        vi.advanceTimersByTime(101);
        throw new SourceCaptureError("rate_limited", "budget exhausted fixture");
      }
      return artifact(request);
    };

    const snapshot = await runCurrentEvidence(
      {
        runId: "run-deadline",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: "2026-08-08T10:00:00.100Z",
      },
      { source: singleStepSource(), requestStep, store, integrity: INTEGRITY, parsers: parsers() },
    );

    expect(retryableAttempts).toBe(1);
    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(snapshot.blockers.find((blocker) => blocker.sourceId === "cbr-eur")?.kind).toBe("rate_limited");
  });

  test("turns a semantic parser failure into one unavailable blocker without an invented claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const evidenceParsers = parsers();
    evidenceParsers["cbr-eur"] = async () => ({ ok: false, kind: "semantic_mismatch" });

    const snapshot = await runCurrentEvidence(
      { runId: "run-semantic", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source: singleStepSource(),
        requestStep: async (request) => artifact(request),
        store,
        integrity: INTEGRITY,
        parsers: evidenceParsers,
      },
    );

    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(snapshot.blockers.filter((blocker) => blocker.sourceId === "cbr-eur")).toEqual([
      expect.objectContaining({ kind: "semantic_mismatch" }),
    ]);
    expect(snapshot.claims.some((claim) => claim.sourceId === "cbr-eur")).toBe(false);
  });

  test("persists a returned partial artifact before other entries finish parsing and before sealing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const realStore = new SqliteEvidenceStore(db);
    let announcePartialPersisted!: () => void;
    const partialPersisted = new Promise<void>((resolve) => {
      announcePartialPersisted = resolve;
    });
    let releaseParsers!: () => void;
    const parserGate = new Promise<void>((resolve) => {
      releaseParsers = resolve;
    });
    const partial = artifact(httpRequest("cbr-eur", "partial-page", "run-partial"));
    const source: OfficialSourcePort = {
      async capture(request, requestStep) {
        if (request.sourceId === "cbr-eur") {
          return {
            ok: false,
            sourceId: request.sourceId,
            kind: "navigation_mismatch",
            attempts: 1,
            partialArtifacts: [partial],
          };
        }
        return singleStepSource().capture(request, requestStep);
      },
    };
    const store = {
      appendArtifact: async (sourceArtifact: LiveCapturedArtifact) => {
        await realStore.appendArtifact(sourceArtifact);
        if (sourceArtifact.artifactId === partial.artifactId) announcePartialPersisted();
      },
      seal: realStore.seal.bind(realStore),
    };
    const running = runCurrentEvidence(
      { runId: "run-partial", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source,
        requestStep: async (request) => artifact(request),
        store,
        integrity: INTEGRITY,
        parsers: parsers(() => parserGate),
      },
    );

    await partialPersisted;
    expect(db.prepare("SELECT sealed FROM artifacts WHERE artifact_id = ?").get(partial.artifactId)).toEqual({ sealed: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    releaseParsers();

    const snapshot = await running;
    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
  });

  test("keeps same-byte artifact provenance separate across current runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const execute = async (runId: string, capturedAt: string) => runCurrentEvidence(
      { runId, assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source: singleStepSource(),
        requestStep: async (request) => artifact(request, request.role, { capturedAt }),
        store,
        integrity: INTEGRITY,
        parsers: parsers(),
      },
    );

    await execute("run-1", "2026-08-08T10:00:01.000Z");
    const second = await execute("run-2", "2026-08-08T10:00:02.000Z");
    const secondBundle = await store.loadVerifiedBundle(second.id, KEY);
    const secondArtifacts = secondBundle.entries.flatMap((entry) => entry.artifacts) as LiveCapturedArtifact[];

    expect(secondArtifacts).toHaveLength(5);
    expect(secondArtifacts.every((item) => item.runId === "run-2")).toBe(true);
    expect(secondArtifacts.every((item) => item.sourceId === item.artifactId.split(":", 1)[0])).toBe(true);
    expect(secondArtifacts.every((item) => item.capturedAt === "2026-08-08T10:00:02.000Z")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({ count: 10 });
  });

  test.each([
    ["wrong run", { runId: "historical-run" }],
    ["wrong source", { sourceId: "boa-eur" as const }],
    ["fixture origin", { origin: "fixture" as const }],
  ])("terminalizes a %s artifact without a verified claim", async (_label, override) => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const snapshot = await runCurrentEvidence(
      { runId: "run-owned", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source: singleStepSource(),
        requestStep: async (request) => artifact(
          request,
          request.role,
          request.sourceId === "cbr-eur" ? override as Partial<LiveCapturedArtifact> : {},
        ),
        store,
        integrity: INTEGRITY,
        parsers: parsers(),
      },
    );

    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(snapshot.claims.some((claim) => claim.sourceId === "cbr-eur")).toBe(false);
  });

  test("seals a deadline blocker when an async parser never resolves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const evidenceParsers = parsers();
    evidenceParsers["cbr-eur"] = () => new Promise(() => undefined);

    const running = runCurrentEvidence(
      { runId: "run-parser-deadline", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source: singleStepSource(),
        requestStep: async (request) => artifact(request),
        store,
        integrity: INTEGRITY,
        parsers: evidenceParsers,
      },
    );
    await vi.advanceTimersByTimeAsync(45_000);
    const snapshot = await running;

    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(snapshot.blockers.find((blocker) => blocker.sourceId === "cbr-eur")?.kind).toBe("deadline");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test("retains only verified current partials when a later step has wrong ownership", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    let firstArtifact!: LiveCapturedArtifact;
    let contaminatedArtifact!: LiveCapturedArtifact;
    const source: OfficialSourcePort = {
      async capture(request, requestStep) {
        const first = await requestStep(
          httpRequest(request.sourceId, "first-step", request.runId),
          request.signal,
        );
        if (request.sourceId !== "cbr-eur") {
          return {
            ok: true,
            entry: {
              sourceId: request.sourceId,
              navigationUrl: `https://official.example/${request.sourceId}`,
              resolvedEvidenceUrl: first.responseUrl,
              artifacts: [first],
              versionHint: "fixture-v1",
            },
          };
        }
        firstArtifact = first;
        const second = await requestStep(
          httpRequest(request.sourceId, "second-step", request.runId),
          request.signal,
        );
        return {
          ok: true,
          entry: {
            sourceId: request.sourceId,
            navigationUrl: `https://official.example/${request.sourceId}`,
            resolvedEvidenceUrl: second.responseUrl,
            artifacts: [first, second],
            versionHint: "fixture-v1",
          },
        };
      },
    };
    const evidenceParsers = parsers();
    const snapshot = await runCurrentEvidence(
      { runId: "run-partial-ownership", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source,
        requestStep: async (request) => {
          const current = artifact(request);
          if (request.sourceId !== "cbr-eur" || request.role !== "second-step") return current;
          contaminatedArtifact = artifact(request, request.role, { runId: "historical-run" });
          return contaminatedArtifact;
        },
        store,
        integrity: INTEGRITY,
        parsers: evidenceParsers,
      },
    );

    expect(snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(snapshot.blockers.find((blocker) => blocker.sourceId === "cbr-eur")).toEqual(
      expect.objectContaining({
        kind: "navigation_mismatch",
        artifactIds: [firstArtifact.artifactId],
      }),
    );
    expect(db.prepare(
      "SELECT artifact_id, sealed FROM artifacts WHERE run_id = ? AND source_id = ?",
    ).all("run-partial-ownership", "cbr-eur")).toEqual([
      { artifact_id: firstArtifact.artifactId, sealed: 1 },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ?").get(
      contaminatedArtifact.runId,
    )).toEqual({ count: 0 });

    const bundle = await store.loadVerifiedBundle(snapshot.id, KEY);
    const cbrEntry = bundle.entries.find((entry) => entry.sourceId === "cbr-eur")!;
    expect(cbrEntry.artifacts.map((item) => item.artifactId)).toEqual([firstArtifact.artifactId]);
    await expect(replayEvidence(
      { snapshotId: snapshot.id, hmacKey: KEY },
      { store, integrityFactory: REPLAY_INTEGRITY_FACTORY, parsers: evidenceParsers },
    )).resolves.toEqual(snapshot);
  });
});

describe("replayEvidence", () => {
  test("replays the fixed pre-refactor VS-1 sealed fixture byte for byte", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    for (const artifact of FIXED_VS1_ARTIFACTS) await store.appendArtifact(artifact);
    await store.seal({
      snapshot: JSON.parse(FIXED_VS1_CANONICAL_SNAPSHOT) as EvidenceSnapshot,
      manifest: JSON.parse(FIXED_VS1_CANONICAL_MANIFEST) as EvidenceManifest,
      canonicalManifest: FIXED_VS1_CANONICAL_MANIFEST,
    });
    const fixedParsers = Object.fromEntries(FIXED_VS1_SOURCE_IDS.map((sourceId, index) => [
      sourceId,
      async () => ({
        ok: true as const,
        facts: { accepted: true },
        sourcePeriod: ASSESSMENT_DATE,
        anchors: [{
          artifactId: `a${index + 1}`,
          locator: "x",
          excerptSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }],
      }),
    ])) as unknown as EvidenceParsers;

    const replayed = await replayEvidence(
      { snapshotId: "s", hmacKey: KEY },
      { store, integrityFactory: REPLAY_INTEGRITY_FACTORY, parsers: fixedParsers },
    );

    expect(canonicalJson(replayed)).toBe(FIXED_VS1_CANONICAL_SNAPSHOT);
    expect(replayed.manifestHash).toBe(
      "71ade3b5abf861e12b8cd54b575bffb4327aca34c6cabfbc60f03de7840b0848",
    );
    expect(replayed.hmac).toBe(
      "44c1104916f6b9cad89e2e1ce55a4d26fe685b231dd9cc006b98a5b1368a1f8a",
    );
    expect(Object.keys(replayed.coverage)).toEqual([...FIXED_VS1_SOURCE_IDS]);
    expect(replayed.claims.map((claim) => claim.claimId)).toEqual([
      "al-law-79-facts-1",
      "al-decision-858-facts-1",
      "cbr-eur-facts-1",
      "boa-eur-facts-1",
      "tirana-urban-lines-facts-1",
    ]);
    expect(replayed.parserVersions).toEqual({
      "al-law-79": "law-79@1",
      "al-decision-858": "decision-858@1",
      "cbr-eur": "cbr-eur@1",
      "boa-eur": "boa-eur@1",
      "tirana-urban-lines": "tirana-urban-lines@1",
    });
    expect(replayed.rulesVersion).toBe("vs1-evidence@1");
  });

  test("verifies and reparses sealed bytes at the same assessment cutoff without network capture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T10:00:00.000Z");
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const networkCapture = vi.fn(singleStepSource().capture);
    const source: OfficialSourcePort = { capture: networkCapture };
    const evidenceParsers = parsers();
    const current = await runCurrentEvidence(
      { runId: "run-replay", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      {
        source,
        requestStep: async (request) => artifact(request),
        store,
        integrity: INTEGRITY,
        parsers: evidenceParsers,
      },
    );
    networkCapture.mockClear();

    const replayed = await replayEvidence(
      { snapshotId: current.id, hmacKey: KEY },
      { store, integrityFactory: REPLAY_INTEGRITY_FACTORY, parsers: evidenceParsers },
    );

    expect(networkCapture).not.toHaveBeenCalled();
    expect(replayed).toEqual(current);
    expect(canonicalJson(replayed)).toBe(canonicalJson(current));
    expect(Object.keys(replayed.coverage)).toEqual([
      "al-law-79",
      "al-decision-858",
      "cbr-eur",
      "boa-eur",
      "tirana-urban-lines",
    ]);
    expect(replayed.claims.map((claim) => claim.claimId)).toEqual([
      "al-law-79-facts-1",
      "al-decision-858-facts-1",
      "cbr-eur-facts-1",
      "boa-eur-facts-1",
      "tirana-urban-lines-facts-1",
    ]);
    expect(replayed.parserVersions).toEqual(EVIDENCE_PARSER_VERSIONS);
    expect(replayed.rulesVersion).toBe(EVIDENCE_RULES_VERSION);
    expect(replayed.assessmentDate).toBe(ASSESSMENT_DATE);

    let projections = 0;
    const changedRulesStore = {
      async loadVerifiedBundle(id: string, key: string) {
        const bundle = await store.loadVerifiedBundle(id, key);
        return {
          ...bundle,
          snapshot: { ...bundle.snapshot, rulesVersion: "unknown-rules@1" },
        };
      },
    };
    await expect(replayEvidence(
      { snapshotId: current.id, hmacKey: KEY },
      {
        store: changedRulesStore,
        integrityFactory: REPLAY_INTEGRITY_FACTORY,
        parsers: parsers(() => { projections += 1; }),
      },
    )).rejects.toThrow("integrity_mismatch");
    expect(projections).toBe(0);
  });
});

describe("replay Evidence integrity injection", () => {
  test("creates one injected integrity and performs one signing recomputation per replay", async () => {
    // Break caught: constructing a second canonicalizer in Application or losing the factory in a nested delegation.
    const db = database();
    const store = new SqliteEvidenceStore(db);
    for (const artifact of FIXED_VS1_ARTIFACTS) await store.appendArtifact(artifact);
    await store.seal({
      snapshot: JSON.parse(FIXED_VS1_CANONICAL_SNAPSHOT) as EvidenceSnapshot,
      manifest: JSON.parse(FIXED_VS1_CANONICAL_MANIFEST) as EvidenceManifest,
      canonicalManifest: FIXED_VS1_CANONICAL_MANIFEST,
    });
    const calls = { create: 0, sign: 0 };
    const canonicalReceivers: string[][] = [];
    const integrityFactory = {
      create(key: string) {
        calls.create += 1;
        const integrity = createEvidenceIntegrity(key);
        return {
          canonical(this: Record<string, unknown>, value: unknown) {
            canonicalReceivers.push(Object.keys(this).sort());
            return integrity.canonical(value);
          },
          hash: integrity.hash,
          sign(value: string) {
            calls.sign += 1;
            return integrity.sign(value);
          },
        };
      },
    };
    const fixedParsers = Object.fromEntries(FIXED_VS1_SOURCE_IDS.map((sourceId, index) => [
      sourceId,
      async () => ({
        ok: true as const,
        facts: { accepted: true },
        sourcePeriod: ASSESSMENT_DATE,
        anchors: [{
          artifactId: `a${index + 1}`,
          locator: "x",
          excerptSha256: "b".repeat(64),
        }],
      }),
    ])) as unknown as EvidenceParsers;

    await replayEvidence(
      { snapshotId: "s", hmacKey: KEY },
      { store, integrityFactory, parsers: fixedParsers },
    );

    expect(calls).toEqual({ create: 1, sign: 1 });
    expect(canonicalReceivers).toEqual([
      ["canonical"],
      ["canonical"],
      ["canonical", "hash", "sign"],
      ["canonical"],
      ["canonical"],
    ]);
  });
});
