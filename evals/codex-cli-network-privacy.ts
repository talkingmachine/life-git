import { createHash } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isIP, SocketAddress } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { types } from "node:util";

import {
  CODEX_CLI_VERSION,
  createCodexJsonInvocation,
  MAX_CODEX_EVENTS,
  MAX_CODEX_STDERR_BYTES,
  MAX_CODEX_STDOUT_BYTES,
  MAX_CODEX_TIMEOUT_MS,
} from "../src/infrastructure/codex-cli/contracts";
import { createClosedCodexEnvironment } from "../src/infrastructure/codex-cli/preflight";
import {
  nodeCodexProcessSpawner,
  type CodexProcessSpawner,
  type SpawnedCodexProcess,
} from "../src/infrastructure/codex-cli/process";
import {
  getCodexCliModelAdapter,
  initializeCodexCliRuntime,
} from "../src/infrastructure/codex-cli/runtime";

const ARTIFACT_SCHEMA_VERSION = "codex-cli-network-privacy-audit@1" as const;
const ALLOWLIST_SCHEMA_VERSION = "codex-cli-network-allowlist@1" as const;
const BUNDLED_CODEX_EXECUTABLE = "/Applications/ChatGPT.app/Contents/Resources/codex";
const LSOF_EXECUTABLE = "/usr/sbin/lsof";
const LSOF_MAX_BYTES = 65_536;
const LSOF_TIMEOUT_MS = 1_000;
const DNS_TIMEOUT_MS = 5_000;
const DNS_MAX_PER_FAMILY = 16;
const DNS_MAX_TOTAL = 32;
const MAX_SNAPSHOT_AGE_MS = 1_000;
const SAMPLE_INTERVAL_MS = 25;
const NETWORK_FIXTURE_URL = new URL("./fixtures/codex-cli/runtime-cases.json", import.meta.url);
const ALLOWLIST_URL = new URL("./fixtures/codex-cli/network-allowlist.json", import.meta.url);
const NETWORK_FIXTURE_PATH = resolve(fileURLToPath(NETWORK_FIXTURE_URL));
const ALLOWLIST_PATH = resolve(fileURLToPath(ALLOWLIST_URL));
const FINAL_PROJECT_LIVE_MODEL_GATE_FLAG = "--final-project-live-model-gate";
const LIVE_MODEL_GATE_DEFERRED = "onboarding_live_model_gate_deferred\n";
const NETWORK_FAILURE = "codex_network_privacy_audit_failed\n";
const EMPTY_TUPLE = Object.freeze([]) as readonly [];
const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;

export interface CodexCliNetworkAllowlist {
  readonly schemaVersion: typeof ALLOWLIST_SCHEMA_VERSION;
  readonly exactHosts: readonly ["chatgpt.com"];
  readonly remotePorts: readonly [443];
}

export interface DnsResolverPort {
  resolve4(host: string): Promise<readonly string[]>;
  resolve6(host: string): Promise<readonly string[]>;
}

export interface ApprovedDnsBinding {
  readonly host: "chatgpt.com";
  readonly port: 443;
  readonly address: string;
}

export interface ApprovedDnsSnapshot {
  readonly completedAtMs: number;
  readonly bindings: readonly ApprovedDnsBinding[];
  readonly digest: string;
}

export interface ParsedLsofSocket {
  readonly processId: number;
  readonly protocol: "TCP";
  readonly state: "ESTABLISHED";
  readonly remoteAddress: string;
  readonly remotePort: number;
}

export interface LsofSampleResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface NetworkObservationPort {
  isProcessAlive(pid: number): boolean;
  sample(pid: number): Promise<LsofSampleResult>;
  wait(milliseconds: number): Promise<void>;
}

export interface LsofCommandRequest {
  readonly executable: typeof LSOF_EXECUTABLE;
  readonly args: readonly ["-nP", "-w", "-a", "-p", string, "-i", "-F0pcfnPT"];
  readonly timeoutMs: typeof LSOF_TIMEOUT_MS;
  readonly maxOutputBytes: typeof LSOF_MAX_BYTES;
}

export interface LsofCommandRunner {
  run(request: LsofCommandRequest): Promise<LsofSampleResult>;
}

export interface NetworkObserverProof {
  readonly codexExecProcessCount: 1;
  readonly sameIntervalObserved: true;
  readonly sampledProcesses: readonly [
    { readonly kind: "application"; readonly processId: number; readonly sampleCount: number },
    { readonly kind: "codex"; readonly processId: number; readonly sampleCount: number },
  ];
  readonly approvedEndpoints: readonly ["chatgpt.com:443"];
  readonly observedConnections: readonly {
    readonly processId: number;
    readonly processKind: "codex";
    readonly remoteEndpoint: "chatgpt.com";
    readonly remotePort: 443;
    readonly classification: "openai";
  }[];
  readonly otherModelProviderConnections: readonly [];
  readonly applicationTelemetryConnections: readonly [];
}

export interface NetworkObservedSpawner {
  readonly spawner: CodexProcessSpawner;
  armDnsSnapshot(snapshot: ApprovedDnsSnapshot): void;
  readProof(): NetworkObserverProof;
}

export interface CodexCliNetworkPrivacyAuditArtifact extends NetworkObserverProof {
  readonly schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly executableKind: "chatgpt_app_bundled";
  readonly allowlistVersion: typeof ALLOWLIST_SCHEMA_VERSION;
  readonly allowlistDigest: string;
  readonly dnsSnapshotDigest: string;
  readonly syntheticFixtureDigest: string;
  readonly sensitiveSentinelHits: readonly [];
  readonly rawPromptStored: false;
  readonly rawResultStored: false;
  readonly stdoutStored: false;
  readonly stderrStored: false;
  readonly residualTempDirectories: readonly [];
  readonly artifactDigest: string;
}

export type CodexCliNetworkPrivacyLaunchArguments = Readonly<{
  mode: "deferred" | "final-project-live-model-gate";
  artifactPath: string;
}>;

export type CodexCliNetworkPrivacyEntrypointResult =
  | Readonly<{ exitCode: 0; stdout: ""; stderr: "" }>
  | Readonly<{
      exitCode: 1;
      stdout: "";
      stderr: "onboarding_live_model_gate_deferred\n" | "codex_network_privacy_audit_failed\n";
    }>;

const NETWORK_SUCCESS_RESULT: CodexCliNetworkPrivacyEntrypointResult = Object.freeze({
  exitCode: 0,
  stdout: "",
  stderr: "",
});
const NETWORK_DEFERRED_RESULT: CodexCliNetworkPrivacyEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: LIVE_MODEL_GATE_DEFERRED,
});
const NETWORK_FAILURE_RESULT: CodexCliNetworkPrivacyEntrypointResult = Object.freeze({
  exitCode: 1,
  stdout: "",
  stderr: NETWORK_FAILURE,
});

interface SyntheticFixture {
  readonly fixtureVersion: "codex-cli-runtime-case@1";
  readonly sensitiveSentinels: readonly [string];
  readonly prompt: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly expectedResult: {
    readonly schemaVersion: "codex-runtime-smoke@1";
    readonly status: "tool_free";
  };
}

export interface ArtifactProofInput {
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly executableKind: "chatgpt_app_bundled";
  readonly allowlist: CodexCliNetworkAllowlist;
  readonly dnsSnapshot: ApprovedDnsSnapshot;
  readonly fixture: SyntheticFixture;
  readonly observer: NetworkObserverProof;
  readonly modelResult: unknown;
  readonly privacy: {
    readonly rawPromptStored: boolean;
    readonly rawResultStored: boolean;
    readonly stdoutStored: boolean;
    readonly stderrStored: boolean;
    readonly inspectedOutputTexts: readonly string[];
  };
  readonly residualTempDirectories: readonly string[];
}

export function readNetworkAllowlist(value: unknown): CodexCliNetworkAllowlist {
  const object = exactPlainObject(value, ["schemaVersion", "exactHosts", "remotePorts"]);
  if (object.schemaVersion !== ALLOWLIST_SCHEMA_VERSION) throw auditFailed();
  const exactHosts = exactDenseArray(object.exactHosts, 1);
  const remotePorts = exactDenseArray(object.remotePorts, 1);
  if (exactHosts[0] !== "chatgpt.com" || remotePorts[0] !== 443) throw auditFailed();
  return Object.freeze({
    schemaVersion: ALLOWLIST_SCHEMA_VERSION,
    exactHosts: Object.freeze(["chatgpt.com"] as const),
    remotePorts: Object.freeze([443] as const),
  });
}

export async function resolveApprovedDnsSnapshot(input: {
  readonly allowlist: CodexCliNetworkAllowlist;
  readonly resolver: DnsResolverPort;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}): Promise<ApprovedDnsSnapshot> {
  throwIfAborted(input.signal);
  readNetworkAllowlist(input.allowlist);
  let resolution: readonly [readonly string[], readonly string[]];
  try {
    resolution = await raceWithTimeoutAndAbort(
      Promise.all([
        resolveFamily(() => input.resolver.resolve4("chatgpt.com")),
        resolveFamily(() => input.resolver.resolve6("chatgpt.com")),
      ]),
      input.signal,
      DNS_TIMEOUT_MS,
    );
  } catch {
    throw auditFailed();
  }
  const [ipv4, ipv6] = resolution;
  if (ipv4.length > DNS_MAX_PER_FAMILY || ipv6.length > DNS_MAX_PER_FAMILY) throw auditFailed();
  const addresses = [...new Set([...ipv4, ...ipv6].map(canonicalPublicAddress))].sort();
  if (addresses.length === 0 || addresses.length > DNS_MAX_TOTAL) throw auditFailed();
  const bindings = Object.freeze(addresses.map((address) => Object.freeze({
    host: "chatgpt.com" as const,
    port: 443 as const,
    address,
  })));
  const completedAtMs = readNow(input.now);
  return Object.freeze({
    completedAtMs,
    bindings,
    digest: sha256(canonicalJson({ bindings })),
  });
}

export function parseLsofMachineOutput(input: {
  readonly pid: number;
  readonly stdout: Uint8Array;
}): readonly ParsedLsofSocket[] {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0 || input.stdout.byteLength > LSOF_MAX_BYTES) {
    throw auditFailed();
  }
  if (input.stdout.byteLength === 0) return EMPTY_TUPLE;
  const text = decodeUtf8(input.stdout);
  if (!text.endsWith("\n")) throw auditFailed();
  const lines = text.slice(0, -1).split("\n");
  if (lines.length < 2 || lines.some((line) => line.length === 0)) throw auditFailed();
  const processFields = fieldsFromLine(lines[0] as string);
  if (processFields.length !== 2 || processFields[0] !== `p${input.pid}` ||
      !/^c[^\0\r\n]{1,255}$/.test(processFields[1] ?? "")) {
    throw auditFailed();
  }

  const sockets: ParsedLsofSocket[] = [];
  const descriptors = new Set<string>();
  for (const line of lines.slice(1)) {
    const fields = fieldsFromLine(line);
    const descriptor = requireSingleField(fields, "f");
    if (!/^[0-9]+[A-Za-z]*$/.test(descriptor) || descriptors.has(descriptor)) throw auditFailed();
    descriptors.add(descriptor);
    const protocol = requireSingleField(fields, "P");
    if (protocol !== "TCP") throw auditFailed();
    const name = requireSingleField(fields, "n");
    const tcp = tcpFields(fields);
    if (tcp.state !== "ESTABLISHED" || !tcp.hasQueueFields) throw auditFailed();
    const endpoints = parseSocketName(name);
    if (endpoints.remote === undefined) throw auditFailed();
    sockets.push(Object.freeze({
      processId: input.pid,
      protocol: "TCP" as const,
      state: "ESTABLISHED" as const,
      remoteAddress: endpoints.remote.address,
      remotePort: endpoints.remote.port,
    }));
  }
  return Object.freeze(sockets);
}

export function createNetworkObservedSpawner(input: {
  readonly delegate: CodexProcessSpawner;
  readonly applicationPid: number;
  readonly clock?: () => number;
  readonly observe?: NetworkObservationPort;
}): NetworkObservedSpawner {
  if (!Number.isSafeInteger(input.applicationPid) || input.applicationPid <= 0) throw auditFailed();
  const observation = input.observe ?? createMacOsNetworkObservationPort();
  let armedSnapshot: ApprovedDnsSnapshot | undefined;
  let proof: NetworkObserverProof | undefined;
  let execCount = 0;

  const spawner: CodexProcessSpawner = Object.freeze({
    spawn(request: Parameters<CodexProcessSpawner["spawn"]>[0]): SpawnedCodexProcess {
      if (request.args[0] !== "exec") return input.delegate.spawn(request);
      if (execCount !== 0 || armedSnapshot === undefined) throw auditFailed();
      if (request.executable !== BUNDLED_CODEX_EXECUTABLE) throw auditFailed();
      const now = readNow(input.clock);
      if (now < armedSnapshot.completedAtMs || now - armedSnapshot.completedAtMs > MAX_SNAPSHOT_AGE_MS) {
        throw auditFailed();
      }
      execCount += 1;
      const child = input.delegate.spawn(request);
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw auditFailed();
      let exitObserved = false;
      const originalExit = child.exit.then(
        (result) => {
          exitObserved = true;
          return result;
        },
        (error: unknown) => {
          exitObserved = true;
          throw error;
        },
      );
      const monitor = observeSpawnInterval({
        applicationPid: input.applicationPid,
        codexPid: child.pid,
        dnsSnapshot: armedSnapshot,
        observation,
        exitObserved: () => exitObserved,
      }).then((value) => {
        proof = value;
      }).catch((error: unknown) => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The observer failure remains authoritative if the child exits concurrently.
        }
        throw error;
      });
      const wrappedExit = Promise.allSettled([originalExit, monitor]).then(([processResult, monitorResult]) => {
        if (processResult.status === "rejected") throw processResult.reason;
        if (monitorResult.status === "rejected") throw monitorResult.reason;
        return processResult.value;
      });
      return Object.freeze({
        pid: child.pid,
        stdout: child.stdout,
        stderr: child.stderr,
        exit: wrappedExit,
        kill: child.kill.bind(child),
      });
    },
  });

  return Object.freeze({
    spawner,
    armDnsSnapshot(snapshot: ApprovedDnsSnapshot): void {
      if (armedSnapshot !== undefined || execCount !== 0) throw auditFailed();
      armedSnapshot = reconstructDnsSnapshot(snapshot);
    },
    readProof(): NetworkObserverProof {
      if (proof === undefined || execCount !== 1) throw auditFailed();
      return proof;
    },
  });
}

export async function runCodexCliNetworkPrivacyForTest(input: {
  readonly artifactPath: string;
  readonly proof: ArtifactProofInput;
}): Promise<CodexCliNetworkPrivacyAuditArtifact> {
  const artifactPath = requireArtifactPath(input.artifactPath);
  await rm(artifactPath, { force: true });
  try {
    const artifact = buildArtifact(input.proof);
    await writeArtifactAtomically(artifactPath, artifact);
    return artifact;
  } catch {
    await rm(artifactPath, { force: true });
    throw auditFailed();
  }
}

export async function runCodexCliNetworkPrivacy(input: {
  readonly artifactPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}): Promise<CodexCliNetworkPrivacyAuditArtifact> {
  const artifactPath = requireArtifactPath(input.artifactPath);
  await rm(artifactPath, { force: true });
  try {
    throwIfAborted(input.signal);
    const executable = await realpath(BUNDLED_CODEX_EXECUTABLE);
    if (executable !== BUNDLED_CODEX_EXECUTABLE) throw auditFailed();
    const allowlist = readNetworkAllowlist(JSON.parse(await readFile(ALLOWLIST_URL, "utf8")) as unknown);
    const fixture = readSyntheticFixture(JSON.parse(await readFile(NETWORK_FIXTURE_URL, "utf8")) as unknown);
    const childEnv = createClosedCodexEnvironment(definedEnvironment(input.env));
    const observed = createNetworkObservedSpawner({
      delegate: nodeCodexProcessSpawner,
      applicationPid: process.pid,
    });
    const currentUid = process.getuid?.();
    if (currentUid === undefined) throw auditFailed();
    const tempRootPath = input.env.TMPDIR ?? tmpdir();
    await initializeCodexCliRuntime({
      configuredExecutable: executable,
      tempRootPath,
      currentUid,
      childEnv,
      spawner: observed.spawner,
      clock: () => new Date(),
      signal: input.signal,
    });
    const dnsSnapshot = await resolveApprovedDnsSnapshot({
      allowlist,
      resolver: NODE_DNS_RESOLVER,
      signal: input.signal,
    });
    observed.armDnsSnapshot(dnsSnapshot);
    const invocation = createCodexJsonInvocation({
      capability: "onboarding_extract",
      templateVersion: "codex-network-privacy@1",
      schemaVersion: fixture.expectedResult.schemaVersion,
      prompt: fixture.prompt,
      outputSchema: fixture.outputSchema,
      limits: {
        timeoutMs: MAX_CODEX_TIMEOUT_MS,
        maxStdoutBytes: MAX_CODEX_STDOUT_BYTES,
        maxStderrBytes: MAX_CODEX_STDERR_BYTES,
        maxEvents: MAX_CODEX_EVENTS,
      },
      signal: input.signal,
    });
    const modelResult = await getCodexCliModelAdapter().invokeJson(invocation);
    const proof: ArtifactProofInput = {
      cliVersion: CODEX_CLI_VERSION,
      executableKind: "chatgpt_app_bundled",
      allowlist,
      dnsSnapshot,
      fixture,
      observer: observed.readProof(),
      modelResult: modelResult.value,
      privacy: Object.freeze({
        rawPromptStored: false,
        rawResultStored: false,
        stdoutStored: false,
        stderrStored: false,
        inspectedOutputTexts: EMPTY_TUPLE,
      }),
      residualTempDirectories: await listResidualTempDirectories(tempRootPath),
    };
    return runCodexCliNetworkPrivacyForTest({ artifactPath, proof });
  } catch {
    await rm(artifactPath, { force: true });
    throw auditFailed();
  }
}

const NODE_DNS_RESOLVER: DnsResolverPort = Object.freeze({
  resolve4: (host: string) => resolve4(host),
  resolve6: (host: string) => resolve6(host),
});

async function observeSpawnInterval(input: {
  readonly applicationPid: number;
  readonly codexPid: number;
  readonly dnsSnapshot: ApprovedDnsSnapshot;
  readonly observation: NetworkObservationPort;
  readonly exitObserved: () => boolean;
}): Promise<NetworkObserverProof> {
  let applicationSamples = 0;
  let codexSamples = 0;
  let approvedConnectionObserved = false;

  while (true) {
    const beforeApplication = input.observation.isProcessAlive(input.applicationPid);
    const beforeCodex = input.observation.isProcessAlive(input.codexPid);
    if (!beforeApplication || !beforeCodex) {
      if (input.exitObserved() && applicationSamples > 0 && codexSamples > 0) break;
      throw auditFailed();
    }
    const [application, codex] = await Promise.all([
      input.observation.sample(input.applicationPid),
      input.observation.sample(input.codexPid),
    ]);
    const afterApplication = input.observation.isProcessAlive(input.applicationPid);
    const afterCodex = input.observation.isProcessAlive(input.codexPid);
    const terminal = input.exitObserved();
    const applicationSockets = inspectLsofSample(application, input.applicationPid, terminal);
    const codexSockets = inspectLsofSample(codex, input.codexPid, terminal);
    classifyApplicationSockets(applicationSockets);
    const approvedInSweep = classifyCodexSockets(codexSockets, input.dnsSnapshot);

    if (!terminal && beforeApplication && beforeCodex && afterApplication && afterCodex) {
      applicationSamples += 1;
      codexSamples += 1;
      approvedConnectionObserved ||= approvedInSweep;
    } else if (!terminal) {
      throw auditFailed();
    }
    if (terminal) break;
    await input.observation.wait(SAMPLE_INTERVAL_MS);
  }

  if (applicationSamples < 1 || codexSamples < 1 || !approvedConnectionObserved) throw auditFailed();
  const sampledProcesses: NetworkObserverProof["sampledProcesses"] = Object.freeze([
    Object.freeze({ kind: "application" as const, processId: input.applicationPid, sampleCount: applicationSamples }),
    Object.freeze({ kind: "codex" as const, processId: input.codexPid, sampleCount: codexSamples }),
  ]);
  return Object.freeze({
    codexExecProcessCount: 1,
    sameIntervalObserved: true,
    sampledProcesses,
    approvedEndpoints: Object.freeze(["chatgpt.com:443"] as const),
    observedConnections: Object.freeze([Object.freeze({
      processId: input.codexPid,
      processKind: "codex" as const,
      remoteEndpoint: "chatgpt.com" as const,
      remotePort: 443 as const,
      classification: "openai" as const,
    })]),
    otherModelProviderConnections: EMPTY_TUPLE,
    applicationTelemetryConnections: EMPTY_TUPLE,
  });
}

function inspectLsofSample(
  sample: LsofSampleResult,
  pid: number,
  terminal: boolean,
): readonly ParsedLsofSocket[] {
  if (sample.stdout.byteLength > LSOF_MAX_BYTES || sample.stderr.byteLength > LSOF_MAX_BYTES) throw auditFailed();
  if (sample.stderr.byteLength !== 0) throw auditFailed();
  if (sample.exitCode === 0) return parseLsofMachineOutput({ pid, stdout: sample.stdout });
  if (sample.exitCode === 1 && sample.stdout.byteLength === 0) return EMPTY_TUPLE;
  void terminal;
  throw auditFailed();
}

function classifyApplicationSockets(sockets: readonly ParsedLsofSocket[]): void {
  if (sockets.length !== 0) throw auditFailed();
}

function classifyCodexSockets(
  sockets: readonly ParsedLsofSocket[],
  snapshot: ApprovedDnsSnapshot,
): boolean {
  const allowed = new Set(snapshot.bindings.map((binding) => `${binding.address}:${binding.port}`));
  let approved = false;
  for (const socket of sockets) {
    if (socket.protocol !== "TCP" || socket.state !== "ESTABLISHED" ||
        socket.remoteAddress === undefined || socket.remotePort === undefined) {
      throw auditFailed();
    }
    const key = `${canonicalAddress(socket.remoteAddress)}:${socket.remotePort}`;
    if (!allowed.has(key) || socket.remotePort !== 443) throw auditFailed();
    approved = true;
  }
  return approved;
}

function createMacOsNetworkObservationPort(): NetworkObservationPort {
  return createMacOsNetworkObservationPortForTest({
    runner: createLsofCommandRunnerForTest(spawn),
    isProcessAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return isNodeError(error) && error.code === "EPERM";
      }
    },
    wait: (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)),
  });
}

export function createLsofCommandRunnerForTest(spawnLsof: typeof spawn): LsofCommandRunner {
  return Object.freeze({
    run(request: LsofCommandRequest): Promise<LsofSampleResult> {
      return runLsofCommand(request, spawnLsof);
    },
  });
}

export function createMacOsNetworkObservationPortForTest(input: {
  readonly runner: LsofCommandRunner;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly wait: (milliseconds: number) => Promise<void>;
}): NetworkObservationPort {
  return Object.freeze({
    isProcessAlive: input.isProcessAlive,
    sample(pid: number): Promise<LsofSampleResult> {
      if (!Number.isSafeInteger(pid) || pid <= 0) throw auditFailed();
      return input.runner.run(Object.freeze({
        executable: LSOF_EXECUTABLE,
        args: Object.freeze(["-nP", "-w", "-a", "-p", String(pid), "-i", "-F0pcfnPT"] as const),
        timeoutMs: LSOF_TIMEOUT_MS,
        maxOutputBytes: LSOF_MAX_BYTES,
      }));
    },
    wait: input.wait,
  });
}

async function runLsofCommand(
  request: LsofCommandRequest,
  spawnLsof: typeof spawn,
): Promise<LsofSampleResult> {
  return new Promise((resolveSample, rejectSample) => {
    const child = spawnLsof(request.executable, [...request.args], {
      stdio: ["ignore", "pipe", "pipe"], shell: false,
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => finishError(), request.timeoutMs);
    const finishError = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // The bounded audit still fails closed when the child disappears concurrently.
        }
      }
      rejectSample(auditFailed());
    };
    child.once("error", finishError);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maxOutputBytes) return finishError();
      stdout.push(Uint8Array.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.byteLength;
      if (stderrBytes > request.maxOutputBytes) return finishError();
      stderr.push(Uint8Array.from(chunk));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === null) return rejectSample(auditFailed());
      resolveSample(Object.freeze({
        exitCode: code,
        stdout: concatenate(stdout, stdoutBytes),
        stderr: concatenate(stderr, stderrBytes),
      }));
    });
  });
}

function buildArtifact(input: ArtifactProofInput): CodexCliNetworkPrivacyAuditArtifact {
  if (input.cliVersion !== CODEX_CLI_VERSION || input.executableKind !== "chatgpt_app_bundled") {
    throw auditFailed();
  }
  const allowlist = readNetworkAllowlist(input.allowlist);
  const snapshot = reconstructDnsSnapshot(input.dnsSnapshot);
  const fixture = readSyntheticFixture(input.fixture);
  const observer = reconstructObserverProof(input.observer);
  if (canonicalJson(input.modelResult) !== canonicalJson(fixture.expectedResult)) throw auditFailed();
  const privacy = exactPlainObject(input.privacy, [
    "rawPromptStored", "rawResultStored", "stdoutStored", "stderrStored", "inspectedOutputTexts",
  ]);
  if (privacy.rawPromptStored !== false || privacy.rawResultStored !== false ||
      privacy.stdoutStored !== false || privacy.stderrStored !== false) {
    throw auditFailed();
  }
  const inspectedOutputTexts = exactDenseArray(privacy.inspectedOutputTexts);
  if (inspectedOutputTexts.some((text) => typeof text !== "string" ||
      fixture.sensitiveSentinels.some((sentinel) => text.includes(sentinel)))) {
    throw auditFailed();
  }
  if (!Array.isArray(input.residualTempDirectories) || input.residualTempDirectories.length !== 0) {
    throw auditFailed();
  }
  const base = Object.freeze({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    cliVersion: CODEX_CLI_VERSION,
    executableKind: "chatgpt_app_bundled" as const,
    allowlistVersion: ALLOWLIST_SCHEMA_VERSION,
    allowlistDigest: sha256(canonicalJson(allowlist)),
    dnsSnapshotDigest: snapshot.digest,
    syntheticFixtureDigest: sha256(canonicalJson(fixture)),
    codexExecProcessCount: observer.codexExecProcessCount,
    sameIntervalObserved: observer.sameIntervalObserved,
    sampledProcesses: observer.sampledProcesses,
    approvedEndpoints: observer.approvedEndpoints,
    observedConnections: observer.observedConnections,
    otherModelProviderConnections: EMPTY_TUPLE,
    applicationTelemetryConnections: EMPTY_TUPLE,
    sensitiveSentinelHits: EMPTY_TUPLE,
    rawPromptStored: false as const,
    rawResultStored: false as const,
    stdoutStored: false as const,
    stderrStored: false as const,
    residualTempDirectories: EMPTY_TUPLE,
  });
  const artifact = Object.freeze({
    ...base,
    artifactDigest: sha256(canonicalJson(base)),
  });
  const serialized = canonicalJson(artifact);
  if (fixture.sensitiveSentinels.some((sentinel) => serialized.includes(sentinel))) throw auditFailed();
  return artifact;
}

function reconstructObserverProof(value: unknown): NetworkObserverProof {
  const object = exactPlainObject(value, [
    "codexExecProcessCount", "sameIntervalObserved", "sampledProcesses", "approvedEndpoints",
    "observedConnections", "otherModelProviderConnections", "applicationTelemetryConnections",
  ]);
  if (object.codexExecProcessCount !== 1 || object.sameIntervalObserved !== true) throw auditFailed();
  const sampled = exactDenseArray(object.sampledProcesses, 2);
  const application = exactPlainObject(sampled[0], ["kind", "processId", "sampleCount"]);
  const codex = exactPlainObject(sampled[1], ["kind", "processId", "sampleCount"]);
  if (application.kind !== "application" || codex.kind !== "codex") throw auditFailed();
  for (const processProof of [application, codex]) {
    if (!Number.isSafeInteger(processProof.processId) || Number(processProof.processId) <= 0 ||
        !Number.isSafeInteger(processProof.sampleCount) || Number(processProof.sampleCount) <= 0) {
      throw auditFailed();
    }
  }
  const endpoints = exactDenseArray(object.approvedEndpoints, 1);
  if (endpoints[0] !== "chatgpt.com:443") throw auditFailed();
  const connections = exactDenseArray(object.observedConnections, 1);
  const connection = exactPlainObject(connections[0], [
    "processId", "processKind", "remoteEndpoint", "remotePort", "classification",
  ]);
  if (connection.processId !== codex.processId || connection.processKind !== "codex" ||
      connection.remoteEndpoint !== "chatgpt.com" || connection.remotePort !== 443 ||
      connection.classification !== "openai") {
    throw auditFailed();
  }
  exactDenseArray(object.otherModelProviderConnections, 0);
  exactDenseArray(object.applicationTelemetryConnections, 0);
  const sampledProcesses: NetworkObserverProof["sampledProcesses"] = Object.freeze([
    Object.freeze({ kind: "application" as const, processId: Number(application.processId), sampleCount: Number(application.sampleCount) }),
    Object.freeze({ kind: "codex" as const, processId: Number(codex.processId), sampleCount: Number(codex.sampleCount) }),
  ]);
  return Object.freeze({
    codexExecProcessCount: 1,
    sameIntervalObserved: true,
    sampledProcesses,
    approvedEndpoints: Object.freeze(["chatgpt.com:443"] as const),
    observedConnections: Object.freeze([Object.freeze({
      processId: Number(connection.processId),
      processKind: "codex" as const,
      remoteEndpoint: "chatgpt.com" as const,
      remotePort: 443 as const,
      classification: "openai" as const,
    })]),
    otherModelProviderConnections: EMPTY_TUPLE,
    applicationTelemetryConnections: EMPTY_TUPLE,
  });
}

function reconstructDnsSnapshot(value: unknown): ApprovedDnsSnapshot {
  const object = exactPlainObject(value, ["completedAtMs", "bindings", "digest"]);
  if (!Number.isSafeInteger(object.completedAtMs) || Number(object.completedAtMs) < 0 ||
      typeof object.digest !== "string" || !/^[0-9a-f]{64}$/.test(object.digest)) {
    throw auditFailed();
  }
  const rawBindings = exactDenseArray(object.bindings);
  if (rawBindings.length === 0 || rawBindings.length > DNS_MAX_TOTAL) throw auditFailed();
  const bindings = rawBindings.map((raw) => {
    const binding = exactPlainObject(raw, ["host", "port", "address"]);
    if (binding.host !== "chatgpt.com" || binding.port !== 443 || typeof binding.address !== "string") {
      throw auditFailed();
    }
    return Object.freeze({
      host: "chatgpt.com" as const,
      port: 443 as const,
      address: canonicalPublicAddress(binding.address),
    });
  });
  const sorted = [...bindings].sort((left, right) => left.address.localeCompare(right.address));
  if (new Set(sorted.map((binding) => binding.address)).size !== sorted.length) throw auditFailed();
  const expectedDigest = sha256(canonicalJson({ bindings: sorted }));
  if (object.digest !== expectedDigest) throw auditFailed();
  return Object.freeze({
    completedAtMs: Number(object.completedAtMs),
    bindings: Object.freeze(sorted),
    digest: expectedDigest,
  });
}

function readSyntheticFixture(value: unknown): SyntheticFixture {
  const object = exactPlainObject(value, [
    "fixtureVersion", "sensitiveSentinels", "prompt", "outputSchema", "expectedResult",
  ]);
  if (object.fixtureVersion !== "codex-cli-runtime-case@1" || typeof object.prompt !== "string" ||
      object.prompt.length === 0) {
    throw auditFailed();
  }
  const sentinels = exactDenseArray(object.sensitiveSentinels, 1);
  if (typeof sentinels[0] !== "string" || sentinels[0].length === 0 || !object.prompt.includes(sentinels[0])) {
    throw auditFailed();
  }
  const schema = exactPlainObject(object.outputSchema);
  const expected = exactPlainObject(object.expectedResult, ["schemaVersion", "status"]);
  if (expected.schemaVersion !== "codex-runtime-smoke@1" || expected.status !== "tool_free") {
    throw auditFailed();
  }
  return Object.freeze({
    fixtureVersion: "codex-cli-runtime-case@1",
    sensitiveSentinels: Object.freeze([sentinels[0]] as [string]),
    prompt: object.prompt,
    outputSchema: Object.freeze({ ...schema }),
    expectedResult: Object.freeze({ schemaVersion: "codex-runtime-smoke@1", status: "tool_free" }),
  });
}

function fieldsFromLine(line: string): readonly string[] {
  if (!line.endsWith("\0")) throw auditFailed();
  const fields = line.slice(0, -1).split("\0");
  if (fields.length === 0 || fields.some((field) => field.length < 2 || /[\r\n]/.test(field))) {
    throw auditFailed();
  }
  return fields;
}

function requireSingleField(fields: readonly string[], prefix: string): string {
  const matches = fields.filter((field) => field.startsWith(prefix));
  if (matches.length !== 1) throw auditFailed();
  return (matches[0] as string).slice(prefix.length);
}

function tcpFields(fields: readonly string[]): {
  readonly state?: string;
  readonly hasQueueFields: boolean;
} {
  const values = fields.filter((field) => field.startsWith("T")).map((field) => field.slice(1));
  const allowed = new Set(["ST", "QR", "QS"]);
  const seen = new Set<string>();
  let state: string | undefined;
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw auditFailed();
    const name = value.slice(0, separator);
    const body = value.slice(separator + 1);
    if (!allowed.has(name) || seen.has(name) || body.length === 0) throw auditFailed();
    seen.add(name);
    if (name === "ST") state = body;
    if ((name === "QR" || name === "QS") && !/^[0-9]+$/.test(body)) throw auditFailed();
  }
  const hasQueueFields = seen.has("QR") && seen.has("QS");
  return state === undefined ? { hasQueueFields } : { state, hasQueueFields };
}

function parseSocketName(name: string): {
  readonly local: { readonly address: string; readonly port: number };
  readonly remote?: { readonly address: string; readonly port: number };
} {
  const parts = name.split("->");
  if (parts.length > 2) throw auditFailed();
  const local = parseEndpoint(parts[0] as string);
  if (parts.length === 1) return { local };
  return { local, remote: parseEndpoint(parts[1] as string) };
}

function parseEndpoint(value: string): { readonly address: string; readonly port: number } {
  if (value.includes("%") || value.includes("*")) throw auditFailed();
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(value);
    if (match === null) throw auditFailed();
    return { address: canonicalAddress(match[1] as string), port: parsePort(match[2] as string) };
  }
  const match = /^([^:]+):(\d{1,5})$/.exec(value);
  if (match === null) throw auditFailed();
  return { address: canonicalAddress(match[1] as string), port: parsePort(match[2] as string) };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw auditFailed();
  return port;
}

function canonicalPublicAddress(value: string): string {
  const address = canonicalAddress(value);
  if (!isGlobalUnicast(address)) throw auditFailed();
  return address;
}

function canonicalAddress(value: string): string {
  const family = isIP(value);
  if (family === 0) throw auditFailed();
  try {
    const address = new SocketAddress({
      address: value,
      port: 443,
      family: family === 4 ? "ipv4" : "ipv6",
    }).address.toLowerCase();
    return ipv4FromMapped(address) ?? address;
  } catch {
    throw auditFailed();
  }
}

function ipv4FromMapped(address: string): string | undefined {
  if (!address.startsWith("::ffff:")) return undefined;
  const suffix = address.slice("::ffff:".length);
  if (isIP(suffix) === 4) return suffix;
  const match = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(suffix);
  if (match === null) throw auditFailed();
  const high = Number.parseInt(match[1] as string, 16);
  const low = Number.parseInt(match[2] as string, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function isGlobalUnicast(address: string): boolean {
  if (isIP(address) === 4) {
    const value = ipv4Number(address);
    return !IPV4_NON_GLOBAL.some(([network, bits]) => inIpv4Cidr(value, network, bits));
  }
  if (isIP(address) !== 6) return false;
  const normalized = new SocketAddress({ address, family: "ipv6", port: 443 }).address.toLowerCase();
  const expanded = expandIpv6(normalized);
  if (!/^[23][0-9a-f]{3}:/.test(expanded)) return false;
  const value = ipv6Number(expanded);
  return !IPV6_NON_GLOBAL.some(([network, bits]) => inIpv6Cidr(value, network, bits));
}

const IPV4_NON_GLOBAL: readonly (readonly [number, number])[] = Object.freeze([
  [ipv4Number("0.0.0.0"), 8],
  [ipv4Number("10.0.0.0"), 8],
  [ipv4Number("100.64.0.0"), 10],
  [ipv4Number("127.0.0.0"), 8],
  [ipv4Number("169.254.0.0"), 16],
  [ipv4Number("172.16.0.0"), 12],
  [ipv4Number("192.0.0.0"), 24],
  [ipv4Number("192.0.2.0"), 24],
  [ipv4Number("192.31.196.0"), 24],
  [ipv4Number("192.52.193.0"), 24],
  [ipv4Number("192.88.99.0"), 24],
  [ipv4Number("192.168.0.0"), 16],
  [ipv4Number("192.175.48.0"), 24],
  [ipv4Number("198.18.0.0"), 15],
  [ipv4Number("198.51.100.0"), 24],
  [ipv4Number("203.0.113.0"), 24],
  [ipv4Number("224.0.0.0"), 4],
  [ipv4Number("240.0.0.0"), 4],
]);

const IPV6_NON_GLOBAL: readonly (readonly [bigint, number])[] = Object.freeze([
  [ipv6Number("2001::"), 23],
  [ipv6Number("2001:db8::"), 32],
  [ipv6Number("2002::"), 16],
  [ipv6Number("3fff::"), 20],
]);

function ipv4Number(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw auditFailed();
  }
  return (((parts[0] as number) << 24) >>> 0) + ((parts[1] as number) << 16) +
    ((parts[2] as number) << 8) + (parts[3] as number);
}

function inIpv4Cidr(value: number, network: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (network & mask) >>> 0;
}

function ipv6Number(address: string): bigint {
  return BigInt(`0x${expandIpv6(address).replaceAll(":", "")}`);
}

function inIpv6Cidr(value: bigint, network: bigint, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === network >> shift;
}

function expandIpv6(address: string): string {
  const [head, tail] = address.split("::");
  if (tail === undefined) return address.split(":").map(padHextet).join(":");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const missing = 8 - left.length - right.length;
  if (missing < 1) throw auditFailed();
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map(padHextet).join(":");
}

function padHextet(value: string): string {
  return value.padStart(4, "0");
}

async function resolveFamily(resolveFamilyRecords: () => Promise<readonly string[]>): Promise<readonly string[]> {
  try {
    const addresses = await resolveFamilyRecords();
    if (!Array.isArray(addresses)) throw auditFailed();
    return addresses;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENODATA") return EMPTY_TUPLE;
    throw error;
  }
}

async function raceWithTimeoutAndAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort(abortReason(signal));
  signal.addEventListener("abort", onAbort);
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(auditFailed()), timeoutMs);
  });
  try {
    throwIfAborted(signal);
    return await Promise.race([promise, aborted, timedOut]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function readNow(now?: () => number): number {
  const value = now?.() ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) throw auditFailed();
  return value;
}

function exactPlainObject(
  value: unknown,
  expectedKeys?: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw auditFailed();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) throw auditFailed();
  const stringKeys = keys as string[];
  if (expectedKeys !== undefined &&
      (stringKeys.length !== expectedKeys.length || expectedKeys.some((key) => !stringKeys.includes(key)))) {
    throw auditFailed();
  }
  const owned: Record<string, unknown> = {};
  for (const key of stringKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw auditFailed();
    }
    owned[key] = descriptor.value;
  }
  return owned;
}

function exactDenseArray(value: unknown, expectedLength?: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      (expectedLength !== undefined && value.length !== expectedLength)) {
    throw auditFailed();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const expected = [...Array.from({ length: value.length }, (_unused, index) => String(index)), "length"];
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) throw auditFailed();
  const owned: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw auditFailed();
    }
    owned.push(descriptor.value);
  }
  return owned;
}

function requireArtifactPath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw auditFailed();
  const path = resolve(value);
  if (path !== value && resolve(process.cwd(), value) !== path) throw auditFailed();
  return path;
}

function requireEntrypointArtifactPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || !value.endsWith(".json")) {
    throw auditFailed();
  }
  const path = resolve(value);
  if (path === resolve("/") || dirname(path) === path) throw auditFailed();
  return path;
}

async function requireEntrypointOutputPath(value: unknown): Promise<string> {
  const artifactPath = requireEntrypointArtifactPath(value);
  const [artifactIdentity, runtimeFixtureIdentity, allowlistIdentity] = await Promise.all([
    readEntrypointPathIdentity(artifactPath),
    readEntrypointPathIdentity(NETWORK_FIXTURE_PATH),
    readEntrypointPathIdentity(ALLOWLIST_PATH),
  ]);
  if (entrypointPathsAlias(artifactIdentity, runtimeFixtureIdentity) ||
    entrypointPathsAlias(artifactIdentity, allowlistIdentity)) throw auditFailed();
  return artifactPath;
}

interface EntrypointPathIdentity {
  readonly realPath: string;
  readonly existing?: Readonly<{ dev: number | bigint; ino: number | bigint }>;
}

async function readEntrypointPathIdentity(path: string): Promise<EntrypointPathIdentity> {
  const [realPath, identity] = await Promise.all([
    resolveEntrypointRealPath(path),
    statEntrypointPathIfPresent(path),
  ]);
  return Object.freeze({
    realPath,
    ...(identity === undefined
      ? {}
      : { existing: Object.freeze({ dev: identity.dev, ino: identity.ino }) }),
  });
}

function entrypointPathsAlias(
  left: EntrypointPathIdentity,
  right: EntrypointPathIdentity,
): boolean {
  return left.realPath === right.realPath || (
    left.existing !== undefined &&
    right.existing !== undefined &&
    left.existing.dev === right.existing.dev &&
    left.existing.ino === right.existing.ino
  );
}

async function resolveEntrypointRealPath(path: string): Promise<string> {
  let existingPrefix = path;
  const missingSuffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(existingPrefix), ...missingSuffix);
    } catch (error) {
      if (!isMissingEntrypointPathError(error)) throw error;
      const parent = dirname(existingPrefix);
      if (parent === existingPrefix) throw error;
      missingSuffix.unshift(basename(existingPrefix));
      existingPrefix = parent;
    }
  }
}

async function statEntrypointPathIfPresent(
  path: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (isMissingEntrypointPathError(error)) return undefined;
    throw error;
  }
}

function isMissingEntrypointPathError(error: unknown): boolean {
  if (error === null || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

async function writeArtifactAtomically(
  path: string,
  artifact: CodexCliNetworkPrivacyAuditArtifact,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, `${canonicalJson(artifact)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function listResidualTempDirectories(rootPath: string): Promise<readonly string[]> {
  let names: readonly string[];
  try {
    names = await readdir(rootPath);
  } catch {
    throw auditFailed();
  }
  return Object.freeze(names.filter((name) => name.startsWith("confirmed-life-codex-")).sort());
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw auditFailed();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw auditFailed();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function decodeUtf8(value: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw auditFailed();
  }
}

function concatenate(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function definedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined) environment[name] = value;
  }
  return Object.freeze(environment);
}

function abortReason(signal: AbortSignal): unknown {
  return NATIVE_REASON_GETTER?.call(signal) ?? new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (NATIVE_ABORTED_GETTER?.call(signal) === true) throw abortReason(signal);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && typeof (value as NodeJS.ErrnoException).code === "string";
}

function auditFailed(): Error {
  return new Error("codex_network_privacy_audit_failed");
}

export function parseNetworkPrivacyCliArguments(argv: readonly string[]): {
  readonly artifactPath: string;
} {
  if (argv.length !== 2 || argv[0] !== "--artifact" || argv[1] === undefined || argv[1] === "--") {
    throw auditFailed();
  }
  return Object.freeze({ artifactPath: argv[1] });
}

function readOwnedLaunchArguments(value: unknown, maximumLength: number): readonly string[] {
  if (
    types.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) throw auditFailed();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set([
    ...Array.from({ length: value.length }, (_unused, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !allowed.has(key))) throw auditFailed();
  const copy: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) ||
      descriptor.enumerable !== true || typeof descriptor.value !== "string") throw auditFailed();
    copy.push(descriptor.value);
  }
  return Object.freeze(copy);
}

export function parseCodexCliNetworkPrivacyLaunchArguments(
  input: unknown,
): CodexCliNetworkPrivacyLaunchArguments {
  const args = readOwnedLaunchArguments(input, 3);
  if (args.length === 2 && args[0] === "--artifact" &&
    args[1] !== undefined && args[1].length > 0) {
    return Object.freeze({ mode: "deferred", artifactPath: args[1] });
  }
  if (args.length === 3 && args[0] === FINAL_PROJECT_LIVE_MODEL_GATE_FLAG &&
    args[1] === "--artifact" && args[2] !== undefined && args[2].length > 0) {
    return Object.freeze({
      mode: "final-project-live-model-gate",
      artifactPath: args[2],
    });
  }
  throw auditFailed();
}

export async function runCodexCliNetworkPrivacyEntrypointForTest(input: {
  readonly rawArguments: unknown;
  readonly runFinalProjectLiveModelGate: (
    paths: Readonly<{ artifactPath: string }>,
  ) => Promise<void>;
}): Promise<CodexCliNetworkPrivacyEntrypointResult> {
  let parsed: CodexCliNetworkPrivacyLaunchArguments;
  try {
    parsed = parseCodexCliNetworkPrivacyLaunchArguments(input.rawArguments);
  } catch {
    return NETWORK_DEFERRED_RESULT;
  }
  try {
    const artifactPath = await requireEntrypointOutputPath(parsed.artifactPath);
    await rm(artifactPath, { force: true });
    if (parsed.mode === "deferred") return NETWORK_DEFERRED_RESULT;
    await input.runFinalProjectLiveModelGate(Object.freeze({ artifactPath }));
    return NETWORK_SUCCESS_RESULT;
  } catch {
    return parsed.mode === "deferred" ? NETWORK_DEFERRED_RESULT : NETWORK_FAILURE_RESULT;
  }
}

async function runFinalProjectLiveModelGate(
  paths: Readonly<{ artifactPath: string }>,
): Promise<void> {
  await runCodexCliNetworkPrivacy({
    artifactPath: paths.artifactPath,
    env: process.env,
    signal: new AbortController().signal,
  });
}

async function main(): Promise<void> {
  const result = await runCodexCliNetworkPrivacyEntrypointForTest({
    rawArguments: process.argv.slice(2),
    runFinalProjectLiveModelGate,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write(NETWORK_FAILURE);
    process.exitCode = 1;
  });
}
