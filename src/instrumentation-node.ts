import { tmpdir } from "node:os";

import { CodexRuntimeError } from "./infrastructure/codex-cli/contracts";
import { nodeCodexProcessSpawner } from "./infrastructure/codex-cli/process";
import { initializeCodexCliRuntime } from "./infrastructure/codex-cli/runtime";

export async function registerNodeCodexRuntime(): Promise<void> {
  const currentUid = process.getuid?.();
  if (currentUid === undefined) throw new CodexRuntimeError("codex_process_failed");

  const tempRootPath = process.env.TMPDIR ?? tmpdir();
  const childEnv = definedEnvironment({
    CODEX_HOME: process.env.CODEX_HOME,
    TMPDIR: tempRootPath,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  });
  await initializeCodexCliRuntime({
    ...(process.env.CODEX_EXECUTABLE === undefined
      ? {}
      : { configuredExecutable: process.env.CODEX_EXECUTABLE }),
    ...(process.env.PATH === undefined ? {} : { pathValue: process.env.PATH }),
    tempRootPath,
    currentUid,
    childEnv,
    spawner: nodeCodexProcessSpawner,
    clock: () => new Date(),
    signal: new AbortController().signal,
  });
}

function definedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined) environment[name] = value;
  }
  return Object.freeze(environment);
}
