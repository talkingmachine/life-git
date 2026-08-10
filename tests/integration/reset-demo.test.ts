import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, expect, test } from "vitest";

import { resetDemo } from "../../scripts/reset-demo";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `confirmed-life-${label}-`));
  const canonicalDirectory = await realpath(directory);
  temporaryDirectories.push(canonicalDirectory);
  return canonicalDirectory;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

test("removes only the exact SQLite files and is idempotent", async () => {
  const allowedDemoDir = await temporaryDirectory("reset-exact");
  const databaseDirectory = join(allowedDemoDir, "current-run");
  await mkdir(databaseDirectory);

  const databasePath = join(databaseDirectory, "demo.sqlite");
  const removedPaths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  const retainedFiles = new Map([
    [`${databasePath}-journal`, "rollback journal"],
    [`${databasePath}-wal.backup`, "wal backup"],
    [join(databaseDirectory, "another.sqlite"), "another database"],
  ]);

  await Promise.all([
    ...removedPaths.map((path, index) => writeFile(path, `remove ${index}`)),
    ...Array.from(retainedFiles, ([path, contents]) => writeFile(path, contents)),
  ]);

  await expect(resetDemo(databasePath, allowedDemoDir)).resolves.toBeUndefined();
  await expect(Promise.all(removedPaths.map(pathExists))).resolves.toEqual([false, false, false]);
  for (const [path, contents] of retainedFiles) {
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  }

  await expect(resetDemo(databasePath, allowedDemoDir)).resolves.toBeUndefined();
  for (const [path, contents] of retainedFiles) {
    await expect(readFile(path, "utf8")).resolves.toBe(contents);
  }
});

test("rejects a symlinked allowed root without deleting its target database", async () => {
  const actualDemoDir = await temporaryDirectory("reset-real-root");
  const aliasContainer = await temporaryDirectory("reset-root-alias");
  const databaseDirectory = join(actualDemoDir, "current-run");
  const allowedAlias = join(aliasContainer, "allowed-link");
  const databasePath = join(databaseDirectory, "demo.sqlite");
  await mkdir(databaseDirectory);
  await writeFile(databasePath, "database remains");
  await symlink(actualDemoDir, allowedAlias, "dir");

  await expect(resetDemo(databasePath, allowedAlias)).rejects.toThrow();
  await expect(readFile(databasePath, "utf8")).resolves.toBe("database remains");
});

test("rejects unsafe paths and symlink targets before deleting any exact file", async () => {
  const allowedDemoDir = await temporaryDirectory("reset-unsafe");
  const outsideDirectory = await temporaryDirectory("reset-outside");
  const databaseDirectory = join(allowedDemoDir, "current-run");
  await mkdir(databaseDirectory);

  const databasePath = join(databaseDirectory, "demo.sqlite");
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const symlinkTarget = join(allowedDemoDir, "symlink-target");
  await Promise.all([
    writeFile(databasePath, "database remains"),
    writeFile(shmPath, "shm remains"),
    writeFile(symlinkTarget, "target remains"),
  ]);
  await symlink(symlinkTarget, walPath);

  await expect(resetDemo(databasePath, allowedDemoDir)).rejects.toThrow();
  await expect(readFile(databasePath, "utf8")).resolves.toBe("database remains");
  expect((await lstat(walPath)).isSymbolicLink()).toBe(true);
  await expect(readFile(shmPath, "utf8")).resolves.toBe("shm remains");
  await expect(readFile(symlinkTarget, "utf8")).resolves.toBe("target remains");

  const boundaryDatabase = join(allowedDemoDir, "boundary.sqlite");
  const directoryTarget = join(databaseDirectory, "directory.sqlite");
  const allowedFile = join(allowedDemoDir, "not-a-directory");
  const linkedOutsideDirectory = join(allowedDemoDir, "linked-outside");
  await Promise.all([
    writeFile(boundaryDatabase, "boundary remains"),
    mkdir(directoryTarget),
    writeFile(`${directoryTarget}-wal`, "directory wal remains"),
    writeFile(allowedFile, "not a directory"),
    symlink(outsideDirectory, linkedOutsideDirectory, "dir"),
  ]);

  const unsafeCalls = [
    () => resetDemo("", allowedDemoDir),
    () => resetDemo("demo.sqlite", allowedDemoDir),
    () => resetDemo(databasePath, ""),
    () => resetDemo(databasePath, "demo"),
    () => resetDemo(databasePath, parse(databasePath).root),
    () => resetDemo(databasePath, allowedFile),
    () => resetDemo(boundaryDatabase, allowedDemoDir),
    () => resetDemo(join(outsideDirectory, "outside.sqlite"), allowedDemoDir),
    () => resetDemo(join(linkedOutsideDirectory, "outside.sqlite"), allowedDemoDir),
    () => resetDemo(join(allowedDemoDir, "missing", "demo.sqlite"), allowedDemoDir),
    () => resetDemo(databasePath, join(allowedDemoDir, "missing-allowed")),
    () => resetDemo(directoryTarget, allowedDemoDir),
  ];
  for (const unsafeCall of unsafeCalls) {
    await expect(unsafeCall()).rejects.toThrow();
  }

  await expect(readFile(databasePath, "utf8")).resolves.toBe("database remains");
  await expect(readFile(boundaryDatabase, "utf8")).resolves.toBe("boundary remains");
  expect((await lstat(directoryTarget)).isDirectory()).toBe(true);
  await expect(readFile(`${directoryTarget}-wal`, "utf8")).resolves.toBe("directory wal remains");
});
