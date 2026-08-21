import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CODEX_DISABLED_FEATURES,
  CODEX_FEATURE_INVENTORY_ARGS,
  CODEX_PREFLIGHT_LIMITS,
  preflightCodexCli,
  readDisabledFeatureInventory,
} from "../../src/infrastructure/codex-cli/preflight";
import type { CodexProcessSpawner, SpawnedCodexProcess } from "../../src/infrastructure/codex-cli/process";

const encoder = new TextEncoder();
const temporaryPaths: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function executableFixture(): Promise<{ readonly root: string; readonly executable: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codex-preflight-test-")));
  temporaryPaths.push(root);
  const executable = join(root, "codex");
  await writeFile(executable, "fixture", { mode: 0o700 });
  await chmod(executable, 0o700);
  return { root, executable };
}

async function* output(text = ""): AsyncGenerator<Uint8Array> {
  if (text.length > 0) yield encoder.encode(text);
}

function spawned(stdout: string, overrides: Partial<SpawnedCodexProcess> = {}): SpawnedCodexProcess {
  return {
    pid: 29,
    stdout: output(stdout),
    stderr: output("bounded warning"),
    exit: Promise.resolve({ code: 0, signal: null }),
    kill: vi.fn(),
    ...overrides,
  };
}

function sequenceSpawner(processes: readonly SpawnedCodexProcess[]):
CodexProcessSpawner & { spawn: ReturnType<typeof vi.fn> } {
  let index = 0;
  return { spawn: vi.fn(() => processes[index++] ?? spawned("")) };
}

describe("preflightCodexCli", () => {
  test("requires exact pinned version and ChatGPT authentication for the configured executable", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15"),
      spawned("Logged in using ChatGPT"),
    ]);
    const signal = new AbortController().signal;

    const result = await preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: { LANG: "C.UTF-8" },
      signal,
    });

    expect(result).toEqual({
      executable: fixture.executable,
      cliVersion: "codex-cli 0.148.0-alpha.15",
      authenticatedWith: "ChatGPT",
    });
    expect(spawner.spawn).toHaveBeenCalledTimes(2);
    expect(spawner.spawn.mock.calls.map(([request]) => ({
      executable: request.executable,
      args: request.args,
      env: request.env,
      stdin: request.stdin,
    }))).toEqual([
      { executable: fixture.executable, args: ["--version"], env: { LANG: "C.UTF-8" }, stdin: new Uint8Array() },
      { executable: fixture.executable, args: ["login", "status"], env: { LANG: "C.UTF-8" }, stdin: new Uint8Array() },
    ]);
  });

  test("prefers an explicit executable over PATH", async () => {
    const explicit = await executableFixture();
    const pathFixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15"),
      spawned("Logged in using ChatGPT"),
    ]);

    await preflightCodexCli({
      configuredExecutable: explicit.executable,
      pathValue: pathFixture.root,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    });

    expect(spawner.spawn.mock.calls[0]?.[0].executable).toBe(explicit.executable);
  });

  test("rejects a missing executable without spawning", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-missing-test-"));
    temporaryPaths.push(root);
    const spawner = sequenceSpawner([]);

    await expect(preflightCodexCli({
      configuredExecutable: join(root, "missing"),
      pathValue: "",
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_missing" });
    expect(spawner.spawn).not.toHaveBeenCalled();
  });

  test("rejects a symlink executable without spawning", async () => {
    const fixture = await executableFixture();
    const link = join(fixture.root, "codex-link");
    await symlink(fixture.executable, link);
    const spawner = sequenceSpawner([]);

    await expect(preflightCodexCli({
      configuredExecutable: link,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_missing" });
    expect(spawner.spawn).not.toHaveBeenCalled();
  });

  test("stops after one version spawn when stdout does not exactly match", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([spawned("codex-cli 0.148.0-alpha.15\n")]);

    await expect(preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_version_mismatch" });
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-ChatGPT login status after exactly two spawns", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15"),
      spawned("Not logged in"),
    ]);

    await expect(preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_not_authenticated" });
    expect(spawner.spawn).toHaveBeenCalledTimes(2);
    expect(spawner.spawn.mock.calls.some(([request]) => request.args.includes("login") && request.args.length > 2))
      .toBe(false);
  });

  test("bounds a hung version probe and never starts the login probe", async () => {
    const fixture = await executableFixture();
    const nativeSetImmediate = setImmediate;
    vi.useFakeTimers();
    const exit = new Promise<{ code: number | null; signal: string | null }>(() => undefined);
    const spawner = sequenceSpawner([spawned("", { exit })]);
    const running = preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    });
    const rejection = expect(running).rejects.toMatchObject({ code: "codex_timeout" });
    while (spawner.spawn.mock.calls.length === 0) {
      await new Promise<void>((resolve) => nativeSetImmediate(resolve));
    }

    await vi.advanceTimersByTimeAsync(CODEX_PREFLIGHT_LIMITS.timeoutMs);
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("readDisabledFeatureInventory", () => {
  test("runs the exact non-strict inventory command and accepts every disabled feature as false", async () => {
    const fixture = await executableFixture();
    const lines = CODEX_DISABLED_FEATURES.map((feature) => `${feature}\texperimental\tfalse`).join("\n");
    const spawner = sequenceSpawner([spawned(`${lines}\n`)]);

    const result = await readDisabledFeatureInventory({
      preflight: {
        executable: fixture.executable,
        cliVersion: "codex-cli 0.148.0-alpha.15",
        authenticatedWith: "ChatGPT",
      },
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    });

    expect(result).toEqual(Object.fromEntries(CODEX_DISABLED_FEATURES.map((feature) => [feature, false])));
    expect(spawner.spawn.mock.calls[0]?.[0].args).toEqual(CODEX_FEATURE_INVENTORY_ARGS);
    expect(CODEX_FEATURE_INVENTORY_ARGS).not.toContain("--strict-config");
  });

  test.each([
    ["an unknown feature", "unknown_feature\texperimental\tfalse\n"],
    ["a missing shared feature", "skill_search\texperimental\tfalse\n"],
    ["an enabled shared feature", "skill_search\texperimental\ttrue\nskill_mcp_dependency_install\texperimental\tfalse\n"],
    ["malformed output", "not an inventory"],
  ])("rejects %s", async (_name, stdout) => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([spawned(stdout)]);

    await expect(readDisabledFeatureInventory({
      preflight: {
        executable: fixture.executable,
        cliVersion: "codex-cli 0.148.0-alpha.15",
        authenticatedWith: "ChatGPT",
      },
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });
  });
});
