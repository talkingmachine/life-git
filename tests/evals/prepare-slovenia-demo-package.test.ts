import { describe, expect, test, vi } from "vitest";

import {
  parsePrepareSloveniaDemoPackageArgs,
  runPrepareSloveniaDemoPackageEntrypoint,
} from "../../evals/prepare-slovenia-demo-package";

function validResult(url = "https://www.policija.si/example") {
  return {
    candidates: [{ url, claimedPublisher: "untrusted", expectedCoverage: "untrusted", rationale: "must not persist" }],
    metadata: {
      invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2",
      compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2", cliVersion: "codex-cli 0.149.0-alpha.4",
      model: "gpt-5.4", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@2",
      templateVersion: "official-source-discover@4", schemaVersion: "official-source-candidates@1",
    } as const,
  };
}

describe("prepare Slovenia demo package command", () => {
  test("requires one explicit local-subscription opt-in and rejects caller-controlled options", () => {
    expect(parsePrepareSloveniaDemoPackageArgs(["--live-local-subscription"]))
      .toEqual({ live: true });

    for (const argv of [
      [],
      ["--live-local-subscription", "--live-local-subscription"],
      ["--model", "gpt-5.6"],
      ["--artifact", "elsewhere.json"],
    ]) {
      expect(() => parsePrepareSloveniaDemoPackageArgs(argv)).toThrow(
        "prepare_slovenia_demo_package_invalid_arguments",
      );
    }
  });

  test("does not register or search without the explicit opt-in", async () => {
    const registerRuntime = vi.fn(async () => undefined);
    const discover = vi.fn();

    await expect(runPrepareSloveniaDemoPackageEntrypoint([], {
      registerRuntime,
      discovery: { discover },
    })).resolves.toEqual({ exitCode: 1, stderr: "local_codex_live_opt_in_required\n" });

    expect(registerRuntime).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
  });

  test("runs exactly the three fixed gpt-5.4 medium discovery jobs and stages only sanitized candidates", async () => {
    const written: unknown[] = [];
    const write = vi.fn(async (_path: string, record: unknown) => { written.push(record); });
    const discover = vi.fn(async (_input: unknown) => {
      void _input;
      return validResult();
    });

    await expect(runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => undefined,
      registerRuntime: async () => undefined,
      discovery: { discover },
      store: { prepare: async () => undefined, cleanup: async () => undefined, write },
    })).resolves.toEqual({ exitCode: 0, stderr: "" });

    expect(discover).toHaveBeenCalledTimes(3);
    for (const call of discover.mock.calls) {
      const input = call[0] as { entity: { countryCode: string }; round: number };
      expect(input.entity.countryCode).toBe("SI");
      expect(input.round).toBe(1);
    }
    expect(discover.mock.calls.map(([input]) => (input as { fact: { factKey: string } }).fact.factKey)).toEqual([
      "ljubljana-public-safety-annual-aggregate",
      "ljubljana-population-denominator",
      "ljubljana-identity-geometry-route",
    ]);
    expect(discover.mock.calls.map(([input]) => (input as { authorityRoots: readonly { url: string }[] }).authorityRoots.map((root) => root.url))).toEqual([
      ["https://www.policija.si/", "https://www.gov.si/"],
      ["https://www.stat.si/StatWeb/", "https://www.gov.si/"],
      ["https://www.e-prostor.gov.si/", "https://www.stat.si/StatWeb/", "https://www.gov.si/"],
    ]);
    expect(write).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      stagingOnly: true,
      policyLockWritten: false,
      discovery: expect.objectContaining({ model: "gpt-5.4", reasoningEffort: "medium" }),
      jobs: expect.arrayContaining([expect.objectContaining({ candidates: [expect.objectContaining({
        url: "https://www.policija.si/example",
        host: "www.policija.si",
      })] })]),
    }));
    expect(JSON.stringify(written[0])).not.toContain("must not persist");
  });

  test("constructs the default discovery port only after verification and runtime registration", async () => {
    const order: string[] = [];
    const discovery = { discover: async () => { order.push("discover"); return validResult(); } };

    await expect(runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => { order.push("verify"); },
      registerRuntime: async () => { order.push("register"); },
      createDiscovery: () => { order.push("factory"); return discovery; },
      store: { prepare: async () => undefined, cleanup: async () => undefined, write: async () => undefined },
    })).resolves.toEqual({ exitCode: 0, stderr: "" });

    expect(order).toEqual(["verify", "register", "factory", "discover", "discover", "discover"]);
  });

  test("removes the stale staging artifact when discovery fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);

    await expect(runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => undefined,
      registerRuntime: async () => undefined,
      discovery: { discover: async () => { throw new Error("discovery failed"); } },
      store: { prepare: async () => undefined, cleanup, write },
    })).resolves.toEqual({ exitCode: 1, stderr: "prepare_slovenia_demo_package_failed\n" });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  test("rejects non-HTTPS or expanded candidate output before staging", async () => {
    const cleanup = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const result = {
      candidates: [{ url: "http://example.test/", claimedPublisher: "x", expectedCoverage: "x", rationale: "x", extra: "x" }],
      metadata: {
        invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2",
        compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2", cliVersion: "codex-cli 0.149.0-alpha.4",
        model: "gpt-5.4", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@2",
        templateVersion: "official-source-discover@4", schemaVersion: "official-source-candidates@1",
      } as const,
    };

    await expect(runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => undefined,
      registerRuntime: async () => undefined,
      discovery: { discover: async () => result as never },
      store: { prepare: async () => undefined, cleanup, write },
    })).resolves.toEqual({ exitCode: 1, stderr: "prepare_slovenia_demo_package_failed\n" });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  test.each(["https://127.0.0.1/", "https://localhost/"])("rejects unsafe host candidate %s before staging", async (url) => {
    const cleanup = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    await runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => undefined, registerRuntime: async () => undefined,
      discovery: { discover: async () => validResult(url) as never },
      store: { prepare: async () => undefined, cleanup, write },
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  test("rejects a candidate getter before staging", async () => {
    const candidate = { claimedPublisher: "x", expectedCoverage: "x", rationale: "x" } as Record<string, unknown>;
    Object.defineProperty(candidate, "url", { enumerable: true, get: () => "https://www.policija.si/" });
    const cleanup = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    await runPrepareSloveniaDemoPackageEntrypoint(["--live-local-subscription"], {
      verifyInstallation: async () => undefined, registerRuntime: async () => undefined,
      discovery: { discover: async () => ({ ...validResult(), candidates: [candidate] }) as never },
      store: { prepare: async () => undefined, cleanup, write },
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
});
