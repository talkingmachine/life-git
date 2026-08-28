import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";

import { CodexRuntimeError } from "./contracts";

export const REVIEWED_CODEX_EXECUTABLE = "/Applications/ChatGPT.app/Contents/Resources/codex";
export const REVIEWED_CODE_MODE_HOST = "/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host";
export const REVIEWED_INSTALLATION_REVISION = "chatgpt-rust-v0.149.0-alpha.4@92920d0";

const REVIEWED_FILES = Object.freeze([
  [REVIEWED_CODEX_EXECUTABLE, "10afbeddd6f951635d8fcfbb337034d37934bb3495c16d053b3560d75747619b"],
  [REVIEWED_CODE_MODE_HOST, "deb277d1987dbfc709fa7fe86ed8db70fa8531f80d3b6ed15d0b3fbe365e888f"],
] as const);

export async function verifyReviewedLocalCodexInstallation(): Promise<void> {
  try {
    const uid = process.getuid?.();
    if (!Number.isSafeInteger(uid)) throw new Error();
    for (const [path, digest] of REVIEWED_FILES) {
      const link = await lstat(path);
      const resolved = await realpath(path);
      const file = await stat(resolved);
      if (!link.isFile() || link.isSymbolicLink() || resolved !== path || !file.isFile() || file.nlink !== 1 ||
        file.uid !== uid || (file.mode & 0o022) !== 0 || (file.mode & 0o111) === 0) throw new Error();
      const actual = createHash("sha256").update(await readFile(resolved)).digest("hex");
      if (actual !== digest) throw new Error();
    }
  } catch {
    throw new CodexRuntimeError("codex_process_failed");
  }
}
