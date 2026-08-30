import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  createDiscoverSloveniaSafetyAuthorityStore,
  parseDiscoverSloveniaSafetyAuthorityArgs,
  runDiscoverSloveniaSafetyAuthorityEntrypoint,
} from "../../evals/discover-slovenia-safety-authority";

const OUTPUT_PATH = "data/evals/discover-slovenia-safety-authority/result.json";
const POLICE_URL = "https://www.policija.si/o-slovenski-policiji/organiziranost/policijske-uprave/pu-ljubljana/statistika-pu-lj";
const jsonSha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

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

function transportFailure(kind: "http_error" | "timeout" = "http_error") {
  return {
    schemaVersion: "si-demo-package-capture-failure@1",
    stagingOnly: true,
    phase: "capture",
    routeId: "police-pu-ljubljana-stats",
    kind,
    retryable: kind === "timeout",
  };
}

function discoveryResult(candidates: readonly unknown[] = [{
  url: "https://www.gov.si/state-authority/municipality-of-ljubljana/",
  claimedPublisher: "PRIVATE untrusted claim",
  expectedCoverage: "PRIVATE untrusted coverage",
  rationale: "PRIVATE must not persist",
}]) {
  return {
    candidates,
    metadata: {
      invocationVersion: "codex-cli-invocation@2",
      protocolVersion: "codex-cli-protocol@2",
      compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2",
      cliVersion: "codex-cli 0.149.0-alpha.4",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      toolPolicy: "codex-tools-web-search@2",
      templateVersion: "official-source-discover@4",
      schemaVersion: "official-source-candidates@1",
    },
  };
}

function injected(overrides: Record<string, unknown> = {}) {
  return {
    readDiscoveryInput: async () => currentDiscoveryInput(),
    readFailureInput: async () => transportFailure(),
    verifyInstallation: async () => undefined,
    registerRuntime: async () => undefined,
    discovery: { discover: async () => discoveryResult() },
    store: {
      prepare: async () => undefined,
      cleanup: async () => undefined,
      write: async () => undefined,
    },
    ...overrides,
  };
}

describe("discover Slovenia safety authority command", () => {
  test("requires the one exact local-subscription opt-in", () => {
    expect(parseDiscoverSloveniaSafetyAuthorityArgs(["--live-local-subscription"]))
      .toEqual({ live: true });

    for (const argv of [
      [],
      ["--live-local-subscription", "--live-local-subscription"],
      ["--model", "gpt-5.4"],
      ["--artifact", "elsewhere.json"],
    ]) {
      expect(() => parseDiscoverSloveniaSafetyAuthorityArgs(argv))
        .toThrow("discover_slovenia_safety_authority_invalid");
    }
  });

  test("performs neither runtime nor output side effects until both existing artifacts pass", async () => {
    for (const gates of [
      {
        readDiscoveryInput: async () => ({ ...currentDiscoveryInput(), jobs: [] }),
        readFailureInput: async () => transportFailure(),
      },
      {
        readDiscoveryInput: async () => currentDiscoveryInput(),
        readFailureInput: async () => ({ ...transportFailure(), responseStatus: 503 }),
      },
      {
        readDiscoveryInput: async () => currentDiscoveryInput(),
        readFailureInput: async () => new Proxy(transportFailure(), {}),
      },
    ]) {
      const prepare = vi.fn(async () => undefined);
      const cleanup = vi.fn(async () => undefined);
      const write = vi.fn(async () => undefined);
      const verifyInstallation = vi.fn(async () => undefined);
      const registerRuntime = vi.fn(async () => undefined);
      const discover = vi.fn(async () => discoveryResult());

      await expect(runDiscoverSloveniaSafetyAuthorityEntrypoint(
        ["--live-local-subscription"],
        injected({
          ...gates,
          verifyInstallation,
          registerRuntime,
          discovery: { discover },
          store: { prepare, cleanup, write },
        }),
      )).resolves.toEqual({
        exitCode: 1,
        stderr: "discover_slovenia_safety_authority_failed\n",
      });

      expect(prepare).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(verifyInstallation).not.toHaveBeenCalled();
      expect(registerRuntime).not.toHaveBeenCalled();
      expect(discover).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("runs one fixed round-two GOV.SI job and stores only closed GOV.SI hints", async () => {
    const calls: unknown[] = [];
    const written: unknown[] = [];
    const result = discoveryResult([
      {
        url: "https://www.gov.si/state-authority/municipality-of-ljubljana/",
        claimedPublisher: "PRIVATE untrusted claim",
        expectedCoverage: "PRIVATE untrusted coverage",
        rationale: "PRIVATE must not persist",
      },
      {
        url: "https://www.ljubljana.si/sl/ljubljana/varna/mestno-redarstvo?l=sl_SI",
        claimedPublisher: "PRIVATE",
        expectedCoverage: "PRIVATE",
        rationale: "PRIVATE",
      },
    ]);

    let receiverWasPreserved = false;
    const discovery = {
      async discover(this: unknown, request: unknown) {
        receiverWasPreserved = this === discovery;
        calls.push(request);
        return result;
      },
    };
    const outcome = await runDiscoverSloveniaSafetyAuthorityEntrypoint(
      ["--live-local-subscription"],
      injected({
        discovery,
        store: {
          prepare: async () => undefined,
          cleanup: async () => undefined,
          write: async (record: unknown) => { written.push(record); },
        },
      }),
    );

    expect(outcome).toEqual({ exitCode: 0, stderr: "" });
    expect(receiverWasPreserved).toBe(true);
    expect(calls).toHaveLength(1);
    const request = calls[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      schemaVersion: "official-source-discovery-request@1",
      entity: { entityId: "ljubljana", kind: "city", countryCode: "SI", displayName: "Ljubljana" },
      fact: {
        factKey: "ljubljana-official-municipality-site-link",
        definitionId: "si-demo-municipality-authority-link@1",
      },
      failedSource: { url: POLICE_URL, reason: "unavailable" },
      authorityRoots: [{ publisherName: "GOV.SI", url: "https://www.gov.si/" }],
      localeHints: ["sl", "en"],
      round: 2,
    });
    expect(written).toEqual([{
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
        url: "https://www.gov.si/state-authority/municipality-of-ljubljana/",
        urlSha256: "def6442539d35ab0b575d00b9dff4cfc75b9ccd5a6f15e3b85a1c3fae521d5ff",
        host: "www.gov.si",
        hostSha256: "27fed0408ceefe4f4958a791ad49dd15788b2b82d9f33f7be4267954bbd53685",
      }],
    }]);
    expect(JSON.stringify(written)).not.toMatch(/PRIVATE|rationale|claimedPublisher|expectedCoverage/);
  });

  test("treats non-GOV hints as an honest empty staging result", async () => {
    const written: unknown[] = [];
    const outcome = await runDiscoverSloveniaSafetyAuthorityEntrypoint(
      ["--live-local-subscription"],
      injected({
        readFailureInput: async () => transportFailure("timeout"),
        discovery: { discover: async () => discoveryResult([
          {
            url: "https://www.ljubljana.si/",
            claimedPublisher: "untrusted",
            expectedCoverage: "untrusted",
            rationale: "untrusted",
          },
          {
            url: "https://www.gov.si:8443/",
            claimedPublisher: "trusted-looking",
            expectedCoverage: "trusted-looking",
            rationale: "trusted-looking",
          },
        ]) },
        store: {
          prepare: async () => undefined,
          cleanup: async () => undefined,
          write: async (record: unknown) => { written.push(record); },
        },
      }),
    );

    expect(outcome).toEqual({ exitCode: 0, stderr: "" });
    expect(written).toEqual([expect.objectContaining({ candidates: [] })]);
  });

  test("fails closed on proxied or accessor-backed discovery output", async () => {
    const cases: unknown[] = [
      new Proxy(discoveryResult(), {}),
      (() => {
        const value = discoveryResult() as Record<string, unknown>;
        Object.defineProperty(value, "metadata", {
          enumerable: true,
          get: () => discoveryResult().metadata,
        });
        return value;
      })(),
      { ...discoveryResult(), metadata: new Proxy(discoveryResult().metadata, {}) },
    ];

    for (const modelOutput of cases) {
      const cleanup = vi.fn(async () => undefined);
      const write = vi.fn(async () => undefined);
      const outcome = await runDiscoverSloveniaSafetyAuthorityEntrypoint(
        ["--live-local-subscription"],
        injected({
          discovery: { discover: async () => modelOutput as never },
          store: { prepare: async () => undefined, cleanup, write },
        }),
      );
      expect(outcome).toEqual({
        exitCode: 1,
        stderr: "discover_slovenia_safety_authority_failed\n",
      });
      expect(cleanup).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("replaces stale output atomically and keeps the artifact private", async () => {
    const root = await mkdtemp(join(tmpdir(), "si-safety-authority-discovery-"));
    const target = join(root, OUTPUT_PATH);
    try {
      await mkdir(join(root, "data", "evals", "discover-slovenia-safety-authority"), { recursive: true });
      await writeFile(target, "stale", "utf8");
      const outcome = await runDiscoverSloveniaSafetyAuthorityEntrypoint(
        ["--live-local-subscription"],
        injected({ store: createDiscoverSloveniaSafetyAuthorityStore({ workspaceRoot: root }) }),
      );
      expect(outcome).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({
        schemaVersion: "si-demo-safety-authority-discovery-staging@1",
        candidates: [{ host: "www.gov.si" }],
      });
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects symlinked parents and hard-linked output leaves", async () => {
    const symlinkRoot = await mkdtemp(join(tmpdir(), "si-safety-authority-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "si-safety-authority-outside-"));
    const hardlinkRoot = await mkdtemp(join(tmpdir(), "si-safety-authority-hardlink-"));
    try {
      await mkdir(join(symlinkRoot, "data", "evals"), { recursive: true });
      await symlink(outside, join(symlinkRoot, "data", "evals", "discover-slovenia-safety-authority"));
      await expect(createDiscoverSloveniaSafetyAuthorityStore({ workspaceRoot: symlinkRoot }).prepare())
        .rejects.toThrow("discover_slovenia_safety_authority_invalid");

      const hardlinkTarget = join(hardlinkRoot, OUTPUT_PATH);
      const outsideLeaf = join(hardlinkRoot, "outside");
      await mkdir(join(hardlinkRoot, "data", "evals", "discover-slovenia-safety-authority"), { recursive: true });
      await writeFile(outsideLeaf, "outside", "utf8");
      await link(outsideLeaf, hardlinkTarget);
      await expect(createDiscoverSloveniaSafetyAuthorityStore({ workspaceRoot: hardlinkRoot }).prepare())
        .rejects.toThrow("discover_slovenia_safety_authority_invalid");
      expect(await readFile(outsideLeaf, "utf8")).toBe("outside");
    } finally {
      await rm(symlinkRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(hardlinkRoot, { recursive: true, force: true });
    }
  });
});
