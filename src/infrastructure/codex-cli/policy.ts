import { createHash } from "node:crypto";

import {
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_DISCOVERY_MODEL,
  CODEX_MODEL,
  type CodexCapabilityId,
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

export const CODEX_FIXED_EXEC_CONFIGS = Object.freeze([
  "tools.experimental_request_user_input.enabled=false",
  "tools.update_plan.enabled=false",
  "check_for_update_on_startup=false",
  "analytics.enabled=false",
  "feedback.enabled=false",
  "allow_login_shell=false",
] as const);

const CODEX_EXEC_ARGV_GRAMMAR = Object.freeze([
  "web-search: --search before exec; no feature is enabled",
  "fixed exec-level -c safety configs before model and effort",
  "exec --strict-config --ephemeral --ignore-user-config --ignore-rules",
  "--model <capability-owned model> -c model_reasoning_effort=<fixed invocation effort>",
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
  invocation: Pick<CodexJsonInvocation, "capability" | "reasoningEffort" | "toolPolicy">,
  directoryPath: string,
  schemaPath: string,
): readonly string[] {
  return Object.freeze([
    ...(invocation.toolPolicy === "codex-tools-web-search@2"
      ? ["--search"]
      : []),
    "exec",
    ...CODEX_FIXED_EXEC_CONFIGS.flatMap((config) => ["-c", config]),
    "--strict-config",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--model", modelForCodexCapability(invocation.capability),
    "-c", `model_reasoning_effort=${JSON.stringify(invocation.reasoningEffort)}`,
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--cd", directoryPath,
    "--output-schema", schemaPath,
    "--json",
    "-",
  ]);
}

export function modelForCodexCapability(capability: CodexCapabilityId): typeof CODEX_MODEL | typeof CODEX_DISCOVERY_MODEL {
  return capability === "source.discover" ? CODEX_DISCOVERY_MODEL : CODEX_MODEL;
}

function fingerprintCodexPolicy(reviewedInstallationDigests: readonly [string, string]): string {
  const input = JSON.stringify({
    protocol: CODEX_CLI_PROTOCOL_VERSION,
    protocolRevision: CODEX_PROTOCOL_NOTICE_REVISION,
    capabilityModels: { "onboarding.extract": CODEX_MODEL, "onboarding.review": CODEX_MODEL, "source.extract": CODEX_MODEL, "source.discover": CODEX_DISCOVERY_MODEL, "full-life.film": CODEX_MODEL },
    reasoningEfforts: ["low", "medium"],
    toolPolicies: ["codex-tools-none@2", "codex-tools-web-search@2"],
    disabledFeatures: CODEX_DISABLED_FEATURES,
    fixedExecConfigs: CODEX_FIXED_EXEC_CONFIGS,
    webSearchPolicyMarker: "--search",
    reviewedInstallationRevision: REVIEWED_INSTALLATION_REVISION,
    reviewedInstallationDigests: [...reviewedInstallationDigests],
    argvGrammar: CODEX_EXEC_ARGV_GRAMMAR,
  });
  return createHash("sha256").update(input, "utf8").digest("hex");
}
