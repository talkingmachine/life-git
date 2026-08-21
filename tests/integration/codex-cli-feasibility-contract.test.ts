import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { CodexRuntimeError } from "../../src/infrastructure/codex-cli/contracts";

const FEATURE_NAMES = [
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_full_cdp_access",
  "code_mode",
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

const STARTUP_NOTICES = [
  "approval_policy_never_to_unless_trusted",
  "code_mode_host_disabled",
] as const;

const ARTIFACT_KEYS = [
  "schemaVersion",
  "cliVersion",
  "authenticatedWith",
  "disabledFeatures",
  "strictExecConfig",
  "messageInputsObserved",
  "diagnosticWorkingDirectory",
  "closedChildEnvironment",
  "projectContextPaths",
  "projectRuleInputsObserved",
  "projectSkillPayloadsObserved",
  "callableSkillFeaturesDisabled",
  "codexExecProcessCount",
  "eventTypes",
  "startupNotices",
  "toolEventTypes",
  "resultSchemaVersion",
  "resultDigest",
  "stdoutBytes",
  "stderrBytes",
  "eventCount",
  "elapsedMs",
  "residualTempDirectories",
  "sensitiveSentinelHits",
] as const;

const DIAGNOSTIC_KEYS = [
  "schemaVersion",
  "stage",
  "errorCode",
  "failureKind",
  "stdoutObserved",
  "eventCount",
  "eventTypes",
  "itemCount",
  "itemTypes",
  "overflowed",
] as const;

const EXACT_RESULT = '{"schemaVersion":"codex-runtime-smoke@1","status":"tool_free"}';
const EXACT_RESULT_DIGEST = "7c6f481c682d163ec58131701487742c77f396e74b6ea97cbc2d891192095192";
const SYNTHETIC_SENTINEL = "SYNTHETIC_CODEX_RUNTIME_SENTINEL_4F7B1C9D";
const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("Task 3 files", () => {
  test("exposes the exact package entry point", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };

    expect(packageJson.scripts?.["eval:codex-runtime-feasibility"]).toBe(
      "node --import tsx evals/codex-cli-feasibility.ts",
    );
  });

  test("parses the diagnostic path only when it is explicitly requested", async () => {
    const module = await loadFeasibilityModule();

    expect(module.parseCodexCliFeasibilityArguments([
      "--artifact", "data/evals/codex-cli-feasibility.json",
    ])).toEqual({ artifactPath: "data/evals/codex-cli-feasibility.json" });
    expect(module.parseCodexCliFeasibilityArguments([
      "--artifact", "data/evals/codex-cli-feasibility.json",
      "--diagnostic", "data/evals/codex-cli-feasibility-diagnostic.json",
    ])).toEqual({
      artifactPath: "data/evals/codex-cli-feasibility.json",
      diagnosticPath: "data/evals/codex-cli-feasibility-diagnostic.json",
    });
    expect(() => module.parseCodexCliFeasibilityArguments([
      "--diagnostic", "data/evals/codex-cli-feasibility-diagnostic.json",
    ])).toThrow("codex_tool_isolation_unproven");
  });

  test("uses one reviewed synthetic fixture with the exact closed result schema", async () => {
    const fixture = JSON.parse(await readFile(
      resolve("evals/fixtures/codex-cli/runtime-cases.json"),
      "utf8",
    )) as Record<string, unknown>;

    expect(Object.keys(fixture)).toEqual([
      "fixtureVersion",
      "sensitiveSentinels",
      "prompt",
      "outputSchema",
      "expectedResult",
    ]);
    expect(fixture.expectedResult).toEqual({
      schemaVersion: "codex-runtime-smoke@1",
      status: "tool_free",
    });
    expect(fixture.outputSchema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "status"],
      properties: {
        schemaVersion: { type: "string", enum: ["codex-runtime-smoke@1"] },
        status: { type: "string", enum: ["tool_free"] },
      },
    });
    expect(fixture.sensitiveSentinels).toEqual([SYNTHETIC_SENTINEL]);
    expect(fixture.prompt).toEqual(expect.stringContaining(SYNTHETIC_SENTINEL));
    for (const requestedCapability of [
      "repository", "pwd", "browser", "app", "plugin", "MCP", "skill", "multi-agent", "image", "schema",
    ]) {
      expect(fixture.prompt).toEqual(expect.stringContaining(requestedCapability));
    }
  });
});

describe("Codex CLI diagnostic protocol observer", () => {
  test("collects only closed event and item type names across split JSONL chunks", async () => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();
    const encoded = new TextEncoder().encode([
      JSON.stringify({ type: "thread.started", thread_id: SYNTHETIC_SENTINEL }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: SYNTHETIC_SENTINEL, model: SYNTHETIC_SENTINEL },
      }),
      JSON.stringify({
        type: "item.updated",
        item: { type: "todo_list", items: [{ text: SYNTHETIC_SENTINEL }] },
      }),
      JSON.stringify({ type: SYNTHETIC_SENTINEL, item: { type: SYNTHETIC_SENTINEL } }),
      "not-json",
      "",
    ].join("\n"));

    observer.observe(encoded.slice(0, 17));
    observer.observe(encoded.slice(17, 91));
    observer.observe(encoded.slice(91));
    observer.finish();

    const snapshot = observer.snapshot();
    expect(snapshot).toEqual({
      stdoutObserved: true,
      eventCount: 5,
      eventTypes: ["thread.started", "item.completed", "item.updated", "unknown", "malformed"],
      itemCount: 3,
      itemTypes: ["agent_message", "todo_list", "unknown"],
      failureKind: "none",
      overflowed: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_SENTINEL);
  });

  test("classifies only bundled enum fields in the exact failed-process fingerprint", async () => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();
    const encoded = new TextEncoder().encode([
      JSON.stringify({ type: "thread.started", thread_id: SYNTHETIC_SENTINEL }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "file_change", changes: [{ path: SYNTHETIC_SENTINEL }] },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "error",
          codex_error_info: "bad_request",
          error: { codex_error_info: "sandbox_error" },
          message: SYNTHETIC_SENTINEL,
        },
      }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "stream_error", message: SYNTHETIC_SENTINEL }),
      JSON.stringify({
        type: "turn.failed",
        codex_error_info: "unauthorized",
        error: {
          codex_error_info: "response_stream_disconnected",
          message: SYNTHETIC_SENTINEL,
        },
      }),
      "",
    ].join("\n"));

    observer.observe(encoded);
    observer.finish();

    const snapshot = observer.snapshot();
    expect(snapshot).toEqual({
      stdoutObserved: true,
      eventCount: 6,
      eventTypes: [
        "thread.started",
        "item.completed",
        "item.completed",
        "turn.started",
        "stream_error",
        "turn.failed",
      ],
      itemCount: 2,
      itemTypes: ["file_change", "error"],
      failureKind: "response_stream_disconnected",
      overflowed: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_SENTINEL);
  });

  test("accepts every exact pinned event and item tag", async () => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();
    const events = [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "turn.completed" },
      { type: "turn.failed", error: { codex_error_info: "other" } },
      { type: "item.started", item: { type: "agent_message" } },
      { type: "item.updated", item: { type: "reasoning" } },
      { type: "item.completed", item: { type: "command_execution" } },
      { type: "error" },
      { type: "stream_error" },
      { type: "item.completed", item: { type: "file_change" } },
      { type: "item.completed", item: { type: "mcp_tool_call" } },
      { type: "item.completed", item: { type: "web_search" } },
      { type: "item.completed", item: { type: "todo_list" } },
      { type: "item.completed", item: { type: "collab_tool_call" } },
      { type: "item.completed", item: { type: "error" } },
    ];

    observer.observe(new TextEncoder().encode(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`));
    observer.finish();

    expect(observer.snapshot()).toEqual({
      stdoutObserved: true,
      eventCount: 15,
      eventTypes: [
        "thread.started",
        "turn.started",
        "turn.completed",
        "turn.failed",
        "item.started",
        "item.updated",
        "item.completed",
        "error",
        "stream_error",
        "item.completed",
        "item.completed",
        "item.completed",
        "item.completed",
        "item.completed",
        "item.completed",
      ],
      itemCount: 9,
      itemTypes: [
        "agent_message",
        "reasoning",
        "command_execution",
        "file_change",
        "mcp_tool_call",
        "web_search",
        "todo_list",
        "collab_tool_call",
        "error",
      ],
      failureKind: "other",
      overflowed: false,
    });
  });

  test("maps removed generic item aliases to unknown", async () => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();
    const removedAliases = [
      "command",
      "shell",
      "browser",
      "mcp",
      "app",
      "plugin",
      "skill",
      "image",
      "image_generation",
      "tool_call",
      "tool_result",
      "function_call",
      "function_call_output",
      "collab_agent_tool_call",
    ];
    const lines = removedAliases.map((type) => JSON.stringify({ type: "item.completed", item: { type } }));

    observer.observe(new TextEncoder().encode(`${lines.join("\n")}\n`));
    observer.finish();

    const snapshot = observer.snapshot();
    expect(snapshot.itemCount).toBe(removedAliases.length);
    expect(snapshot.itemTypes).toEqual(removedAliases.map(() => "unknown"));
    expect(snapshot.failureKind).toBe("none");
  });

  test("retains at most MAX_CODEX_EVENTS diagnostic names", async () => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();
    const line = JSON.stringify({ type: "item.completed", item: { type: "agent_message" } });
    const failureLine = JSON.stringify({
      type: "turn.failed",
      item: { type: "error" },
      error: { codex_error_info: "response_stream_disconnected" },
    });

    observer.observe(new TextEncoder().encode(
      `${[...Array.from({ length: 256 }, () => line), failureLine].join("\n")}\n`,
    ));
    observer.finish();

    const snapshot = observer.snapshot();
    expect(snapshot.eventCount).toBe(256);
    expect(snapshot.eventTypes).toHaveLength(256);
    expect(snapshot.itemCount).toBe(256);
    expect(snapshot.itemTypes).toHaveLength(256);
    expect(snapshot.failureKind).toBe("response_stream_disconnected");
    expect(snapshot.overflowed).toBe(true);
  });

  test.each([
    ["root field", { type: "turn.failed", codex_error_info: "bad_request" }, "unknown"],
    [
      "item fields",
      {
        type: "turn.failed",
        item: {
          type: "error",
          codex_error_info: "sandbox_error",
          error: { codex_error_info: "unauthorized" },
        },
      },
      "unknown",
    ],
    [
      "removed non-discriminant",
      { type: "turn.failed", error: { codex_error_info: "turn_kind" } },
      "unknown",
    ],
    ["malformed error", { type: "turn.failed", error: [] }, "unknown"],
    [
      "non-failure item",
      { type: "item.completed", item: { type: "error", codex_error_info: "bad_request" } },
      "none",
    ],
  ] as const)("ignores deceptive %s failure fields", async (_label, event, expectedFailureKind) => {
    const module = await loadFeasibilityModule();
    const observer = module.createCodexCliDiagnosticProtocolObserver();

    observer.observe(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
    observer.finish();

    expect(observer.snapshot().failureKind).toBe(expectedFailureKind);
  });
});

describe("runCodexCliFeasibilityForTest", () => {
  test("rejects const-only property schemas before any probe", async () => {
    const artifactPath = await freshArtifactPath();
    const fixture = await loadFixture() as Record<string, unknown>;
    const dependencies = validDependencies([]);
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: {
        ...fixture,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "status"],
          properties: {
            schemaVersion: { const: "codex-runtime-smoke@1" },
            status: { const: "tool_free" },
          },
        },
      },
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runPreflight).not.toHaveBeenCalled();
    expect(dependencies.runModelProbe).not.toHaveBeenCalled();
    await expectArtifactAbsent(artifactPath);
  });

  test("rejects type-and-const leaf schemas before any probe", async () => {
    const artifactPath = await freshArtifactPath();
    const fixture = await loadFixture() as Record<string, unknown>;
    const dependencies = validDependencies([]);
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: {
        ...fixture,
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "status"],
          properties: {
            schemaVersion: { type: "string", const: "codex-runtime-smoke@1" },
            status: { type: "string", const: "tool_free" },
          },
        },
      },
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runPreflight).not.toHaveBeenCalled();
    expect(dependencies.runModelProbe).not.toHaveBeenCalled();
    await expectArtifactAbsent(artifactPath);
  });

  test("builds production message-input proof in the exact boundary order", async () => {
    const artifactPath = await freshArtifactPath();
    const module = await loadFeasibilityModule();
    const messageInputs = module.createCodexCliMessageInputProof({
      messageInputs: {
        messageInputsObserved: true,
        projectContextPaths: [],
        projectRuleInputsObserved: false,
        projectSkillPayloadsObserved: false,
      },
      diagnosticWorkingDirectory: "fresh_validated_empty",
      closedChildEnvironment: true,
      callableSkillFeaturesDisabled: true,
    });

    expect(Object.keys(messageInputs)).toEqual([
      "messageInputsObserved",
      "diagnosticWorkingDirectory",
      "closedChildEnvironment",
      "projectContextPaths",
      "projectRuleInputsObserved",
      "projectSkillPayloadsObserved",
      "callableSkillFeaturesDisabled",
    ]);
    expect(messageInputs).toEqual(validMessageInputs());

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...validDependencies([], { messageInputs }),
    })).resolves.toMatchObject({ schemaVersion: "codex-cli-feasibility@1" });
  });

  test("proves prerequisites in order, invokes one model probe, and writes only the exact redacted artifact", async () => {
    const artifactPath = await freshArtifactPath();
    const calls: string[] = [];
    const dependencies = validDependencies(calls);
    const module = await loadFeasibilityModule();

    const artifact = await module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...dependencies,
    });

    expect(calls).toEqual(["preflight", "inventory", "message-inputs", "model"]);
    expect(dependencies.runModelProbe).toHaveBeenCalledTimes(1);
    expect(Object.keys(artifact)).toEqual(ARTIFACT_KEYS);
    expect(Object.keys(artifact.disabledFeatures)).toEqual(FEATURE_NAMES);
    expect(Object.values(artifact.disabledFeatures)).toEqual(Array.from({ length: 23 }, () => false));
    expect(artifact).toEqual({
      schemaVersion: "codex-cli-feasibility@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      authenticatedWith: "ChatGPT",
      disabledFeatures: exactDisabledFeatures(),
      strictExecConfig: true,
      messageInputsObserved: true,
      diagnosticWorkingDirectory: "fresh_validated_empty",
      closedChildEnvironment: true,
      projectContextPaths: [],
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
      callableSkillFeaturesDisabled: true,
      codexExecProcessCount: 1,
      eventTypes: [
        "thread.started",
        "item.completed",
        "item.completed",
        "turn.started",
        "item.completed",
        "turn.completed",
      ],
      startupNotices: STARTUP_NOTICES,
      toolEventTypes: [],
      resultSchemaVersion: "codex-runtime-smoke@1",
      resultDigest: EXACT_RESULT_DIGEST,
      stdoutBytes: 317,
      stderrBytes: 19,
      eventCount: 6,
      elapsedMs: 37,
      residualTempDirectories: [],
      sensitiveSentinelHits: [],
    });

    const serializedArtifact = await readFile(artifactPath, "utf8");
    expect(JSON.parse(serializedArtifact)).toEqual(artifact);
    expect(serializedArtifact.endsWith("\n")).toBe(true);
    expect(serializedArtifact).not.toContain(SYNTHETIC_SENTINEL);
    expect(serializedArtifact).not.toContain(EXACT_RESULT);
    expect(serializedArtifact).not.toContain("tool_free");
  });

  test("accepts the exact production-proved startup notice pair", async () => {
    const artifactPath = await freshArtifactPath();
    const module = await loadFeasibilityModule();

    const artifact = await module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...validDependencies([]),
    });

    expect(artifact.startupNotices).toEqual(STARTUP_NOTICES);
    expect(artifact.eventTypes).toEqual([
      "thread.started",
      "item.completed",
      "item.completed",
      "turn.started",
      "item.completed",
      "turn.completed",
    ]);
  });

  test("stops before model invocation when message inputs contain project context", async () => {
    const artifactPath = await freshArtifactPath();
    const dependencies = validDependencies([], {
      messageInputs: {
        ...validMessageInputs(),
        projectContextPaths: ["/demo/workspace/AGENTS.md"],
      },
    });
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runModelProbe).not.toHaveBeenCalled();
    await expectArtifactAbsent(artifactPath);
  });

  test("removes a stale passing artifact before attempting new proof", async () => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, '{"schemaVersion":"codex-cli-feasibility@1"}\n', "utf8");
    const dependencies = validDependencies([]);
    dependencies.runPreflight.mockRejectedValueOnce(new Error("synthetic preflight failure"));
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runModelProbe).not.toHaveBeenCalled();
    await expectArtifactAbsent(artifactPath);
  });

  test("writes a closed process-stage diagnostic only when explicitly configured", async () => {
    const artifactPath = await freshArtifactPath();
    const diagnosticPath = join(dirnameOf(artifactPath), "diagnostic.json");
    const dependencies = validDependencies([], {
      modelError: new CodexRuntimeError("codex_process_failed"),
    });
    const readModelObservation = vi.fn(() => ({
      stdoutObserved: false,
      eventCount: 0,
      eventTypes: [],
      itemCount: 0,
      itemTypes: [],
      failureKind: "none",
      overflowed: false,
    }));
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      diagnostic: { path: diagnosticPath, readModelObservation },
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(readModelObservation).toHaveBeenCalledTimes(1);
    await expectArtifactAbsent(artifactPath);
    const diagnosticText = await readFile(diagnosticPath, "utf8");
    const diagnostic = JSON.parse(diagnosticText) as Record<string, unknown>;
    expect(Object.keys(diagnostic)).toEqual(DIAGNOSTIC_KEYS);
    expect(diagnostic).toEqual({
      schemaVersion: "codex-cli-feasibility-diagnostic@1",
      stage: "model_process",
      errorCode: "codex_process_failed",
      failureKind: "none",
      stdoutObserved: false,
      eventCount: 0,
      eventTypes: [],
      itemCount: 0,
      itemTypes: [],
      overflowed: false,
    });
  });

  test("writes sanitized protocol names without raw output when JSONL validation fails", async () => {
    const artifactPath = await freshArtifactPath();
    const diagnosticPath = join(dirnameOf(artifactPath), "diagnostic.json");
    const dependencies = validDependencies([], {
      modelError: new CodexRuntimeError("codex_protocol_invalid"),
    });
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      diagnostic: {
        path: diagnosticPath,
        readModelObservation: () => ({
          stdoutObserved: true,
          eventCount: 4,
          eventTypes: ["thread.started", SYNTHETIC_SENTINEL, "item.completed", "turn.failed"],
          itemCount: 3,
          itemTypes: ["reasoning", "agent_message", SYNTHETIC_SENTINEL],
          failureKind: SYNTHETIC_SENTINEL,
          overflowed: true,
        }),
      },
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    await expectArtifactAbsent(artifactPath);
    const diagnosticText = await readFile(diagnosticPath, "utf8");
    expect(JSON.parse(diagnosticText)).toEqual({
      schemaVersion: "codex-cli-feasibility-diagnostic@1",
      stage: "model_protocol",
      errorCode: "codex_protocol_invalid",
      failureKind: "unknown",
      stdoutObserved: true,
      eventCount: 4,
      eventTypes: ["thread.started", "unknown", "item.completed", "turn.failed"],
      itemCount: 3,
      itemTypes: ["reasoning", "agent_message", "unknown"],
      overflowed: true,
    });
    expect(diagnosticText).not.toContain(SYNTHETIC_SENTINEL);
    expect(diagnosticText).not.toContain("result");
    expect(diagnosticText).not.toContain("stderr");
  });

  test("distinguishes post-JSONL result validation from model protocol failure", async () => {
    const artifactPath = await freshArtifactPath();
    const diagnosticPath = join(dirnameOf(artifactPath), "diagnostic.json");
    const dependencies = validDependencies([], {
      model: {
        ...validModelProof(),
        finalMessage: '{"schemaVersion":"codex-runtime-smoke@2","status":"tool_free"}',
      },
    });
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      diagnostic: {
        path: diagnosticPath,
        readModelObservation: () => ({
          stdoutObserved: true,
          eventCount: 4,
          eventTypes: ["thread.started", "turn.started", "item.completed", "turn.completed"],
          itemCount: 1,
          itemTypes: ["agent_message"],
          failureKind: "none",
          overflowed: false,
        }),
      },
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    await expectArtifactAbsent(artifactPath);
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toMatchObject({
      stage: "result_validation",
      errorCode: "codex_tool_isolation_unproven",
      failureKind: "none",
      stdoutObserved: true,
      eventCount: 4,
      itemCount: 1,
      overflowed: false,
    });
  });

  test.each([
    ["a missing feature", { disabledFeatures: missingFeatureInventory() }],
    ["an enabled feature", { disabledFeatures: { ...exactDisabledFeatures(), browser_use: true } }],
    ["an unknown feature", { disabledFeatures: { ...exactDisabledFeatures(), future_tool: false } }],
    ["unobserved message inputs", { messageInputs: { ...validMessageInputs(), messageInputsObserved: false } }],
    ["a non-empty diagnostic cwd", {
      messageInputs: { ...validMessageInputs(), diagnosticWorkingDirectory: "not_empty" },
    }],
    ["an open child environment", { messageInputs: { ...validMessageInputs(), closedChildEnvironment: false } }],
    ["project rules", { messageInputs: { ...validMessageInputs(), projectRuleInputsObserved: true } }],
    ["a project skill payload", {
      messageInputs: { ...validMessageInputs(), projectSkillPayloadsObserved: true },
    }],
    ["callable skill features", {
      messageInputs: { ...validMessageInputs(), callableSkillFeaturesDisabled: false },
    }],
  ])("writes no artifact and makes zero model calls for %s", async (_name, override) => {
    const artifactPath = await freshArtifactPath();
    const dependencies = validDependencies([], override);
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runModelProbe).not.toHaveBeenCalled();
    await expectArtifactAbsent(artifactPath);
  });

  test.each([
    ["missing strict config", { strictExecConfig: false }],
    ["an open exec environment", { closedChildEnvironment: false }],
    ["two exec processes", { codexExecProcessCount: 2 }],
    ["a tool event", { toolEventTypes: ["command_execution"] }],
    ["protocol drift", { eventTypes: ["thread.started", "turn.started", "future.event", "turn.completed"] }],
    ["a missing startup notice", {
      startupNotices: ["approval_policy_never_to_unless_trusted"],
    }],
    ["reversed startup notices", {
      startupNotices: ["code_mode_host_disabled", "approval_policy_never_to_unless_trusted"],
    }],
    ["an extra startup notice", {
      startupNotices: [...STARTUP_NOTICES, "future_notice"],
    }],
    ["a notice-prefix mismatch", {
      eventTypes: ["thread.started", "item.completed", "turn.started", "item.completed", "turn.completed"],
      eventCount: 5,
    }],
    ["duplicate notice prefixes", {
      eventTypes: [
        "thread.started",
        "item.completed",
        "item.completed",
        "item.completed",
        "turn.started",
        "item.completed",
        "turn.completed",
      ],
      eventCount: 7,
    }],
    ["event-count drift", { eventCount: 5 }],
    ["schema drift", { finalMessage: '{"schemaVersion":"codex-runtime-smoke@2","status":"tool_free"}' }],
    ["extra result data", {
      finalMessage: '{"schemaVersion":"codex-runtime-smoke@1","status":"tool_free","extra":true}',
    }],
    ["a sensitive sentinel hit", {
      finalMessage: `{"schemaVersion":"codex-runtime-smoke@1","status":"${SYNTHETIC_SENTINEL}"}`,
    }],
    ["temp residue", { residualTempDirectories: ["confirmed-life-codex-leftover"] }],
  ])("writes no artifact when the model proof contains %s", async (_name, modelOverride) => {
    const artifactPath = await freshArtifactPath();
    const dependencies = validDependencies([], { model: { ...validModelProof(), ...modelOverride } });
    const module = await loadFeasibilityModule();

    await expect(module.runCodexCliFeasibilityForTest({
      artifactPath,
      fixture: await loadFixture(),
      signal: new AbortController().signal,
      ...dependencies,
    })).rejects.toMatchObject({ code: "codex_tool_isolation_unproven" });

    expect(dependencies.runModelProbe).toHaveBeenCalledTimes(1);
    await expectArtifactAbsent(artifactPath);
  });
});

async function loadFeasibilityModule(): Promise<typeof import("../../evals/codex-cli-feasibility")> {
  return import("../../evals/codex-cli-feasibility");
}

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(resolve("evals/fixtures/codex-cli/runtime-cases.json"), "utf8"));
}

function validDependencies(
  calls: string[],
  overrides: {
    readonly disabledFeatures?: unknown;
    readonly messageInputs?: unknown;
    readonly model?: unknown;
    readonly modelError?: unknown;
  } = {},
) {
  return {
    runPreflight: vi.fn(async () => {
      calls.push("preflight");
      return {
        cliVersion: "codex-cli 0.148.0-alpha.15",
        authenticatedWith: "ChatGPT",
      };
    }),
    readFeatureInventory: vi.fn(async () => {
      calls.push("inventory");
      return overrides.disabledFeatures ?? exactDisabledFeatures();
    }),
    inspectMessageInputs: vi.fn(async () => {
      calls.push("message-inputs");
      return overrides.messageInputs ?? validMessageInputs();
    }),
    runModelProbe: vi.fn(async () => {
      calls.push("model");
      if (overrides.modelError !== undefined) throw overrides.modelError;
      return overrides.model ?? validModelProof();
    }),
  };
}

function exactDisabledFeatures(): Record<(typeof FEATURE_NAMES)[number], false> {
  return {
    apps: false,
    auth_elicitation: false,
    browser_use: false,
    browser_use_full_cdp_access: false,
    code_mode: false,
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
  };
}

function missingFeatureInventory(): Record<string, false> {
  const inventory: Record<string, false> = { ...exactDisabledFeatures() };
  delete inventory.workspace_dependencies;
  return inventory;
}

function validMessageInputs(): Record<string, unknown> {
  return {
    messageInputsObserved: true,
    diagnosticWorkingDirectory: "fresh_validated_empty",
    closedChildEnvironment: true,
    projectContextPaths: [],
    projectRuleInputsObserved: false,
    projectSkillPayloadsObserved: false,
    callableSkillFeaturesDisabled: true,
  };
}

function validModelProof(): Record<string, unknown> {
  return {
    strictExecConfig: true,
    closedChildEnvironment: true,
    codexExecProcessCount: 1,
    eventTypes: [
      "thread.started",
      "item.completed",
      "item.completed",
      "turn.started",
      "item.completed",
      "turn.completed",
    ],
    startupNotices: [...STARTUP_NOTICES],
    toolEventTypes: [],
    finalMessage: EXACT_RESULT,
    stdoutBytes: 317,
    stderrBytes: 19,
    eventCount: 6,
    elapsedMs: 37,
    residualTempDirectories: [],
  };
}

async function freshArtifactPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-feasibility-contract-"));
  createdDirectories.push(directory);
  return join(directory, "artifact.json");
}

function dirnameOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

async function expectArtifactAbsent(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}
