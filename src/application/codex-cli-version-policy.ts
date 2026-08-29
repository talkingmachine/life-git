/**
 * Dependency-safe representation of the reviewed Codex CLI compatibility policy.
 * Infrastructure maps policy failures to its transport-specific errors.
 */
export function isSupportedCodexCliVersion(value: unknown): value is string {
  return typeof value === "string" && /^codex-cli 0\.149\.0-alpha\.((?:[4-9]|[1-9][0-9]{1,5}))$/.test(value);
}
