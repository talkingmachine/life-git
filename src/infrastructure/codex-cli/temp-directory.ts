import { chmod, lstat, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { CodexRuntimeError } from "./contracts";
import type { JsonObject } from "./owned-json";

const DIRECTORY_PREFIX = "confirmed-life-codex-";

export interface ValidatedCodexTempRoot {
  readonly path: string;
  readonly uid: number;
}

export interface CodexTempDirectory {
  readonly directoryPath: string;
  readonly schemaPath: string;
}

export async function validateCodexTempRoot(input: {
  readonly path: string;
  readonly currentUid: number;
  readonly userHomePath: string;
  readonly workspacePath: string;
}): Promise<ValidatedCodexTempRoot> {
  try {
    if (!isAbsolute(input.path)) throw invalidTempRoot();
    const canonicalPath = await realpath(input.path);
    const canonicalHomePath = await canonicalizeReferencePath(input.userHomePath);
    const canonicalWorkspacePath = await canonicalizeReferencePath(input.workspacePath);
    const metadata = await lstat(input.path);
    if (canonicalPath !== resolve(input.path) || metadata.isSymbolicLink() || !metadata.isDirectory() ||
      metadata.uid !== input.currentUid ||
      isForbiddenRoot(canonicalPath, canonicalHomePath, canonicalWorkspacePath)) {
      throw invalidTempRoot();
    }
    return Object.freeze({ path: canonicalPath, uid: input.currentUid });
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw invalidTempRoot();
  }
}

export async function withCodexTempDirectory<T>(input: {
  readonly root: ValidatedCodexTempRoot;
  readonly outputSchema: JsonObject;
  readonly use: (directory: CodexTempDirectory) => Promise<T>;
}): Promise<T> {
  const directoryPath = await createDirectTempDirectory(input.root);
  const schemaPath = join(directoryPath, "schema.json");
  try {
    const schemaFile = await open(schemaPath, "wx", 0o600);
    try {
      await schemaFile.writeFile(JSON.stringify(input.outputSchema), "utf8");
    } finally {
      await schemaFile.close();
    }
    await chmod(schemaPath, 0o600);
    return await input.use({ directoryPath, schemaPath });
  } finally {
    await rm(directoryPath, { recursive: true });
  }
}

export async function scavengeStaleCodexDirectories(input: {
  readonly root: ValidatedCodexTempRoot;
  readonly now: Date;
  readonly staleAfterMs: 3_600_000;
}): Promise<number> {
  const entries = await readdir(input.root.path, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(DIRECTORY_PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(input.root.path, entry.name);
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== input.root.uid ||
      input.now.getTime() - metadata.mtimeMs < input.staleAfterMs) {
      continue;
    }
    await rm(path, { recursive: true });
    removed += 1;
  }
  return removed;
}

export async function createEmptyCodexTempDirectory(root: ValidatedCodexTempRoot): Promise<string> {
  return createDirectTempDirectory(root);
}

async function createDirectTempDirectory(root: ValidatedCodexTempRoot): Promise<string> {
  const path = await mkdtemp(join(root.path, DIRECTORY_PREFIX));
  await chmod(path, 0o700);
  return path;
}

async function canonicalizeReferencePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isForbiddenRoot(path: string, canonicalHomePath: string, canonicalWorkspacePath: string): boolean {
  return path === "/" || path === canonicalHomePath || path === canonicalWorkspacePath ||
    isParentOf(path, canonicalWorkspacePath);
}

function isParentOf(candidate: string, child: string): boolean {
  const pathFromCandidate = relative(candidate, child);
  return pathFromCandidate.length > 0 && pathFromCandidate !== ".." && !pathFromCandidate.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(pathFromCandidate);
}

function invalidTempRoot(): CodexRuntimeError {
  return new CodexRuntimeError("codex_temp_root_invalid");
}
