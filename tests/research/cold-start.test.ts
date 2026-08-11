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
  ClaimKind,
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
    if (!result.ok) throw new Error("discovery fixture must validate");
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(Object.isFrozen(result.candidates[0]!.claimKinds)).toBe(true);
    expect(() => {
      (result.candidates[0]!.claimKinds as ClaimKind[]).push("income");
    }).toThrow();
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

// Provenance: docs/superpowers/specs/2026-08-11-slovenia-official-source-field-map.md.
// Each compact role retains its recorded official URL and response-byte SHA-256 below.
const SLOVENIA_CAPTURE_FIXTURES = {
  "gov-route-page": {
    name: "route-gov.html",
    url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    responseSha256: "57a166b3637d5c2351eb32fe79b30f7dc18f3e1c73953af1d09ee70047dd1985",
  },
  "ztuj2-registry": {
    name: "ztuj2-registry.json",
    url: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761",
    responseSha256: "e7a7f1dcfe91624e1383a5ded3403b4a1ef630e125d05bce9d158b0b89f5dfdb",
  },
  "ztuj2-details": {
    name: "ztuj2-details.json",
    url: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/298532110/details",
    responseSha256: "e4f8b71aaaa02dad8fc2833fe78aa465a005ad54ba593109cd2b367d5beeaf26",
  },
  "salary-registry": {
    name: "salary-registry.json",
    url: "https://pisrs.si/api/rezultat/zbirka/sop/2026-01-1950",
    responseSha256: "a17f7e97aaa00583ec732bc231667fc3315842617421da677501c08c32bc95b6",
  },
  "salary-details": {
    name: "salary-details.json",
    url: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/613486752/details",
    responseSha256: "6e42c781690646b3a30475c965b7ae8c4fe823243823475e9a47668cb3011651",
  },
  "sistat-metadata": {
    name: "sistat-metadata.json",
    url: "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px",
    responseSha256: "6ca031a46b4f171b87983c752396fb8642e0736acda79ee3a586de93016d9ca0",
  },
  "sistat-series": {
    name: "sistat-series.json",
    url: "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px",
    responseSha256: "7118fba1fdb78e0722efb134083f00f01f2e829c82158b516612e88b365b263f",
  },
  "ess-companion-page": {
    name: "companion-ess.html",
    url: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
    responseSha256: "a71d5d64369421a1b4b9cd3d7a6037d09b493ba4e835c550a3171900455c057b",
  },
  "zzsdt-registry": {
    name: "zzsdt-registry.json",
    url: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655",
    responseSha256: "10544a5f750982789e31ccc27de536d1021a5da760984df661da8cd15169f081",
  },
  "zzsdt-details": {
    name: "zzsdt-details.json",
    url: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details",
    responseSha256: "a9e61386a1bb8d6fc3ab13d78dd2fa4495fc8bd7ab48c5e9c63b4c12611ba98c",
  },
} as const;

interface SloveniaArtifactOverrides {
  readonly bytes?: Uint8Array;
  readonly requestMethod?: "GET" | "POST";
  readonly requestUrl?: string;
  readonly responseUrl?: string;
}

interface PisrsRegistryFixture {
  data: {
    evidencniPodatki: {
      semafor: { id: number; naziv: string };
      zunanjiID: string;
    };
    besedilo: {
      npbVerzije: { id: number; naziv: string }[];
      total?: number;
    };
  };
  error: unknown;
}

interface SiStatMetadataFixture {
  variables: {
    code: string;
    time?: boolean;
    values: string[];
    valueTexts: string[];
  }[];
}

function captureFixtureBytes(role: string): Uint8Array {
  if (role === "official-document") {
    return new TextEncoder().encode("<ValCurs Date=\"11.08.2026\"></ValCurs>");
  }
  const fixture = SLOVENIA_CAPTURE_FIXTURES[role as keyof typeof SLOVENIA_CAPTURE_FIXTURES];
  if (fixture === undefined) return new TextEncoder().encode(`legacy:${role}`);
  return new Uint8Array(readFileSync(
    new URL(`../sources/fixtures/slovenia/${fixture.name}`, import.meta.url),
  ));
}

function sloveniaArtifact(
  request: HttpStepRequest<SloveniaSourceId>,
  overrides: SloveniaArtifactOverrides = {},
): LiveCapturedArtifact<SloveniaSourceId> {
  const fixtureBytes = overrides.bytes ?? captureFixtureBytes(request.role);
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
    responseUrl: overrides.responseUrl ?? request.url,
    request: {
      method: overrides.requestMethod ?? request.method,
      url: overrides.requestUrl ?? request.url,
      ...(request.bodyMediaType === undefined ? {} : { bodyMediaType: request.bodyMediaType }),
      ...(request.bodyBytes === undefined
        ? {}
        : { bodySha256: createHash("sha256").update(request.bodyBytes).digest("hex") }),
    },
  };
}

describe("Slovenia installed research plan", () => {
  test("installs only the Slovenia v2 evidence contract", () => {
    const { plan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    expect(plan).toMatchObject({
      id: "vs2-slovenia@2",
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
        "si-digital-nomad-route": "si-route@2",
        "si-income-threshold": "si-income@2",
        "si-companion-employment": "si-companion@2",
        "cbr-eur": "cbr-eur@1",
      },
      rulesVersion: "vs2-si-evidence@2",
      limits: { concurrency: 3, maxCaptures: 11, deadlineMs: 60_000 },
    });
    expect(SLOVENIA_CANDIDATES.some((candidate) => candidate.url.includes("cbr.ru"))).toBe(false);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sourceIds)).toBe(true);
    expect(Object.isFrozen(plan.sourceNavigation)).toBe(true);
    expect(Object.isFrozen(plan.parserVersions)).toBe(true);
    expect(Object.isFrozen(plan.limits)).toBe(true);
  });

  test("captures the canonical eleven artifacts and builds the official all-dimensions SiStat query", async () => {
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
        runId: "eleven-captures",
        sourceId,
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: DEADLINE_AT,
        signal: new AbortController().signal,
      }, requestStep);
      expect(result.ok).toBe(true);
    }

    expect(requests.map(({ sourceId, role, method }) => ({ sourceId, role, method }))).toEqual([
      { sourceId: "si-digital-nomad-route", role: "gov-route-page", method: "GET" },
      { sourceId: "si-digital-nomad-route", role: "ztuj2-registry", method: "GET" },
      { sourceId: "si-digital-nomad-route", role: "ztuj2-details", method: "GET" },
      { sourceId: "si-income-threshold", role: "salary-registry", method: "GET" },
      { sourceId: "si-income-threshold", role: "salary-details", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-metadata", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-series", method: "POST" },
      { sourceId: "si-companion-employment", role: "ess-companion-page", method: "GET" },
      { sourceId: "si-companion-employment", role: "zzsdt-registry", method: "GET" },
      { sourceId: "si-companion-employment", role: "zzsdt-details", method: "GET" },
      { sourceId: "cbr-eur", role: "official-document", method: "GET" },
    ]);
    expect(requests.find(({ role }) => role === "ztuj2-registry")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["ztuj2-registry"].url);
    expect(requests.find(({ role }) => role === "ztuj2-details")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["ztuj2-details"].url);
    expect(requests.find(({ role }) => role === "salary-registry")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["salary-registry"].url);
    expect(requests.find(({ role }) => role === "salary-details")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["salary-details"].url);
    expect(requests.find(({ role }) => role === "zzsdt-registry")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["zzsdt-registry"].url);
    expect(requests.find(({ role }) => role === "zzsdt-details")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["zzsdt-details"].url);
    expect(requests.find(({ role }) => role === "sistat-metadata")?.url)
      .toBe(SLOVENIA_CAPTURE_FIXTURES["sistat-metadata"].url);
    const series = requests.find((request) => request.role === "sistat-series");
    expect(series).toMatchObject({
      url: SLOVENIA_CAPTURE_FIXTURES["sistat-series"].url,
      bodyMediaType: "application/json",
      headers: { accept: "application/json", "content-type": "application/json" },
      allowedHosts: ["pxweb.stat.si"],
    });
    expect(JSON.parse(new TextDecoder().decode(series?.bodyBytes))).toEqual({
      query: [
        { code: "MESEC", selection: { filter: "all", values: ["*"] } },
        { code: "PLAČE", selection: { filter: "all", values: ["*"] } },
      ],
      response: { format: "json-stat2" },
    });
  });

  test("snapshots validated candidate scalars before caller mutation", async () => {
    const mutableCandidates = SLOVENIA_CANDIDATES.map((candidate) => ({
      ...candidate,
      claimKinds: [...candidate.claimKinds],
    }));
    const expectedGovUrl = mutableCandidates[0]!.url;
    const expectedRegistryUrl = SLOVENIA_CAPTURE_FIXTURES["ztuj2-registry"].url;
    const expectedDetailsUrl = SLOVENIA_CAPTURE_FIXTURES["ztuj2-details"].url;
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: mutableCandidates });
    mutableCandidates[0]!.url = "https://www.gov.si/mutated-after-construction";
    mutableCandidates[1]!.url = "https://pisrs.si/mutated-after-construction";
    mutableCandidates[0]!.claimKinds.splice(0);
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "candidate-snapshot",
      sourceId: "si-digital-nomad-route",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request);
    });

    expect(result.ok).toBe(true);
    expect(requests.map(({ url }) => url)).toEqual([
      expectedGovUrl,
      expectedRegistryUrl,
      expectedDetailsUrl,
    ]);
  });

  test("stops before PISRS details when the registry omits an internal NPB ordinal", async () => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const registry = JSON.parse(new TextDecoder().decode(
      captureFixtureBytes("ztuj2-registry"),
    )) as { data: { besedilo: { npbVerzije: { naziv: string }[] } } };
    registry.data.besedilo.npbVerzije = registry.data.besedilo.npbVerzije.filter(
      ({ naziv }) => naziv !== "NPB 1",
    );
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "registry-gap",
      sourceId: "si-digital-nomad-route",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request, request.role === "ztuj2-registry"
        ? { bytes: jsonBytes(registry) }
        : {});
    });

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    if (result.ok) throw new Error("registry gap must stop capture");
    expect(result.partialArtifacts.map(({ role }) => role)).toEqual([
      "gov-route-page",
      "ztuj2-registry",
    ]);
    expect(requests.map(({ role }) => role)).toEqual([
      "gov-route-page",
      "ztuj2-registry",
    ]);
  });

  test.each([
    {
      name: "non-null API error",
      mutate: (registry: PisrsRegistryFixture) => { registry.error = { message: "failed" }; },
    },
    {
      name: "wrong record identity",
      mutate: (registry: PisrsRegistryFixture) => {
        registry.data.evidencniPodatki.zunanjiID = "ZAKO6655";
      },
    },
    {
      name: "wrong record status",
      mutate: (registry: PisrsRegistryFixture) => {
        registry.data.evidencniPodatki.semafor.id = 153;
      },
    },
    {
      name: "duplicate NPB id",
      mutate: (registry: PisrsRegistryFixture) => {
        registry.data.besedilo.npbVerzije[1]!.id = registry.data.besedilo.npbVerzije[0]!.id;
      },
    },
    {
      name: "missing Osnovni",
      mutate: (registry: PisrsRegistryFixture) => {
        registry.data.besedilo.npbVerzije[0]!.naziv = "NPB 21";
      },
    },
    {
      name: "unsupported total field",
      mutate: (registry: PisrsRegistryFixture) => {
        registry.data.besedilo.total = registry.data.besedilo.npbVerzije.length;
      },
    },
  ])("stops before PISRS details for $name", async ({ mutate }) => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const registry = JSON.parse(new TextDecoder().decode(
      captureFixtureBytes("ztuj2-registry"),
    )) as PisrsRegistryFixture;
    mutate(registry);
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "invalid-registry",
      sourceId: "si-digital-nomad-route",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request, request.role === "ztuj2-registry"
        ? { bytes: jsonBytes(registry) }
        : {});
    });

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    expect(requests.map(({ role }) => role)).toEqual([
      "gov-route-page",
      "ztuj2-registry",
    ]);
  });

  test("stops before SiStat series when metadata duplicates a dimension code", async () => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const metadata = JSON.parse(new TextDecoder().decode(
      captureFixtureBytes("sistat-metadata"),
    )) as { variables: unknown[] };
    metadata.variables.push(metadata.variables[0]!);
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "duplicate-metadata",
      sourceId: "si-income-threshold",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request, request.role === "sistat-metadata"
        ? { bytes: jsonBytes(metadata) }
        : {});
    });

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    if (result.ok) throw new Error("duplicate metadata must stop capture");
    expect(result.partialArtifacts.map(({ role }) => role)).toEqual([
      "salary-registry",
      "salary-details",
      "sistat-metadata",
    ]);
    expect(requests.map(({ role }) => role)).toEqual([
      "salary-registry",
      "salary-details",
      "sistat-metadata",
    ]);
  });

  test.each([
    {
      name: "misaligned values and labels",
      mutate: (metadata: SiStatMetadataFixture) => { metadata.variables[0]!.valueTexts = []; },
    },
    {
      name: "duplicate category value",
      mutate: (metadata: SiStatMetadataFixture) => {
        metadata.variables[1]!.values[1] = metadata.variables[1]!.values[0]!;
      },
    },
    {
      name: "missing time dimension",
      mutate: (metadata: SiStatMetadataFixture) => { delete metadata.variables[0]!.time; },
    },
    {
      name: "multiple time dimensions",
      mutate: (metadata: SiStatMetadataFixture) => { metadata.variables[1]!.time = true; },
    },
  ])("stops before SiStat series for $name", async ({ mutate }) => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const metadata = JSON.parse(new TextDecoder().decode(
      captureFixtureBytes("sistat-metadata"),
    )) as SiStatMetadataFixture;
    mutate(metadata);
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "invalid-metadata",
      sourceId: "si-income-threshold",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request, request.role === "sistat-metadata"
        ? { bytes: jsonBytes(metadata) }
        : {});
    });

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    expect(requests.map(({ role }) => role)).toEqual([
      "salary-registry",
      "salary-details",
      "sistat-metadata",
    ]);
  });

  test.each([
    { name: "request method", overrides: { requestMethod: "POST" as const } },
    { name: "request URL", overrides: { requestUrl: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655" } },
    { name: "final response URL", overrides: { responseUrl: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655" } },
  ])("rejects valid registry JSON with a mismatched $name", async ({ overrides }) => {
    const { source: sloveniaSource } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];

    const result = await sloveniaSource.capture({
      runId: "registry-provenance",
      sourceId: "si-digital-nomad-route",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
      signal: new AbortController().signal,
    }, async (request) => {
      requests.push(request);
      return sloveniaArtifact(request, request.role === "ztuj2-registry" ? overrides : {});
    });

    expect(result).toMatchObject({ ok: false, kind: "navigation_mismatch" });
    expect(requests.map(({ role }) => role)).toEqual([
      "gov-route-page",
      "ztuj2-registry",
    ]);
  });

  test.each([
    { name: "missing", candidates: SLOVENIA_CANDIDATES.filter((candidate) => candidate.candidateId !== "ztuj2") },
    { name: "ambiguous", candidates: [...SLOVENIA_CANDIDATES, { ...SLOVENIA_CANDIDATES[1]!, candidateId: "ztuj2-copy" }] },
    { name: "noncanonical-port", candidates: SLOVENIA_CANDIDATES.map((candidate) => candidate.candidateId === "ztuj2" ? { ...candidate, url: "https://pisrs.si:444/law" } : candidate) },
    { name: "wrong PISRS path", candidates: SLOVENIA_CANDIDATES.map((candidate) => candidate.candidateId === "ztuj2" ? { ...candidate, url: "https://pisrs.si/law?id=ZAKO5761" } : candidate) },
    { name: "wrong PISRS identity", candidates: SLOVENIA_CANDIDATES.map((candidate) => candidate.candidateId === "ztuj2" ? { ...candidate, url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655" } : candidate) },
    { name: "duplicate PISRS identity", candidates: SLOVENIA_CANDIDATES.map((candidate) => candidate.candidateId === "ztuj2" ? { ...candidate, url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&id=ZAKO5761" } : candidate) },
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

interface RouteEntryOptions {
  readonly govBytes?: Uint8Array;
  readonly registryBytes?: Uint8Array;
  readonly detailsBytes?: Uint8Array;
  readonly detailsUrl?: string;
}

interface PisrsDetailsFixture {
  data: {
    besedilo: {
      id: number;
      struktura: string;
      vsebina: string;
      navezavaNPB: { vsebina: string } | null;
    }[];
    kazalo: {
      idStrukturniElement: number;
      idStrukturniElementPostavljeno: number;
      kazaloIme: string;
      struktura: string;
    }[];
  };
  error: unknown;
}

function routeEntry(options: RouteEntryOptions = {}): ParserEntry<SloveniaSourceId> {
  const gov = fixtureArtifact(
    "si-digital-nomad-route",
    "gov-route-page",
    "route-gov.html",
    SLOVENIA_CANDIDATES[0]!.url,
  );
  const registry = fixtureArtifact(
    "si-digital-nomad-route",
    "ztuj2-registry",
    "ztuj2-registry.json",
    SLOVENIA_CAPTURE_FIXTURES["ztuj2-registry"].url,
    "application/json",
  );
  const details = fixtureArtifact(
    "si-digital-nomad-route",
    "ztuj2-details",
    "ztuj2-details.json",
    SLOVENIA_CAPTURE_FIXTURES["ztuj2-details"].url,
    "application/json",
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
    artifacts: [
      replaceBytes(gov, options.govBytes),
      replaceBytes(registry, options.registryBytes),
      {
        ...replaceBytes(details, options.detailsBytes),
        ...(options.detailsUrl === undefined
          ? {}
          : {
              url: options.detailsUrl,
              responseUrl: options.detailsUrl,
              request: { method: "GET" as const, url: options.detailsUrl },
            }),
      },
    ],
  };
}

function mutateFixture(name: string, mutate: (text: string) => string): Uint8Array {
  const text = readFileSync(
    new URL(`../sources/fixtures/slovenia/${name}`, import.meta.url),
    "utf8",
  );
  return new TextEncoder().encode(mutate(text));
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function mutateJsonFixture<T>(name: string, mutate: (value: T) => void): Uint8Array {
  const value = JSON.parse(readFileSync(
    new URL(`../sources/fixtures/slovenia/${name}`, import.meta.url),
    "utf8",
  )) as T;
  mutate(value);
  return jsonBytes(value);
}

describe("Slovenia route validator", () => {
  test("emits seven atomic native-source route claims in canonical order", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(routeEntry(), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("route fixture must validate");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx")).toEqual([
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
      { eligibleCategory: "third_country_national", explicitNationalityExclusions: ["EU", "EEA"] },
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
        validatorVersion: "si-route@2",
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
    expect(result.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "citizenship_applicability",
    )?.value).toEqual({
      eligibleCategory: "third_country_national",
      explicitNationalityExclusions: ["EU", "EEA"],
    });
  });

  test("keeps every native locator and excerpt hash stable after unrelated insertions", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const govBytes = mutateFixture("route-gov.html", (text) => text.replace(
      "<h1>Temporary residence permit for digital nomads</h1>",
      "<h1>Temporary residence permit for digital nomads</h1><p>Unrelated service notice.</p>",
    ));
    const detailsBytes = mutateJsonFixture<PisrsDetailsFixture>(
      "ztuj2-details.json",
      (details) => details.data.besedilo.unshift({
        id: 358811900,
        struktura: "opomba",
        vsebina: "Neodvisna redakcijska opomba.",
        navezavaNPB: null,
      }),
    );

    const [baseline, changed] = await Promise.all([
      sloveniaPlan.validate(routeEntry(), ASSESSMENT_DATE),
      sloveniaPlan.validate(routeEntry({ govBytes, detailsBytes }), ASSESSMENT_DATE),
    ]);

    expect(baseline.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!baseline.ok || !changed.ok) throw new Error("route fixtures must validate");
    const anchors = (claims: typeof baseline.claims) => claims.flatMap((claim) => {
      if (!("evidence" in claim)) throw new Error("route claim must carry evidence");
      return claim.evidence.map(({ anchor: { locator, excerptSha256 } }) => ({ locator, excerptSha256 }));
    });
    expect(anchors(changed.claims)).toEqual(anchors(baseline.claims));
    expect(anchors(baseline.claims).map(({ locator }) => locator)).toEqual([
      "GOV.SI route title and publication date",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > route basis",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > citizenship scope",
      "GOV.SI citizenship scope",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > remote-work relations",
      "GOV.SI remote-work relations",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > complete bounded article",
      "GOV.SI immediate family entry",
      "GOV.SI route duration",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > duration and reapplication",
      "PISRS ZAKO5761 NPB 20 > 51.a člen > passport, insurance, and refusal prerequisites",
      "PISRS ZAKO5761 NPB 20 > 55. člen > refusal grounds opening",
    ]);
  });

  test.each([
    {
      name: "missing NPB 1",
      options: (): RouteEntryOptions => ({
        registryBytes: mutateJsonFixture<PisrsRegistryFixture>(
          "ztuj2-registry.json",
          (registry) => {
            registry.data.besedilo.npbVerzije = registry.data.besedilo.npbVerzije.filter(
              ({ naziv }) => naziv !== "NPB 1",
            );
          },
        ),
      }),
    },
    {
      name: "duplicate NPB 2",
      options: (): RouteEntryOptions => ({
        registryBytes: mutateJsonFixture<PisrsRegistryFixture>(
          "ztuj2-registry.json",
          (registry) => {
            registry.data.besedilo.npbVerzije[1]!.naziv = "NPB 2";
          },
        ),
      }),
    },
    {
      name: "details URL bound to the wrong selected ID",
      options: (): RouteEntryOptions => ({
        detailsUrl: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details",
      }),
    },
    {
      name: "duplicate Article 51.a",
      options: (): RouteEntryOptions => ({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("ztuj2-details.json", (details) => {
          details.data.besedilo.splice(1, 0, {
            id: 358811955,
            struktura: "clen",
            vsebina: "51.a člen",
            navezavaNPB: null,
          });
        }),
      }),
    },
    {
      name: "missing Article 51.a",
      options: (): RouteEntryOptions => ({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("ztuj2-details.json", (details) => {
          details.data.besedilo = details.data.besedilo.filter(({ vsebina }) => vsebina !== "51.a člen");
        }),
      }),
    },
    {
      name: "changed passport requirement",
      options: (): RouteEntryOptions => ({
        detailsBytes: mutateFixture("ztuj2-details.json", (text) => text.replace(
          "katere veljavnost je najmanj tri mesece daljša",
          "katere veljavnost je najmanj dva meseca daljša",
        )),
      }),
    },
    {
      name: "explicit qualification text inside Article 51.a",
      options: (): RouteEntryOptions => ({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("ztuj2-details.json", (details) => {
          details.data.besedilo.splice(8, 0, {
            id: 358811968,
            struktura: "odstavek",
            vsebina: "Qualification required.",
            navezavaNPB: null,
          });
        }),
      }),
    },
  ])("rejects the whole route bundle for $name", async ({ options }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(routeEntry(options()), ASSESSMENT_DATE);

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

const SISTAT_API_URL = SLOVENIA_CAPTURE_FIXTURES["sistat-series"].url;
const SISTAT_BODY_SHA256 = "c51587d0d30a096233aa690537714199d86670e355cbbabf58d5c1b45b2e5121";
const PISRS_NET_PARAGRAPH = "Povprečna mesečna neto plača na zaposleno osebo v Sloveniji za maj 2026 je znašala 1.680,80 EUR in je bila za 0,5 % nižja kot za april 2026.";
const SISTAT_NET_METADATA_PROJECTION = JSON.stringify({
  dimension: { code: "PLAČE", label: "EARNINGS" },
  category: { value: "2", label: "Net earnings" },
});
const SISTAT_NET_COORDINATE_PROJECTION = JSON.stringify({
  coordinate: { MESEC: "2026M05", "PLAČE": "2" },
  value: 1680.8,
});

interface SiStatSeriesFixture {
  source?: string;
  id: string[];
  size: number[];
  dimension: Record<string, {
    label: string;
    category: { index: Record<string, number>; label: Record<string, string> };
  }>;
  value: (number | null)[];
}

interface IncomeEntryOptions {
  readonly registryBytes?: Uint8Array;
  readonly detailsBytes?: Uint8Array;
  readonly metadataBytes?: Uint8Array;
  readonly seriesBytes?: Uint8Array;
  readonly publicationUrl?: string;
  readonly registryUrl?: string;
  readonly detailsUrl?: string;
  readonly seriesMethod?: "GET" | "POST";
  readonly seriesRequestUrl?: string;
  readonly seriesResponseUrl?: string;
  readonly seriesBodySha256?: string;
}

function withFixtureBytes(
  artifactValue: LiveCapturedArtifact<SloveniaSourceId>,
  bytes: Uint8Array | undefined,
): LiveCapturedArtifact<SloveniaSourceId> {
  if (bytes === undefined) return artifactValue;
  return {
    ...artifactValue,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function incomeEntry(options: IncomeEntryOptions = {}): ParserEntry<SloveniaSourceId> {
  const publicationUrl = options.publicationUrl ?? SLOVENIA_CANDIDATES[2]!.url;
  const registryUrl = options.registryUrl ?? SLOVENIA_CAPTURE_FIXTURES["salary-registry"].url;
  const detailsUrl = options.detailsUrl ?? SLOVENIA_CAPTURE_FIXTURES["salary-details"].url;
  const seriesRequestUrl = options.seriesRequestUrl ?? SISTAT_API_URL;
  const seriesResponseUrl = options.seriesResponseUrl ?? SISTAT_API_URL;
  const registry = withFixtureBytes(fixtureArtifact(
    "si-income-threshold",
    "salary-registry",
    "salary-registry.json",
    registryUrl,
    "application/json",
  ), options.registryBytes);
  const details = withFixtureBytes(fixtureArtifact(
    "si-income-threshold",
    "salary-details",
    "salary-details.json",
    detailsUrl,
    "application/json",
  ), options.detailsBytes);
  const metadata = withFixtureBytes(fixtureArtifact(
    "si-income-threshold",
    "sistat-metadata",
    "sistat-metadata.json",
    SISTAT_API_URL,
    "application/json",
  ), options.metadataBytes);
  const series = withFixtureBytes(fixtureArtifact(
    "si-income-threshold",
    "sistat-series",
    "sistat-series.json",
    seriesResponseUrl,
    "application/json",
  ), options.seriesBytes);
  const seriesArtifact: LiveCapturedArtifact<SloveniaSourceId> = {
    ...series,
    url: seriesRequestUrl,
    responseUrl: seriesResponseUrl,
    request: {
      method: options.seriesMethod ?? "POST",
      url: seriesRequestUrl,
      bodyMediaType: "application/json",
      bodySha256: options.seriesBodySha256 ?? SISTAT_BODY_SHA256,
    },
  };
  return {
    sourceId: "si-income-threshold",
    navigationUrl: publicationUrl,
    resolvedEvidenceUrl: seriesResponseUrl,
    artifacts: [
      registry,
      details,
      metadata,
      seriesArtifact,
    ],
  };
}

function changedSalaryDetails(amount: string): Uint8Array {
  return mutateFixture("salary-details.json", (text) => text.replace("1.680,80", amount));
}

function changedSeriesValue(amount: number): Uint8Array {
  return mutateJsonFixture<SiStatSeriesFixture>("sistat-series.json", (series) => {
    series.value[1] = amount;
  });
}

function reorderedIncomeEntryOptions(): IncomeEntryOptions {
  return {
    registryBytes: mutateFixture("salary-registry.json", (text) =>
      text.replaceAll("maj 2026", "junij 2026")),
    detailsBytes: mutateFixture("salary-details.json", (text) => text
      .replaceAll("maj 2026", "junij 2026")
      .replace("1.680,80", "1.734,56")),
    metadataBytes: jsonBytes({
      title: "Average monthly earnings by EARNINGS, UNIT and MONTH",
      variables: [
        {
          code: "PLAČE",
          text: "EARNINGS",
          values: ["1", "2", "3", "4"],
          valueTexts: [
            "Gross earnings",
            "Net earnings",
            "Average gross earnings for the last three months",
            "Average net earnings for the last three months",
          ],
        },
        { code: "ENOTA", text: "UNIT", values: ["EUR"], valueTexts: ["Euro"] },
        {
          code: "MESEC",
          text: "MONTH",
          time: true,
          values: ["2026M04", "2026M05", "2026M06"],
          valueTexts: ["2026M04", "2026M05", "2026M06"],
        },
      ],
    }),
    seriesBytes: jsonBytes({
      version: "2.0",
      class: "dataset",
      source: "Statistical Office of the Republic of Slovenia",
      id: ["PLAČE", "ENOTA", "MESEC"],
      size: [4, 1, 3],
      dimension: {
        "PLAČE": {
          label: "EARNINGS",
          category: {
            index: { "1": 0, "2": 1, "3": 2, "4": 3 },
            label: {
              "1": "Gross earnings",
              "2": "Net earnings",
              "3": "Average gross earnings for the last three months",
              "4": "Average net earnings for the last three months",
            },
          },
        },
        ENOTA: {
          label: "UNIT",
          category: { index: { EUR: 0 }, label: { EUR: "Euro" } },
        },
        MESEC: {
          label: "MONTH",
          category: {
            index: { "2026M04": 0, "2026M05": 1, "2026M06": 2 },
            label: {
              "2026M04": "2026M04",
              "2026M05": "2026M05",
              "2026M06": "2026M06",
            },
          },
        },
      },
      value: [null, null, null, 1600, 1680.8, 1734.56, null, null, null, null, null, null],
    }),
    seriesBodySha256: "b43fbe355244ed6fa0db839da31f0a029ebf86816896c462b2e63b579bbb7d65",
  };
}

describe("Slovenia income validator", () => {
  test("derives one verified income claim from official PISRS and JSON-stat2 shapes", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(incomeEntry(), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("official income fixture must validate");
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0]!;
    expect(claim).toMatchObject({
      claimKind: "income",
      sourceId: "si-income-threshold",
      value: {
        metric: "latest_official_average_monthly_net_salary",
        multiplier: "2",
        thresholdEur: "3361.60",
        period: "2026M05",
      },
      sourcePeriod: "2026M05",
      validatorVersion: "si-income@2",
      status: "verified",
    });
    if (!("evidence" in claim)) throw new Error("income claim must carry evidence");
    expect(claim.evidence.map(({ anchor: claimAnchor }) => claimAnchor)).toEqual([
      {
        artifactId: expect.stringContaining("salary-details"),
        locator: "PISRS salary publication 2026-01-1950 > monthly net salary 2026M05",
        excerptSha256: createHash("sha256").update(PISRS_NET_PARAGRAPH).digest("hex"),
      },
      {
        artifactId: expect.stringContaining("sistat-metadata"),
        locator: "H285S.px metadata > PLAČE > Net earnings",
        excerptSha256: createHash("sha256")
          .update(SISTAT_NET_METADATA_PROJECTION)
          .digest("hex"),
      },
      {
        artifactId: expect.stringContaining("sistat-series"),
        locator: "H285S.px series > 2026M05 > Net earnings",
        excerptSha256: createHash("sha256")
          .update(SISTAT_NET_COORDINATE_PROJECTION)
          .digest("hex"),
      },
    ]);
    expect(claim.anchor).toEqual(claim.evidence[2]!.anchor);
    expect(JSON.stringify(claim)).not.toMatch(/gross_to_net|conversion|estimated/i);
  });

  test("applies a leap-February monthly period only at its UTC month end", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const entry = incomeEntry({
      registryBytes: mutateFixture("salary-registry.json", (text) => text
        .replaceAll("maj 2026", "februar 2028")
        .replace('"objavljeno": "2026-07-28"', '"objavljeno": "2028-02-01"')),
      detailsBytes: mutateFixture("salary-details.json", (text) =>
        text.replaceAll("maj 2026", "februar 2028")),
      metadataBytes: mutateFixture("sistat-metadata.json", (text) =>
        text.replaceAll("2026M05", "2028M02")),
      seriesBytes: mutateFixture("sistat-series.json", (text) =>
        text.replaceAll("2026M05", "2028M02")),
    });

    const [beforeMonthEnd, atMonthEnd] = await Promise.all([
      sloveniaPlan.validate(entry, "2028-02-28"),
      sloveniaPlan.validate(entry, "2028-02-29"),
    ]);

    expect(beforeMonthEnd).toEqual({ ok: false, kind: "semantic_mismatch" });
    expect(atMonthEnd.ok).toBe(true);
    if (!atMonthEnd.ok) throw new Error("leap-February fixture must validate at month end");
    expect(atMonthEnd.claims[0]?.value).toEqual({
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "3361.60",
      period: "2028M02",
    });
  });

  test("rejects an invalid assessment calendar date", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const entry = incomeEntry({
      registryBytes: mutateFixture("salary-registry.json", (text) => text
        .replaceAll("maj 2026", "februar 2028")
        .replace('"objavljeno": "2026-07-28"', '"objavljeno": "2028-02-01"')),
      detailsBytes: mutateFixture("salary-details.json", (text) =>
        text.replaceAll("maj 2026", "februar 2028")),
      metadataBytes: mutateFixture("sistat-metadata.json", (text) =>
        text.replaceAll("2026M05", "2028M02")),
      seriesBytes: mutateFixture("sistat-series.json", (text) =>
        text.replaceAll("2026M05", "2028M02")),
    });

    const result = await sloveniaPlan.validate(entry, "2028-02-30");

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("derives a changed matching official value instead of remembering salary", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(incomeEntry({
      detailsBytes: changedSalaryDetails("1.700,00"),
      seriesBytes: changedSeriesValue(1700),
    }), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("mutated income fixture must validate");
    expect(result.claims[0]?.value).toEqual({
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "3400.00",
      period: "2026M05",
    });
  });

  test("uses declared dimension order for a nondegenerate row-major coordinate", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(
      incomeEntry(reorderedIncomeEntryOptions()),
      ASSESSMENT_DATE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("reordered JSON-stat2 fixture must validate");
    expect(result.claims[0]?.value).toEqual({
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "3469.12",
      period: "2026M06",
    });
    if (!("evidence" in result.claims[0]!)) throw new Error("income claim must carry evidence");
    expect(result.claims[0]!.evidence.at(-1)?.anchor).toEqual({
      artifactId: expect.stringContaining("sistat-series"),
      locator: "H285S.px series > 2026M06 > Net earnings",
      excerptSha256: createHash("sha256").update(JSON.stringify({
        coordinate: { "PLAČE": "2", ENOTA: "EUR", MESEC: "2026M06" },
        value: 1734.56,
      })).digest("hex"),
    });
  });

  test("rejects a multi-valued unselected JSON-stat2 dimension as ambiguous", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const options = reorderedIncomeEntryOptions();
    const metadata = JSON.parse(new TextDecoder().decode(options.metadataBytes)) as SiStatMetadataFixture;
    const series = JSON.parse(new TextDecoder().decode(options.seriesBytes)) as SiStatSeriesFixture;
    metadata.variables[1]!.values.push("INDEX");
    metadata.variables[1]!.valueTexts.push("Index");
    series.size[1] = 2;
    series.dimension.ENOTA!.category.index.INDEX = 1;
    series.dimension.ENOTA!.category.label.INDEX = "Index";
    series.value = new Array<number | null>(24).fill(null);
    series.value[8] = 1734.56;

    const result = await sloveniaPlan.validate(incomeEntry({
      ...options,
      metadataBytes: jsonBytes(metadata),
      seriesBytes: jsonBytes(series),
    }), ASSESSMENT_DATE);

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test.each([
    { name: "only PISRS changes", options: { detailsBytes: changedSalaryDetails("1.700,00") } },
    { name: "only SiStat changes", options: { seriesBytes: changedSeriesValue(1700) } },
  ])("rejects remembered-value drift when $name", async ({ options }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(incomeEntry(options), ASSESSMENT_DATE);

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test("accepts a coherent alternate candidate-derived SOP identity", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const alternateSop = "2026-02-2000";
    const publicationUrl = `https://pisrs.si/pregledPredpisa?sop=${alternateSop}`;
    const registryUrl = `https://pisrs.si/api/rezultat/zbirka/sop/${alternateSop}`;
    const registryBytes = mutateFixture("salary-registry.json", (text) =>
      text.replace("2026-01-1950", alternateSop));

    const result = await sloveniaPlan.validate(incomeEntry({
      publicationUrl,
      registryUrl,
      registryBytes,
    }), ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("alternate SOP fixture must validate");
    const claim = result.claims[0]!;
    if (!("evidence" in claim)) throw new Error("income claim must carry evidence");
    expect(claim.evidence[0]).toMatchObject({
      navigationUrl: SLOVENIA_CAPTURE_FIXTURES["salary-details"].url,
      anchor: { locator: `PISRS salary publication ${alternateSop} > monthly net salary 2026M05` },
    });
  });

  test.each([
    {
      name: "candidate SOP disagrees with registry identity",
      options: (): IncomeEntryOptions => ({
        publicationUrl: "https://pisrs.si/pregledPredpisa?sop=2026-02-2000",
        registryUrl: "https://pisrs.si/api/rezultat/zbirka/sop/2026-02-2000",
      }),
    },
    {
      name: "registry publication is after the assessment cutoff",
      options: (): IncomeEntryOptions => ({
        registryBytes: mutateFixture("salary-registry.json", (text) =>
          text.replace('"objavljeno": "2026-07-28"', '"objavljeno": "2026-08-12"')),
      }),
    },
    {
      name: "Net earnings category is missing",
      options: (): IncomeEntryOptions => ({
        metadataBytes: mutateFixture("sistat-metadata.json", (text) =>
          text.replace('"Net earnings"', '"Take-home earnings"')),
      }),
    },
    {
      name: "Net earnings category is duplicated",
      options: (): IncomeEntryOptions => ({
        metadataBytes: mutateFixture("sistat-metadata.json", (text) =>
          text.replace('"Gross earnings"', '"Net earnings"')),
      }),
    },
    {
      name: "category index is duplicate and misaligned",
      options: (): IncomeEntryOptions => ({
        seriesBytes: mutateJsonFixture<SiStatSeriesFixture>("sistat-series.json", (series) => {
          series.dimension["PLAČE"]!.category.index["2"] = 0;
        }),
      }),
    },
    {
      name: "series source is missing",
      options: (): IncomeEntryOptions => ({
        seriesBytes: mutateJsonFixture<SiStatSeriesFixture>("sistat-series.json", (series) => {
          delete series.source;
        }),
      }),
    },
    {
      name: "series source is empty",
      options: (): IncomeEntryOptions => ({
        seriesBytes: mutateJsonFixture<SiStatSeriesFixture>("sistat-series.json", (series) => {
          series.source = "";
        }),
      }),
    },
    {
      name: "series request method is not POST",
      options: (): IncomeEntryOptions => ({ seriesMethod: "GET" }),
    },
    {
      name: "series request URL is not the metadata API URL",
      options: (): IncomeEntryOptions => ({ seriesRequestUrl: `${SISTAT_API_URL}?wrong=1` }),
    },
    {
      name: "series final URL is not the metadata API URL",
      options: (): IncomeEntryOptions => ({ seriesResponseUrl: `${SISTAT_API_URL}?wrong=1` }),
    },
    {
      name: "series body hash differs from the re-encoded all-dimensions query",
      options: (): IncomeEntryOptions => ({ seriesBodySha256: "f".repeat(64) }),
    },
    {
      name: "only future periods exist",
      options: (): IncomeEntryOptions => ({
        metadataBytes: mutateFixture("sistat-metadata.json", (text) =>
          text.replaceAll("2026M05", "2027M05")),
        seriesBytes: mutateFixture("sistat-series.json", (text) =>
          text.replaceAll("2026M05", "2027M05")),
      }),
    },
    {
      name: "PISRS and SiStat periods disagree",
      options: (): IncomeEntryOptions => ({
        registryBytes: mutateFixture("salary-registry.json", (text) =>
          text.replaceAll("maj 2026", "april 2026")),
        detailsBytes: mutateFixture("salary-details.json", (text) =>
          text.replaceAll("maj 2026", "april 2026")),
      }),
    },
  ])("rejects the complete official income claim when $name", async ({ options }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(incomeEntry(options()), ASSESSMENT_DATE);

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

interface CompanionEntryOptions {
  readonly essBytes?: Uint8Array;
  readonly registryBytes?: Uint8Array;
  readonly detailsBytes?: Uint8Array;
}

function companionEntry(options: CompanionEntryOptions = {}): ParserEntry<SloveniaSourceId> {
  const artifacts = [
    fixtureArtifact(
      "si-companion-employment",
      "ess-companion-page",
      "companion-ess.html",
      SLOVENIA_CANDIDATES[4]!.url,
    ),
    fixtureArtifact(
      "si-companion-employment",
      "zzsdt-registry",
      "zzsdt-registry.json",
      SLOVENIA_CAPTURE_FIXTURES["zzsdt-registry"].url,
      "application/json",
    ),
    fixtureArtifact(
      "si-companion-employment",
      "zzsdt-details",
      "zzsdt-details.json",
      SLOVENIA_CAPTURE_FIXTURES["zzsdt-details"].url,
      "application/json",
    ),
  ];
  return {
    sourceId: "si-companion-employment",
    navigationUrl: SLOVENIA_CANDIDATES[4]!.url,
    resolvedEvidenceUrl: SLOVENIA_CAPTURE_FIXTURES["zzsdt-details"].url,
    artifacts: artifacts.map((artifactValue, index) => {
      const bytes = [options.essBytes, options.registryBytes, options.detailsBytes][index];
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
  test("emits one narrow conditional work claim from native ESS and current ZZSDT evidence", async () => {
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
      sourcePeriod: "ZAKO6655:NPB 8",
      validatorVersion: "si-companion@2",
      status: "verified",
    });
    if (!("evidence" in claim)) throw new Error("companion claim must carry evidence");
    expect(claim.evidence).toHaveLength(2);
    expect(claim.evidence.map(({ anchor: value }) => value.locator)).toEqual([
      "ESS conditional employment procedure",
      "PISRS ZAKO6655 NPB 8 > 32.–33. člen > conditional employment procedure",
    ]);
    expect(claim.evidence.every(({ anchor: value }) => value.excerptSha256.length === 64)).toBe(true);
    expect(claim.anchor).toEqual(claim.evidence.at(-1)!.anchor);
    expect(JSON.stringify(claim)).not.toMatch(/automatic|foreign_company_remote_work/i);
  });

  test("keeps companion locators and excerpt hashes stable after unrelated insertions", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const essBytes = mutateFixture("companion-ess.html", (text) => text.replace(
      "<h1>Zaposlitev tujcev z dovoljenjem za prebivanje</h1>",
      "<h1>Zaposlitev tujcev z dovoljenjem za prebivanje</h1><p>Neodvisno obvestilo.</p>",
    ));
    const detailsBytes = mutateJsonFixture<PisrsDetailsFixture>(
      "zzsdt-details.json",
      (details) => details.data.besedilo.unshift({
        id: 422791300,
        struktura: "opomba",
        vsebina: "Neodvisna redakcijska opomba.",
        navezavaNPB: null,
      }),
    );

    const [baseline, changed] = await Promise.all([
      sloveniaPlan.validate(companionEntry(), ASSESSMENT_DATE),
      sloveniaPlan.validate(companionEntry({ essBytes, detailsBytes }), ASSESSMENT_DATE),
    ]);

    expect(baseline.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!baseline.ok || !changed.ok) throw new Error("companion fixtures must validate");
    const anchors = (claims: typeof baseline.claims) => claims.flatMap((claim) => {
      if (!("evidence" in claim)) throw new Error("companion claim must carry evidence");
      return claim.evidence.map(({ anchor: { locator, excerptSha256 } }) => ({ locator, excerptSha256 }));
    });
    expect(anchors(changed.claims)).toEqual(anchors(baseline.claims));
  });

  test("rejects rather than silently changing evidence when an Article 33 sentence changes", async () => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });
    const detailsBytes = mutateFixture("zzsdt-details.json", (text) => text.replace(
      "zavod v petih delovnih dneh",
      "zavod v šestih delovnih dneh",
    ));

    const result = await sloveniaPlan.validate(
      companionEntry({ detailsBytes }),
      ASSESSMENT_DATE,
    );

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });

  test.each([
    {
      name: "Article 33 precedes Article 32",
      options: (): CompanionEntryOptions => ({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("zzsdt-details.json", (details) => {
          const article33Index = details.data.besedilo.findIndex(
            ({ struktura, vsebina }) => struktura === "clen" && vsebina === "33. člen",
          );
          if (article33Index < 0) throw new Error("fixture must contain Article 33");
          details.data.besedilo = [
            ...details.data.besedilo.slice(article33Index),
            ...details.data.besedilo.slice(0, article33Index),
          ];
        }),
      }),
    },
    {
      name: "information-sheet paragraph is removed",
      options: (): CompanionEntryOptions => ({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("zzsdt-details.json", (details) => {
          details.data.besedilo = details.data.besedilo.filter(
            ({ id }) => id !== 422791330,
          );
        }),
      }),
    },
    {
      name: "ESS says no labour-market check",
      options: (): CompanionEntryOptions => ({
        essBytes: mutateFixture("companion-ess.html", (text) => text.replace(
          "3. Na Zavodu preverimo trg dela.",
          "3. Na Zavodu ne preverimo trga dela.",
        )),
      }),
    },
  ])("rejects the whole companion claim for $name", async ({ options }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(
      companionEntry(options()),
      ASSESSMENT_DATE,
    );

    expect(result).toEqual({ ok: false, kind: "semantic_mismatch" });
  });
});

describe("Slovenia native PISRS TOC binding", () => {
  test.each([
    {
      source: "route",
      mutation: "duplicate target TOC entry with conflicting bounds",
      entry: () => routeEntry({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("ztuj2-details.json", (details) => {
          details.data.kazalo.push({
            idStrukturniElement: 358812008,
            idStrukturniElementPostavljeno: 358812031,
            kazaloIme: "51.a člen (dovoljenje za začasno prebivanje za digitalnega nomada)",
            struktura: "clen",
          });
        }),
      }),
    },
    {
      source: "route",
      mutation: "swapped required TOC order",
      entry: () => routeEntry({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("ztuj2-details.json", (details) => {
          details.data.kazalo.reverse();
        }),
      }),
    },
    {
      source: "companion",
      mutation: "duplicate target TOC entry with conflicting bounds",
      entry: () => companionEntry({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("zzsdt-details.json", (details) => {
          details.data.kazalo.push({
            idStrukturniElement: 422791327,
            idStrukturniElementPostavljeno: 422791336,
            kazaloIme: "32. člen (splošna določba)",
            struktura: "clen",
          });
        }),
      }),
    },
    {
      source: "companion",
      mutation: "swapped required TOC order",
      entry: () => companionEntry({
        detailsBytes: mutateJsonFixture<PisrsDetailsFixture>("zzsdt-details.json", (details) => {
          details.data.kazalo.reverse();
        }),
      }),
    },
  ])("rejects $source evidence for $mutation", async ({ entry }) => {
    const { plan: sloveniaPlan } = createSloveniaResearch({ candidates: SLOVENIA_CANDIDATES });

    const result = await sloveniaPlan.validate(entry(), ASSESSMENT_DATE);

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
