import { createHash } from "node:crypto";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createLsofCommandRunnerForTest,
  createMacOsNetworkObservationPortForTest,
  createNetworkObservedSpawner,
  parseLsofMachineOutput,
  parseNetworkPrivacyCliArguments,
  readNetworkAllowlist,
  resolveApprovedDnsSnapshot,
  runCodexCliNetworkPrivacyForTest,
  type ApprovedDnsSnapshot,
  type LsofSampleResult,
  type NetworkObserverProof,
} from "../../evals/codex-cli-network-privacy";
import { CODEX_CLI_VERSION } from "../../src/infrastructure/codex-cli/contracts";
import type {
  CodexProcessSpawner,
  SpawnedCodexProcess,
} from "../../src/infrastructure/codex-cli/process";

const EXACT_ALLOWLIST = Object.freeze({
  schemaVersion: "codex-cli-network-allowlist@1" as const,
  exactHosts: Object.freeze(["chatgpt.com"] as const),
  remotePorts: Object.freeze([443] as const),
});
const BUNDLED_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";
const PUBLIC_IPV4 = "104.18.32.47";
const SYNTHETIC_SENTINEL = "SYNTHETIC_CODEX_RUNTIME_SENTINEL_4F7B1C9D";
const createdDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(createdDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Codex CLI network/privacy gate files", () => {
  test("pins the exact local entry point, arguments, and allowlist", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    const allowlist = JSON.parse(await readFile(
      resolve("evals/fixtures/codex-cli/network-allowlist.json"),
      "utf8",
    )) as unknown;

    expect(packageJson.scripts?.["eval:codex-network-privacy"]).toBe(
      "node --import tsx evals/codex-cli-network-privacy.ts",
    );
    expect(readNetworkAllowlist(allowlist)).toEqual({
      schemaVersion: "codex-cli-network-allowlist@1",
      exactHosts: ["chatgpt.com"],
      remotePorts: [443],
    });
    expect(parseNetworkPrivacyCliArguments([
      "--artifact", "data/evals/codex-cli-network-privacy.json",
    ])).toEqual({ artifactPath: "data/evals/codex-cli-network-privacy.json" });
    expect(() => parseNetworkPrivacyCliArguments([
      "--", "--artifact", "data/evals/codex-cli-network-privacy.json",
    ])).toThrow("codex_network_privacy_audit_failed");
  });

  test.each([
    [{ schemaVersion: "codex-cli-network-allowlist@1", exactHosts: ["api.openai.com"], remotePorts: [443] }],
    [{ schemaVersion: "codex-cli-network-allowlist@1", exactHosts: ["chatgpt.com"], remotePorts: [80] }],
    [{ schemaVersion: "codex-cli-network-allowlist@1", exactHosts: ["chatgpt.com"], remotePorts: [443], suffix: ".openai.com" }],
  ])("rejects allowlist drift", (value) => {
    expect(() => readNetworkAllowlist(value)).toThrow("codex_network_privacy_audit_failed");
  });
});

describe("approved DNS snapshot", () => {
  test("accepts one public address family when the other is absent", async () => {
    const missingFamily = Object.assign(new Error("missing"), { code: "ENODATA" });
    const snapshot = await resolveApprovedDnsSnapshot({
      allowlist: EXACT_ALLOWLIST,
      resolver: {
        resolve4: vi.fn(async () => ["104.18.32.47"]),
        resolve6: vi.fn(async () => { throw missingFamily; }),
      },
      signal: new AbortController().signal,
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  test.each([
    ["empty", async () => [], async () => []],
    ["over family cap", async () => Array.from({ length: 17 }, (_, index) => `8.8.8.${index + 1}`), async () => []],
    ["private address", async () => ["10.0.0.1"], async () => []],
    ["loopback IPv6", async () => [], async () => ["::1"]],
    ["Teredo IPv6", async () => [], async () => ["2001::1"]],
    ["benchmark IPv6", async () => [], async () => ["2001:2::1"]],
    ["ORCHIDv1 IPv6", async () => [], async () => ["2001:10::1"]],
    ["ORCHIDv1 range end IPv6", async () => [], async () => ["2001:1f::1"]],
    ["ORCHIDv2 IPv6", async () => [], async () => ["2001:20::1"]],
    ["ORCHIDv2 range end IPv6", async () => [], async () => ["2001:2f::1"]],
    ["documentation IPv6", async () => [], async () => ["2001:db8::1"]],
    ["6to4 IPv6", async () => [], async () => ["2002::1"]],
    ["documentation block IPv6", async () => [], async () => ["3fff::1"]],
    ["malformed address", async () => ["not-an-address"], async () => []],
    ["resolver failure", async () => { throw new Error("resolver failed"); }, async () => []],
  ])("rejects a %s DNS proof", async (_label, resolve4, resolve6) => {
    await expect(resolveApprovedDnsSnapshot({
      allowlist: EXACT_ALLOWLIST,
      resolver: { resolve4, resolve6 },
      signal: new AbortController().signal,
    })).rejects.toThrow("codex_network_privacy_audit_failed");
  });

  test("times out the combined A and AAAA lookup", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<readonly string[]>(() => undefined);
      const proof = resolveApprovedDnsSnapshot({
        allowlist: EXACT_ALLOWLIST,
        resolver: { resolve4: () => never, resolve6: () => never },
        signal: new AbortController().signal,
      });
      const rejection = expect(proof).rejects.toThrow("codex_network_privacy_audit_failed");
      await vi.advanceTimersByTimeAsync(5_001);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("strict macOS lsof machine parser", () => {
  test.each([
    ["IPv4", "127.0.0.1:51000->104.18.32.47:443", "104.18.32.47"],
    ["compressed IPv6", "[2001:db8::2]:51000->[2606:4700::6812:24e4]:443", "2606:4700::6812:24e4"],
    ["IPv4-mapped IPv6", "[::1]:51000->[::ffff:104.18.32.47]:443", "104.18.32.47"],
  ])("parses and canonicalizes %s", (_label, name, remoteAddress) => {
    expect(parseLsofMachineOutput({ pid: 321, stdout: lsofOutput(321, [tcpFile(name)]) })).toEqual([
      {
        processId: 321,
        protocol: "TCP",
        state: "ESTABLISHED",
        remoteAddress,
        remotePort: 443,
      },
    ]);
  });

  test.each([
    ["wrong PID", lsofOutput(999, [tcpFile("127.0.0.1:1->104.18.32.47:443")])],
    ["duplicate protocol", lsofOutput(321, [["f10u", "PTCP", "PTCP", "n127.0.0.1:1->104.18.32.47:443", "TST=ESTABLISHED", "TQR=0", "TQS=0"]])],
    ["missing queue field", lsofOutput(321, [["f10u", "PTCP", "n127.0.0.1:1->104.18.32.47:443", "TST=ESTABLISHED", "TQR=0"]])],
    ["hostname", lsofOutput(321, [tcpFile("localhost:1->chatgpt.com:443")])],
    ["scope ID", lsofOutput(321, [tcpFile("[fe80::1%en0]:1->[2606:4700::1]:443")])],
    ["listener", lsofOutput(321, [["f10u", "PTCP", "n*:443", "TST=LISTEN", "TQR=0", "TQS=0"]])],
    ["UDP", lsofOutput(321, [["f10u", "PUDP", "n127.0.0.1:50000->203.0.113.10:443"]])],
    ["wrong TCP state", lsofOutput(321, [["f10u", "PTCP", "n127.0.0.1:1->104.18.32.47:443", "TST=SYN_SENT", "TQR=0", "TQS=0"]])],
    ["bare newline", new TextEncoder().encode("p321\0cnode\0\nf10u\0PTCP\0bad\nfield\0\n")],
    ["unterminated record", new TextEncoder().encode("p321\0cnode\0")],
  ])("rejects %s", (_label, stdout) => {
    expect(() => parseLsofMachineOutput({ pid: 321, stdout })).toThrow("codex_network_privacy_audit_failed");
  });
});

describe("spawn-time paired observer", () => {
  test("waits for lsof close and captures output delivered after exit", async () => {
    const child = Object.assign(new EventEmitter(), {
      killed: false,
      kill: vi.fn(() => true),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const spawnLsof = vi.fn(() => child) as unknown as typeof spawn;
    const runner = createLsofCommandRunnerForTest(spawnLsof);
    const request = {
      executable: "/usr/sbin/lsof" as const,
      args: ["-nP", "-w", "-a", "-p", "321", "-i", "-F0pcfnPT"] as const,
      timeoutMs: 1_000 as const,
      maxOutputBytes: 65_536 as const,
    };
    const samplePromise = runner.run(request);
    let settled = false;
    void samplePromise.finally(() => { settled = true; });

    child.stdout.write(Buffer.from("p321\0cnode\0\n"));
    child.emit("exit", 0, null);
    child.stdout.write(Buffer.from("f10u\0PUDP\0n127.0.0.1:50000->203.0.113.10:443\0\n"));
    await Promise.resolve();
    expect(settled).toBe(false);

    child.emit("close", 0, null);
    const sample = await samplePromise;
    expect(() => parseLsofMachineOutput({ pid: 321, stdout: sample.stdout })).toThrow(
      "codex_network_privacy_audit_failed",
    );
  });

  test("constructs the exact bounded numeric lsof request", async () => {
    const runner = { run: vi.fn(async () => emptyLsofSample()) };
    const isProcessAlive = vi.fn(() => true);
    const wait = vi.fn(async () => undefined);
    const observation = createMacOsNetworkObservationPortForTest({ runner, isProcessAlive, wait });

    await expect(observation.sample(321)).resolves.toEqual(emptyLsofSample());
    expect(runner.run).toHaveBeenCalledWith({
      executable: "/usr/sbin/lsof",
      args: ["-nP", "-w", "-a", "-p", "321", "-i", "-F0pcfnPT"],
      timeoutMs: 1_000,
      maxOutputBytes: 65_536,
    });
    expect(observation.isProcessAlive(321)).toBe(true);
    expect(isProcessAlive).toHaveBeenCalledWith(321);
    await observation.wait(25);
    expect(wait).toHaveBeenCalledWith(25);
  });

  test("starts synchronously and keeps wrapped exit pending through observation", async () => {
    const snapshot = await approvedSnapshot(1_000);
    const modelSample = deferred<LsofSampleResult>();
    const childExit = deferred<{ readonly code: number | null; readonly signal: string | null }>();
    const child = fakeProcess(902, childExit.promise);
    const delegate = { spawn: vi.fn(() => child) };
    let observationStarted = false;
    const eventOrder: string[] = [];
    const observed = createNetworkObservedSpawner({
      delegate,
      applicationPid: 701,
      clock: () => 1_000,
      observe: {
        isProcessAlive: vi.fn((pid: number) => {
          eventOrder.push(`alive:${pid}`);
          return eventOrder.filter((event) => event.startsWith("alive:")).length <= 4;
        }),
        sample: vi.fn((pid: number) => {
          observationStarted = true;
          eventOrder.push(`sample:${pid}`);
          return pid === 701 ? Promise.resolve(emptyLsofSample()) : modelSample.promise;
        }),
        wait: vi.fn(async () => {
          childExit.resolve({ code: 0, signal: null });
          await Promise.resolve();
        }),
      },
    });
    observed.armDnsSnapshot(snapshot);

    const wrapped = observed.spawner.spawn(modelRequest());
    expect(observationStarted).toBe(true);
    let settled = false;
    void wrapped.exit.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    modelSample.resolve(connectedLsofSample(902, PUBLIC_IPV4, 443));
    await expect(wrapped.exit).resolves.toEqual({ code: 0, signal: null });
    expect(eventOrder).toEqual([
      "alive:701", "alive:902", "sample:701", "sample:902", "alive:701", "alive:902",
      "alive:701", "alive:902",
    ]);
    expect(observed.readProof()).toMatchObject({
      codexExecProcessCount: 1,
      sameIntervalObserved: true,
      sampledProcesses: [
        { kind: "application", processId: 701, sampleCount: 1 },
        { kind: "codex", processId: 902, sampleCount: 1 },
      ],
    });
    expect(() => observed.spawner.spawn(modelRequest())).toThrow("codex_network_privacy_audit_failed");
  });

  test("does not use a terminal-first sweep as the first network proof", async () => {
    const observed = createNetworkObservedSpawner({
      delegate: { spawn: () => fakeProcess(902, Promise.resolve({ code: 0, signal: null })) },
      applicationPid: 701,
      clock: () => 1_000,
      observe: {
        isProcessAlive: () => true,
        sample: async (pid) => pid === 701
          ? emptyLsofSample()
          : connectedLsofSample(902, PUBLIC_IPV4, 443),
        wait: async () => undefined,
      },
    });
    observed.armDnsSnapshot(await approvedSnapshot(1_000));

    await expect(observed.spawner.spawn(modelRequest()).exit).rejects.toThrow(
      "codex_network_privacy_audit_failed",
    );
  });

  test("rejects an unexpected lsof status in a terminal sweep after valid proof", async () => {
    const childExit = deferred<{ readonly code: number | null; readonly signal: string | null }>();
    let codexSamples = 0;
    const observed = createNetworkObservedSpawner({
      delegate: { spawn: () => fakeProcess(902, childExit.promise) },
      applicationPid: 701,
      clock: () => 1_000,
      observe: {
        isProcessAlive: () => true,
        sample: async (pid) => {
          if (pid === 701) return emptyLsofSample();
          codexSamples += 1;
          const sample = connectedLsofSample(902, PUBLIC_IPV4, 443);
          return codexSamples === 1 ? sample : { ...sample, exitCode: 2 };
        },
        wait: async () => {
          childExit.resolve({ code: 0, signal: null });
          await Promise.resolve();
        },
      },
    });
    observed.armDnsSnapshot(await approvedSnapshot(1_000));

    await expect(observed.spawner.spawn(modelRequest()).exit).rejects.toThrow(
      "codex_network_privacy_audit_failed",
    );
  });

  test("awaits observer completion when the original child exit rejects", async () => {
    const childExit = deferred<{ readonly code: number | null; readonly signal: string | null }>();
    const codexSample = deferred<LsofSampleResult>();
    const observed = createNetworkObservedSpawner({
      delegate: { spawn: () => fakeProcess(902, childExit.promise) },
      applicationPid: 701,
      clock: () => 1_000,
      observe: {
        isProcessAlive: () => true,
        sample: (pid) => pid === 701 ? Promise.resolve(emptyLsofSample()) : codexSample.promise,
        wait: async () => undefined,
      },
    });
    observed.armDnsSnapshot(await approvedSnapshot(1_000));
    const wrappedExit = observed.spawner.spawn(modelRequest()).exit;
    let settled = false;
    void wrappedExit.then(() => { settled = true; }, () => { settled = true; });

    childExit.reject(new Error("synthetic child failure"));
    await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 0));
    expect(settled).toBe(false);

    codexSample.resolve(connectedLsofSample(902, PUBLIC_IPV4, 443));
    await expect(wrappedExit).rejects.toThrow();
  });

  test("passes preflight children through and rejects a stale snapshot before model spawn", async () => {
    const snapshot = await approvedSnapshot(1_000);
    const childExit = deferred<{ readonly code: number | null; readonly signal: string | null }>();
    const child = fakeProcess(902, childExit.promise);
    const delegate = { spawn: vi.fn(() => child) };
    const observed = createNetworkObservedSpawner({
      delegate,
      applicationPid: 701,
      clock: () => 2_001,
      observe: neverUsedObservation(),
    });

    expect(observed.spawner.spawn({ ...modelRequest(), args: ["--version"] })).toBe(child);
    observed.armDnsSnapshot(snapshot);
    expect(() => observed.spawner.spawn(modelRequest())).toThrow("codex_network_privacy_audit_failed");
    expect(delegate.spawn).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["dead PID", [true, false], emptyLsofSample(), connectedLsofSample(902, PUBLIC_IPV4, 443)],
    ["empty Codex", [true, true, true, true], emptyLsofSample(), emptyLsofSample()],
    ["application telemetry", [true, true, true, true], connectedLsofSample(701, PUBLIC_IPV4, 443), connectedLsofSample(902, PUBLIC_IPV4, 443)],
    ["unknown Codex address", [true, true, true, true], emptyLsofSample(), connectedLsofSample(902, "8.8.8.8", 443)],
    ["wrong Codex port", [true, true, true, true], emptyLsofSample(), connectedLsofSample(902, PUBLIC_IPV4, 8443)],
    ["unexpected lsof status", [true, true, true, true], emptyLsofSample(), { ...connectedLsofSample(902, PUBLIC_IPV4, 443), exitCode: 2 }],
    ["lsof stderr", [true, true, true, true], emptyLsofSample(), { ...connectedLsofSample(902, PUBLIC_IPV4, 443), stderr: new TextEncoder().encode("warning") }],
    ["lsof overflow", [true, true, true, true], emptyLsofSample(), { exitCode: 0, stdout: new Uint8Array(65_537), stderr: new Uint8Array() }],
  ])("fails closed on %s", async (_label, liveness, application, codex) => {
    const snapshot = await approvedSnapshot(1_000);
    const childExit = deferred<{ readonly code: number | null; readonly signal: string | null }>();
    const child = fakeProcess(902, childExit.promise);
    vi.mocked(child.kill).mockImplementation((signal) => {
      childExit.resolve({ code: null, signal });
    });
    const live = [...liveness];
    const observed = createNetworkObservedSpawner({
      delegate: { spawn: () => child },
      applicationPid: 701,
      clock: () => 1_000,
      observe: {
        isProcessAlive: () => live.shift() ?? false,
        sample: async (pid) => pid === 701 ? application : codex,
        wait: async () => {
          childExit.resolve({ code: 0, signal: null });
          await Promise.resolve();
        },
      },
    });
    observed.armDnsSnapshot(snapshot);

    await expect(observed.spawner.spawn(modelRequest()).exit).rejects.toThrow(
      "codex_network_privacy_audit_failed",
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});

describe("redacted network/privacy artifact", () => {
  test("writes an atomic 0600 artifact with independently recomputable digests", async () => {
    const directory = await freshDirectory();
    const artifactPath = join(directory, "network.json");
    const snapshot = await approvedSnapshot(1_000);
    const fixture = await syntheticFixture();
    const artifact = await runCodexCliNetworkPrivacyForTest({
      artifactPath,
      proof: validArtifactProof(snapshot, fixture),
    });
    const serialized = await readFile(artifactPath, "utf8");
    const mode = (await stat(artifactPath)).mode & 0o777;
    const { artifactDigest, ...base } = artifact;

    expect(mode).toBe(0o600);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(Object.keys(artifact)).toEqual([
      "schemaVersion", "cliVersion", "executableKind", "allowlistVersion", "allowlistDigest",
      "dnsSnapshotDigest", "syntheticFixtureDigest", "codexExecProcessCount", "sameIntervalObserved",
      "sampledProcesses", "approvedEndpoints", "observedConnections", "otherModelProviderConnections",
      "applicationTelemetryConnections", "sensitiveSentinelHits", "rawPromptStored", "rawResultStored",
      "stdoutStored", "stderrStored", "residualTempDirectories", "artifactDigest",
    ]);
    expect(artifactDigest).toBe(sha256(canonicalJson(base)));
    expect(serialized).not.toContain(BUNDLED_CODEX);
    expect(serialized).not.toContain(PUBLIC_IPV4);
    expect(serialized).not.toContain(SYNTHETIC_SENTINEL);
    for (const forbiddenKey of ["prompt", "result", "stdout", "stderr", "remoteAddress", "executable"]) {
      expect(Object.keys(artifact)).not.toContain(forbiddenKey);
    }
  });

  test("removes a stale artifact before validation and leaves it absent on failure", async () => {
    const directory = await freshDirectory();
    const artifactPath = join(directory, "network.json");
    const snapshot = await approvedSnapshot(1_000);
    const fixture = await syntheticFixture();
    await writeFile(artifactPath, "stale-sensitive-output", "utf8");

    await expect(runCodexCliNetworkPrivacyForTest({
      artifactPath,
      proof: {
        ...validArtifactProof(snapshot, fixture),
        executableKind: "unexpected",
      } as never,
    })).rejects.toThrow("codex_network_privacy_audit_failed");
    await expect(access(artifactPath)).rejects.toThrow();
  });

  test.each([
    ["raw prompt", (proof: ArtifactProof) => ({ ...proof, privacy: { ...proof.privacy, rawPromptStored: true } })],
    ["raw result", (proof: ArtifactProof) => ({ ...proof, privacy: { ...proof.privacy, rawResultStored: true } })],
    ["stdout", (proof: ArtifactProof) => ({ ...proof, privacy: { ...proof.privacy, stdoutStored: true } })],
    ["stderr", (proof: ArtifactProof) => ({ ...proof, privacy: { ...proof.privacy, stderrStored: true } })],
    ["sentinel", (proof: ArtifactProof) => ({
      ...proof,
      privacy: { ...proof.privacy, inspectedOutputTexts: [`log:${SYNTHETIC_SENTINEL}`] },
    })],
    ["temp residue", (proof: ArtifactProof) => ({
      ...proof,
      residualTempDirectories: ["confirmed-life-codex-residue"],
    })],
  ])("rejects %s retention evidence", async (_label, mutate) => {
    const directory = await freshDirectory();
    const artifactPath = join(directory, "network.json");
    const proof = validArtifactProof(await approvedSnapshot(1_000), await syntheticFixture());

    await expect(runCodexCliNetworkPrivacyForTest({
      artifactPath,
      proof: mutate(proof),
    })).rejects.toThrow("codex_network_privacy_audit_failed");
    await expect(access(artifactPath)).rejects.toThrow();
  });
});

function lsofOutput(pid: number, files: readonly (readonly string[])[]): Uint8Array {
  const records = [[`p${pid}`, "ccodex"], ...files];
  return new TextEncoder().encode(records.map((fields) => `${fields.join("\0")}\0\n`).join(""));
}

function tcpFile(name: string): readonly string[] {
  return ["f10u", "PTCP", `n${name}`, "TST=ESTABLISHED", "TQR=0", "TQS=0"];
}

type ArtifactProof = Parameters<typeof runCodexCliNetworkPrivacyForTest>[0]["proof"];
type SyntheticFixtureInput = ArtifactProof["fixture"];

async function approvedSnapshot(completedAtMs: number): Promise<ApprovedDnsSnapshot> {
  return resolveApprovedDnsSnapshot({
    allowlist: EXACT_ALLOWLIST,
    resolver: {
      resolve4: async () => [PUBLIC_IPV4],
      resolve6: async () => [],
    },
    signal: new AbortController().signal,
    now: () => completedAtMs,
  });
}

function modelRequest(): Parameters<CodexProcessSpawner["spawn"]>[0] {
  return {
    executable: BUNDLED_CODEX,
    args: ["exec", "--strict-config"],
    cwd: "/tmp/codex-network-test",
    env: {},
    stdin: new Uint8Array(),
  };
}

function fakeProcess(
  pid: number,
  exit: Promise<{ readonly code: number | null; readonly signal: string | null }>,
): SpawnedCodexProcess {
  return {
    pid,
    stdout: emptyStream(),
    stderr: emptyStream(),
    exit,
    kill: vi.fn(),
  };
}

async function* emptyStream(): AsyncGenerator<Uint8Array> {
  return;
}

function emptyLsofSample(): LsofSampleResult {
  return { exitCode: 1, stdout: new Uint8Array(), stderr: new Uint8Array() };
}

function connectedLsofSample(pid: number, address: string, port: number): LsofSampleResult {
  return {
    exitCode: 0,
    stdout: lsofOutput(pid, [tcpFile(`127.0.0.1:51000->${address}:${port}`)]),
    stderr: new Uint8Array(),
  };
}

function neverUsedObservation() {
  return {
    isProcessAlive: vi.fn(() => { throw new Error("not used"); }),
    sample: vi.fn(async () => { throw new Error("not used"); }),
    wait: vi.fn(async () => { throw new Error("not used"); }),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolveValue = resolvePromise;
    rejectValue = rejectPromise;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

async function freshDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codex-network-artifact-"));
  createdDirectories.push(directory);
  return directory;
}

async function syntheticFixture(): Promise<SyntheticFixtureInput> {
  return JSON.parse(await readFile(
    resolve("evals/fixtures/codex-cli/runtime-cases.json"),
    "utf8",
  )) as SyntheticFixtureInput;
}

function validArtifactProof(
  dnsSnapshot: ApprovedDnsSnapshot,
  fixture: SyntheticFixtureInput,
): ArtifactProof {
  return {
    cliVersion: CODEX_CLI_VERSION,
    executableKind: "chatgpt_app_bundled",
    allowlist: EXACT_ALLOWLIST,
    dnsSnapshot,
    fixture,
    observer: validObserverProof(),
    modelResult: { schemaVersion: "codex-runtime-smoke@1", status: "tool_free" },
    privacy: {
      rawPromptStored: false,
      rawResultStored: false,
      stdoutStored: false,
      stderrStored: false,
      inspectedOutputTexts: [],
    },
    residualTempDirectories: [],
  };
}

function validObserverProof(): NetworkObserverProof {
  return {
    codexExecProcessCount: 1,
    sameIntervalObserved: true,
    sampledProcesses: [
      { kind: "application", processId: 701, sampleCount: 1 },
      { kind: "codex", processId: 902, sampleCount: 1 },
    ],
    approvedEndpoints: ["chatgpt.com:443"],
    observedConnections: [{
      processId: 902,
      processKind: "codex",
      remoteEndpoint: "chatgpt.com",
      remotePort: 443,
      classification: "openai",
    }],
    otherModelProviderConnections: [],
    applicationTelemetryConnections: [],
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new Error("unsupported test value");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
