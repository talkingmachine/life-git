import { describe, expect, test, vi } from "vitest";

import { parseLocalCodexStageAArgs, runLocalCodexStageA } from "../../evals/local-codex-stage-a";

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
      measureConcurrency: async (requested) => ({ completed: requested, crossJobLeakage: false }),
      proveAbort: async () => ({ processGroupTerminated: true, lateResultAccepted: false }),
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
      concurrency: { requested: [1, 2, 5], completed: [1, 2, 5], crossJobLeakage: false },
      abort: { processGroupTerminated: true, lateResultAccepted: false },
    });
  });
});
