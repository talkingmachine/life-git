import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  createCaptureSloveniaSafetyAuthorityStore,
  parseCaptureSloveniaSafetyAuthorityArgs,
  runCaptureSloveniaSafetyAuthorityEntrypoint,
} from "../../evals/capture-slovenia-safety-authority";
import type { HttpStepRequest } from "../../src/research/contracts";

const OUTPUT_ROOT = "data/evals/capture-slovenia-safety-authority";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const POLICE_URL = "https://www.policija.si/o-slovenski-policiji/organiziranost/policijske-uprave/pu-ljubljana/statistika-pu-lj";
const GOV_URL = "https://www.gov.si/podrocja/drzava-in-druzba/lokalna-samouprava-in-regionalni-razvoj/lokalna-samouprava/obcine/";

type CaptureRequest = HttpStepRequest<"si-demo-gov-municipalities">;
type CaptureLimits = Readonly<{ maxBytes: number; maxRedirects: number }>;

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const jsonSha256 = (value: unknown) => sha256(JSON.stringify(value));

function currentDiscoveryInput() {
  return {
    schemaVersion: "si-demo-package-acquisition-staging@1",
    mode: "native_discovery_hints",
    stagingOnly: true,
    policyLockWritten: false,
    discovery: {
      invocationVersion: "codex-cli-invocation@2",
      protocolVersion: "codex-cli-protocol@2",
      compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
      cliVersion: "codex-cli 0.149.0-alpha.4",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
      templateVersion: "official-source-discover@4",
      schemaVersion: "official-source-candidates@1",
      output: "untrusted_hints_only",
    },
    jobs: [
      {
        jobId: "ljubljana_safety",
        candidates: [{
          url: POLICE_URL,
          urlSha256: "4ded510a7ae11ad4e18410a63f6056e7106c65236ab0beb7f3becee35da0915b",
          host: "www.policija.si",
          hostSha256: "3bbf84dad238c75f82d07a7bf60c3c6be562350cfdf3fdc943cf6aa83b49c40e",
        }],
      },
      {
        jobId: "ljubljana_population",
        candidates: [{
          url: "https://www.stat.si/obcine/en/Municip/GroupedAll/82",
          urlSha256: "68747d1d8e07e6930052dc6014425812f3886a58f3c0869ff173328e7b9fbacf",
          host: "www.stat.si",
          hostSha256: "b28a17cc8f4b1b69769c693f4b8e7685d7dafc45d199a344911fbe7ff4282eeb",
        }],
      },
      {
        jobId: "ljubljana_identity_geometry",
        candidates: [{
          url: "https://www.e-prostor.gov.si/podrocja/prostorske-enote-in-naslovi/register-prostorskih-enot/",
          urlSha256: "7793d43c190e74d061b34daa7e346d9098bfc0e731a2c20c5ba11976f5714197",
          host: "www.e-prostor.gov.si",
          hostSha256: "2ba0665f996f4c026a7e39bf026773db8555b52d16464e9d141042e5fc883a13",
        }],
      },
    ],
  };
}

function transportFailure() {
  return {
    schemaVersion: "si-demo-package-capture-failure@1",
    stagingOnly: true,
    phase: "capture",
    routeId: "police-pu-ljubljana-stats",
    kind: "http_error",
    retryable: false,
  };
}

function recoveryDiscovery() {
  return {
    schemaVersion: "si-demo-safety-authority-discovery-staging@1",
    stagingOnly: true,
    policyLockWritten: false,
    prerequisites: {
      discoverySnapshotSha256: jsonSha256(currentDiscoveryInput()),
      failureSnapshotSha256: jsonSha256(transportFailure()),
    },
    failedSource: {
      routeId: "police-pu-ljubljana-stats",
      urlSha256: "4ded510a7ae11ad4e18410a63f6056e7106c65236ab0beb7f3becee35da0915b",
      kind: "transport_unavailable",
    },
    discovery: {
      invocationVersion: "codex-cli-invocation@2",
      protocolVersion: "codex-cli-protocol@2",
      compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
      cliVersion: "codex-cli 0.149.0-alpha.4",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
      templateVersion: "official-source-discover@4",
      schemaVersion: "official-source-candidates@1",
      output: "untrusted_hints_only",
    },
    candidates: [{
      url: GOV_URL,
      urlSha256: "ea675252d8aca3c7d1352e297e26761d27fe223806c4cd82a5d06e89ac9053c3",
      host: "www.gov.si",
      hostSha256: "27fed0408ceefe4f4958a791ad49dd15788b2b82d9f33f7be4267954bbd53685",
    }],
  };
}

function evidence() {
  return Object.freeze({
    schemaVersion: "si-municipality-authority-link-evidence@1" as const,
    analyzerVersion: "si-municipality-authority-link-html@1" as const,
    parentPublisherHost: "www.gov.si" as const,
    municipalityHost: "www.ljubljana.si" as const,
    linkUrl: "https://www.ljubljana.si/" as const,
    identityLabel: "Mestna občina Ljubljana" as const,
  });
}

function captured(request: CaptureRequest, bytes: Uint8Array) {
  const artifactSha256 = sha256(bytes);
  return {
    artifact: {
      artifactId: `${request.sourceId}:${request.role}:${artifactSha256}`,
      runId: request.runId,
      sourceId: request.sourceId,
      role: request.role,
      url: request.url,
      mediaType: "text/html",
      sha256: artifactSha256,
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

function injected(overrides: Record<string, unknown> = {}) {
  return {
    readDiscoveryInput: async () => currentDiscoveryInput(),
    readFailureInput: async () => transportFailure(),
    readRecoveryInput: async () => recoveryDiscovery(),
    createRunId: () => RUN_ID,
    capture: async (request: CaptureRequest, signal: AbortSignal, limits: CaptureLimits) => {
      void signal;
      void limits;
      return captured(request, new TextEncoder().encode("<html>trusted parent</html>"));
    },
    analyze: () => evidence(),
    store: {
      prepare: async () => undefined,
      cleanup: async () => undefined,
      write: async () => undefined,
    },
    ...overrides,
  };
}

describe("capture Slovenia safety authority evidence", () => {
  test("requires the one exact live-source opt-in", () => {
    expect(parseCaptureSloveniaSafetyAuthorityArgs(["--live-official-sources"]))
      .toEqual({ live: true });
    for (const argv of [[], ["--live-official-sources", "--live-official-sources"], ["--url", GOV_URL]]) {
      expect(() => parseCaptureSloveniaSafetyAuthorityArgs(argv))
        .toThrow("capture_slovenia_safety_authority_invalid");
    }
  });

  test("performs no network or output write and removes stale output after a prerequisite rejection", async () => {
    const badDiscovery = { ...currentDiscoveryInput(), policyLockWritten: true };
    const badFailure = { ...transportFailure(), retryable: true };
    const badHash = recoveryDiscovery();
    badHash.prerequisites.failureSnapshotSha256 = "f".repeat(64);
    const badDiscoveryHash = recoveryDiscovery();
    badDiscoveryHash.prerequisites.discoverySnapshotSha256 = "f".repeat(64);
    const badCurrentCandidateHash = currentDiscoveryInput();
    badCurrentCandidateHash.jobs[0]!.candidates[0]!.urlSha256 = "f".repeat(64);
    const badRecoveryCandidateHash = recoveryDiscovery();
    badRecoveryCandidateHash.candidates[0]!.hostSha256 = "f".repeat(64);
    const noFixedCandidate = recoveryDiscovery();
    noFixedCandidate.candidates = [];
    for (const inputReaders of [
      { readDiscoveryInput: async () => badDiscovery },
      { readFailureInput: async () => badFailure },
      { readRecoveryInput: async () => badHash },
      { readRecoveryInput: async () => badDiscoveryHash },
      { readDiscoveryInput: async () => badCurrentCandidateHash },
      { readRecoveryInput: async () => badRecoveryCandidateHash },
      { readRecoveryInput: async () => noFixedCandidate },
      { readRecoveryInput: async () => new Proxy(recoveryDiscovery(), {}) },
    ]) {
      const capture = vi.fn();
      const prepare = vi.fn(async () => undefined);
      const cleanup = vi.fn(async () => undefined);
      const write = vi.fn(async () => undefined);
      const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
        ["--live-official-sources"],
        injected({ ...inputReaders, capture, store: { prepare, cleanup, write } }),
      );
      expect(result).toEqual({
        exitCode: 1,
        stderr: "capture_slovenia_safety_authority_failed\n",
      });
      expect(capture).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("uses the one fixed GOV request and analyzes the immediate snapshot before writing", async () => {
    const order: string[] = [];
    const capture = vi.fn(async (
      request: CaptureRequest,
      signal: AbortSignal,
      limits: CaptureLimits,
    ) => {
      void signal;
      void limits;
      order.push("capture");
      return captured(request, new TextEncoder().encode("<html>trusted parent</html>"));
    });
    const analyze = vi.fn(() => { order.push("analyze"); return evidence(); });
    const write = vi.fn(async () => { order.push("write"); });

    const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
      ["--live-official-sources"],
      injected({ capture, analyze, store: { prepare: async () => undefined, cleanup: async () => undefined, write } }),
    );

    expect(result).toEqual({ exitCode: 0, stderr: "" });
    expect(order).toEqual(["capture", "analyze", "write"]);
    expect(capture).toHaveBeenCalledOnce();
    const [request, signal, limits] = capture.mock.calls[0]!;
    expect(request).toEqual({
      runId: RUN_ID,
      sourceId: "si-demo-gov-municipalities",
      role: "municipality-authority-directory",
      method: "GET",
      url: GOV_URL,
      headers: { accept: "text/html" },
      allowedHosts: ["www.gov.si"],
      allowedMediaTypes: ["text/html"],
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(limits).toEqual({ maxBytes: 2 * 1024 * 1024, maxRedirects: 2 });
    expect(analyze).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  test("does not write a manifest when the deterministic link analyzer rejects the page", async () => {
    const cleanup = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
      ["--live-official-sources"],
      injected({
        analyze: () => { throw new Error("slovenia_municipality_authority_link_invalid"); },
        store: { prepare: async () => undefined, cleanup, write },
      }),
    );
    expect(result).toEqual({
      exitCode: 1,
      stderr: "capture_slovenia_safety_authority_failed\n",
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  test("owns captured bytes before an analyzer or caller can mutate borrowed memory", async () => {
    const borrowed = new TextEncoder().encode("original");
    let stored: unknown;
    const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
      ["--live-official-sources"],
      injected({
        capture: async (request: CaptureRequest, signal: AbortSignal, limits: CaptureLimits) => {
          void signal;
          void limits;
          return captured(request, borrowed);
        },
        analyze: (bytes: Uint8Array) => {
          borrowed[0] = "X".charCodeAt(0);
          bytes[0] = "Y".charCodeAt(0);
          return evidence();
        },
        store: {
          prepare: async () => undefined,
          cleanup: async () => undefined,
          write: async (value: unknown) => { stored = value; },
        },
      }),
    );
    expect(result).toEqual({ exitCode: 0, stderr: "" });
    const bytes = (stored as { capture: { artifact: { bytes: Uint8Array } } }).capture.artifact.bytes;
    expect(new TextDecoder().decode(bytes)).toBe("original");
  });

  test("rejects proxied captured bytes without invoking proxy traps or the analyzer", async () => {
    let prototypeReads = 0;
    const original = new TextEncoder().encode("PRIVATE");
    const proxied = new Proxy(original, {
      getPrototypeOf() {
        prototypeReads += 1;
        throw new Error("PRIVATE proxy trap");
      },
    });
    const analyze = vi.fn();
    const write = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);
    const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
      ["--live-official-sources"],
      injected({
        capture: async (request: CaptureRequest) => {
          const value = captured(request, original);
          value.artifact.bytes = proxied;
          return value;
        },
        analyze,
        store: { prepare: async () => undefined, cleanup, write },
      }),
    );
    expect(result).toEqual({
      exitCode: 1,
      stderr: "capture_slovenia_safety_authority_failed\n",
    });
    expect(prototypeReads).toBe(0);
    expect(analyze).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  test("stores raw bytes then the closed manifest with private permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-safety-authority-capture-"));
    try {
      const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
        ["--live-official-sources"],
        injected({ store: createCaptureSloveniaSafetyAuthorityStore({ workspaceRoot: root }) }),
      );
      expect(result).toEqual({ exitCode: 0, stderr: "" });
      const rawPath = join(root, OUTPUT_ROOT, "raw", "gov-municipalities.bin");
      const manifestPath = join(root, OUTPUT_ROOT, "manifest.json");
      const rawBytes = new TextEncoder().encode("<html>trusted parent</html>");
      const rawSha256 = sha256(rawBytes);
      const artifactId = `si-demo-gov-municipalities:municipality-authority-directory:${rawSha256}`;
      expect(new TextDecoder().decode(await readFile(rawPath))).toBe("<html>trusted parent</html>");
      expect((await stat(rawPath)).mode & 0o777).toBe(0o600);
      expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({
        schemaVersion: "si-demo-safety-authority-capture-staging@1",
        runId: RUN_ID,
        stagingOnly: true,
        policyLockWritten: false,
        authorityInstalled: false,
        inputs: {
          discoverySnapshotSha256: jsonSha256(currentDiscoveryInput()),
          failureSnapshotSha256: jsonSha256(transportFailure()),
          recoveryDiscoverySnapshotSha256: jsonSha256(recoveryDiscovery()),
        },
        capture: {
          artifactId,
          routeId: "gov-municipalities",
          sourceId: "si-demo-gov-municipalities",
          publisherId: "si-gov",
          inputCandidateSha256: sha256(GOV_URL),
          method: "GET",
          initialUrl: GOV_URL,
          finalUrl: GOV_URL,
          responseStatus: 200,
          redirectChain: [GOV_URL],
          mediaType: "text/html",
          byteCount: rawBytes.byteLength,
          sha256: rawSha256,
          capturedAt: "2026-08-30T00:00:00.000Z",
          rawPath: `${OUTPUT_ROOT}/raw/gov-municipalities.bin`,
        },
        candidateAuthorityEvidence: {
          schemaVersion: "si-municipality-authority-link-evidence@1",
          analyzerVersion: "si-municipality-authority-link-html@1",
          parentPublisherHost: "www.gov.si",
          municipalityHost: "www.ljubljana.si",
          linkUrl: "https://www.ljubljana.si/",
          identityLabel: "Mestna občina Ljubljana",
          parentArtifactId: artifactId,
          edgeKind: "confirmed_document_link",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe output identities and preserves an unowned temp collision", async () => {
    const symlinkRoot = await mkdtemp(join(tmpdir(), "si-safety-authority-capture-link-"));
    const outside = await mkdtemp(join(tmpdir(), "si-safety-authority-capture-outside-"));
    const hardlinkRoot = await mkdtemp(join(tmpdir(), "si-safety-authority-capture-hard-"));
    const collisionRoot = await mkdtemp(join(tmpdir(), "si-safety-authority-capture-collision-"));
    try {
      await mkdir(join(symlinkRoot, "data", "evals"), { recursive: true });
      await symlink(outside, join(symlinkRoot, "data", "evals", "capture-slovenia-safety-authority"));
      await expect(createCaptureSloveniaSafetyAuthorityStore({ workspaceRoot: symlinkRoot }).prepare())
        .rejects.toThrow("capture_slovenia_safety_authority_invalid");

      const output = join(hardlinkRoot, OUTPUT_ROOT);
      const manifest = join(output, "manifest.json");
      const outsideLeaf = join(hardlinkRoot, "outside");
      await mkdir(output, { recursive: true });
      await writeFile(outsideLeaf, "outside");
      await link(outsideLeaf, manifest);
      await expect(createCaptureSloveniaSafetyAuthorityStore({ workspaceRoot: hardlinkRoot }).prepare())
        .rejects.toThrow("capture_slovenia_safety_authority_invalid");
      expect(await readFile(outsideLeaf, "utf8")).toBe("outside");

      const collisionOutput = join(collisionRoot, OUTPUT_ROOT);
      const collision = join(collisionOutput, ".collision.tmp");
      await mkdir(collisionOutput, { recursive: true });
      await writeFile(collision, "owned elsewhere");
      const result = await runCaptureSloveniaSafetyAuthorityEntrypoint(
        ["--live-official-sources"],
        injected({
          store: createCaptureSloveniaSafetyAuthorityStore({
            workspaceRoot: collisionRoot,
            randomId: () => "collision",
          }),
        }),
      );
      expect(result.exitCode).toBe(1);
      expect(await readFile(collision, "utf8")).toBe("owned elsewhere");
      await expect(readFile(join(collisionOutput, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(collisionOutput, "raw", "gov-municipalities.bin")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(symlinkRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(hardlinkRoot, { recursive: true, force: true });
      await rm(collisionRoot, { recursive: true, force: true });
    }
  });
});
