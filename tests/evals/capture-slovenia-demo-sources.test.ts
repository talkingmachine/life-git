import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { createCaptureStore, runCaptureSloveniaDemoSourcesEntrypoint } from "../../evals/capture-slovenia-demo-sources";
import { SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP } from "../../src/infrastructure/sources/slovenia-official-directory-bootstrap";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const input = () => ({
  schemaVersion: "si-demo-package-acquisition-staging@1", mode: "native_discovery_hints", stagingOnly: true, policyLockWritten: false,
  discovery: { invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2", compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2", cliVersion: "codex-cli 0.149.0-alpha.4", model: "gpt-5.4", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@2", templateVersion: "official-source-discover@4", schemaVersion: "official-source-candidates@1", output: "untrusted_hints_only" },
  jobs: SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes.map((policy) => ({ jobId: policy.jobId, candidates: [{ url: policy.url, urlSha256: digest(policy.url), host: new URL(policy.url).hostname, hostSha256: digest(new URL(policy.url).hostname) }] })),
});
const runId = "00000000-0000-4000-8000-000000000001";
function captured(request: { runId: string; sourceId: string; role: string; url: string }, bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifact: {
      artifactId: `${request.sourceId}:${request.role}:${sha256}`,
      runId: request.runId,
      sourceId: request.sourceId,
      role: request.role,
      url: request.url,
      mediaType: "text/html",
      sha256,
      bytes,
      origin: "live" as const,
      capturedAt: "2026-08-30T00:00:00.000Z",
      responseStatus: 200,
      responseUrl: request.url,
      request: { method: "GET" as const, url: request.url },
    },
    redirectChain: [request.url],
  };
}

describe("capture Slovenia demo sources", () => {
  test("does not capture before a fully valid discovery staging input", async () => {
    const capture = vi.fn();
    const result = await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], {
      readInput: async () => ({ ...input(), jobs: [] }), capture,
      store: { prepare: async () => undefined, cleanup: async () => undefined, write: async () => undefined },
    });
    expect(result).toEqual({ exitCode: 1, stderr: "capture_slovenia_demo_sources_failed\n" });
    expect(capture).not.toHaveBeenCalled();
  });

  test("uses exactly the three allowlisted first-party routes and cleans partial failure", async () => {
    const cleanup = vi.fn(async () => undefined);
    const capture = vi.fn(async (request: { sourceId: string; role: string; url: string; allowedHosts: readonly string[] }) => {
      if (capture.mock.calls.length === 3) throw new Error("stop");
      return { artifact: { artifactId: `${request.sourceId}:${request.role}:${digest("x")}`, runId: "00000000-0000-4000-8000-000000000001", sourceId: request.sourceId, role: request.role, url: request.url, mediaType: "text/html", sha256: digest("x"), bytes: new TextEncoder().encode("x"), origin: "live", capturedAt: "2026-08-30T00:00:00.000Z", responseStatus: 200, responseUrl: request.url, request: { method: "GET", url: request.url } }, redirectChain: [request.url] };
    });
    await expect(runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], {
      readInput: async () => input(), capture: capture as never,
      createRunId: () => "00000000-0000-4000-8000-000000000001",
      store: { prepare: async () => undefined, cleanup, write: async () => undefined },
    })).resolves.toEqual({ exitCode: 1, stderr: "capture_slovenia_demo_sources_failed\n" });
    expect(capture.mock.calls.map(([request]) => request.url)).toEqual(SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes.map((policy) => policy.url));
    expect(capture.mock.calls.flatMap(([request]) => request.allowedHosts)).not.toContain("www.ljubljana.si");
    expect(capture.mock.calls.flatMap(([request]) => request.allowedHosts)).not.toContain("pxweb.stat.si");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  test("rejects a symlinked fixed output parent without following it", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-capture-"));
    const outside = await mkdtemp(join(tmpdir(), "si-capture-outside-"));
    try {
      await mkdir(join(root, "data", "evals"), { recursive: true });
      await symlink(outside, join(root, "data", "evals", "capture-slovenia-demo-sources"));
      await expect(createCaptureStore({ workspaceRoot: root }).prepare()).rejects.toThrow("capture_slovenia_demo_sources_invalid");
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  test("rejects a hard-linked fixed manifest leaf", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-capture-"));
    const outside = join(root, "outside");
    const manifest = join(root, "data", "evals", "capture-slovenia-demo-sources", "manifest.json");
    try {
      await mkdir(join(root, "data", "evals", "capture-slovenia-demo-sources"), { recursive: true });
      await writeFile(outside, "outside"); await link(outside, manifest);
      await expect(createCaptureStore({ workspaceRoot: root }).prepare()).rejects.toThrow("capture_slovenia_demo_sources_invalid");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("cleans the staging set when the manifest-last write fails", async () => {
    const cleanup = vi.fn(async () => undefined);
    const capture = vi.fn(async (request: { sourceId: string; role: string; url: string }) => ({ artifact: { artifactId: `${request.sourceId}:${request.role}:${digest("x")}`, runId: "00000000-0000-4000-8000-000000000001", sourceId: request.sourceId, role: request.role, url: request.url, mediaType: "text/html", sha256: digest("x"), bytes: new TextEncoder().encode("x"), origin: "live", capturedAt: "2026-08-30T00:00:00.000Z", responseStatus: 200, responseUrl: request.url, request: { method: "GET", url: request.url } }, redirectChain: [request.url] }));
    await expect(runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], {
      readInput: async () => input(), capture: capture as never,
      createRunId: () => "00000000-0000-4000-8000-000000000001",
      store: { prepare: async () => undefined, cleanup, write: async () => { throw new Error("manifest write failed"); } },
    })).resolves.toEqual({ exitCode: 1, stderr: "capture_slovenia_demo_sources_failed\n" });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  test("stops after one invalid returned capture", async () => {
    const capture = vi.fn(async (request: { sourceId: string; role: string; url: string }) => ({ artifact: { artifactId: "wrong", runId: "00000000-0000-4000-8000-000000000001", sourceId: request.sourceId, role: request.role, url: request.url, mediaType: "text/html", sha256: digest("x"), bytes: new TextEncoder().encode("x"), origin: "live", capturedAt: "2026-08-30T00:00:00.000Z", responseStatus: 200, responseUrl: request.url, request: { method: "GET", url: request.url } }, redirectChain: [request.url] }));
    await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], { readInput: async () => input(), capture: capture as never, createRunId: () => "00000000-0000-4000-8000-000000000001", store: { prepare: async () => undefined, cleanup: async () => undefined, write: async () => undefined } });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  test("rejects sparse and getter discovery input before network", async () => {
    const capture = vi.fn(); const sparse = input(); sparse.jobs = new Array(3);
    await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], { readInput: async () => sparse, capture, store: { prepare: async () => undefined, cleanup: async () => undefined, write: async () => undefined } });
    const getter = input(); Object.defineProperty(getter.jobs[0]!.candidates[0]!, "url", { enumerable: true, get: () => "https://www.policija.si/" });
    await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], { readInput: async () => getter, capture, store: { prepare: async () => undefined, cleanup: async () => undefined, write: async () => undefined } });
    expect(capture).not.toHaveBeenCalled();
  });

  test("writes the owned capture bytes even when the borrowed bytes mutate later", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-capture-owned-"));
    const firstBytes = new TextEncoder().encode("first");
    let call = 0;
    const capture = vi.fn(async (request: { runId: string; sourceId: string; role: string; url: string }) => {
      call += 1;
      if (call === 2) firstBytes[0] = "X".charCodeAt(0);
      return captured(request, call === 1 ? firstBytes : new TextEncoder().encode(`capture-${call}`));
    });
    try {
      const result = await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], {
        readInput: async () => input(),
        capture: capture as never,
        createRunId: () => runId,
        store: createCaptureStore({ workspaceRoot: root }),
      });
      expect(result).toEqual({ exitCode: 0, stderr: "" });
      const rawPath = join(root, "data", "evals", "capture-slovenia-demo-sources", "raw", "police-pu-ljubljana-stats.bin");
      const stored = await readFile(rawPath);
      expect(stored.toString("utf8")).toBe("first");
      const manifest = JSON.parse(await readFile(join(root, "data", "evals", "capture-slovenia-demo-sources", "manifest.json"), "utf8")) as { captures: { sha256: string }[] };
      expect(manifest.captures[0]?.sha256).toBe(digest("first"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("manifest-last collision leaves no final raw files or manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-capture-collision-"));
    const output = join(root, "data", "evals", "capture-slovenia-demo-sources");
    const collision = join(output, ".collision.tmp");
    try {
      await mkdir(output, { recursive: true });
      await writeFile(collision, "owned collision");
      const result = await runCaptureSloveniaDemoSourcesEntrypoint(["--live-official-sources"], {
        readInput: async () => input(),
        capture: (async (request: { runId: string; sourceId: string; role: string; url: string }) =>
          captured(request, new TextEncoder().encode(request.role))) as never,
        createRunId: () => runId,
        store: createCaptureStore({ workspaceRoot: root, randomId: () => "collision" }),
      });
      expect(result).toEqual({ exitCode: 1, stderr: "capture_slovenia_demo_sources_failed\n" });
      await expect(readFile(join(output, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
      for (const route of SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP.routes) {
        await expect(readFile(join(output, "raw", `${route.routeId}.bin`))).rejects.toMatchObject({ code: "ENOENT" });
      }
      await expect(readFile(collision, "utf8")).resolves.toBe("owned collision");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
