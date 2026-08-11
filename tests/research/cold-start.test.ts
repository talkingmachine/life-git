import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";
import type OpenAI from "openai";

import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { createOfficialSourceDiscovery } from "../../src/infrastructure/sources/official-source-discovery";
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
import {
  REQUIRED_CLAIM_KINDS,
  SI_AUTHORITY_ROOTS,
  resolveCountry,
} from "../../src/research/country-registry";
import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  SourceCandidate,
} from "../../src/research/cold-start-contracts";
import { createSloveniaResearch } from "../../src/infrastructure/sources/slovenia-source-adapter";

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

  test("publishes durable progress only after append and validation promises resolve", async () => {
    let announceAppendStarted!: () => void;
    const appendStarted = new Promise<void>((resolve) => {
      announceAppendStarted = resolve;
    });
    let releaseAppend!: () => void;
    const appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    let announceValidationStarted!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      announceValidationStarted = resolve;
    });
    let releaseValidator!: () => void;
    const validatorGate = new Promise<void>((resolve) => {
      releaseValidator = resolve;
    });
    const basePlan = plan([]);
    const deferredPlan: ResearchPlan<FakeSourceId, FakeClaim> = {
      ...basePlan,
      sourceIds: ["alpha"],
      limits: { concurrency: 1, maxCaptures: 1, deadlineMs: 60_000 },
      async validate(entry, assessmentAt) {
        announceValidationStarted();
        await validatorGate;
        return basePlan.validate(entry, assessmentAt);
      },
    };
    const progress: string[] = [];
    let appendCalls = 0;
    const running = runEvidencePlan(
      {
        runId: "durable-progress",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      },
      deferredPlan,
      {
        source: source(),
        requestStep: async (request) => artifact(request),
        store: {
          async appendArtifact() {
            appendCalls += 1;
            if (appendCalls !== 1) return;
            announceAppendStarted();
            await appendGate;
          },
          seal: async () => undefined,
        },
        integrity: createEvidenceIntegrity(KEY),
        onProgress: (event) => {
          progress.push(event.type);
        },
      },
    );

    await appendStarted;
    expect(progress).toEqual([]);

    releaseAppend();
    await validationStarted;
    expect(progress).toEqual(["artifact_captured"]);

    releaseValidator();
    await running;
    expect(progress).toEqual(["artifact_captured", "claim_verified"]);
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

  test("caps a later caller deadline at the plan budget for capture, retry, and terminality", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const effectiveDeadline = "2026-08-11T10:00:00.100Z";
    const seenDeadlines: string[] = [];
    let betaAttempts = 0;
    const boundedPlan = {
      ...plan([]),
      limits: { concurrency: 1, maxCaptures: 3, deadlineMs: 100 },
    };
    const observingSource: OfficialSourcePort<FakeSourceId> = {
      async capture(request, requestStep) {
        seenDeadlines.push(request.deadlineAt);
        return source().capture(request, requestStep);
      },
    };

    const snapshot = await runEvidencePlan(
      {
        runId: "bounded-deadline",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: "2026-08-11T10:10:00.000Z",
      },
      boundedPlan,
      {
        source: observingSource,
        requestStep: async (request) => {
          if (request.sourceId === "beta") {
            betaAttempts += 1;
            if (betaAttempts === 1) {
              vi.advanceTimersByTime(101);
              throw { kind: "server_error" };
            }
          }
          return artifact(request);
        },
        store: { appendArtifact: async () => undefined, seal: async () => undefined },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    expect(seenDeadlines).toEqual([effectiveDeadline]);
    expect(betaAttempts).toBe(1);
    expect(snapshot.coverage).toEqual({ beta: "unavailable", alpha: "unavailable" });
    expect(snapshot.blockers).toEqual([
      expect.objectContaining({ sourceId: "beta", kind: "server_error" }),
      expect.objectContaining({ sourceId: "alpha", kind: "deadline" }),
    ]);
  });

  test("keeps an earlier caller deadline as the exact cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-11T10:00:00.000Z");
    const callerDeadline = "2026-08-11T10:00:00.050Z";
    const seenDeadlines: string[] = [];
    const earlierPlan: ResearchPlan<FakeSourceId, FakeClaim> = {
      ...plan([]),
      limits: { concurrency: 2, maxCaptures: 2, deadlineMs: 1_000 },
      validate: async () => new Promise(() => undefined),
    };
    const observingSource: OfficialSourcePort<FakeSourceId> = {
      async capture(request, requestStep) {
        seenDeadlines.push(request.deadlineAt);
        return source().capture(request, requestStep);
      },
    };
    const running = prepareEvidencePlan(
      {
        runId: "earlier-caller-deadline",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: callerDeadline,
      },
      earlierPlan,
      {
        source: observingSource,
        requestStep: async (request) => artifact(request),
        artifacts: { appendArtifact: async () => undefined },
        integrity: createEvidenceIntegrity(KEY),
      },
    );

    await vi.advanceTimersByTimeAsync(50);
    const prepared = await running;

    expect(seenDeadlines).toEqual([callerDeadline, callerDeadline]);
    expect(prepared.snapshot.blockers).toHaveLength(2);
    expect(prepared.snapshot.blockers.every((blocker) => blocker.kind === "deadline")).toBe(true);
  });

  test.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid plan deadlineMs %s",
    async (deadlineMs) => {
      vi.useFakeTimers();
      vi.setSystemTime("2026-08-11T10:00:00.000Z");
      const invalidPlan = {
        ...plan([]),
        limits: { concurrency: 1, maxCaptures: 2, deadlineMs },
      };

      await expect(prepareEvidencePlan(
        { runId: "invalid-plan", assessmentDate: ASSESSMENT_DATE, deadlineAt: DEADLINE_AT },
        invalidPlan,
        {
          source: source(),
          requestStep: async (request) => artifact(request),
          artifacts: { appendArtifact: async () => undefined },
          integrity: createEvidenceIntegrity(KEY),
        },
      )).rejects.toThrow("invalid_research_plan");
    },
  );

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

  test("propagates the same external abort promptly while validation is pending", async () => {
    const external = new AbortController();
    const reason = new Error("client_left_during_validation");
    let seals = 0;
    let announceValidationStarted!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      announceValidationStarted = resolve;
    });
    let releaseValidator!: () => void;
    const validatorGate = new Promise<void>((resolve) => {
      releaseValidator = resolve;
    });
    const basePlan = plan([]);
    const deferredPlan: ResearchPlan<FakeSourceId, FakeClaim> = {
      ...basePlan,
      limits: { concurrency: 1, maxCaptures: 2, deadlineMs: 60_000 },
      async validate(entry, assessmentAt) {
        announceValidationStarted();
        await validatorGate;
        return basePlan.validate(entry, assessmentAt);
      },
    };
    const running = runEvidencePlan(
      {
        runId: "abort-during-validation",
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        signal: external.signal,
      },
      deferredPlan,
      {
        source: source(),
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
    await validationStarted;

    external.abort(reason);
    const settled = running.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const outcome = await Promise.race([
      settled,
      new Promise<{ readonly status: "pending" }>((resolve) => {
        setTimeout(() => resolve({ status: "pending" }), 25);
      }),
    ]);
    if (outcome.status === "pending") {
      releaseValidator();
      await settled;
    }

    expect(outcome).toEqual({ status: "rejected", error: reason });
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

describe("Slovenia registry and official discovery", () => {
  test.each(["SI", " si ", "Slovenia", " slovenia ", "Словения", " словения "])(
    "resolves the supported alias %j to the frozen data-only SI entry",
    (input) => {
      const result = resolveCountry(input);

      expect(result).toEqual({
        ok: true,
        country: {
          code: "SI",
          englishName: "Slovenia",
          displayName: "Словения",
          flag: "🇸🇮",
          coordinate: { lat: 46.1512, lng: 14.9955 },
        },
        authorityRoots: [
          "https://www.gov.si",
          "https://pisrs.si",
          "https://pxweb.stat.si",
          "https://www.ess.gov.si",
        ],
      });
      expect(Object.isFrozen(result)).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.country)).toBe(true);
        expect(Object.isFrozen(result.country.coordinate)).toBe(true);
        expect(Object.isFrozen(result.authorityRoots)).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(
          /dossier|salary|threshold|eligib|profile|citizenship|income/i,
        );
      }
    },
  );

  test("fails closed for unsupported free text without echoing it", () => {
    const sentinel = "RU passport, salary 210000, choose a nice country";

    const result = resolveCountry(sentinel);

    expect(result).toEqual({ ok: false, kind: "unsupported_country" });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  test("sends the exact data-only registry request and stamps a valid model proposal", async () => {
    const country = resolveCountry("SI");
    expect(country.ok).toBe(true);
    if (!country.ok) throw new Error("SI fixture must resolve");
    const calls: { body?: unknown; options?: unknown }[] = [];
    const client = {
      responses: {
        parse: async (body: unknown, options: unknown) => {
          calls.push({ body, options });
          return {
            output_parsed: {
              candidates: [{
                candidateId: "route-gov",
                url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
                authorityRoot: "https://www.gov.si",
                claimKinds: ["route_basis", "duration"],
              }],
            },
            output: [],
          };
        },
      },
    } as unknown as OpenAI;

    const result = await createOfficialSourceDiscovery(client).discover({
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    });

    expect(result).toEqual({
      ok: true,
      candidates: [{
        candidateId: "route-gov",
        url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
        authorityRoot: "https://www.gov.si",
        claimKinds: ["route_basis", "duration"],
        discoveredFrom: "registry",
      }],
    });
    expect(calls).toHaveLength(1);
    const call = calls[0] as {
      body: {
        model: string;
        input: string;
        store: boolean;
        tools: unknown[];
        text: { format: unknown };
      };
      options: unknown;
    };
    expect(JSON.parse(call.body.input)).toEqual({
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    });
    expect(Object.keys(JSON.parse(call.body.input))).toEqual([
      "country",
      "authorityRoots",
      "requiredClaimKinds",
    ]);
    expect(call.body.input).not.toMatch(/210000|passport|profile|incomeRub|Russian|free.?text/i);
    expect(call.body).toMatchObject({
      model: "gpt-5.6",
      store: false,
      tools: [{
        type: "web_search",
        search_context_size: "low",
        filters: {
          allowed_domains: ["www.gov.si", "pisrs.si", "pxweb.stat.si", "www.ess.gov.si"],
        },
      }],
    });
    expect(call.body.text.format).toEqual(expect.objectContaining({ type: "json_schema" }));
    expect(call.options).toEqual({ timeout: 12_000, maxRetries: 0 });
  });

  test("reconstructs the discovery payload without extra enumerable caller fields", async () => {
    const country = resolveCountry("SI");
    if (!country.ok) throw new Error("SI fixture must resolve");
    let serializedInput = "";
    const client = {
      responses: {
        parse: async (body: { readonly input: string }) => {
          serializedInput = body.input;
          return { output_parsed: { candidates: [] }, output: [] };
        },
      },
    } as unknown as OpenAI;
    const taintedCountry = {
      ...country.country,
      profile: { monthlyIncomeRub: "210000", citizenship: "RU" },
      freeText: "private sentinel",
    };

    await createOfficialSourceDiscovery(client).discover({
      country: taintedCountry,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    });

    expect(JSON.parse(serializedInput)).toEqual({
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    });
    expect(serializedInput).not.toMatch(/210000|monthlyIncomeRub|"citizenship":|private sentinel|freeText/i);
  });

  test.each([
    {
      name: "more than six candidates",
      output: {
        candidates: Array.from({ length: 7 }, (_, index) => ({
          candidateId: `candidate-${index}`,
          url: `https://pisrs.si/${index}`,
          authorityRoot: "https://pisrs.si",
          claimKinds: ["income"],
        })),
      },
    },
    {
      name: "non-HTTPS URL",
      output: { candidates: [{
        candidateId: "bad-http",
        url: "http://pisrs.si/law",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["income"],
      }] },
    },
    {
      name: "uninstalled subdomain",
      output: { candidates: [{
        candidateId: "bad-host",
        url: "https://e-uprava.gov.si/route",
        authorityRoot: "https://www.gov.si",
        claimKinds: ["route_basis"],
      }] },
    },
    {
      name: "noncanonical port",
      output: { candidates: [{
        candidateId: "bad-port",
        url: "https://pisrs.si:444/law",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["income"],
      }] },
    },
    {
      name: "mismatched authority root",
      output: { candidates: [{
        candidateId: "wrong-root",
        url: "https://pisrs.si/law",
        authorityRoot: "https://www.gov.si",
        claimKinds: ["route_basis"],
      }] },
    },
    {
      name: "duplicate claim kind",
      output: { candidates: [{
        candidateId: "duplicate-kind",
        url: "https://pisrs.si/law",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["route_basis", "route_basis"],
      }] },
    },
    {
      name: "empty claim kinds",
      output: { candidates: [{
        candidateId: "empty-kinds",
        url: "https://pisrs.si/law",
        authorityRoot: "https://pisrs.si",
        claimKinds: [],
      }] },
    },
    {
      name: "kind outside the requested set",
      output: { candidates: [{
        candidateId: "unrequested-kind",
        url: "https://pisrs.si/law",
        authorityRoot: "https://pisrs.si",
        claimKinds: ["income"],
      }] },
      requested: ["route_basis"] as const,
    },
  ])("rejects the entire batch for $name", async ({ output, requested }) => {
    const country = resolveCountry("SI");
    if (!country.ok) throw new Error("SI fixture must resolve");
    const client = {
      responses: { parse: async () => ({ output_parsed: output, output: [] }) },
    } as unknown as OpenAI;

    const result = await createOfficialSourceDiscovery(client).discover({
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: requested ?? REQUIRED_CLAIM_KINDS,
    });

    expect(result).toEqual({ ok: false, kind: "invalid_output", candidates: [] });
  });

  test.each([
    {
      name: "refusal",
      response: {
        output_parsed: null,
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      },
      kind: "refused",
    },
    { name: "schema mismatch", response: { output_parsed: { candidates: "bad" }, output: [] }, kind: "invalid_output" },
    { name: "empty parse", response: { output_parsed: null, output: [] }, kind: "invalid_output" },
  ])("returns an empty typed blocker for $name", async ({ response, kind }) => {
    const country = resolveCountry("SI");
    if (!country.ok) throw new Error("SI fixture must resolve");
    const client = {
      responses: { parse: async () => response },
    } as unknown as OpenAI;

    await expect(createOfficialSourceDiscovery(client).discover({
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    })).resolves.toEqual({ ok: false, kind, candidates: [] });
  });

  test("classifies model and timeout errors without exposing a partial candidate", async () => {
    const country = resolveCountry("SI");
    if (!country.ok) throw new Error("SI fixture must resolve");
    const input = {
      country: country.country,
      authorityRoots: SI_AUTHORITY_ROOTS,
      requiredClaimKinds: REQUIRED_CLAIM_KINDS,
    };
    const modelClient = {
      responses: { parse: async () => { throw new Error("upstream failed"); } },
    } as unknown as OpenAI;
    const timeoutClient = {
      responses: {
        parse: async () => {
          throw Object.assign(new Error("request timed out"), { name: "APIConnectionTimeoutError" });
        },
      },
    } as unknown as OpenAI;

    await expect(createOfficialSourceDiscovery(modelClient).discover(input)).resolves.toEqual({
      ok: false,
      kind: "model_error",
      candidates: [],
    });
    await expect(createOfficialSourceDiscovery(timeoutClient).discover(input)).resolves.toEqual({
      ok: false,
      kind: "timeout",
      candidates: [],
    });
  });
});

const SLOVENIA_CANDIDATES: readonly SourceCandidate[] = [
  {
    candidateId: "gov-route",
    url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    authorityRoot: "https://www.gov.si",
    claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
    discoveredFrom: "registry",
  },
  {
    candidateId: "ztuj2",
    url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
    discoveredFrom: "registry",
  },
  {
    candidateId: "salary-publication",
    url: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["income"],
    discoveredFrom: "registry",
  },
  {
    candidateId: "sistat",
    url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
    authorityRoot: "https://pxweb.stat.si",
    claimKinds: ["income"],
    discoveredFrom: "registry",
  },
  {
    candidateId: "ess-companion",
    url: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
    authorityRoot: "https://www.ess.gov.si",
    claimKinds: ["companion_local_work_access"],
    discoveredFrom: "registry",
  },
  {
    candidateId: "zzsdt",
    url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["companion_local_work_access"],
    discoveredFrom: "registry",
  },
];

function sloveniaArtifact(
  request: HttpStepRequest<SloveniaSourceId>,
): LiveCapturedArtifact<SloveniaSourceId> {
  const fixtureBytes = request.role === "sistat-metadata"
    ? new TextEncoder().encode(JSON.stringify({
        title: "Average monthly earnings",
        variables: [
          { code: "MEASURE", text: "Measure", values: ["NET"], valueTexts: ["Net salary"] },
          { code: "TIME", text: "Period", time: true, values: ["2025M12", "2026M01"], valueTexts: ["2025M12", "2026M01"] },
        ],
      }))
    : request.role === "official-document"
      ? new TextEncoder().encode("<ValCurs Date=\"11.08.2026\"></ValCurs>")
      : new TextEncoder().encode(`${request.sourceId}:${request.role}`);
  const sha256 = createHash("sha256").update(fixtureBytes).digest("hex");
  const mediaType = request.allowedMediaTypes[0]!;
  return {
    artifactId: `${request.sourceId}:${request.role}:${sha256}`,
    runId: request.runId,
    sourceId: request.sourceId,
    role: request.role,
    url: request.url,
    mediaType,
    sha256,
    bytes: fixtureBytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:01.000Z",
    responseStatus: 200,
    responseUrl: request.url,
    request: {
      method: request.method,
      url: request.url,
      ...(request.bodyMediaType === undefined ? {} : { bodyMediaType: request.bodyMediaType }),
      ...(request.bodyBytes === undefined
        ? {}
        : { bodySha256: createHash("sha256").update(request.bodyBytes).digest("hex") }),
    },
  };
}

describe("Slovenia installed research plan", () => {
  test("freezes the four-source plan contract and keeps CBR outside discovery", () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    expect(sloveniaPlan).toMatchObject({
      id: "vs2-slovenia@1",
      scope: "VS-2 Slovenia cold start",
      sourceIds: [
        "si-digital-nomad-route",
        "si-income-threshold",
        "si-companion-employment",
        "cbr-eur",
      ],
      sourceNavigation: {
        "si-digital-nomad-route": SLOVENIA_CANDIDATES[0]!.url,
        "si-income-threshold": SLOVENIA_CANDIDATES[2]!.url,
        "si-companion-employment": SLOVENIA_CANDIDATES[4]!.url,
        "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
      },
      parserVersions: {
        "si-digital-nomad-route": "si-route@1",
        "si-income-threshold": "si-income@1",
        "si-companion-employment": "si-companion@1",
        "cbr-eur": "cbr-eur@1",
      },
      rulesVersion: "vs2-evidence@1",
      limits: { concurrency: 3, maxCaptures: 10, deadlineMs: 60_000 },
    });
    expect(SLOVENIA_CANDIDATES.some((candidate) => candidate.url.includes("cbr.ru"))).toBe(false);
    expect(Object.isFrozen(sloveniaPlan)).toBe(true);
    expect(Object.isFrozen(sloveniaPlan.sourceIds)).toBe(true);
    expect(Object.isFrozen(sloveniaPlan.sourceNavigation)).toBe(true);
    expect(Object.isFrozen(sloveniaPlan.parserVersions)).toBe(true);
    expect(Object.isFrozen(sloveniaPlan.limits)).toBe(true);
  });

  test("captures the canonical eight artifacts and builds an all-dimensions SiStat query", async () => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];
    const requestStep: RequestStep<SloveniaSourceId> = async (request) => {
      requests.push(request);
      return sloveniaArtifact(request);
    };
    for (const sourceId of [
      "si-digital-nomad-route",
      "si-income-threshold",
      "si-companion-employment",
      "cbr-eur",
    ] as const) {
      const result = await sloveniaSource.capture({
        runId: "eight-captures",
        sourceId,
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: DEADLINE_AT,
        signal: new AbortController().signal,
      }, requestStep);
      expect(result.ok).toBe(true);
    }

    expect(requests.map(({ sourceId, role, method }) => ({ sourceId, role, method }))).toEqual([
      { sourceId: "si-digital-nomad-route", role: "gov-route-page", method: "GET" },
      { sourceId: "si-digital-nomad-route", role: "ztuj2-consolidated", method: "GET" },
      { sourceId: "si-income-threshold", role: "salary-publication", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-metadata", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-series", method: "POST" },
      { sourceId: "si-companion-employment", role: "ess-companion-page", method: "GET" },
      { sourceId: "si-companion-employment", role: "zzsdt-consolidated", method: "GET" },
      { sourceId: "cbr-eur", role: "official-document", method: "GET" },
    ]);
    const series = requests.find((request) => request.role === "sistat-series");
    expect(series).toMatchObject({
      url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
      bodyMediaType: "application/json",
      headers: { accept: "application/json", "content-type": "application/json" },
      allowedHosts: ["pxweb.stat.si"],
    });
    expect(JSON.parse(new TextDecoder().decode(series?.bodyBytes))).toEqual({
      query: [
        { code: "MEASURE", selection: { filter: "all", values: ["*"] } },
        { code: "TIME", selection: { filter: "all", values: ["*"] } },
      ],
      response: { format: "json-stat2" },
    });
  });

  test.each([
    { name: "missing", candidates: SLOVENIA_CANDIDATES.filter((candidate) => candidate.candidateId !== "ztuj2") },
    { name: "ambiguous", candidates: [...SLOVENIA_CANDIDATES, { ...SLOVENIA_CANDIDATES[1]!, candidateId: "ztuj2-copy" }] },
    { name: "noncanonical-port", candidates: SLOVENIA_CANDIDATES.map((candidate) => candidate.candidateId === "ztuj2" ? { ...candidate, url: "https://pisrs.si:444/law" } : candidate) },
  ])("does no HTTP work for a $name required candidate slot", async ({ candidates }) => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates });
    let requests = 0;

    const result = await sloveniaSource.capture({
      runId: "unavailable-route",
      sourceId: "si-digital-nomad-route",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests += 1;
      return sloveniaArtifact(request);
    });

    expect(result).toEqual({
      ok: false,
      sourceId: "si-digital-nomad-route",
      kind: "navigation_mismatch",
      attempts: 1,
      partialArtifacts: [],
    });
    expect(requests).toBe(0);
  });
});

function fixtureArtifact(
  sourceId: SloveniaSourceId,
  role: string,
  fixtureName: string,
  responseUrl: string,
  mediaType = "text/html",
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new Uint8Array(readFileSync(
    new URL(`../sources/fixtures/slovenia/${fixtureName}`, import.meta.url),
  ));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${sourceId}:${role}:${sha256}`,
    runId: "slovenia-validators",
    sourceId,
    role,
    url: responseUrl,
    mediaType,
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:01.000Z",
    responseStatus: 200,
    responseUrl,
    request: { method: "GET", url: responseUrl },
  };
}

function routeEntry(
  govBytes?: Uint8Array,
  lawBytes?: Uint8Array,
): ParserEntry<SloveniaSourceId> {
  const gov = fixtureArtifact(
    "si-digital-nomad-route",
    "gov-route-page",
    "route-gov.html",
    SLOVENIA_CANDIDATES[0]!.url,
  );
  const law = fixtureArtifact(
    "si-digital-nomad-route",
    "ztuj2-consolidated",
    "ztuj2.html",
    SLOVENIA_CANDIDATES[1]!.url,
  );
  const replaceBytes = (
    artifactValue: LiveCapturedArtifact<SloveniaSourceId>,
    bytes: Uint8Array | undefined,
  ) => bytes === undefined
    ? artifactValue
    : {
        ...artifactValue,
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
  return {
    sourceId: "si-digital-nomad-route",
    navigationUrl: SLOVENIA_CANDIDATES[0]!.url,
    resolvedEvidenceUrl: SLOVENIA_CANDIDATES[1]!.url,
    artifacts: [replaceBytes(gov, govBytes), replaceBytes(law, lawBytes)],
  };
}

function mutateFixture(name: string, mutate: (text: string) => string): Uint8Array {
  const text = readFileSync(
    new URL(`../sources/fixtures/slovenia/${name}`, import.meta.url),
    "utf8",
  );
  return new TextEncoder().encode(mutate(text));
}

describe("Slovenia route validator", () => {
  test("emits all seven route claims in canonical order with current exact bundle evidence", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(routeEntry(), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("route fixture must validate");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx_rate")).toEqual([
      "route_basis",
      "citizenship_applicability",
      "remote_work_relations",
      "qualification",
      "companion_entry",
      "duration",
      "general_statutory_prerequisites",
    ]);
    expect(result.claims.map((claim) => claim.value)).toEqual([
      { route: "temporary_residence_digital_nomad", legalBasis: "ZTuj-2 Article 51a", effectiveFrom: "2025-11-21" },
      { eligibleCategory: "third_country_national", explicitNationalityExclusions: ["EU", "EEA", "Switzerland"] },
      { allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"], slovenianLabourMarketWorkIncluded: false },
      { rule: "not_listed_in_authoritative_requirements" },
      { rule: "immediate_family_reunification_without_waiting_period" },
      { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6 },
      { passportBeyondPermitMonths: 3, healthInsurance: true, article55GroundsApply: true },
    ]);
    for (const claim of result.claims) {
      expect(claim).toMatchObject({
        sourceId: "si-digital-nomad-route",
        scope: "VS-2 Slovenia cold start",
        sourcePeriod: "2025-11-21",
        status: "verified",
        validatorVersion: "si-route@1",
      });
      if (!("evidence" in claim)) throw new Error("route claim must carry evidence");
      expect(claim.evidence.length).toBeGreaterThan(0);
      expect(claim.evidence.every(({ anchor: claimAnchor }) =>
        claimAnchor.excerptSha256.length === 64 && claimAnchor.locator.length > 0
      )).toBe(true);
      expect(claim.evidence.every(({ navigationUrl, resolvedEvidenceUrl }) =>
        navigationUrl.startsWith("https://") && resolvedEvidenceUrl.startsWith("https://")
      )).toBe(true);
      expect(claim.anchor).toEqual(claim.evidence.at(-1)!.anchor);
    }
    expect(new Set(result.claims.map((claim) => claim.anchor.excerptSha256)).size).toBe(7);
    const routeBasis = result.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "route_basis",
    );
    expect(routeBasis && "evidence" in routeBasis && routeBasis.evidence.map(({ anchor: value }) => value.locator)).toEqual([
      "GOV.SI route title and publication date",
      "ZAKO5761 51.a člen route basis",
    ]);
    const qualification = result.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "qualification",
    );
    expect(qualification && "evidence" in qualification && qualification.evidence).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({ locator: "ZAKO5761 51.a člen complete requirements" }),
      }),
    ]);
    const citizenship = result.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "citizenship_applicability",
    );
    expect(JSON.stringify(citizenship)).not.toMatch(/Russian|guaranteed_admission|consular_guarantee/i);
  });

  test("retains candidate navigation separately from the exact redirected final URL", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const original = routeEntry();
    const redirectedUrl = "https://www.gov.si/en/news/digital-nomads-current/";
    const redirected: ParserEntry<SloveniaSourceId> = {
      ...original,
      artifacts: original.artifacts.map((artifactValue, index) => index === 0
        ? {
            ...artifactValue,
            url: redirectedUrl,
            responseUrl: redirectedUrl,
            request: { method: "GET" as const, url: SLOVENIA_CANDIDATES[0]!.url },
          }
        : artifactValue),
    };

    const result = await sloveniaPlan.validate(redirected, ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("redirected route fixture must validate");
    const claim = result.claims[0]!;
    if (!("evidence" in claim)) throw new Error("route claim must carry evidence");
    expect(claim.evidence[0]).toMatchObject({
      navigationUrl: SLOVENIA_CANDIDATES[0]!.url,
      resolvedEvidenceUrl: redirectedUrl,
    });
  });

  test.each([
    {
      name: "incomplete effective-state listing",
      law: () => mutateFixture("ztuj2.html", (text) => text.replace("EFFECTIVE STATE LIST: COMPLETE.", "EFFECTIVE STATE LIST: INCOMPLETE.")),
    },
    {
      name: "duplicate latest applicable state",
      law: () => mutateFixture("ztuj2.html", (text) => text.replace("STATE FUTURE: 2027-01-01; ID=future-amendment.", "STATE EFFECTIVE: 2025-11-21; ID=ambiguous-copy.")),
    },
    {
      name: "future-only state",
      law: () => mutateFixture("ztuj2.html", (text) => text.replaceAll("2024-01-01", "2027-01-01").replaceAll("2025-11-21", "2028-01-01")),
    },
    {
      name: "changed article anchor",
      law: () => mutateFixture("ztuj2.html", (text) => text.replaceAll("51.a člen", "51.b člen")),
    },
    {
      name: "incomplete prerequisites",
      law: () => mutateFixture("ztuj2.html", (text) => text.replace("Article 55 refusal grounds apply.", "Article 55 not captured.")),
    },
    {
      name: "required text moved outside Article 51a",
      law: () => mutateFixture("ztuj2.html", (text) => text
        .replace("<p>Health insurance is required.</p>", "")
        .replace("<h2>END 51.a člen</h2>", "<h2>END 51.a člen</h2><p>Health insurance is required.</p>")),
    },
    {
      name: "reversed Article 51a boundaries",
      law: () => mutateFixture("ztuj2.html", (text) => text
        .replace("BEGIN 51.a člen", "TEMP 51.a člen")
        .replace("END 51.a člen", "BEGIN 51.a člen")
        .replace("TEMP 51.a člen", "END 51.a člen")),
    },
    {
      name: "incomplete eligibility scope",
      gov: () => mutateFixture("route-gov.html", (text) => text.replace("ELIGIBILITY SCOPE COMPLETE.", "ELIGIBILITY SCOPE PARTIAL.")),
    },
    {
      name: "unsupported nationality guarantee",
      gov: () => mutateFixture("route-gov.html", (text) => text.replace("No nationality-specific or consular admission guarantee is stated.", "Guaranteed admission for Russian citizens.")),
    },
  ])("rejects the whole route bundle for $name", async ({ gov, law }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(routeEntry(gov?.(), law?.()), ASSESSMENT_DATE);

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

function incomeEntry(
  salaryBytes?: Uint8Array,
  metadataBytes?: Uint8Array,
  seriesBytes?: Uint8Array,
): ParserEntry<SloveniaSourceId> {
  const artifacts = [
    fixtureArtifact(
      "si-income-threshold",
      "salary-publication",
      "salary-publication.html",
      SLOVENIA_CANDIDATES[2]!.url,
    ),
    fixtureArtifact(
      "si-income-threshold",
      "sistat-metadata",
      "sistat-metadata.json",
      SLOVENIA_CANDIDATES[3]!.url,
      "application/json",
    ),
    fixtureArtifact(
      "si-income-threshold",
      "sistat-series",
      "sistat-series.json",
      SLOVENIA_CANDIDATES[3]!.url,
      "application/json",
    ),
  ];
  const overrides = [salaryBytes, metadataBytes, seriesBytes];
  return {
    sourceId: "si-income-threshold",
    navigationUrl: SLOVENIA_CANDIDATES[2]!.url,
    resolvedEvidenceUrl: SLOVENIA_CANDIDATES[3]!.url,
    artifacts: artifacts.map((artifactValue, index) => {
      const bytes = overrides[index];
      return bytes === undefined
        ? artifactValue
        : {
            ...artifactValue,
            bytes,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
    }),
  };
}

describe("Slovenia income validator", () => {
  test("selects the latest applicable complete net period and derives its Decimal threshold", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(incomeEntry(), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("income fixture must validate");
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0]!;
    expect(claim).toMatchObject({
      claimKind: "income",
      sourceId: "si-income-threshold",
      value: {
        metric: "latest_official_average_monthly_net_salary",
        multiplier: "2",
        thresholdEur: "3120.00",
        period: "2026M01",
      },
      sourcePeriod: "2026M01",
      validatorVersion: "si-income@1",
      status: "verified",
    });
    if (!("evidence" in claim)) throw new Error("income claim must carry evidence");
    expect(claim.evidence.map(({ anchor: claimAnchor }) => claimAnchor)).toEqual([
      {
        artifactId: expect.stringContaining("salary-publication"),
        locator: "PISRS salary publication 2026-01-1950",
        excerptSha256: createHash("sha256")
          .update("PISRS 2026-01-1950 | NET | 2026M01 | 1560.00 EUR")
          .digest("hex"),
      },
      {
        artifactId: expect.stringContaining("sistat-metadata"),
        locator: "H285S.px complete dimensions",
        excerptSha256: createHash("sha256")
          .update("H285S.px | dimensions complete | no pagination")
          .digest("hex"),
      },
      {
        artifactId: expect.stringContaining("sistat-series"),
        locator: "H285S.px NET 2026M01",
        excerptSha256: createHash("sha256")
          .update("H285S.px | NET | 2026M01 | 1560.00")
          .digest("hex"),
      },
    ]);
    expect(claim.anchor).toEqual(claim.evidence[2]!.anchor);
    expect(JSON.stringify(claim)).not.toMatch(/gross_to_net|conversion|estimated/i);
  });

  test("derives a changed matching publication and series value instead of remembering salary", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const salary = mutateFixture("salary-publication.html", (text) => text.replaceAll("1560.00", "1601.00"));
    const series = mutateFixture("sistat-series.json", (text) => text.replaceAll("1560.00", "1601.00"));

    const result = await sloveniaPlan.validate(incomeEntry(salary, undefined, series), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("mutated income fixture must validate");
    expect(result.claims[0]?.value).toEqual({
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "3202.00",
      period: "2026M01",
    });
  });

  test.each([
    {
      name: "paginated metadata",
      metadata: () => mutateFixture("sistat-metadata.json", (text) => text.replace('"hasMore": false', '"hasMore": true')),
    },
    {
      name: "incomplete metadata",
      metadata: () => mutateFixture("sistat-metadata.json", (text) => text.replace('"complete": true', '"complete": false')),
    },
    {
      name: "missing series dimension",
      series: () => mutateFixture("sistat-series.json", (text) => text.replace('"id": ["MEASURE", "TIME"]', '"id": ["TIME"]')),
    },
    {
      name: "ambiguous net metric",
      metadata: () => mutateFixture("sistat-metadata.json", (text) => text.replace('"Average monthly gross salary"', '"Average monthly net salary"')),
    },
    {
      name: "future-only period",
      metadata: () => mutateFixture("sistat-metadata.json", (text) => text.replaceAll("2025M12", "2027M11").replaceAll("2026M01", "2027M12")),
      series: () => mutateFixture("sistat-series.json", (text) => text.replaceAll("2025M12", "2027M11").replaceAll("2026M01", "2027M12")),
    },
    {
      name: "publication disagreement",
      salary: () => mutateFixture("salary-publication.html", (text) => text.replaceAll("1560.00", "1559.00")),
    },
    {
      name: "malformed publication date",
      salary: () => mutateFixture("salary-publication.html", (text) => text.replace("PUBLISHED: 2026-02-20.", "PUBLISHED: 0000.")),
    },
    {
      name: "malformed publication value",
      salary: () => mutateFixture("salary-publication.html", (text) => text.replace("VALUE EUR: 1560.00.", "VALUE EUR: not-a-number.")),
    },
  ])("rejects the complete income claim for $name", async ({ salary, metadata, series }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(
      incomeEntry(salary?.(), metadata?.(), series?.()),
      ASSESSMENT_DATE,
    );

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

function companionEntry(
  essBytes?: Uint8Array,
  lawBytes?: Uint8Array,
): ParserEntry<SloveniaSourceId> {
  const artifacts = [
    fixtureArtifact(
      "si-companion-employment",
      "ess-companion-page",
      "companion-ess.html",
      SLOVENIA_CANDIDATES[4]!.url,
    ),
    fixtureArtifact(
      "si-companion-employment",
      "zzsdt-consolidated",
      "zzsdt.html",
      SLOVENIA_CANDIDATES[5]!.url,
    ),
  ];
  return {
    sourceId: "si-companion-employment",
    navigationUrl: SLOVENIA_CANDIDATES[4]!.url,
    resolvedEvidenceUrl: SLOVENIA_CANDIDATES[5]!.url,
    artifacts: artifacts.map((artifactValue, index) => {
      const bytes = [essBytes, lawBytes][index];
      return bytes === undefined
        ? artifactValue
        : {
            ...artifactValue,
            bytes,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
    }),
  };
}

describe("Slovenia companion employment validator", () => {
  test("emits only narrow conditional local work access with both exact current artifacts", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(companionEntry(), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("companion fixture must validate");
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0]!;
    expect(claim).toMatchObject({
      claimKind: "companion_local_work_access",
      sourceId: "si-companion-employment",
      value: { access: "conditional", labourMarketCheck: true, informationSheet: true },
      sourcePeriod: "2026-01-01",
      validatorVersion: "si-companion@1",
      status: "verified",
    });
    if (!("evidence" in claim)) throw new Error("companion claim must carry evidence");
    expect(claim.evidence.map(({ anchor: claimAnchor }) => claimAnchor)).toEqual([
      {
        artifactId: expect.stringContaining("ess-companion-page"),
        locator: "ESS complete conditional local employment scope",
        excerptSha256: createHash("sha256")
          .update([
            "CONDITIONAL LOCAL EMPLOYMENT SCOPE: COMPLETE.",
            "A family member holding the relevant residence permit may enter local employment conditionally.",
            "An informativni list (information sheet) is required.",
            "A kontrola trga dela (labour-market check) is required.",
            "Automatic labour-market access is not granted.",
            "No conclusion is made about remote work for a foreign company.",
          ].join(" "))
          .digest("hex"),
      },
      {
        artifactId: expect.stringContaining("zzsdt-consolidated"),
        locator: "ZAKO6655 complete 32. člen + 33. člen",
        excerptSha256: createHash("sha256")
          .update([
            "For conditional employment under a residence permit, an informativni list (information sheet) is required.",
            "A kontrola trga dela (labour-market check) is required before local employment.",
            "The provision does not create automatic access.",
          ].join(" "))
          .digest("hex"),
      },
    ]);
    expect(claim.anchor).toEqual(claim.evidence[1]!.anchor);
    expect(JSON.stringify(claim)).not.toMatch(/automatic|foreign_company_remote_work/i);
  });

  test.each([
    {
      name: "incomplete effective-state listing",
      law: () => mutateFixture("zzsdt.html", (text) => text.replace("EFFECTIVE STATE LIST: COMPLETE.", "EFFECTIVE STATE LIST: INCOMPLETE.")),
    },
    {
      name: "duplicate latest applicable state",
      law: () => mutateFixture("zzsdt.html", (text) => text.replace("STATE FUTURE: 2027-01-01; ID=future-amendment.", "STATE EFFECTIVE: 2026-01-01; ID=ambiguous-copy.")),
    },
    {
      name: "future-only state",
      law: () => mutateFixture("zzsdt.html", (text) => text.replaceAll("2024-01-01", "2027-01-01").replaceAll("2026-01-01", "2028-01-01")),
    },
    {
      name: "changed article anchor",
      law: () => mutateFixture("zzsdt.html", (text) => text.replaceAll("33. člen", "34. člen")),
    },
    {
      name: "missing information sheet",
      ess: () => mutateFixture("companion-ess.html", (text) => text.replace("An informativni list (information sheet) is required.", "Information sheet not captured.")),
    },
    {
      name: "Article 32 text moved outside its boundaries",
      law: () => mutateFixture("zzsdt.html", (text) => text
        .replace("<p>For conditional employment under a residence permit, an informativni list (information sheet) is required.</p>", "")
        .replace("<h2>END 32. člen</h2>", "<h2>END 32. člen</h2><p>For conditional employment under a residence permit, an informativni list (information sheet) is required.</p>")),
    },
    {
      name: "automatic access inference",
      ess: () => mutateFixture("companion-ess.html", (text) => text.replace("Automatic labour-market access is not granted.", "Automatic labour-market access is granted.")),
    },
    {
      name: "foreign-company remote work inference",
      ess: () => mutateFixture("companion-ess.html", (text) => text.replace("No conclusion is made about remote work for a foreign company.", "Remote work for a foreign company is automatically allowed.")),
    },
  ])("rejects the whole companion claim for $name", async ({ ess, law }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(
      companionEntry(ess?.(), law?.()),
      ASSESSMENT_DATE,
    );

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

describe("Slovenia cross-source claim rules", () => {
  async function verifiedCountryEntries() {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const parserEntries = [routeEntry(), incomeEntry(), companionEntry()] as const;
    const entries = [];
    for (const parserEntry of parserEntries) {
      const result = await sloveniaPlan.validate(parserEntry, ASSESSMENT_DATE);
      if (!result.ok) throw new Error(`${parserEntry.sourceId} fixture must validate`);
      entries.push({
        sourceId: parserEntry.sourceId,
        parserEntry,
        coverage: "verified" as const,
        claims: result.claims,
      });
    }
    return { sloveniaPlan, entries };
  }

  test("sorts complete unique country claims by the published nine-kind order", async () => {
    const { sloveniaPlan, entries } = await verifiedCountryEntries();
    const reversed = entries.map((entry) => ({ ...entry, claims: [...entry.claims].reverse() }));

    const ruled = sloveniaPlan.applyRules(reversed, ASSESSMENT_DATE);

    expect(ruled.flatMap((entry) => entry.coverage === "verified"
      ? entry.claims.flatMap((claim) => "claimKind" in claim ? [claim.claimKind] : [])
      : [])).toEqual([
        "route_basis",
        "citizenship_applicability",
        "remote_work_relations",
        "qualification",
        "companion_entry",
        "duration",
        "general_statutory_prerequisites",
        "income",
        "companion_local_work_access",
      ]);
  });

  test.each(["missing", "duplicate"] as const)(
    "fails all country bundles closed for %s claim-kind coverage",
    async (mutation) => {
      const { sloveniaPlan, entries } = await verifiedCountryEntries();
      const income = entries.find((entry) => entry.sourceId === "si-income-threshold")!;
      const route = entries.find((entry) => entry.sourceId === "si-digital-nomad-route")!;
      const mutated = entries.map((entry) => entry.sourceId === income.sourceId
        ? {
            ...entry,
            claims: mutation === "missing"
              ? []
              : [
                  ...entry.claims,
                  route.claims.find((claim) =>
                    "claimKind" in claim && claim.claimKind === "route_basis"
                  ) as ColdStartEvidenceClaim,
                ],
          }
        : entry);

      const ruled = sloveniaPlan.applyRules(mutated, ASSESSMENT_DATE);

      expect(ruled).toHaveLength(3);
      expect(ruled.every((entry) => entry.coverage === "unavailable")).toBe(true);
      expect(ruled.map((entry) => entry.coverage === "unavailable" && entry.blocker.kind)).toEqual([
        "conflict",
        "conflict",
        "conflict",
      ]);
    },
  );
});
