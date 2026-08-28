import { createHash } from "node:crypto";

import {
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_MODEL,
  CodexRuntimeError,
  type CodexJsonInvocation,
} from "./contracts";
import { CODEX_PROTOCOL_NOTICE_REVISION } from "./event-stream";
import {
  REVIEWED_INSTALLATION_DIGESTS,
  REVIEWED_INSTALLATION_REVISION,
} from "./reviewed-installation";

export const CODEX_DISABLED_FEATURES = Object.freeze([
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
] as const);

export const CODEX_WEB_SEARCH_DISABLED_FEATURES = Object.freeze(
  CODEX_DISABLED_FEATURES.filter((feature) => feature !== "code_mode" && feature !== "code_mode_host"),
);

export const CODEX_FIXED_EXEC_CONFIGS = Object.freeze([
  "tools.experimental_request_user_input.enabled=false",
  "tools.update_plan.enabled=false",
  "check_for_update_on_startup=false",
  "analytics.enabled=false",
  "feedback.enabled=false",
  "allow_login_shell=false",
] as const);

export const CODEX_WEB_SEARCH_ENABLED_FEATURES = Object.freeze(["code_mode", "code_mode_host"] as const);

const CODEX_EXEC_ARGV_GRAMMAR = Object.freeze([
  "web-search: --search --enable code_mode --enable code_mode_host before exec; -c suppress_unstable_features_warning=true after exec",
  "fixed exec-level -c safety configs before model and effort",
  "exec --strict-config --ephemeral --ignore-user-config --ignore-rules",
  "--model gpt-5.6-terra -c model_reasoning_effort=<fixed invocation effort>",
  "--disable <each retained disabled feature>",
  "--sandbox read-only --skip-git-repo-check --cd <fresh owned directory>",
  "--output-schema <owned schema path> --json -",
] as const);

export const codexPolicyFingerprint = fingerprintCodexPolicy(REVIEWED_INSTALLATION_DIGESTS);

export function deriveCodexPolicyFingerprintForTest(
  reviewedInstallationDigests: readonly [string, string],
): string {
  return fingerprintCodexPolicy(reviewedInstallationDigests);
}

export function parseSupportedCodexCliVersion(stdout: string): string {
  const match = /^codex-cli 0\.149\.0-alpha\.((?:[4-9]|[1-9][0-9]{1,5}))\n$/.exec(stdout);
  if (match === null || match[1] === undefined || Number(match[1]) < 4) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  return stdout.slice(0, -1);
}

export function buildCodexExecArgs(
  invocation: Pick<CodexJsonInvocation, "reasoningEffort" | "toolPolicy">,
  directoryPath: string,
  schemaPath: string,
): readonly string[] {
  return Object.freeze([
    ...(invocation.toolPolicy === "codex-tools-web-search@1"
      ? ["--search", ...CODEX_WEB_SEARCH_ENABLED_FEATURES.flatMap((feature) => ["--enable", feature])]
      : []),
    "exec",
    ...(invocation.toolPolicy === "codex-tools-web-search@1" ? ["-c", "suppress_unstable_features_warning=true"] : []),
    ...CODEX_FIXED_EXEC_CONFIGS.flatMap((config) => ["-c", config]),
    "--strict-config",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--model", "gpt-5.6-terra",
    "-c", `model_reasoning_effort=${JSON.stringify(invocation.reasoningEffort)}`,
    ...(invocation.toolPolicy === "codex-tools-web-search@1"
      ? CODEX_WEB_SEARCH_DISABLED_FEATURES
      : CODEX_DISABLED_FEATURES).flatMap((feature) => ["--disable", feature]),
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--cd", directoryPath,
    "--output-schema", schemaPath,
    "--json",
    "-",
  ]);
}

function fingerprintCodexPolicy(reviewedInstallationDigests: readonly [string, string]): string {
  const input = JSON.stringify({
    protocol: CODEX_CLI_PROTOCOL_VERSION,
    protocolRevision: CODEX_PROTOCOL_NOTICE_REVISION,
    model: CODEX_MODEL,
    reasoningEfforts: ["low", "medium"],
    toolPolicies: ["codex-tools-none@2", "codex-tools-web-search@1"],
    disabledFeatures: CODEX_DISABLED_FEATURES,
    fixedExecConfigs: CODEX_FIXED_EXEC_CONFIGS,
    webSearchEnabledFeatures: CODEX_WEB_SEARCH_ENABLED_FEATURES,
    webSearchPolicyMarker: "--search",
    reviewedInstallationRevision: REVIEWED_INSTALLATION_REVISION,
    reviewedInstallationDigests: [...reviewedInstallationDigests],
    argvGrammar: CODEX_EXEC_ARGV_GRAMMAR,
  });
  return createHash("sha256").update(input, "utf8").digest("hex");
}
