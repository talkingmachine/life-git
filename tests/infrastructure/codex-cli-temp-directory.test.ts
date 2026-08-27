import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createCodexJsonInvocation } from "../../src/infrastructure/codex-cli/contracts";
import {
  inspectModelVisibleInputs,
  runCodexJsonProbe,
} from "../../src/infrastructure/codex-cli/feasibility-probe";
import type { CodexProcessSpawner, SpawnedCodexProcess } from "../../src/infrastructure/codex-cli/process";
import {
  scavengeStaleCodexDirectories,
  validateCodexTempRoot,
  withCodexTempDirectory,
  type ValidatedCodexTempRoot,
} from "../../src/infrastructure/codex-cli/temp-directory";

const temporaryPaths: string[] = [];
const encoder = new TextEncoder();
const CODE_MODE_HOST_DISABLED_MESSAGE =
  "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";

const EXPECTED_EXEC_ARGS = [
  "exec",
  "--strict-config",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--disable", "apps",
  "--disable", "auth_elicitation",
  "--disable", "browser_use",
  "--disable", "browser_use_full_cdp_access",
  "--disable", "code_mode",
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
  "--sandbox", "read-only",
  "--skip-git-repo-check",
] as const;

const EXPECTED_MESSAGE_INPUT_INSPECTION_ARGS = [
  "--disable", "apps",
  "--disable", "auth_elicitation",
  "--disable", "browser_use",
  "--disable", "browser_use_full_cdp_access",
  "--disable", "code_mode",
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
  "debug", "prompt-input", "synthetic capability audit",
] as const;

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempRoot(): Promise<{ readonly path: string; readonly uid: number }> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "codex-root-test-")));
  temporaryPaths.push(path);
  return { path, uid: (await stat(path)).uid };
}

async function validatedRoot(): Promise<ValidatedCodexTempRoot> {
  const root = await tempRoot();
  return validateCodexTempRoot({
    path: root.path,
    currentUid: root.uid,
    userHomePath: dirname(root.path),
    workspacePath: join(dirname(root.path), "unrelated-workspace"),
  });
}

describe("validateCodexTempRoot", () => {
  test.each([
    ["a relative path", "relative-temp"],
    ["the filesystem root", "/"],
  ])("rejects %s", async (_name, path) => {
    await expect(validateCodexTempRoot({
      path,
      currentUid: process.getuid?.() ?? 0,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("rejects the user home, workspace, and a parent of the workspace", async () => {
    const root = await tempRoot();
    const workspace = join(root.path, "workspace", "project");
    await mkdir(workspace, { recursive: true });

    for (const path of [root.path, workspace, dirname(workspace)]) {
      await expect(validateCodexTempRoot({
        path,
        currentUid: root.uid,
        userHomePath: root.path,
        workspacePath: workspace,
      })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
    }
  });

  test("rejects a real directory inside the workspace", async () => {
    // Break caught: allowing Codex temporary artifacts to be created within the project tree.
    const root = await tempRoot();
    const workspace = join(root.path, "workspace");
    const descendant = join(workspace, "private-codex-tmp");
    await mkdir(descendant, { recursive: true });

    await expect(validateCodexTempRoot({
      path: descendant,
      currentUid: root.uid,
      userHomePath: "/users/person",
      workspacePath: workspace,
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("canonicalizes a symlinked user home before excluding the temp root", async () => {
    const actualHome = await tempRoot();
    const aliasContainer = await tempRoot();
    const homeAlias = join(aliasContainer.path, "home-alias");
    await symlink(actualHome.path, homeAlias);

    await expect(validateCodexTempRoot({
      path: actualHome.path,
      currentUid: actualHome.uid,
      userHomePath: homeAlias,
      workspacePath: aliasContainer.path,
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("canonicalizes a symlinked workspace before excluding its real parent", async () => {
    const parent = await tempRoot();
    const workspace = join(parent.path, "workspace");
    const aliasContainer = await tempRoot();
    const workspaceAlias = join(aliasContainer.path, "workspace-alias");
    await mkdir(workspace);
    await symlink(workspace, workspaceAlias);

    await expect(validateCodexTempRoot({
      path: parent.path,
      currentUid: parent.uid,
      userHomePath: aliasContainer.path,
      workspacePath: workspaceAlias,
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("rejects a symlink, wrong owner, and non-directory", async () => {
    const root = await tempRoot();
    const link = `${root.path}-link`;
    const file = join(root.path, "file");
    temporaryPaths.push(link);
    await symlink(root.path, link);
    await writeFile(file, "not a directory");

    await expect(validateCodexTempRoot({
      path: link,
      currentUid: root.uid,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
    await expect(validateCodexTempRoot({
      path: root.path,
      currentUid: root.uid + 1,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
    await expect(validateCodexTempRoot({
      path: file,
      currentUid: root.uid,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("rejects a final symlink even when the input has a trailing slash", async () => {
    const root = await tempRoot();
    const link = `${root.path}-trailing-link`;
    temporaryPaths.push(link);
    await symlink(root.path, link);

    await expect(validateCodexTempRoot({
      path: `${link}/`,
      currentUid: root.uid,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).rejects.toMatchObject({ code: "codex_temp_root_invalid" });
  });

  test("returns the canonical owned directory", async () => {
    const root = await tempRoot();

    await expect(validateCodexTempRoot({
      path: root.path,
      currentUid: root.uid,
      userHomePath: "/users/person",
      workspacePath: "/workspace/project",
    })).resolves.toEqual(root);
  });

  test("accepts the standard macOS /var alias while returning its canonical /private/var path", async () => {
    const aliasPath = await mkdtemp(join(tmpdir(), "codex-aliased-root-test-"));
    const canonicalPath = await realpath(aliasPath);
    temporaryPaths.push(canonicalPath);
    const uid = (await stat(aliasPath)).uid;

    await expect(validateCodexTempRoot({
      path: aliasPath,
      currentUid: uid,
      userHomePath: "/Users/synthetic-user",
      workspacePath: "/workspace/synthetic-project",
    })).resolves.toEqual({ path: canonicalPath, uid });
  });
});

describe("withCodexTempDirectory", () => {
  test("creates only a direct 0700 child and an exclusive 0600 schema", async () => {
    const root = await validatedRoot();
    let observedDirectory = "";

    const result = await withCodexTempDirectory({
      root,
      outputSchema: { type: "object", properties: { answer: { type: "string" } } },
      use: async ({ directoryPath, schemaPath }) => {
        observedDirectory = directoryPath;
        const childMode = (await stat(directoryPath)).mode & 0o777;
        const schemaMode = (await stat(schemaPath)).mode & 0o777;
        const entries = await readdir(directoryPath);
        return {
          childMode,
          schemaMode,
          entries,
          schema: await readFile(schemaPath, "utf8"),
          directParent: dirname(directoryPath),
        };
      },
    });

    expect(result).toEqual({
      childMode: 0o700,
      schemaMode: 0o600,
      entries: ["schema.json"],
      schema: '{"type":"object","properties":{"answer":{"type":"string"}}}',
      directParent: root.path,
    });
    expect(observedDirectory).toContain(join(root.path, "confirmed-life-codex-"));
    await expect(lstat(observedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes the child when use rejects", async () => {
    const root = await validatedRoot();
    let observedDirectory = "";

    await expect(withCodexTempDirectory({
      root,
      outputSchema: {},
      use: async ({ directoryPath }) => {
        observedDirectory = directoryPath;
        await writeFile(join(directoryPath, "nested-output"), "temporary");
        throw new Error("use failed");
      },
    })).rejects.toThrowError("use failed");
    await expect(lstat(observedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("scavengeStaleCodexDirectories", () => {
  test("deletes only direct exact-prefix owned directories at the stale threshold", async () => {
    const root = await validatedRoot();
    const now = new Date("2026-08-21T12:00:00.000Z");
    const stale = join(root.path, "confirmed-life-codex-stale");
    const fresh = join(root.path, "confirmed-life-codex-fresh");
    const wrongPrefix = join(root.path, "confirmed-life-codexish-stale");
    await Promise.all([mkdir(stale), mkdir(fresh), mkdir(wrongPrefix)]);
    await utimes(stale, new Date(now.getTime() - 3_600_000), new Date(now.getTime() - 3_600_000));
    await utimes(fresh, new Date(now.getTime() - 3_599_999), new Date(now.getTime() - 3_599_999));
    await utimes(wrongPrefix, new Date(0), new Date(0));

    await expect(scavengeStaleCodexDirectories({ root, now, staleAfterMs: 3_600_000 })).resolves.toBe(1);
    await expect(lstat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fresh)).resolves.toBeDefined();
    await expect(lstat(wrongPrefix)).resolves.toBeDefined();
  });

  test("preserves a stale symlink entry and a directory whose owner does not match the validated root UID", async () => {
    const root = await validatedRoot();
    const target = await tempRoot();
    const link = join(root.path, "confirmed-life-codex-link");
    const wrongOwner = join(root.path, "confirmed-life-codex-wrong-owner");
    await symlink(target.path, link);
    await mkdir(wrongOwner);
    await utimes(wrongOwner, new Date(0), new Date(0));

    await expect(scavengeStaleCodexDirectories({
      root: { path: root.path, uid: root.uid + 1 },
      now: new Date("2026-08-21T12:00:00.000Z"),
      staleAfterMs: 3_600_000,
    })).resolves.toBe(0);
    await expect(lstat(link)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    await expect(lstat(wrongOwner)).resolves.toBeDefined();
  });

  test("never follows a nested symlink during scavenging", async () => {
    const root = await validatedRoot();
    const outside = await tempRoot();
    const sentinel = join(outside.path, "sentinel");
    const stale = join(root.path, "confirmed-life-codex-stale-nested-link");
    await writeFile(sentinel, "keep");
    await mkdir(stale);
    await symlink(outside.path, join(stale, "outside"));
    await utimes(stale, new Date(0), new Date(0));

    await scavengeStaleCodexDirectories({
      root,
      now: new Date("2026-08-21T12:00:00.000Z"),
      staleAfterMs: 3_600_000,
    });

    await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
  });
});

async function* output(text: string): AsyncGenerator<Uint8Array> {
  yield encoder.encode(text);
}

function fakeSpawner(stdout: string): CodexProcessSpawner & { spawn: ReturnType<typeof vi.fn> } {
  return {
    spawn: vi.fn((): SpawnedCodexProcess => ({
      pid: 83,
      stdout: output(stdout),
      stderr: output(""),
      exit: Promise.resolve({ code: 0, signal: null }),
      kill: vi.fn(),
    })),
  };
}

const preflight = {
  executable: "/opt/codex",
  cliVersion: "codex-cli 0.148.0-alpha.15" as const,
  authenticatedWith: "ChatGPT" as const,
};

describe("runCodexJsonProbe", () => {
  test("uses the exact isolated exec request before rejecting an incomplete startup proof", async () => {
    const root = await validatedRoot();
    const stdout = [
      { type: "thread.started", thread_id: "thread-1" },
      {
        type: "item.completed",
        item: { type: "error", id: "item_1", message: CODE_MODE_HOST_DISABLED_MESSAGE },
      },
      { type: "turn.started" },
      { type: "item.completed", item: { type: "agent_message", text: "answer" } },
      { type: "turn.completed" },
    ].map((event) => `${JSON.stringify(event)}\n`).join("");
    const spawner = fakeSpawner(stdout);
    const invocation = createCodexJsonInvocation({
      capability: "onboarding_extract",
      templateVersion: "extract@1",
      schemaVersion: "schema@1",
      prompt: "private prompt",
      outputSchema: { type: "object" },
      limits: { timeoutMs: 1_000, maxStdoutBytes: 4_096, maxStderrBytes: 1_024, maxEvents: 8 },
      signal: new AbortController().signal,
    });

    const running = runCodexJsonProbe({
      invocation,
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {
        CODEX_HOME: "/codex-home",
        TMPDIR: "/configured-tmp",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/must-not-leak",
      },
    });
    await expect(running).rejects.toMatchObject({ code: "codex_protocol_invalid" });
    const request = spawner.spawn.mock.calls[0]?.[0];
    expect(request.args).toEqual([
      ...EXPECTED_EXEC_ARGS,
      "--cd", request.cwd,
      "--output-schema", join(request.cwd, "schema.json"),
      "--json",
      "-",
    ]);
    expect(request.args.filter((arg: string) => arg === "--strict-config")).toHaveLength(1);
    expect(request.args.filter((arg: string) => arg === "code_mode_host")).toHaveLength(1);
    expect(request.env).toEqual({
      CODEX_HOME: "/codex-home",
      TMPDIR: "/configured-tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    });
    expect(request.stdin).toEqual(encoder.encode("private prompt"));
    await expect(lstat(request.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("inspectModelVisibleInputs", () => {
  test("uses a fresh initially empty cwd, exact diagnostic args, closed env, and removes the cwd", async () => {
    const root = await validatedRoot();
    const spawner = fakeSpawner("");
    let entriesAtSpawn: string[] = ["not-observed"];
    spawner.spawn.mockImplementation((request): SpawnedCodexProcess => {
      const checked = readdir(request.cwd).then((entries) => { entriesAtSpawn = entries; });
      return {
        pid: 84,
        stdout: (async function* (): AsyncGenerator<Uint8Array> {
          await checked;
          yield encoder.encode(JSON.stringify({ messages: [
            { role: "developer", content: `<cwd>${request.cwd}</cwd>` },
          ] }));
        })(),
        stderr: output(""),
        exit: checked.then(() => ({ code: 0, signal: null })),
        kill: vi.fn(),
      };
    });

    const result = await inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: { CODEX_HOME: "/home", LANG: "C", PATH: "/leak" },
      signal: new AbortController().signal,
    });

    const request = spawner.spawn.mock.calls[0]?.[0];
    expect(entriesAtSpawn).toEqual([]);
    expect(request.args).toEqual(EXPECTED_MESSAGE_INPUT_INSPECTION_ARGS);
    expect(request.cwd).toContain(join(root.path, "confirmed-life-codex-"));
    expect(request.env).toEqual({ CODEX_HOME: "/home", LANG: "C" });
    expect(request.stdin).toEqual(new Uint8Array());
    expect(result).toEqual({
      messageInputsObserved: true,
      projectContextPaths: [],
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
    });
    await expect(lstat(request.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("detects project paths, rule sentinels, and project-local skill payloads", async () => {
    const root = await validatedRoot();
    const projectPath = "/workspace/herring-8";
    const spawner = fakeSpawner(JSON.stringify({ messages: [
      { role: "developer", content: `# AGENTS.md instructions for ${projectPath}\n<INSTRUCTIONS>project rules</INSTRUCTIONS>` },
      { role: "developer", content: "<app-context>application-owned instructions</app-context>" },
      { role: "developer", content: `Project skill payload: ${projectPath}/.agents/skills/local/SKILL.md` },
    ] }));

    await expect(inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({
      messageInputsObserved: true,
      projectContextPaths: [projectPath],
      projectRuleInputsObserved: true,
      projectSkillPayloadsObserved: true,
    });
  });

  test("keeps inert generic catalogue prose and unanchored skill paths non-project", async () => {
    const root = await validatedRoot();
    const spawner = fakeSpawner(JSON.stringify({ messages: [
      {
        role: "developer",
        content: [
          "The generic catalogue may discuss confirmed-life and herring-8 as ordinary words.",
          "It may quote <INSTRUCTIONS> and the phrase project skill payload as inert documentation.",
          "Generic skill path: /Users/person/.codex/skills/catalogue/SKILL.md",
        ].join("\n"),
      },
    ] }));

    await expect(inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({
      messageInputsObserved: true,
      projectContextPaths: [],
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
    });
  });

  test("recognizes the exact app instruction sentinel without repository-name heuristics", async () => {
    const root = await validatedRoot();
    const spawner = fakeSpawner(JSON.stringify({ messages: [
      { role: "developer", content: "<app-context>synthetic app instruction</app-context>" },
    ] }));

    await expect(inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({
      messageInputsObserved: true,
      projectContextPaths: [],
      projectRuleInputsObserved: true,
      projectSkillPayloadsObserved: false,
    });
  });

  test("reports an exact cwd path without misclassifying it as a project rule", async () => {
    const root = await validatedRoot();
    const spawner = fakeSpawner(JSON.stringify({ messages: [
      { role: "developer", content: "<cwd>/workspace/synthetic-project</cwd>" },
    ] }));

    await expect(inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: new AbortController().signal,
    })).resolves.toEqual({
      messageInputsObserved: true,
      projectContextPaths: ["/workspace/synthetic-project"],
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
    });
  });

  test.each([
    ["malformed output", "not-json"],
    ["a missing message list", JSON.stringify({ other: [] })],
    ["an unknown message shape", JSON.stringify({ messages: [{ role: "developer" }] })],
  ])("rejects %s and cleans the diagnostic cwd", async (_name, stdout) => {
    const root = await validatedRoot();
    const spawner = fakeSpawner(stdout);

    await expect(inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });
    const cwd = spawner.spawn.mock.calls[0]?.[0].cwd;
    await expect(lstat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("cleans the diagnostic cwd after caller abort", async () => {
    const root = await validatedRoot();
    const nativeSetImmediate = setImmediate;
    const controller = new AbortController();
    const spawner = fakeSpawner(JSON.stringify({ messages: [] }));
    let resolveExit!: (value: { readonly code: number | null; readonly signal: string | null }) => void;
    const exit = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
      (resolve) => { resolveExit = resolve; },
    );
    spawner.spawn.mockImplementation((): SpawnedCodexProcess => ({
      pid: 85,
      stdout: output(""),
      stderr: output(""),
      exit,
      kill: vi.fn((signal) => { resolveExit({ code: null, signal }); }),
    }));
    const running = inspectModelVisibleInputs({
      preflight,
      spawner,
      tempRoot: root,
      childEnv: {},
      signal: controller.signal,
    });
    while (spawner.spawn.mock.calls.length === 0) {
      await new Promise<void>((resolve) => nativeSetImmediate(resolve));
    }
    const cwd = spawner.spawn.mock.calls[0]?.[0].cwd;

    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await expect(lstat(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
