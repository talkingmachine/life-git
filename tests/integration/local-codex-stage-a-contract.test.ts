import { describe, expect, test, vi } from "vitest";

import {
  evaluateDiscoveryFixture,
  evaluateOnboardingFixture,
  parseDiscoveryFixture,
  parseLocalCodexStageAArgs,
  parseOnboardingFixture,
  runLocalCodexStageA,
} from "../../evals/local-codex-stage-a";
import { createOnboardingSession } from "../../src/decision/onboarding-session";
import { projectQuestionnaireForModel } from "../../src/decision/onboarding-model-contract";

const onboardingFixture = {
  message: { messageId: "00000000-0000-4000-8000-000000000081", role: "user", text: "Я живу в Москве." },
  expected: {
    schemaVersion: "onboarding-model-output@1",
    proposals: [{ fieldId: "current_location", typedValue: { countryCode: "RU", city: "Москва" }, messageId: "00000000-0000-4000-8000-000000000081", sourceSpan: { start: 7, end: 15 }, text: "в Москве" }],
    nextQuestion: "Какой у вас бюджет?",
  },
};

const discoveryFixture = {
  schemaVersion: "official-source-discovery-request@1",
  entity: { entityId: "city-belgrade", kind: "city", countryCode: "RS", displayName: "Belgrade" },
  fact: { factKey: "urban-transit", definitionId: "urban-transit@1", description: "Public municipal transport information" },
  failedSource: { url: "https://www.beograd.rs/", reason: "stale" },
  authorityRoots: [{ publisherName: "City of Belgrade", url: "https://www.beograd.rs/" }],
  localeHints: ["en", "sr"], round: 1, candidateLimit: 5, candidatesUntrusted: true,
};

describe("local Codex Stage A gate", () => {
  test("requires explicit live opt-in before any dependency or artifact write", async () => {
    const writeArtifact = vi.fn(async () => undefined);
    const runtime = vi.fn(async () => { throw new Error("must not run"); });

    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs([]), {
      initializeRuntime: runtime,
      writeArtifact,
      now: () => 1,
    })).resolves.toEqual({ exitCode: 1, stderr: "local_codex_live_opt_in_required\n" });
    expect(runtime).not.toHaveBeenCalled();
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  test("writes only the sanitized Stage A artifact from deterministic dependencies", async () => {
    const writeArtifact = vi.fn(async () => undefined);
    const result = await runLocalCodexStageA(parseLocalCodexStageAArgs([
      "--live-local-subscription", "--artifact", "data/evals/local-codex-stage-a/result.json",
    ]), {
      initializeRuntime: async () => ({
        cliVersion: "codex-cli 0.149.0-alpha.4",
        protocolVersion: "codex-cli-protocol@2",
        compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1",
        model: "gpt-5.6-terra",
        noToolProbe: { passed: true, webSearchCount: 0 },
        discoveryProbe: { passed: true, webSearchCount: 1 },
      }),
      runOnboarding: async () => ({ guardedProposalCount: 4, inventedValueCount: 0 }),
      runDiscovery: async () => ({ candidateCount: 1, allCandidatesUntrusted: true }),
      measureConcurrency: async (requested) => ({ requested, completed: requested, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1_000_000, effectiveCeiling: 5 }),
      proveAbort: async () => ({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true }),
      prepareArtifact: async () => undefined,
      cleanupArtifact: async () => undefined,
      writeArtifact,
      now: () => 1,
    });

    expect(result).toEqual({ exitCode: 0, stderr: "" });
    expect(writeArtifact).toHaveBeenCalledWith("data/evals/local-codex-stage-a/result.json", {
      schemaVersion: "local-codex-stage-a@1",
      cliVersion: "codex-cli 0.149.0-alpha.4",
      protocolVersion: "codex-cli-protocol@2",
      compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1",
      model: "gpt-5.6-terra",
      effortsProven: ["low", "medium"],
      noToolProbe: { passed: true, webSearchCount: 0 },
      discoveryProbe: { passed: true, webSearchCount: 1 },
      onboarding: { guardedProposalCount: 4, inventedValueCount: 0 },
      discovery: { candidateCount: 1, allCandidatesUntrusted: true },
      concurrency: { requested: [1, 2, 5], completed: [1, 2, 5], crossJobLeakage: false, measurements: [
        { requested: 1, completed: 1, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1_000_000, effectiveCeiling: 5 },
        { requested: 2, completed: 2, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1_000_000, effectiveCeiling: 5 },
        { requested: 5, completed: 5, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1_000_000, effectiveCeiling: 5 },
      ] },
      abort: { processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true },
    });
  });

  test("fails closed when an abort proof lacks terminal leader evidence", async () => {
    const base = deterministicDependencies();
    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs(["--live-local-subscription"]), {
      ...base,
      proveAbort: async () => ({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: false }),
    })).rejects.toThrow("local_codex_stage_a_invalid_proof");
  });

  test("fails closed for backwards or unbounded concurrency measurements", async () => {
    const base = deterministicDependencies();
    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs(["--live-local-subscription"]), {
      ...base,
      measureConcurrency: async (requested) => ({ requested, completed: requested, elapsedMs: -1, p95Ms: 1, throughputMilliJobsPerSecond: 1, effectiveCeiling: 5 }),
    })).rejects.toThrow("local_codex_stage_a_invalid_proof");
  });

  test("removes stale output before runtime and cleans it on a later failure through owned filesystem seams", async () => {
    const order: string[] = [];
    const base = deterministicDependencies();
    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs(["--live-local-subscription"]), {
      ...base,
      prepareArtifact: async () => { order.push("prepare"); },
      initializeRuntime: async () => { order.push("runtime"); throw new Error("broken"); },
      cleanupArtifact: async () => { order.push("cleanup"); },
    })).rejects.toThrow("broken");
    expect(order).toEqual(["prepare", "runtime", "cleanup"]);
  });

  test("rejects hostile onboarding fixtures before invoking the model", async () => {
    const malicious = structuredClone(onboardingFixture) as Record<string, unknown>;
    Object.defineProperty((malicious.expected as Record<string, unknown>).proposals as object, "0", {
      enumerable: true, get: () => onboardingFixture.expected.proposals[0],
    });
    const extract = vi.fn();
    expect(() => parseOnboardingFixture(malicious)).toThrow("local_codex_stage_a_invalid_fixture");
    expect(extract).not.toHaveBeenCalled();
  });

  test("accepts recursively null-prototype JSON data but rejects a proxy, symbol and sparse array", () => {
    const nullPrototype = toNullPrototype(onboardingFixture);
    expect(parseOnboardingFixture(nullPrototype).expected.proposals).toHaveLength(1);
    expect(() => parseOnboardingFixture(new Proxy(onboardingFixture, {}))).toThrow("local_codex_stage_a_invalid_fixture");
    const symbolic = structuredClone(onboardingFixture) as Record<string | symbol, unknown>;
    symbolic[Symbol("fixture")] = true;
    expect(() => parseOnboardingFixture(symbolic)).toThrow("local_codex_stage_a_invalid_fixture");
    const sparse = structuredClone(discoveryFixture) as Record<string, unknown>;
    sparse.localeHints = new Array(1);
    expect(() => parseDiscoveryFixture(sparse)).toThrow("local_codex_stage_a_invalid_fixture");
  });

  test("calls the onboarding port with the canonical projection and rejects an exact-looking duplicate slice", async () => {
    const fixture = parseOnboardingFixture(onboardingFixture);
    const extract = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
      schemaVersion: "onboarding-model-output@1",
      proposals: [{ fieldId: "current_location", typedValue: { countryCode: "RU", city: "Москва" }, messageId: onboardingFixture.message.messageId, sourceSpan: { start: 0, end: 8 } }],
      nextQuestion: onboardingFixture.expected.nextQuestion,
    }));
    await expect(evaluateOnboardingFixture(fixture, { extract })).rejects.toThrow("local_codex_stage_a_onboarding_invalid");
    expect(extract).toHaveBeenCalledTimes(1);
    const input = extract.mock.calls[0]![0] as { questionnaire: unknown; message: unknown };
    expect(input.message).toEqual(onboardingFixture.message);
    expect(input.questionnaire).toEqual(projectQuestionnaireForModel(createOnboardingSession({
      nextParticipantId: () => "00000000-0000-4000-8000-000000000001",
      nextCompletionCommandId: () => "00000000-0000-4000-8000-000000000002",
    })));
  });

  test("rejects a malformed discovery fixture before calling the discovery port", async () => {
    const malformed = { ...discoveryFixture, authorityRoots: ["not-an-authority"] };
    const discover = vi.fn();
    expect(() => parseDiscoveryFixture(malformed)).toThrow("local_codex_stage_a_invalid_fixture");
    expect(discover).not.toHaveBeenCalled();
  });

  test("requires exact discovery metadata and bounded untrusted candidates", async () => {
    const fixture = parseDiscoveryFixture(discoveryFixture);
    const discover = vi.fn(async () => ({
      candidates: [{ url: "https://www.beograd.rs/transport/", claimedPublisher: "City", expectedCoverage: "Transit", rationale: "Official" }],
      metadata: { invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2", compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1", cliVersion: "codex-cli 0.149.0-alpha.4", model: "gpt-5.6-terra", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@1", templateVersion: "wrong", schemaVersion: "official-source-candidates@1" },
    }));
    await expect(evaluateDiscoveryFixture(fixture, { discover })).rejects.toThrow("local_codex_stage_a_discovery_invalid");
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

function deterministicDependencies() {
  return {
    initializeRuntime: async () => ({ cliVersion: "codex-cli 0.149.0-alpha.4", protocolVersion: "codex-cli-protocol@2" as const, compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1" as const, model: "gpt-5.6-terra" as const, noToolProbe: { passed: true as const, webSearchCount: 0 }, discoveryProbe: { passed: true as const, webSearchCount: 1 } }),
    runOnboarding: async () => ({ guardedProposalCount: 4, inventedValueCount: 0 }),
    runDiscovery: async () => ({ candidateCount: 1, allCandidatesUntrusted: true as const }),
    measureConcurrency: async (requested: 1 | 2 | 5) => ({ requested, completed: requested, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1, effectiveCeiling: 5 as const }),
    proveAbort: async () => ({ processGroupTerminated: true as const, lateResultAccepted: false as const, waiterRejected: true as const, leaderTerminalObserved: true as const }),
    prepareArtifact: async () => undefined,
    cleanupArtifact: async () => undefined,
    writeArtifact: async () => undefined,
    now: () => 1,
  };
}

function toNullPrototype(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toNullPrototype);
  if (value !== null && typeof value === "object") return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toNullPrototype(nested)])));
  return value;
}
