import { describe, expect, test } from "vitest";

import type { CodexJsonInvocation } from "../../src/infrastructure/codex-cli/contracts";
import { CODEX_PROTOCOL_NOTICE_REVISION } from "../../src/infrastructure/codex-cli/event-stream";
import { REVIEWED_INSTALLATION_DIGESTS } from "../../src/infrastructure/codex-cli/reviewed-installation";
import {
  buildCodexExecArgs,
  CODEX_DISABLED_FEATURES,
  CODEX_FIXED_EXEC_CONFIGS,
  codexPolicyFingerprint,
  deriveCodexPolicyFingerprintForTest,
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
  toolPolicy: "codex-tools-none@2" | "codex-tools-web-search@2",
): CodexJsonInvocation {
  return {
    capability: toolPolicy === "codex-tools-web-search@2" ? "source.discover" : "onboarding.extract",
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
      "exec", ...CODEX_FIXED_EXEC_CONFIGS.flatMap((config) => ["-c", config]),
      "--strict-config", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--model", "gpt-5.6-terra", "-c", "model_reasoning_effort=\"low\"",
      ...EXPECTED_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      "--sandbox", "read-only", "--skip-git-repo-check", "--cd", "/owned/fresh",
      "--output-schema", "/owned/fresh/schema.json", "--json", "-",
    ]);
    expect(args.filter((arg) => arg === "exec")).toHaveLength(1);
    expect(args).not.toContain("--search");
    expectFixedConfigs(args);
    expect(args).not.toContain("private user payload must stay on stdin");
    expect(args.join("\0")).not.toMatch(/--(?:ask-for-approval|approve-for-me|profile|add-dir)/);
  });

  test("puts the only allowed discovery tool before exec and fixes medium effort", () => {
    const args = buildCodexExecArgs(invocation("medium", "codex-tools-web-search@2"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(args.slice(0, 2)).toEqual(["--search", "exec"]);
    expectFixedConfigs(args);
    expect(args).toContain("code_mode");
    expect(args).toContain("code_mode_host");
    expect(args).toContain("model_reasoning_effort=\"medium\"");
    expect(args.join("\0")).not.toMatch(/--(?:ask-for-approval|approve-for-me|profile|add-dir)/);
    expect(args).toEqual([
      "--search", "exec", ...CODEX_FIXED_EXEC_CONFIGS.flatMap((config) => ["-c", config]),
      "--strict-config", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--model", "gpt-5.4", "-c", "model_reasoning_effort=\"medium\"",
      ...EXPECTED_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
      "--sandbox", "read-only", "--skip-git-repo-check", "--cd", "/owned/fresh",
      "--output-schema", "/owned/fresh/schema.json", "--json", "-",
    ]);
  });

  test("keeps Code Mode disabled while using the capability-owned direct-search model", () => {
    const args = buildCodexExecArgs(invocation("medium", "codex-tools-web-search@2"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(args.slice(0, 2)).toEqual(["--search", "exec"]);
    expect(args).toContain("gpt-5.4");
    expect(args).not.toContain("--enable");
    for (const feature of CODEX_DISABLED_FEATURES) {
      expect(args).toContain(feature);
    }
  });

  test("binds the complete retained disabled-feature tuple into argv and fingerprint", () => {
    const args = buildCodexExecArgs(invocation("low", "codex-tools-none@2"), "/owned/fresh", "/owned/fresh/schema.json");

    expect(CODEX_DISABLED_FEATURES).toEqual(EXPECTED_DISABLED_FEATURES);
    expect(EXPECTED_DISABLED_FEATURES.every((feature) => args.includes(`--disable`) &&
      args.some((entry, index) => entry === "--disable" && args[index + 1] === feature))).toBe(true);
    expect(codexPolicyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(CODEX_PROTOCOL_NOTICE_REVISION).toBe("alpha.4-reviewed-web-search@6");
  });

  test("binds both reviewed binary digests into the policy fingerprint", () => {
    const firstDrift = [`0${REVIEWED_INSTALLATION_DIGESTS[0].slice(1)}`, REVIEWED_INSTALLATION_DIGESTS[1]] as const;
    const secondDrift = [REVIEWED_INSTALLATION_DIGESTS[0], `0${REVIEWED_INSTALLATION_DIGESTS[1].slice(1)}`] as const;

    expect(codexPolicyFingerprint).toBe(deriveCodexPolicyFingerprintForTest(REVIEWED_INSTALLATION_DIGESTS));
    expect(deriveCodexPolicyFingerprintForTest(firstDrift)).not.toBe(codexPolicyFingerprint);
    expect(deriveCodexPolicyFingerprintForTest(secondDrift)).not.toBe(codexPolicyFingerprint);
  });
});

function expectFixedConfigs(args: readonly string[]): void {
  for (const config of CODEX_FIXED_EXEC_CONFIGS) {
    expect(args.filter((entry) => entry === config)).toHaveLength(1);
    expect(args.indexOf(config)).toBeGreaterThan(args.indexOf("exec"));
    expect(args.indexOf(config)).toBeLessThan(args.indexOf("--model"));
  }
}
