import { describe, expect, test } from "vitest";

import type { CodexJsonInvocation } from "../../src/infrastructure/codex-cli/contracts";
import { CODEX_PROTOCOL_NOTICE_REVISION } from "../../src/infrastructure/codex-cli/event-stream";
import {
  buildCodexExecArgs,
  CODEX_DISABLED_FEATURES,
  CODEX_WEB_SEARCH_DISABLED_FEATURES,
  codexPolicyFingerprint,
  parseSupportedCodexCliVersion,
} from "../../src/infrastructure/codex-cli/policy";

const EXPECTED_DISABLED_FEATURES = [
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

function invocation(
  reasoningEffort: "low" | "medium",
  toolPolicy: "codex-tools-none@2" | "codex-tools-web-search@1",
): CodexJsonInvocation {
  return {
    capability: toolPolicy === "codex-tools-web-search@1" ? "source.discover" : "onboarding.extract",
    reasoningEffort,
    toolPolicy,
    templateVersion: "template@1",
    schemaVersion: "schema@1",
    prompt: "private user payload must stay on stdin",
    outputSchema: {},
    limits: { timeoutMs: 1, maxStdoutBytes: 1, maxStderrBytes: 1, maxEvents: 1 },
    signal: new AbortController().signal,
  };
}

describe("parseSupportedCodexCliVersion", () => {
  test("accepts the supported alpha family", () => {
    expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.4\n"))
      .toBe("codex-cli 0.149.0-alpha.4");
    expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.27\n"))
      .toBe("codex-cli 0.149.0-alpha.27");
  });

  test.each([
    "codex-cli 0.148.0-alpha.99\n",
    "codex-cli 0.149.0-alpha.3\n",
    "codex-cli 0.150.0-alpha.1\n",
    "codex-cli 0.149.0-alpha.4 extra\n",
    "codex-cli 0.149.0-alpha.000004\n",
    "codex-cli 0.149.0-alpha.1000000\n",
  ])(
    "rejects unsupported version output %j", (stdout) => {
      expect(() => parseSupportedCodexCliVersion(stdout)).toThrowError("codex_version_mismatch");
    },
  );
});

describe("buildCodexExecArgs", () => {
  test("builds the fixed zero-tool extraction argv without user payload", () => {
    const args = buildCodexExecArgs(invocation("low", "codex-tools-none@2"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(args).toEqual([
      "exec", "--strict-config", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--model", "gpt-5.6-terra", "-c", "model_reasoning_effort=\"low\"",
      ...EXPECTED_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      "--sandbox", "read-only", "--skip-git-repo-check", "--cd", "/owned/fresh",
      "--output-schema", "/owned/fresh/schema.json", "--json", "-",
    ]);
    expect(args.filter((arg) => arg === "exec")).toHaveLength(1);
    expect(args).not.toContain("--search");
    expect(args).not.toContain("private user payload must stay on stdin");
    expect(args.join("\0")).not.toMatch(/--(?:ask-for-approval|approve-for-me|profile|add-dir)/);
  });

  test("puts the only allowed discovery tool before exec and fixes medium effort", () => {
    const args = buildCodexExecArgs(invocation("medium", "codex-tools-web-search@1"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(args.slice(0, 6)).toEqual(["--search", "--enable", "code_mode", "--enable", "code_mode_host", "exec"]);
    expect(args.slice(5, 7)).toEqual(["exec", "-c"]);
    expect(args).toContain("suppress_unstable_features_warning=true");
    expect(CODEX_WEB_SEARCH_DISABLED_FEATURES).not.toContain("code_mode");
    expect(CODEX_WEB_SEARCH_DISABLED_FEATURES).not.toContain("code_mode_host");
    expect(args).toContain("model_reasoning_effort=\"medium\"");
    expect(args.join("\0")).not.toMatch(/--(?:ask-for-approval|approve-for-me|profile|add-dir)/);
  });

  test("binds the complete retained disabled-feature tuple into argv and fingerprint", () => {
    const args = buildCodexExecArgs(invocation("low", "codex-tools-none@2"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(CODEX_DISABLED_FEATURES).toEqual(EXPECTED_DISABLED_FEATURES);
    expect(EXPECTED_DISABLED_FEATURES.every((feature) => args.includes(`--disable`) &&
      args.some((entry, index) => entry === "--disable" && args[index + 1] === feature))).toBe(true);
    expect(codexPolicyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(CODEX_PROTOCOL_NOTICE_REVISION).toBe("alpha.4-reviewed-web-search@3");
  });
});
