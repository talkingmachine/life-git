import { createHash } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import type {
  CaptureResult,
  Claim,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParserEntry,
  RequestStep,
} from "../../src/research/contracts";
import {
  prepareEvidencePlan,
  runEvidencePlan,
  type EvidenceWriteStore,
  type ResearchPlan,
} from "../../src/research/research-plan";

type FakeSourceId = "alpha" | "beta";
type FakeClaim = Claim<{ readonly accepted: true }, FakeSourceId>;

const KEY = "cold-start-test-key-at-least-32-bytes";
const ASSESSMENT_DATE = "2026-08-11";
const DEADLINE_AT = "2026-08-11T10:01:00.000Z";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function artifact(request: HttpStepRequest<FakeSourceId>): LiveCapturedArtifact<FakeSourceId> {
  const bytes = new TextEncoder().encode(`${request.sourceId}:${request.role}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${request.sourceId}:${request.role}:${sha256}`,
    runId: request.runId,
    sourceId: request.sourceId,
    role: request.role,
    url: request.url,
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:01.000Z",
    responseStatus: 200,
    responseUrl: request.url,
    request: { method: request.method, url: request.url },
  };
}

function stepRequest(sourceId: FakeSourceId, runId: string): HttpStepRequest<FakeSourceId> {
  return {
    runId,
    sourceId,
    role: "official-document",
    method: "GET",
    url: `https://official.example/${sourceId}`,
    headers: { accept: "application/octet-stream" },
    allowedHosts: ["official.example"],
    allowedMediaTypes: ["application/octet-stream"],
  };
}

function source(): OfficialSourcePort<FakeSourceId> {
  return {
    async capture(request, requestStep): Promise<CaptureResult<FakeSourceId>> {
      const captured = await requestStep(
        stepRequest(request.sourceId, request.runId),
        request.signal,
      );
      return {
        ok: true,
        entry: {
          sourceId: request.sourceId,
          navigationUrl: `https://official.example/${request.sourceId}`,
          resolvedEvidenceUrl: captured.responseUrl,
          artifacts: [captured],
          versionHint: "fixture-v1",
        },
      };
    },
  };
}

function plan(log: string[]): ResearchPlan<FakeSourceId, FakeClaim> {
  return {
    id: "fake-plan@1",
    scope: "two-source fixture",
    sourceIds: ["beta", "alpha"],
    sourceNavigation: {
      beta: "https://official.example/beta",
      alpha: "https://official.example/alpha",
    },
    parserVersions: { beta: "beta@7", alpha: "alpha@3" },
    rulesVersion: "fake-rules@1",
    limits: { concurrency: 1, maxCaptures: 2, deadlineMs: 60_000 },
    async validate(entry: ParserEntry<FakeSourceId>) {
      log.push(`validated:${entry.sourceId}`);
      return {
        ok: true as const,
        claims: [{
          claimId: `${entry.sourceId}-verified`,
          sourceId: entry.sourceId,
          value: { accepted: true as const },
          scope: "two-source fixture",
          sourcePeriod: ASSESSMENT_DATE,
          anchor: {
            artifactId: entry.artifacts[0]!.artifactId,
            locator: `${entry.sourceId} fixture`,
            excerptSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          status: "verified" as const,
        }],
      };
    },
    applyRules: (entries) => entries,
  };
}

describe("generic evidence research plan", () => {
  test("uses plan order and versions, persists before factual progress, and seals exact terminal coverage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const log: string[] = [];
    let persistedSnapshotId: string | undefined;
    const store: EvidenceWriteStore<FakeSourceId, FakeClaim> = {
      async appendArtifact(value) {
        log.push(`appended:${value.sourceId}`);
      },
      async seal(value) {
        persistedSnapshotId = value.snapshot.id;
        log.push("sealed");
      },
    };
    const requestStep: RequestStep<FakeSourceId> = async (request) => artifact(request);

    const snapshot = await runEvidencePlan(
      { runId: "plan-order", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      plan(log),
      {
        source: source(),
        requestStep,
        store,
        integrity: createEvidenceIntegrity(KEY),
        onProgress: (event) => {
          log.push(`${event.type}:${event.sourceId}`);
        },
      },
    );

    expect(Object.keys(snapshot.coverage)).toEqual(["beta", "alpha"]);
    expect(snapshot.coverage).toEqual({ beta: "verified", alpha: "verified" });
    expect(snapshot.parserVersions).toEqual({ beta: "beta@7", alpha: "alpha@3" });
    expect(snapshot.claims.map((claim) => claim.claimId)).toEqual([
      "beta-verified",
      "alpha-verified",
    ]);
    expect(snapshot.rulesVersion).toBe("fake-rules@1");
    expect("contextHash" in snapshot).toBe(false);
    expect(persistedSnapshotId).toBe("plan-order:evidence");
    expect(log).toEqual([
      "appended:beta",
      "artifact_captured:beta",
      "appended:beta",
      "validated:beta",
      "claim_verified:beta",
      "appended:alpha",
      "artifact_captured:alpha",
      "appended:alpha",
      "validated:alpha",
      "claim_verified:alpha",
      "sealed",
    ]);
  });

  test("never starts more source captures than the plan concurrency", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    let active = 0;
    let maximumActive = 0;
    const controlledSource: OfficialSourcePort<FakeSourceId> = {
      async capture(request, requestStep) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        const captured = await requestStep(
          stepRequest(request.sourceId, request.runId),
          request.signal,
        );
        active -= 1;
        return {
          ok: true,
          entry: {
            sourceId: request.sourceId,
            navigationUrl: `https://official.example/${request.sourceId}`,
            resolvedEvidenceUrl: captured.responseUrl,
            artifacts: [captured],
          },
        };
      },
    };

    await runEvidencePlan(
      { runId: "bounded-workers", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      plan([]),
      {
        source: controlledSource,
        requestStep: async (request) => artifact(request),
        store: { appendArtifact: async () => undefined, seal: async () => undefined },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    expect(maximumActive).toBe(1);
  });

  test("counts every request attempt against the plan capture ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    let attempts = 0;
    const limitedPlan = {
      ...plan([]),
      limits: { concurrency: 1, maxCaptures: 1, deadlineMs: 60_000 },
    };

    const snapshot = await runEvidencePlan(
      { runId: "capture-ceiling", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
      limitedPlan,
      {
        source: source(),
        requestStep: async (request) => {
          attempts += 1;
          return artifact(request);
        },
        store: { appendArtifact: async () => undefined, seal: async () => undefined },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    expect(attempts).toBe(1);
    expect(snapshot.coverage).toEqual({ beta: "verified", alpha: "unavailable" });
    expect(snapshot.blockers).toEqual([
      expect.objectContaining({ sourceId: "alpha", kind: "deadline", artifactIds: [] }),
    ]);
  });

  test.each(["timeout", "rate_limited", "server_error"] as const)(
    "retries one %s request failure exactly once",
    async (kind) => {
      vi.useFakeTimers();
      vi.setSystemTime("2026-08-11T10:00:00.000Z");
      const attempts = new Map<FakeSourceId, number>();
      const retryPlan = {
        ...plan([]),
        limits: { concurrency: 1, maxCaptures: 3, deadlineMs: 60_000 },
      };

      const snapshot = await runEvidencePlan(
        { runId: `retry-${kind}`, assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
        retryPlan,
        {
          source: source(),
          requestStep: async (request) => {
            const count = (attempts.get(request.sourceId) ?? 0) + 1;
            attempts.set(request.sourceId, count);
            if (request.sourceId === "beta" && count === 1) throw { kind };
            return artifact(request);
          },
          store: { appendArtifact: async () => undefined, seal: async () => undefined },
          integrity: createEvidenceIntegrity(KEY),
        },
      );

      expect(attempts.get("beta")).toBe(2);
      expect(attempts.get("alpha")).toBe(1);
      expect(snapshot.coverage).toEqual({ beta: "verified", alpha: "verified" });
    },
  );

  test.each(["http_error", "wrong_media_type", "too_large", "navigation_mismatch"] as const)(
    "does not retry a %s request failure",
    async (kind) => {
      vi.useFakeTimers();
      vi.setSystemTime("2026-08-11T10:00:00.000Z");
      let betaAttempts = 0;

      const snapshot = await runEvidencePlan(
        { runId: `no-retry-${kind}`, assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
        plan([]),
        {
          source: source(),
          requestStep: async (request) => {
            if (request.sourceId === "beta") {
              betaAttempts += 1;
              throw { kind };
            }
            return artifact(request);
          },
          store: { appendArtifact: async () => undefined, seal: async () => undefined },
          integrity: createEvidenceIntegrity(KEY),
        },
      );

      expect(betaAttempts).toBe(1);
      expect(snapshot.coverage.beta).toBe("unavailable");
      expect(snapshot.blockers[0]).toEqual(expect.objectContaining({ sourceId: "beta", kind }));
    },
  );

  test("prepares deadline blocker evidence instead of throwing or inserting a snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const deadlinePlan: ResearchPlan<FakeSourceId, FakeClaim> = {
      ...plan([]),
      limits: { concurrency: 2, maxCaptures: 2, deadlineMs: 100 },
      async validate(entry) {
        if (entry.sourceId === "beta") return new Promise(() => undefined);
        return plan([]).validate(entry, ASSESSMENT_DATE);
      },
    };
    const running = prepareEvidencePlan(
      {
        runId: "prepared-deadline",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: "2026-08-11T10:00:00.100Z",
      },
      deadlinePlan,
      {
        source: source(),
        requestStep: async (request) => artifact(request),
        artifacts: { appendArtifact: async () => undefined },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    await vi.advanceTimersByTimeAsync(100);
    const prepared = await running;

    expect(prepared.snapshot.coverage).toEqual({ beta: "unavailable", alpha: "verified" });
    expect(prepared.snapshot.blockers).toEqual([
      expect.objectContaining({ sourceId: "beta", kind: "deadline" }),
    ]);
  });

  test("propagates an external abort before preparation completes and never persists a seal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const external = new AbortController();
    const reason = new Error("client_disconnected");
    let seals = 0;
    const waitingSource: OfficialSourcePort<FakeSourceId> = {
      async capture(request): Promise<CaptureResult<FakeSourceId>> {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    };
    const running = runEvidencePlan(
      {
        runId: "external-abort",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: DEADLINE_AT,
        signal: external.signal,
      },
      plan([]),
      {
        source: waitingSource,
        requestStep: async (request) => artifact(request),
        store: {
          appendArtifact: async () => undefined,
          seal: async () => {
            seals += 1;
          },
        },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    await Promise.resolve();
    external.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(seals).toBe(0);
  });

  test("binds an optional context hash into the signed prepared manifest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const contextHash = "c".repeat(64);
    let persistedCanonicalManifest = "";

    const snapshot = await runEvidencePlan(
      {
        runId: "context-bound",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: DEADLINE_AT,
        contextHash,
      },
      plan([]),
      {
        source: source(),
        requestStep: async (request) => artifact(request),
        store: {
          appendArtifact: async () => undefined,
          seal: async (sealed) => {
            persistedCanonicalManifest = sealed.canonicalManifest;
          },
        },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    expect(snapshot.contextHash).toBe(contextHash);
    expect(JSON.parse(persistedCanonicalManifest)).toEqual(
      expect.objectContaining({ snapshot: expect.objectContaining({ contextHash }) }),
    );
  });
});
