import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { auditCodexRuntime } from "../../scripts/audit-codex-runtime";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex runtime static audit", () => {
  test("exposes the exact package entry point", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    expect(packageJson.scripts?.["audit:codex-runtime"]).toBe(
      "node --import tsx scripts/audit-codex-runtime.ts",
    );
  });

  test("returns the closed zero-match proof for the production tree", async () => {
    await expect(auditCodexRuntime({ rootPath: resolve(".") })).resolves.toEqual({
      schemaVersion: "codex-runtime-static-audit@1",
      forbiddenDependencyMatches: [],
      apiKeyHandlingMatches: [],
      modelDownloadMatches: [],
      forbiddenRuntimeMethodMatches: [],
    });
  });

  test.each([
    ["local model dependency", `import "node-llama-cpp";`],
    ["OpenAI SDK side-effect import", `import "openai";`],
    ["API key handling", `const credential = process.env.OPENAI_API_KEY;`],
    ["model selector", `const args = ["--model", "synthetic"];`],
    ["session resume", `resume("synthetic-session");`],
    ["generic retry", `retry();`],
    ["provider retry", `retryProvider("synthetic-provider");`],
    ["repeating background timer", `setInterval(runProbe, 25);`],
  ])("fails closed on %s", async (_label, source) => {
    const rootPath = await createRuntimeFixture({ source });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("permits only the capability-owned model argv in the policy owner", async () => {
    const rootPath = await createRuntimeFixture({
      policySource: 'export const args = ["--model", modelForCodexCapability(invocation.capability)];',
    });

    await expect(auditCodexRuntime({ rootPath })).resolves.toMatchObject({
      schemaVersion: "codex-runtime-static-audit@1",
    });
  });

  test.each([
    ["the fixed Terra argv outside the policy owner", {
      source: 'export const args = ["--model", "gpt-5.6-terra"];',
    }],
    ["a dynamic model argv in the policy owner", {
      policySource: 'export const args = ["--model", process.env.CODEX_MODEL];',
    }],
    ["a different fixed model argv in the policy owner", {
      policySource: 'export const args = ["--model", "gpt-5.6-luna"];',
    }],
    ["a caller-controlled suffix on the fixed Terra model in the policy owner", {
      policySource: 'export const args = ["--model", "gpt-5.6-terra" + callerControlledValue];',
    }],
  ])("rejects %s", async (_label, fixture) => {
    const rootPath = await createRuntimeFixture(fixture);

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("walks the installed production dependency graph", async () => {
    const rootPath = await createRuntimeFixture({
      dependencies: { "runtime-wrapper": "1.0.0" },
      installedPackages: {
        "runtime-wrapper": { dependencies: { openai: "1.0.0" } },
        openai: { dependencies: {} },
      },
    });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("resolves pnpm virtual-store transitives and validates their manifest names", async () => {
    const rootPath = await createRuntimeFixture({ dependencies: { "runtime-wrapper": "1.0.0" } });
    const virtualStore = join(rootPath, "node_modules", ".pnpm");
    const wrapperPath = join(virtualStore, "runtime-wrapper@1.0.0", "node_modules", "runtime-wrapper");
    const forbiddenPath = join(virtualStore, "openai@1.0.0", "node_modules", "openai");
    await mkdir(join(wrapperPath, "node_modules"), { recursive: true });
    await mkdir(forbiddenPath, { recursive: true });
    await writeFile(join(wrapperPath, "index.js"), "export {};", "utf8");
    await writeFile(join(wrapperPath, "package.json"), JSON.stringify({
      name: "runtime-wrapper",
      version: "1.0.0",
      main: "index.js",
      dependencies: { "safe-client": "1.0.0" },
    }), "utf8");
    await writeFile(join(forbiddenPath, "index.js"), "export {};", "utf8");
    await writeFile(join(forbiddenPath, "package.json"), JSON.stringify({
      name: "openai",
      version: "1.0.0",
      main: "index.js",
    }), "utf8");
    await symlink(wrapperPath, join(rootPath, "node_modules", "runtime-wrapper"), "dir");
    await symlink(forbiddenPath, join(wrapperPath, "node_modules", "safe-client"), "dir");

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("fails closed when a required production dependency is absent", async () => {
    const rootPath = await createRuntimeFixture({ dependencies: { "missing-runtime": "1.0.0" } });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("rejects npm aliases to forbidden packages before resolution", async () => {
    const rootPath = await createRuntimeFixture({ dependencies: { "safe-client": "npm:openai@1.0.0" } });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test.each([
    ["forbidden peer name", { openai: "1.0.0" }],
    ["forbidden peer alias", { "safe-client": "npm:openai@1.0.0" }],
  ])("rejects an absent %s", async (_label, peerDependencies) => {
    const rootPath = await createRuntimeFixture({
      dependencies: { "runtime-wrapper": "1.0.0" },
      installedPackages: {
        "runtime-wrapper": { dependencies: {}, peerDependencies },
      },
    });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("walks an installed peer dependency graph", async () => {
    const rootPath = await createRuntimeFixture({
      dependencies: { "runtime-wrapper": "1.0.0" },
      installedPackages: {
        "runtime-wrapper": { dependencies: {}, peerDependencies: { "safe-peer": "1.0.0" } },
        "safe-peer": { dependencies: { openai: "1.0.0" } },
        openai: { dependencies: {} },
      },
    });

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("permits an absent allowed peer dependency", async () => {
    const rootPath = await createRuntimeFixture({
      dependencies: { "runtime-wrapper": "1.0.0" },
      installedPackages: {
        "runtime-wrapper": { dependencies: {}, peerDependencies: { "host-runtime": "1.0.0" } },
      },
    });

    await expect(auditCodexRuntime({ rootPath })).resolves.toMatchObject({
      schemaVersion: "codex-runtime-static-audit@1",
    });
  });

  test("scans non-Codex production sources for model and API-key surfaces", async () => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await mkdir(join(rootPath, "src", "application"), { recursive: true });
    await writeFile(join(rootPath, "src", "application", "leak.ts"),
      "export const key = process.env.OPENAI_API_KEY;", "utf8");

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("scans the root package manifest for forbidden runtime configuration", async () => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await writeFile(join(rootPath, "package.json"), JSON.stringify({
      name: "audit-fixture",
      private: true,
      dependencies: {},
      scripts: { model: "node app.js --token=$OPENAI_API_KEY" },
    }), "utf8");

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test.each([".jsx", ".mts", ".cts"])("scans production %s sources", async (extension) => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await mkdir(join(rootPath, "src", "application"), { recursive: true });
    await writeFile(join(rootPath, "src", "application", `leak${extension}`),
      "export const key = process.env.OPENAI_API_KEY;", "utf8");

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test.each([
    ".env.production.example",
    ".env.local.sample",
    ".env.staging.template",
    ".env.defaults",
  ])("scans the explicit non-secret environment template %s", async (fileName) => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await writeFile(join(rootPath, fileName), "OPENAI_API_KEY=synthetic", "utf8");

    await expect(auditCodexRuntime({ rootPath })).rejects.toThrow("codex_runtime_audit_failed");
  });

  test("allows a bounded timeout inside the Codex runtime", async () => {
    const rootPath = await createRuntimeFixture({
      source: "export const timeout = setTimeout(runProbe, 25);",
    });

    await expect(auditCodexRuntime({ rootPath })).resolves.toMatchObject({
      schemaVersion: "codex-runtime-static-audit@1",
    });
  });

  test("allows unrelated product retry behavior outside the Codex runtime closure", async () => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await mkdir(join(rootPath, "src", "research"), { recursive: true });
    await writeFile(join(rootPath, "src", "research", "retry.ts"),
      "export function retryProvider() { return 'official-source'; }", "utf8");

    await expect(auditCodexRuntime({ rootPath })).resolves.toMatchObject({
      schemaVersion: "codex-runtime-static-audit@1",
    });
  });

  test("does not audit historical specifications or tests", async () => {
    const rootPath = await createRuntimeFixture({ source: "export const runtime = true;" });
    await mkdir(join(rootPath, "docs"), { recursive: true });
    await mkdir(join(rootPath, "tests"), { recursive: true });
    await writeFile(join(rootPath, "docs", "history.md"), "OPENAI_API_KEY node-llama-cpp", "utf8");
    await writeFile(join(rootPath, "tests", "history.test.ts"), "retryProvider('--model')", "utf8");

    await expect(auditCodexRuntime({ rootPath })).resolves.toMatchObject({
      schemaVersion: "codex-runtime-static-audit@1",
    });
  });
});

async function createRuntimeFixture(input: {
  readonly source?: string;
  readonly policySource?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly installedPackages?: Readonly<Record<string, {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  }>>;
}): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), "codex-runtime-audit-"));
  createdDirectories.push(rootPath);
  await mkdir(join(rootPath, "src", "infrastructure", "codex-cli"), { recursive: true });
  await writeFile(join(rootPath, "src", "infrastructure", "codex-cli", "runtime.ts"),
    input.source ?? "export const runtime = true;", "utf8");
  if (input.policySource !== undefined) {
    await writeFile(join(rootPath, "src", "infrastructure", "codex-cli", "policy.ts"), input.policySource, "utf8");
  }
  await writeFile(join(rootPath, "package.json"), JSON.stringify({
    name: "audit-fixture",
    private: true,
    dependencies: input.dependencies ?? {},
  }), "utf8");

  for (const [packageName, packageJson] of Object.entries(input.installedPackages ?? {})) {
    const packagePath = join(rootPath, "node_modules", ...packageName.split("/"));
    await mkdir(packagePath, { recursive: true });
    await writeFile(join(packagePath, "package.json"), JSON.stringify({
      name: packageName,
      version: "1.0.0",
      dependencies: packageJson.dependencies,
      peerDependencies: packageJson.peerDependencies,
    }), "utf8");
  }
  return rootPath;
}
