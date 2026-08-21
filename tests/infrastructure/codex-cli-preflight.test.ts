import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CODEX_DISABLED_FEATURES,
  CODEX_PREFLIGHT_LIMITS,
  preflightCodexCli,
  readDisabledFeatureInventory,
} from "../../src/infrastructure/codex-cli/preflight";
import type { CodexProcessSpawner, SpawnedCodexProcess } from "../../src/infrastructure/codex-cli/process";

const encoder = new TextEncoder();
const temporaryPaths: string[] = [];
const KNOWN_PATH_ALIAS_WARNING =
  "WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)\n";
const CHATGPT_LOGIN_STATUS = "Logged in using ChatGPT\n";

const EXPECTED_DISABLED_FEATURES = [
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_full_cdp_access",
  "code_mode_host",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugin_sharing",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
] as const;

const EXPECTED_FEATURE_INVENTORY_ARGS = [
  "--disable", "apps",
  "--disable", "auth_elicitation",
  "--disable", "browser_use",
  "--disable", "browser_use_full_cdp_access",
  "--disable", "code_mode_host",
  "--disable", "goals",
  "--disable", "hooks",
  "--disable", "image_generation",
  "--disable", "in_app_browser",
  "--disable", "multi_agent",
  "--disable", "plugin_sharing",
  "--disable", "plugins",
  "--disable", "remote_plugin",
  "--disable", "shell_snapshot",
  "--disable", "shell_tool",
  "--disable", "skill_mcp_dependency_install",
  "--disable", "skill_search",
  "--disable", "tool_call_mcp_elicitation",
  "--disable", "tool_suggest",
  "--disable", "unified_exec",
  "--disable", "view_image",
  "--disable", "workspace_dependencies",
  "features", "list",
] as const;

function exactDisabledInventory(overrides: Readonly<Record<string, boolean>> = {}): string {
  return EXPECTED_DISABLED_FEATURES.map((feature) =>
    `${feature}\texperimental\t${String(overrides[feature] ?? false)}`).join("\n") + "\n";
}

function realisticFullFeatureInventory(): string {
  const unrelated = Array.from({ length: 91 }, (_, index) => {
    const maturity = index === 0 ? "under development" : "stable";
    return `known_registry_feature_${String(index).padStart(3, "0")}`.padEnd(41) +
      `${maturity.padEnd(19)}false`;
  });
  const pinned = EXPECTED_DISABLED_FEATURES.map((feature) =>
    feature.padEnd(41) + "experimental       false");
  return [...unrelated.slice(0, 37), ...pinned, ...unrelated.slice(37)].join("\n") + "\n";
}

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
  test("accepts the exact unsandboxed version and ChatGPT authentication streams", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output("") }),
      spawned("", { stderr: output(CHATGPT_LOGIN_STATUS) }),
    ]);

    await expect(preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({
      executable: fixture.executable,
      cliVersion: "codex-cli 0.148.0-alpha.15",
      authenticatedWith: "ChatGPT",
    });
    expect(spawner.spawn).toHaveBeenCalledTimes(2);
  });

  test("requires exact pinned version and ChatGPT authentication for the configured executable", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output(KNOWN_PATH_ALIAS_WARNING) }),
      spawned("", { stderr: output(KNOWN_PATH_ALIAS_WARNING + CHATGPT_LOGIN_STATUS) }),
    ]);
    const signal = new AbortController().signal;

    const result = await preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {
        CODEX_HOME: "/codex-home",
        TMPDIR: "/configured-tmp",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        APPLICATION_SECRET: "must-not-leak",
      },
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
      {
        executable: fixture.executable,
        args: ["--version"],
        env: { CODEX_HOME: "/codex-home", TMPDIR: "/configured-tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
        stdin: new Uint8Array(),
      },
      {
        executable: fixture.executable,
        args: ["login", "status"],
        env: { CODEX_HOME: "/codex-home", TMPDIR: "/configured-tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
        stdin: new Uint8Array(),
      },
    ]);
  });

  test("prefers an explicit executable over PATH", async () => {
    const explicit = await executableFixture();
    const pathFixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output(KNOWN_PATH_ALIAS_WARNING) }),
      spawned("", { stderr: output(KNOWN_PATH_ALIAS_WARNING + CHATGPT_LOGIN_STATUS) }),
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

  test.each([
    ["a missing line ending", "codex-cli 0.148.0-alpha.15"],
    ["an extra line ending", "codex-cli 0.148.0-alpha.15\n\n"],
    ["a different version", "codex-cli 0.148.0-alpha.14\n"],
  ])("stops after one version spawn for %s", async (_name, versionStdout) => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([spawned(versionStdout, { stderr: output(KNOWN_PATH_ALIAS_WARNING) })]);

    await expect(preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_version_mismatch" });
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["an unknown warning", "WARNING: unrelated warning\n"],
    ["a duplicate known warning", KNOWN_PATH_ALIAS_WARNING + KNOWN_PATH_ALIAS_WARNING],
  ])("rejects version stderr containing %s", async (_name, versionStderr) => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output(versionStderr) }),
    ]);

    await expect(preflightCodexCli({
      configuredExecutable: fixture.executable,
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_version_mismatch", message: "codex_version_mismatch" });
    expect(spawner.spawn).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-ChatGPT login status after exactly two spawns", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output(KNOWN_PATH_ALIAS_WARNING) }),
      spawned("", { stderr: output(`${KNOWN_PATH_ALIAS_WARNING}Not logged in\n`) }),
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

  test.each([
    ["missing auth", KNOWN_PATH_ALIAS_WARNING, ""],
    ["ambiguous auth", KNOWN_PATH_ALIAS_WARNING + CHATGPT_LOGIN_STATUS + CHATGPT_LOGIN_STATUS, ""],
    ["duplicate warning", KNOWN_PATH_ALIAS_WARNING + KNOWN_PATH_ALIAS_WARNING + CHATGPT_LOGIN_STATUS, ""],
    ["unknown warning", `WARNING: unrelated warning\n${CHATGPT_LOGIN_STATUS}`, ""],
    ["non-empty stdout", KNOWN_PATH_ALIAS_WARNING + CHATGPT_LOGIN_STATUS, "unexpected stdout\n"],
  ])("strictly rejects %s without exposing stderr", async (_name, loginStderr, loginStdout) => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([
      spawned("codex-cli 0.148.0-alpha.15\n", { stderr: output(KNOWN_PATH_ALIAS_WARNING) }),
      spawned(loginStdout, { stderr: output(loginStderr) }),
    ]);

    let thrown: unknown;
    try {
      await preflightCodexCli({
        configuredExecutable: fixture.executable,
        spawner,
        childEnv: {},
        signal: new AbortController().signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "codex_not_authenticated", message: "codex_not_authenticated" });
    expect(String(thrown)).not.toContain("Logged in using ChatGPT");
    expect(String(thrown)).not.toContain("WARNING:");
    expect(String(thrown)).not.toContain("Not logged in");
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
  test("pins the exhaustive ordered 22-feature tuple", () => {
    expect(CODEX_DISABLED_FEATURES).toEqual(EXPECTED_DISABLED_FEATURES);
  });

  test("runs the exact non-strict inventory command and accepts every disabled feature as false", async () => {
    const fixture = await executableFixture();
    const inventory = realisticFullFeatureInventory();
    expect(inventory.split("\n")).toHaveLength(114);
    expect(encoder.encode(inventory).byteLength).toBeGreaterThan(4_096);
    const spawner = sequenceSpawner([spawned(inventory)]);

    const result = await readDisabledFeatureInventory({
      preflight: {
        executable: fixture.executable,
        cliVersion: "codex-cli 0.148.0-alpha.15",
        authenticatedWith: "ChatGPT",
      },
      spawner,
      childEnv: { LANG: "C", APPLICATION_SECRET: "must-not-leak" },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      apps: false,
      auth_elicitation: false,
      browser_use: false,
      browser_use_full_cdp_access: false,
      code_mode_host: false,
      goals: false,
      hooks: false,
      image_generation: false,
      in_app_browser: false,
      multi_agent: false,
      plugin_sharing: false,
      plugins: false,
      remote_plugin: false,
      shell_snapshot: false,
      shell_tool: false,
      skill_mcp_dependency_install: false,
      skill_search: false,
      tool_call_mcp_elicitation: false,
      tool_suggest: false,
      unified_exec: false,
      view_image: false,
      workspace_dependencies: false,
    });
    expect(spawner.spawn.mock.calls[0]?.[0].args).toEqual(EXPECTED_FEATURE_INVENTORY_ARGS);
    expect(spawner.spawn.mock.calls[0]?.[0].env).toEqual({ LANG: "C" });
    expect(EXPECTED_FEATURE_INVENTORY_ARGS).not.toContain("--strict-config");
  });

  test("accepts unrelated known CLI registry entries outside the pinned tuple", async () => {
    const fixture = await executableFixture();
    const spawner = sequenceSpawner([spawned(`${exactDisabledInventory()}unrelated_known_feature\tstable\ttrue\n`)]);

    await expect(readDisabledFeatureInventory({
      preflight: {
        executable: fixture.executable,
        cliVersion: "codex-cli 0.148.0-alpha.15",
        authenticatedWith: "ChatGPT",
      },
      spawner,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ shell_tool: false, skill_search: false });
  });

  test.each([
    ["a missing shared feature", exactDisabledInventory().replace("shell_tool\texperimental\tfalse\n", "")],
    ["a duplicate shared feature", `${exactDisabledInventory()}shell_tool\texperimental\tfalse\n`],
    ["an enabled shared feature", exactDisabledInventory({ shell_tool: true })],
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
