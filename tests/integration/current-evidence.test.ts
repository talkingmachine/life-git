import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { replayEvidence } from "../../src/application/replay-evidence";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { SourceCaptureError } from "../../src/infrastructure/sources/gateway";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import type {
  CaptureResult,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  RequestStep,
  ParserEntry,
  SourceId,
} from "../../src/research/contracts";
import {
  EVIDENCE_SOURCE_IDS,
  runCurrentEvidence,
  type EvidenceParsers,
} from "../../src/research/run";

const KEY = "integration-test-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(KEY);
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
});

describe("replayEvidence", () => {
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
      { store, parsers: evidenceParsers },
    );

    expect(networkCapture).not.toHaveBeenCalled();
    expect(replayed).toEqual(current);
    expect(replayed.assessmentDate).toBe(ASSESSMENT_DATE);
  });
});
