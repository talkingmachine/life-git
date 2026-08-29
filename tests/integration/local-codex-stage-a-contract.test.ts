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
  runLocalCodexStageAEntrypoint,
  assertGuardedFixtureProposals,
  initializeReviewedStageARuntimeForTest,
} from "../../evals/local-codex-stage-a";
import { CodexRuntimeError } from "../../src/infrastructure/codex-cli/contracts";
import { OnboardingModelError, type OnboardingModelErrorCode } from "../../src/application/onboarding-contracts";
import { REVIEWED_CODEX_EXECUTABLE } from "../../src/infrastructure/codex-cli/reviewed-installation";
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
  test("reports an exact reviewed-installation mismatch without registration, subscription, or artifact write", async () => {
    const registerRuntime = vi.fn(async () => undefined);
    const consumeSubscription = vi.fn(async () => deterministicDependencies().initializeRuntime());
    const writeArtifact = vi.fn(async () => undefined);
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription"], {
      ...deterministicDependencies(),
      initializeRuntime: () => initializeReviewedStageARuntimeForTest({
        executableOverride: undefined,
        verifyInstallation: async () => { throw new CodexRuntimeError("codex_version_mismatch"); },
        registerRuntime,
        consumeSubscription,
      }),
      writeArtifact,
    });

    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:codex_version_mismatch\n" });
    expect(registerRuntime).not.toHaveBeenCalled();
    expect(consumeSubscription).not.toHaveBeenCalled();
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  test("never leaks unrelated failure text through the CLI wrapper", async () => {
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription"], {
      ...deterministicDependencies(),
      initializeRuntime: async () => { throw new Error("/private/path token=secret deliberate trap"); },
    });
    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed\n" });
  });

  test.each([
    ["prepare_artifact", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, prepareArtifact: async () => { throw new Error("prompt=https://secret.example/id token=credential"); } })],
    ["initialize_runtime", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, initializeRuntime: async () => { throw new CodexRuntimeError("codex_not_authenticated"); } })],
    ["onboarding", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, runOnboarding: async () => { throw new Error("model response: secret"); } })],
    ["discovery", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, runDiscovery: async () => { throw new Error("https://secret.example/search"); } })],
    ["concurrency_1", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, measureConcurrency: async () => { throw new Error("stdout private"); } })],
    ["concurrency_2", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, measureConcurrency: async (requested: 1 | 2 | 5) => requested === 2 ? Promise.reject(new Error("stderr private")) : deterministicDependencies().measureConcurrency(requested) })],
    ["concurrency_5", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, measureConcurrency: async (requested: 1 | 2 | 5) => requested === 5 ? Promise.reject(new Error("auth private")) : deterministicDependencies().measureConcurrency(requested) })],
    ["abort", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, proveAbort: async () => { throw new Error("query private"); } })],
    ["proof_validation", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, runOnboarding: async () => ({ guardedProposalCount: 0, inventedValueCount: 0 }) })],
    ["artifact_write", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, writeArtifact: async () => { throw new Error("/private/output.json"); } })],
    ["cleanup", (base: ReturnType<typeof deterministicDependencies>) => ({ ...base, initializeRuntime: async () => { throw new Error("root failure"); }, cleanupArtifact: async () => { throw new Error("cleanup secret"); } })],
  ] as const)("diagnostic reports only the fixed stage and an allowlisted code for %s", async (stage, configure) => {
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], configure(deterministicDependencies()));

    expect(result).toEqual({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@1:${stage}:${stage === "initialize_runtime" ? "codex_not_authenticated" : "unclassified"}\n` });
    expect(result.stderr).not.toMatch(/secret|private|https:|token|credential|stdout|stderr|query|output/i);
  });

  test("diagnostic preserves generic stderr by default and leaves no failure artifact", async () => {
    const cleanupArtifact = vi.fn(async () => undefined);
    const generic = await runLocalCodexStageAEntrypoint(["--live-local-subscription"], {
      ...deterministicDependencies(), initializeRuntime: async () => { throw new Error("/private/path token=secret"); }, cleanupArtifact,
    });
    expect(generic).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed\n" });
    expect(cleanupArtifact).toHaveBeenCalledWith("data/evals/local-codex-stage-a/result.json");
  });

  test("does not invoke cleanup when artifact preparation itself rejects", async () => {
    const cleanupArtifact = vi.fn(async () => undefined);
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(),
      prepareArtifact: async () => { throw new Error("unsafe artifact identity"); },
      cleanupArtifact,
    });

    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:prepare_artifact:unclassified\n" });
    expect(cleanupArtifact).not.toHaveBeenCalled();
  });

  test("cleans a prepared artifact when the first clock read fails", async () => {
    const cleanupArtifact = vi.fn(async () => undefined);
    const writeArtifact = vi.fn(async () => undefined);
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(),
      now: () => { throw new Error("hostile clock payload"); },
      cleanupArtifact,
      writeArtifact,
    });

    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:initialize_runtime:unclassified\n" });
    expect(cleanupArtifact).toHaveBeenCalledTimes(1);
    expect(cleanupArtifact).toHaveBeenCalledWith("data/evals/local-codex-stage-a/result.json");
    expect(writeArtifact).not.toHaveBeenCalled();
  });

  test("diagnostic safely classifies hostile thrown values without reading their payload", async () => {
    const payload = new Proxy(Object.create(null), {
      get: () => { throw new Error("leaked getter payload"); },
      getPrototypeOf: () => { throw new Error("leaked prototype payload"); },
      ownKeys: () => { throw new Error("leaked keys payload"); },
    });
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(), initializeRuntime: async () => { throw payload; },
    });
    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:initialize_runtime:unclassified\n" });
    const spoof = Object.create(CodexRuntimeError.prototype) as object;
    Object.defineProperties(spoof, {
      code: { value: "codex_timeout", writable: true, enumerable: true, configurable: true },
      name: { value: "CodexRuntimeError", writable: true, enumerable: true, configurable: true },
      message: { value: "codex_timeout", writable: true, enumerable: false, configurable: true },
    });
    const spoofed = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(), initializeRuntime: async () => { throw spoof; },
    });
    expect(spoofed).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:initialize_runtime:unclassified\n" });
  });

  test.each([
    ["onboarding_model_output_invalid", async () => ({ schemaVersion: "wrong", payload: "prompt=https://secret.example/id token=credential" })],
    ["onboarding_guard_invalid", async () => onboardingOutput({ sourceSpan: { start: 0, end: 0 } })],
    ["onboarding_canonical_mismatch", async () => onboardingOutput({ typedValue: { countryCode: "RU", city: "Тверь" } })],
    ["onboarding_evidence_mismatch", async () => onboardingOutput({ sourceSpan: { start: 0, end: 6 } })],
  ] as const)("reports content-free onboarding diagnostic %s through the real evaluator", async (code, extract) => {
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(), runOnboarding: () => evaluateOnboardingFixture(parseOnboardingFixture(onboardingFixture), { extract }),
    });

    expect(result).toEqual({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@1:onboarding:${code}\n` });
    expect(result.stderr).not.toMatch(/secret|private|https:|token|credential|prompt|response|query|stdout|stderr|path|payload/i);
  });

  test.each([
    "onboarding_model_aborted",
    "onboarding_model_integrity_failed",
    "onboarding_model_invalid",
    "onboarding_model_runtime_failed",
  ] as const)("allowlists exact native typed onboarding error %s", async (code: OnboardingModelErrorCode) => {
    const typed = new OnboardingModelError(code, code === "onboarding_model_runtime_failed" ? "codex_timeout" : undefined);
    const dependencies = {
      ...deterministicDependencies(),
      runOnboarding: () => evaluateOnboardingFixture(parseOnboardingFixture(onboardingFixture), { extract: async () => { throw typed; } }),
    };
    await expect(runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], dependencies))
      .resolves.toEqual({ exitCode: 1, stderr: `local_codex_stage_a_failed:diagnostic@1:onboarding:${code}\n` });
    await expect(runLocalCodexStageAEntrypoint(["--live-local-subscription"], dependencies))
      .resolves.toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed\n" });
  });

  test.each([
    ["runtime code missing", new OnboardingModelError("onboarding_model_runtime_failed")],
    ["runtime code on non-runtime error", new OnboardingModelError("onboarding_model_aborted", "codex_timeout")],
    ["runtime code outside allowlist", new OnboardingModelError("onboarding_model_runtime_failed", "codex_secret_payload" as never)],
  ] as const)("classifies typed onboarding error with %s as unclassified", async (_case, typed) => {
    const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
      ...deterministicDependencies(),
      runOnboarding: () => evaluateOnboardingFixture(parseOnboardingFixture(onboardingFixture), { extract: async () => { throw typed; } }),
    });

    expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:onboarding:unclassified\n" });
    expect(result.stderr).not.toMatch(/secret|payload/i);
  });

  test("rejects hostile onboarding error lookalikes and never leaks their content", async () => {
    const proxy = new Proxy(Object.create(null), {
      get: () => { throw new Error("proxy token=secret"); },
      getPrototypeOf: () => { throw new Error("prototype token=secret"); },
      ownKeys: () => { throw new Error("keys token=secret"); },
    });
    const spoof = Object.create(OnboardingModelError.prototype) as object;
    Object.defineProperties(spoof, {
      code: { value: "onboarding_model_invalid", writable: true, enumerable: true, configurable: true },
      runtimeCode: { value: undefined, writable: true, enumerable: true, configurable: true },
      name: { value: "OnboardingModelError", writable: true, enumerable: true, configurable: true },
      message: { value: "onboarding_model_invalid", writable: true, enumerable: false, configurable: true },
    });
    for (const error of [new Error("prompt=https://secret.example response token=credential"), proxy, spoof]) {
      const result = await runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], {
        ...deterministicDependencies(),
        runOnboarding: () => evaluateOnboardingFixture(parseOnboardingFixture(onboardingFixture), { extract: async () => { throw error; } }),
      });
      expect(result).toEqual({ exitCode: 1, stderr: "local_codex_stage_a_failed:diagnostic@1:onboarding:unclassified\n" });
      expect(result.stderr).not.toMatch(/secret|https:|token|credential|prompt|response/i);
    }
  });

  test("accepts diagnostic only with a single live opt-in and keeps successful output unchanged", async () => {
    expect(parseLocalCodexStageAArgs(["--live-local-subscription", "--diagnostic"]))
      .toEqual({ live: true, diagnostic: true, artifactPath: "data/evals/local-codex-stage-a/result.json" });
    expect(() => parseLocalCodexStageAArgs(["--diagnostic"])).toThrow("local_codex_stage_a_invalid_arguments");
    expect(() => parseLocalCodexStageAArgs(["--live-local-subscription", "--diagnostic", "--diagnostic"])).toThrow("local_codex_stage_a_invalid_arguments");
    await expect(runLocalCodexStageAEntrypoint(["--live-local-subscription", "--diagnostic"], deterministicDependencies()))
      .resolves.toEqual({ exitCode: 0, stderr: "" });
  });

  test.each([undefined, REVIEWED_CODEX_EXECUTABLE])(
    "verifies the reviewed installation before registration and subscription for override %s",
    async (executableOverride) => {
      const order: string[] = [];
      const result = await initializeReviewedStageARuntimeForTest({
        executableOverride,
        verifyInstallation: async () => { order.push("verify"); },
        registerRuntime: async () => { order.push("register"); },
        consumeSubscription: async () => { order.push("subscribe"); return "runtime-proof"; },
      });

      expect(result).toBe("runtime-proof");
      expect(order).toEqual(["verify", "register", "subscribe"]);
    },
  );

  test("rejects a nonexact executable override before verification, registration, or subscription", async () => {
    const verifyInstallation = vi.fn(async () => undefined);
    const registerRuntime = vi.fn(async () => undefined);
    const consumeSubscription = vi.fn(async () => "must-not-run");

    await expect(initializeReviewedStageARuntimeForTest({
      executableOverride: `${REVIEWED_CODEX_EXECUTABLE}.alias`,
      verifyInstallation,
      registerRuntime,
      consumeSubscription,
    })).rejects.toMatchObject({ code: "codex_version_mismatch" });
    expect(verifyInstallation).not.toHaveBeenCalled();
    expect(registerRuntime).not.toHaveBeenCalled();
    expect(consumeSubscription).not.toHaveBeenCalled();
  });

  test("stops before registration and subscription when installation verification fails", async () => {
    const mismatch = new CodexRuntimeError("codex_version_mismatch");
    const registerRuntime = vi.fn(async () => undefined);
    const consumeSubscription = vi.fn(async () => "must-not-run");

    await expect(initializeReviewedStageARuntimeForTest({
      executableOverride: undefined,
      verifyInstallation: async () => { throw mismatch; },
      registerRuntime,
      consumeSubscription,
    })).rejects.toBe(mismatch);
    expect(registerRuntime).not.toHaveBeenCalled();
    expect(consumeSubscription).not.toHaveBeenCalled();
  });

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

  test("calls the onboarding port with the canonical projection and rejects an empty evidence span", async () => {
    const fixture = parseOnboardingFixture(onboardingFixture);
    const extract = vi.fn<(input: unknown) => Promise<unknown>>(async () => ({
      schemaVersion: "onboarding-model-output@1",
      proposals: [{ fieldId: "current_location", typedValue: { countryCode: "RU", city: "Москва" }, messageId: onboardingFixture.message.messageId, sourceSpan: { start: 0, end: 0 } }],
      nextQuestion: onboardingFixture.expected.nextQuestion,
    }));
    await expect(evaluateOnboardingFixture(fixture, { extract })).rejects.toThrow("onboarding_guard_invalid");
    expect(extract).toHaveBeenCalledTimes(1);
    const input = extract.mock.calls[0]![0] as { questionnaire: unknown; message: unknown };
    expect(input.message).toEqual(onboardingFixture.message);
    expect(input.questionnaire).toEqual(projectQuestionnaireForModel(createOnboardingSession({
      nextParticipantId: () => "00000000-0000-4000-8000-000000000001",
      nextCompletionCommandId: () => "00000000-0000-4000-8000-000000000002",
    })));
  });

  test("accepts canonical guarded facts with alternative valid evidence and a filtered no-op roster", async () => {
    const fixture = await readOnboardingFixture();
    const evidence = ["я живу в Москве, Россия", "переезжать одна", "российское гражданство", "опыт — 5 лет"];
    const proposals = fixture.expected.proposals.map((proposal, index) => {
      const start = fixture.message.text.indexOf(evidence[index]!);
      expect(start).toBeGreaterThanOrEqual(0);
      return {
        fieldId: proposal.fieldId,
        typedValue: proposal.typedValue,
        messageId: fixture.message.messageId,
        sourceSpan: { start, end: start + evidence[index]!.length },
      };
    });
    proposals.push({
      fieldId: "participants",
      typedValue: [{ descriptor: "self", relationship: "self" }],
      messageId: fixture.message.messageId,
      sourceSpan: { start: 0, end: 6 },
    });

    await expect(evaluateOnboardingFixture(fixture, { extract: async () => ({
      schemaVersion: "onboarding-model-output@1",
      proposals,
      nextQuestion: fixture.expected.nextQuestion,
    }) })).resolves.toEqual({ guardedProposalCount: 4, inventedValueCount: 0 });
  });

  test("rejects canonical facts when every field points to the same unrelated valid evidence", async () => {
    const fixture = await readOnboardingFixture();
    const proposals = fixture.expected.proposals.map(({ fieldId, typedValue }) => ({
      fieldId,
      typedValue,
      messageId: fixture.message.messageId,
      sourceSpan: { start: 0, end: 6 },
    }));

    await expect(evaluateOnboardingFixture(fixture, { extract: async () => ({
      schemaVersion: "onboarding-model-output@1",
      proposals,
      nextQuestion: fixture.expected.nextQuestion,
    }) })).rejects.toThrow("onboarding_evidence_mismatch");
  });

  test.each([
    ["missing", (proposals: Record<string, unknown>[]) => proposals.slice(0, -1)],
    ["extra", (proposals: Record<string, unknown>[]) => [...proposals, {
      fieldId: "move_horizon", typedValue: "within_3_months", messageId: "00000000-0000-4000-8000-000000000081", sourceSpan: { start: 32, end: 40 },
    }]],
    ["wrong value", (proposals: Record<string, unknown>[]) => proposals.map((proposal) => proposal.fieldId === "current_location"
      ? { ...proposal, typedValue: { countryCode: "RU", city: "Тверь" } }
      : proposal)],
  ] as const)("rejects %s retained canonical guarded proposals", async (_case, mutate) => {
    const fixture = await readOnboardingFixture();
    const proposals = fixture.expected.proposals.map(({ fieldId, typedValue, messageId, sourceSpan }) => structuredClone({ fieldId, typedValue, messageId, sourceSpan }) as Record<string, unknown>);
    await expect(evaluateOnboardingFixture(fixture, { extract: async () => ({
      schemaVersion: "onboarding-model-output@1", proposals: mutate(proposals), nextQuestion: fixture.expected.nextQuestion,
    }) })).rejects.toThrow("onboarding_canonical_mismatch");
  });

  test.each([
    ["out-of-bounds", { messageId: onboardingFixture.message.messageId, sourceSpan: { start: 0, end: onboardingFixture.message.text.length + 1 } }],
    ["non-current message", { messageId: "00000000-0000-4000-8000-000000000082", sourceSpan: { start: 0, end: 8 } }],
  ] as const)("rejects %s evidence before canonical guarded acceptance", async (_case, evidence) => {
    const fixture = parseOnboardingFixture(onboardingFixture);
    await expect(evaluateOnboardingFixture(fixture, { extract: async () => ({
      schemaVersion: "onboarding-model-output@1",
      proposals: [{ fieldId: "current_location", typedValue: { countryCode: "RU", city: "Москва" }, ...evidence }],
      nextQuestion: fixture.expected.nextQuestion,
    }) })).rejects.toThrow();
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

function onboardingOutput(overrides: Readonly<{ typedValue?: unknown; sourceSpan?: Readonly<{ start: number; end: number }> }> = {}) {
  return {
    schemaVersion: "onboarding-model-output@1",
    proposals: [{
      fieldId: "current_location",
      typedValue: overrides.typedValue ?? { countryCode: "RU", city: "Москва" },
      messageId: onboardingFixture.message.messageId,
      sourceSpan: overrides.sourceSpan ?? onboardingFixture.expected.proposals[0]!.sourceSpan,
    }],
    nextQuestion: onboardingFixture.expected.nextQuestion,
  };
}

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
