import { CodexRuntimeError } from "./contracts";

export function parseSupportedCodexCliVersion(stdout: string): string {
  const match = /^codex-cli 0\.149\.0-alpha\.([0-9]+)\n$/.exec(stdout);
  if (match === null || match[1] === undefined || Number(match[1]) < 4) {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
  return stdout.slice(0, -1);
}
