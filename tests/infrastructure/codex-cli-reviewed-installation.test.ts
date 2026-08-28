import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { CodexRuntimeError } from "../../src/infrastructure/codex-cli/contracts";
import {
  REVIEWED_CODE_MODE_HOST_SHA256,
  REVIEWED_CODEX_SHA256,
  REVIEWED_INSTALLATION_DIGESTS,
  verifyReviewedLocalCodexInstallationForTest,
} from "../../src/infrastructure/codex-cli/reviewed-installation";

const CODEX_PATH = "/synthetic/reviewed/codex";
const HOST_PATH = "/synthetic/reviewed/codex-code-mode-host";
const CODEX_BYTES = new TextEncoder().encode("synthetic reviewed codex executable");
const HOST_BYTES = new TextEncoder().encode("synthetic reviewed code mode host");

describe("reviewed local Codex installation", () => {
  test("accepts the exact synthetic regular executable pair", async () => {
    const fixture = exactInstallation();

    await expect(verifyReviewedLocalCodexInstallationForTest(fixture.input)).resolves.toBeUndefined();

    expect(fixture.inspect.lstat.mock.calls.map(([path]) => path)).toEqual([CODEX_PATH, HOST_PATH]);
    expect(fixture.inspect.readFile.mock.calls.map(([path]) => path)).toEqual([CODEX_PATH, HOST_PATH]);
  });

  test.each([
    ["a symlink", (fixture: InstallationFixture) => { fixture.link.symbolicLink = true; }],
    ["a non-regular directory entry", (fixture: InstallationFixture) => { fixture.link.regularFile = false; }],
    ["a non-regular resolved target", (fixture: InstallationFixture) => { fixture.file.regularFile = false; }],
    ["a realpath mismatch", (fixture: InstallationFixture) => { fixture.resolvedSuffix = ".alias"; }],
    ["an extra hard link", (fixture: InstallationFixture) => { fixture.file.linkCount = 2; }],
    ["a foreign owner", (fixture: InstallationFixture) => { fixture.file.ownerUid = 777; }],
    ["a group-writable mode", (fixture: InstallationFixture) => { fixture.file.mode = 0o720; }],
    ["a world-writable mode", (fixture: InstallationFixture) => { fixture.file.mode = 0o702; }],
    ["a non-executable mode", (fixture: InstallationFixture) => { fixture.file.mode = 0o600; }],
    ["a wrong digest", (fixture: InstallationFixture) => { fixture.contents.set(CODEX_PATH, new TextEncoder().encode("drift")); }],
    ["a missing file", (fixture: InstallationFixture) => { fixture.inspect.lstat.mockRejectedValueOnce(Object.assign(new Error("hidden missing path"), { code: "ENOENT" })); }],
    ["an inaccessible file", (fixture: InstallationFixture) => { fixture.inspect.readFile.mockRejectedValueOnce(Object.assign(new Error("hidden inaccessible path"), { code: "EACCES" })); }],
  ])("maps %s only to the sanitized typed mismatch", async (_name, mutate) => {
    const fixture = exactInstallation();
    mutate(fixture);

    await expectVersionMismatch(() => verifyReviewedLocalCodexInstallationForTest(fixture.input));
  });

  test("keeps the reviewed production digests exact", () => {
    expect(REVIEWED_CODEX_SHA256).toBe("10afbeddd6f951635d8fcfbb337034d37934bb3495c16d053b3560d75747619b");
    expect(REVIEWED_CODE_MODE_HOST_SHA256).toBe("deb277d1987dbfc709fa7fe86ed8db70fa8531f80d3b6ed15d0b3fbe365e888f");
    expect(REVIEWED_INSTALLATION_DIGESTS).toEqual([REVIEWED_CODEX_SHA256, REVIEWED_CODE_MODE_HOST_SHA256]);
    expect(Object.isFrozen(REVIEWED_INSTALLATION_DIGESTS)).toBe(true);
  });
});

type InstallationFixture = ReturnType<typeof exactInstallation>;

function exactInstallation() {
  const contents = new Map<string, Uint8Array>([
    [CODEX_PATH, CODEX_BYTES],
    [HOST_PATH, HOST_BYTES],
  ]);
  const link = { regularFile: true, symbolicLink: false };
  const file = { regularFile: true, linkCount: 1, ownerUid: 501, mode: 0o700 };
  const fixture = { resolvedSuffix: "" };
  const inspect = {
    lstat: vi.fn(async (path: string) => {
      void path;
      return {
        isFile: () => link.regularFile,
        isSymbolicLink: () => link.symbolicLink,
      };
    }),
    realpath: vi.fn(async (path: string) => `${path}${fixture.resolvedSuffix}`),
    stat: vi.fn(async (path: string) => {
      void path;
      return {
        isFile: () => file.regularFile,
        nlink: file.linkCount,
        uid: file.ownerUid,
        mode: file.mode,
      };
    }),
    readFile: vi.fn(async (path: string) => contents.get(path) ?? new Uint8Array()),
  };
  return {
    contents,
    link,
    file,
    inspect,
    get resolvedSuffix() { return fixture.resolvedSuffix; },
    set resolvedSuffix(value: string) { fixture.resolvedSuffix = value; },
    input: {
      files: [
        { path: CODEX_PATH, sha256: sha256(CODEX_BYTES) },
        { path: HOST_PATH, sha256: sha256(HOST_BYTES) },
      ],
      currentUid: 501,
      inspect,
    },
  };
}

async function expectVersionMismatch(run: () => Promise<void>): Promise<void> {
  const error = await run().then(() => undefined, (caught: unknown) => caught);
  expect(Object.getPrototypeOf(error)).toBe(CodexRuntimeError.prototype);
  expect(error).toMatchObject({
    name: "CodexRuntimeError",
    code: "codex_version_mismatch",
    message: "codex_version_mismatch",
  });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.parse(JSON.stringify(error))).toEqual({
    name: "CodexRuntimeError",
    code: "codex_version_mismatch",
  });
  expect((error as Error).message).not.toContain("/synthetic/");
  expect((error as Error).message).not.toContain("hidden");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
