import { describe, expect, test, vi } from "vitest";
import { link, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  evaluateDiscoveryFixture,
  evaluateOnboardingFixture,
  parseDiscoveryFixture,
  parseLocalCodexStageAArgs,
  parseOnboardingFixture,
  createStageAArtifactStore,
  proveStageAAbort,
  readOnboardingFixture,
  runLocalCodexStageA,
  assertGuardedFixtureProposals,
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
  test("uses provider-compatible typed single-value enums in every live synthetic schema", async () => {
    const [runtime, stageA] = await Promise.all([
      readFile(resolve(process.cwd(), "src/infrastructure/codex-cli/runtime.ts"), "utf8"),
      readFile(resolve(process.cwd(), "evals/local-codex-stage-a.ts"), "utf8"),
    ]);
    expect(runtime).not.toContain("const:");
    expect(stageA).not.toContain("const:");
    expect(runtime).toContain('schemaVersion: { type: "string", enum: ["codex-runtime-smoke@2"] }');
    expect(runtime).toContain('status: { type: "string", enum: ["ok"] }');
    expect(stageA).toContain('ok: { type: "boolean", enum: [true] }');
    expect(stageA).toContain('jobId: { type: "string", enum: [id] }');
  });

  test("accepts exactly one leading pnpm separator and preserves passive no-flag parsing", async () => {
    expect(parseLocalCodexStageAArgs(["--", "--live-local-subscription", "--artifact", "data/evals/local-codex-stage-a/result.json"]))
      .toEqual({ live: true, artifactPath: "data/evals/local-codex-stage-a/result.json" });
    expect(parseLocalCodexStageAArgs(["--"])).toEqual({ live: false, artifactPath: "data/evals/local-codex-stage-a/result.json" });
    expect(() => parseLocalCodexStageAArgs(["--live-local-subscription", "--"])).toThrow("local_codex_stage_a_invalid_arguments");
    expect(() => parseLocalCodexStageAArgs(["--", "--"])).toThrow("local_codex_stage_a_invalid_arguments");
  });

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
      measureConcurrency: async (requested) => ({ requested, completed: requested, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: requested * 1_000_000, effectiveCeiling: 5 }),
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
        { requested: 2, completed: 2, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 2_000_000, effectiveCeiling: 5 },
        { requested: 5, completed: 5, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 5_000_000, effectiveCeiling: 5 },
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

  test("rejects internally inconsistent bounded measurement claims", async () => {
    const base = deterministicDependencies();
    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs(["--live-local-subscription"]), {
      ...base,
      measureConcurrency: async (requested) => ({ requested, completed: requested, elapsedMs: 10, p95Ms: 11, throughputMilliJobsPerSecond: requested * 100_000, effectiveCeiling: 5 }),
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

  test("uses a production monotonic clock when every subscription dependency is faked", async () => {
    const { now: _ignored, ...withoutClock } = deterministicDependencies();
    void _ignored;
    await expect(runLocalCodexStageA(parseLocalCodexStageAArgs(["--live-local-subscription"]), withoutClock)).resolves.toEqual({ exitCode: 0, stderr: "" });
  });

  test("artifact store rejects lexical aliases and symlinked parents without outside mutation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "stage-a-store-"));
    const outside = await mkdtemp(resolve(tmpdir(), "stage-a-outside-"));
    const store = createStageAArtifactStore({ workspaceRoot: root, randomId: () => "fixed" });
    await expect(store.prepare("../data/evals/local-codex-stage-a/result.json")).rejects.toThrow("local_codex_stage_a_invalid_artifact_path");
    await expect(store.prepare("data/evals/local-codex-stage-a/result.json\0suffix")).rejects.toThrow("local_codex_stage_a_invalid_artifact_path");
    await mkdir(resolve(root, "data/evals"), { recursive: true });
    await symlink(outside, resolve(root, "data/evals/local-codex-stage-a"));
    const outsideResult = resolve(outside, "result.json");
    await writeFile(outsideResult, "protected", { mode: 0o600 });
    await expect(store.prepare("data/evals/local-codex-stage-a/result.json")).rejects.toThrow("local_codex_stage_a_invalid_artifact_path");
    expect(await readFile(outsideResult, "utf8")).toBe("protected");
    expect((await lstat(outsideResult)).mode & 0o777).toBe(0o600);
  });

  test("artifact store removes a stale regular final only through prepare", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "stage-a-store-"));
    const target = resolve(root, "data/evals/local-codex-stage-a/result.json");
    await mkdir(resolve(root, "data/evals/local-codex-stage-a"), { recursive: true });
    await writeFile(target, "stale", { mode: 0o600 });
    await createStageAArtifactStore({ workspaceRoot: root }).prepare("data/evals/local-codex-stage-a/result.json");
    await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("artifact store rejects a hardlinked final without altering its peer", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "stage-a-store-"));
    const directory = resolve(root, "data/evals/local-codex-stage-a");
    const target = resolve(directory, "result.json");
    const peer = resolve(root, "protected-input.json");
    await mkdir(directory, { recursive: true });
    await writeFile(peer, "peer-bytes", { mode: 0o600 });
    await link(peer, target);
    await expect(createStageAArtifactStore({ workspaceRoot: root }).prepare("data/evals/local-codex-stage-a/result.json")).rejects.toThrow("local_codex_stage_a_invalid_artifact_path");
    expect(await readFile(peer, "utf8")).toBe("peer-bytes");
    expect((await lstat(peer)).mode & 0o777).toBe(0o600);
  });

  test("artifact store writes atomically at mode 0600 and collision cleanup preserves unrelated files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "stage-a-store-"));
    const directory = resolve(root, "data/evals/local-codex-stage-a");
    const path = "data/evals/local-codex-stage-a/result.json";
    const store = createStageAArtifactStore({ workspaceRoot: root, randomId: () => "unique" });
    await store.write(path, validArtifact());
    const target = resolve(directory, "result.json");
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({ schemaVersion: "local-codex-stage-a@1" });
    const collision = resolve(directory, ".local-codex-stage-a-fixed.tmp");
    await writeFile(collision, "unrelated", { mode: 0o600 });
    await expect(createStageAArtifactStore({ workspaceRoot: root, randomId: () => "fixed" }).write(path, validArtifact())).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(collision, "utf8")).toBe("unrelated");
  });

  test("abort proof requires admission, exact waiter reason, terminal handoff, then successor", async () => {
    let active = 0;
    const calls: string[] = [];
    const adapter = {
      runtimeDiagnostics: () => Object.freeze({ activeLeaders: active, queuedFlights: 0, effectiveCeiling: 5 as const }),
      invokeJson: (input: { templateVersion: string; signal: AbortSignal }) => {
        calls.push(input.templateVersion);
        if (input.templateVersion === "stage-a-abort@1") {
          active = 1;
          return new Promise<Readonly<{ value: unknown }>>((_, reject) => input.signal.addEventListener("abort", () => { active = 0; reject(input.signal.reason); }, { once: true }));
        }
        expect(active).toBe(0);
        return Promise.resolve(Object.freeze({ value: Object.freeze({ ok: true }) }));
      },
    };
    const wait = async (predicate: () => boolean) => { if (!predicate()) throw new TypeError("timeout"); };
    await expect(proveStageAAbort(adapter, wait)).resolves.toEqual({ processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true });
    expect(calls).toEqual(["stage-a-abort@1", "stage-a-abort-successor@1"]);
  });

  test("abort proof fails if admission is not observed or original result resolves late", async () => {
    const idleAdapter = { runtimeDiagnostics: () => Object.freeze({ activeLeaders: 0, queuedFlights: 0, effectiveCeiling: 5 as const }), invokeJson: async () => Object.freeze({ value: Object.freeze({ ok: true }) }) };
    await expect(proveStageAAbort(idleAdapter, async () => { throw new TypeError("timeout"); })).rejects.toThrow("timeout");
    let active = 0;
    const lateAdapter = { runtimeDiagnostics: () => Object.freeze({ activeLeaders: active, queuedFlights: 0, effectiveCeiling: 5 as const }), invokeJson: async () => { active = 1; return Object.freeze({ value: Object.freeze({ ok: true }) }); } };
    await expect(proveStageAAbort(lateAdapter, async () => undefined)).rejects.toThrow("local_codex_stage_a_late_result");
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

  test("rejects a same-count guarded projection with one altered normalized value", async () => {
    const fixture = await readOnboardingFixture();
    const guarded = fixture.expected.proposals.map((proposal) => proposal.fieldId === "current_location"
      ? { kind: "non_participant_field", fieldId: proposal.fieldId, normalizedValue: { countryCode: "RU", city: "Тверь" } }
      : proposal.fieldId === "participants"
        ? { kind: "participant_roster", roster: proposal.typedValue }
        : proposal.fieldId.startsWith("participants.")
          ? participantGuardedProposal(proposal)
          : { kind: "non_participant_field", fieldId: proposal.fieldId, normalizedValue: proposal.typedValue });
    expect(guarded).toHaveLength(fixture.expected.proposals.length);
    expect(() => assertGuardedFixtureProposals(fixture, guarded)).toThrow("local_codex_stage_a_onboarding_invalid");
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
    measureConcurrency: async (requested: 1 | 2 | 5) => ({ requested, completed: requested, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: requested * 1_000_000, effectiveCeiling: 5 as const }),
    proveAbort: async () => ({ processGroupTerminated: true as const, lateResultAccepted: false as const, waiterRejected: true as const, leaderTerminalObserved: true as const }),
    prepareArtifact: async () => undefined,
    cleanupArtifact: async () => undefined,
    writeArtifact: async () => undefined,
    now: () => 1,
  };
}

function validArtifact(): Parameters<ReturnType<typeof createStageAArtifactStore>["write"]>[1] {
  return {
    schemaVersion: "local-codex-stage-a@1", cliVersion: "codex-cli 0.149.0-alpha.4", protocolVersion: "codex-cli-protocol@2", compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@1", model: "gpt-5.6-terra", effortsProven: ["low", "medium"],
    noToolProbe: { passed: true, webSearchCount: 0 }, discoveryProbe: { passed: true, webSearchCount: 1 }, onboarding: { guardedProposalCount: 4, inventedValueCount: 0 }, discovery: { candidateCount: 1, allCandidatesUntrusted: true },
    concurrency: { requested: [1, 2, 5], completed: [1, 2, 5], crossJobLeakage: false, measurements: [
      { requested: 1, completed: 1, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 1_000_000, effectiveCeiling: 5 },
      { requested: 2, completed: 2, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 2_000_000, effectiveCeiling: 5 },
      { requested: 5, completed: 5, elapsedMs: 1, p95Ms: 1, throughputMilliJobsPerSecond: 5_000_000, effectiveCeiling: 5 },
    ] }, abort: { processGroupTerminated: true, lateResultAccepted: false, waiterRejected: true, leaderTerminalObserved: true },
  };
}

function toNullPrototype(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toNullPrototype);
  if (value !== null && typeof value === "object") return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toNullPrototype(nested)])));
  return value;
}

function participantGuardedProposal(proposal: { readonly fieldId: string; readonly typedValue: unknown }) {
  const match = /^participants\.(self|companion\.\d+)\.([a-z_]+)$/.exec(proposal.fieldId);
  if (match === null) throw new Error("invalid test fixture");
  return { kind: "participant_leaf", descriptor: match[1]!, leafId: match[2]!, normalizedValue: proposal.typedValue };
}
