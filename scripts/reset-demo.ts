import { lstat, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

const SQLITE_RESET_SUFFIXES = ["", "-wal", "-shm"] as const;

function rejectUnsafePath(reason: string): never {
  throw new Error(`unsafe_demo_reset:${reason}`);
}

function isStrictDescendant(path: string, parent: string): boolean {
  const pathFromParent = relative(parent, path);
  return pathFromParent !== ""
    && pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

async function existingRegularFile(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) rejectUnsafePath("target_not_regular_file");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function resetDemo(databasePath: string, allowedDemoDir: string): Promise<void> {
  if (!isAbsolute(databasePath) || !isAbsolute(allowedDemoDir)) {
    rejectUnsafePath("path_not_absolute");
  }

  const allowedInputStats = await lstat(allowedDemoDir);
  if (!allowedInputStats.isDirectory() || allowedInputStats.isSymbolicLink()) {
    rejectUnsafePath("allowed_path_not_real_directory");
  }

  const [resolvedAllowedDemoDir, resolvedDatabaseParent] = await Promise.all([
    realpath(allowedDemoDir),
    realpath(dirname(databasePath)),
  ]);
  const databaseParentStats = await lstat(resolvedDatabaseParent);

  if (resolvedAllowedDemoDir !== resolve(allowedDemoDir)) {
    rejectUnsafePath("allowed_path_contains_symlink");
  }
  if (resolvedAllowedDemoDir === parse(resolvedAllowedDemoDir).root) {
    rejectUnsafePath("allowed_directory_is_root");
  }
  if (!databaseParentStats.isDirectory()) rejectUnsafePath("database_parent_not_directory");
  if (!isStrictDescendant(resolvedDatabaseParent, resolvedAllowedDemoDir)) {
    rejectUnsafePath("database_parent_outside_allowed_directory");
  }

  const targets = SQLITE_RESET_SUFFIXES.map((suffix) => `${databasePath}${suffix}`);
  const existingTargets = await Promise.all(
    targets.map(async (path) => ({ path, exists: await existingRegularFile(path) })),
  );

  await Promise.all(
    existingTargets
      .filter((target) => target.exists)
      .map((target) => unlink(target.path)),
  );
}
