import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";

import { CodexRuntimeError } from "./contracts";

export const REVIEWED_CODEX_EXECUTABLE = "/Applications/ChatGPT.app/Contents/Resources/codex";
export const REVIEWED_CODE_MODE_HOST = "/Applications/ChatGPT.app/Contents/Resources/codex-code-mode-host";
export const REVIEWED_INSTALLATION_REVISION = "chatgpt-rust-v0.149.0-alpha.4@92920d0";
export const REVIEWED_CODEX_SHA256 = "10afbeddd6f951635d8fcfbb337034d37934bb3495c16d053b3560d75747619b";
export const REVIEWED_CODE_MODE_HOST_SHA256 = "deb277d1987dbfc709fa7fe86ed8db70fa8531f80d3b6ed15d0b3fbe365e888f";
export const REVIEWED_INSTALLATION_DIGESTS = Object.freeze([
  REVIEWED_CODEX_SHA256,
  REVIEWED_CODE_MODE_HOST_SHA256,
] as const);

const REVIEWED_FILES = Object.freeze([
  Object.freeze({ path: REVIEWED_CODEX_EXECUTABLE, sha256: REVIEWED_CODEX_SHA256 }),
  Object.freeze({ path: REVIEWED_CODE_MODE_HOST, sha256: REVIEWED_CODE_MODE_HOST_SHA256 }),
] as const);

export async function verifyReviewedLocalCodexInstallation(): Promise<void> {
  return verifyReviewedInstallation({
    files: REVIEWED_FILES,
    currentUid: process.getuid?.(),
    inspect: { lstat, realpath, stat, readFile },
  });
}

interface ReviewedInstallationInspection {
  readonly lstat: (path: string) => Promise<Readonly<{
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }>>;
  readonly realpath: (path: string) => Promise<string>;
  readonly stat: (path: string) => Promise<Readonly<{
    isFile(): boolean;
    readonly nlink: number;
    readonly uid: number;
    readonly mode: number;
  }>>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

interface ReviewedInstallationVerification {
  readonly files: readonly Readonly<{ readonly path: string; readonly sha256: string }>[];
  readonly currentUid: number | undefined;
  readonly inspect: ReviewedInstallationInspection;
}

/** Test seam for deterministic metadata faults; production remains bound to the frozen manifest and Node filesystem. */
export async function verifyReviewedLocalCodexInstallationForTest(
  input: ReviewedInstallationVerification,
): Promise<void> {
  return verifyReviewedInstallation({
    files: Object.freeze(input.files.map((file) => Object.freeze({ path: file.path, sha256: file.sha256 }))),
    currentUid: input.currentUid,
    inspect: Object.freeze({
      lstat: input.inspect.lstat,
      realpath: input.inspect.realpath,
      stat: input.inspect.stat,
      readFile: input.inspect.readFile,
    }),
  });
}

async function verifyReviewedInstallation(input: ReviewedInstallationVerification): Promise<void> {
  try {
    const uid = input.currentUid;
    if (!Number.isSafeInteger(uid)) throw new Error();
    for (const reviewed of input.files) {
      const link = await input.inspect.lstat(reviewed.path);
      const resolved = await input.inspect.realpath(reviewed.path);
      const file = await input.inspect.stat(resolved);
      if (!link.isFile() || link.isSymbolicLink() || resolved !== reviewed.path || !file.isFile() || file.nlink !== 1 ||
        file.uid !== uid || (file.mode & 0o022) !== 0 || (file.mode & 0o111) === 0) throw new Error();
      const actual = createHash("sha256").update(await input.inspect.readFile(resolved)).digest("hex");
      if (actual !== reviewed.sha256) throw new Error();
    }
  } catch {
    throw new CodexRuntimeError("codex_version_mismatch");
  }
}
