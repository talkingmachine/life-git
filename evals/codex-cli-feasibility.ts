import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODEX_CLI_VERSION,
  CodexRuntimeError,
  createCodexJsonInvocation,
  MAX_CODEX_EVENTS,
  MAX_CODEX_STDERR_BYTES,
  MAX_CODEX_STDOUT_BYTES,
  MAX_CODEX_TIMEOUT_MS,
  type CodexRuntimeErrorCode,
} from "../src/infrastructure/codex-cli/contracts";
import {
  CODEX_EXEC_ARGS,
  CODEX_MESSAGE_INPUT_INSPECTION_ARGS,
  inspectModelVisibleInputs,
  runCodexJsonProbe,
} from "../src/infrastructure/codex-cli/feasibility-probe";
import {
  CODEX_STARTUP_NOTICES,
  type CodexStartupNotices,
} from "../src/infrastructure/codex-cli/event-stream";
import type { JsonObject } from "../src/infrastructure/codex-cli/owned-json";
import {
  CODEX_DISABLED_FEATURES,
  createClosedCodexEnvironment,
  preflightCodexCli,
  readDisabledFeatureInventory,
  type CodexPreflightResult,
} from "../src/infrastructure/codex-cli/preflight";
import {
  nodeCodexProcessSpawner,
  type CodexProcessSpawner,
  type SpawnedCodexProcess,
} from "../src/infrastructure/codex-cli/process";
import {
  validateCodexTempRoot,
  type ValidatedCodexTempRoot,
} from "../src/infrastructure/codex-cli/temp-directory";

const ARTIFACT_SCHEMA_VERSION = "codex-cli-feasibility@1" as const;
const DIAGNOSTIC_SCHEMA_VERSION = "codex-cli-feasibility-diagnostic@1" as const;
const RESULT_SCHEMA_VERSION = "codex-runtime-smoke@1" as const;
const RESULT_STATUS = "tool_free" as const;
const TEMP_DIRECTORY_PREFIX = "confirmed-life-codex-";
const FIXTURE_URL = new URL("./fixtures/codex-cli/runtime-cases.json", import.meta.url);
const CLOSED_ENVIRONMENT_KEYS = new Set(["CODEX_HOME", "TMPDIR", "LANG", "LC_ALL"]);
const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const EMPTY_TUPLE = Object.freeze([]) as readonly [];
const DIAGNOSTIC_EVENT_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
  "stream_error",
]);
const DIAGNOSTIC_ITEM_TYPES = new Set([
  "agent_message",
  "reasoning",
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "web_search",
  "todo_list",
  "collab_tool_call",
  "error",
]);
const DIAGNOSTIC_FAILURE_KINDS = new Set([
  "context_window_exceeded",
  "session_budget_exceeded",
  "usage_limit_exceeded",
  "server_overloaded",
  "cyber_policy",
  "http_connection_failed",
  "response_stream_connection_failed",
  "internal_server_error",
  "unauthorized",
  "bad_request",
  "sandbox_error",
  "response_stream_disconnected",
  "response_too_many_failed_attempts",
  "active_turn_not_steerable",
  "thread_rollback_failed",
  "other",
]);

type CodexCliDiagnosticFailureKind =
  | "none"
  | "unknown"
  | "multiple"
  | "context_window_exceeded"
  | "session_budget_exceeded"
  | "usage_limit_exceeded"
  | "server_overloaded"
  | "cyber_policy"
  | "http_connection_failed"
  | "response_stream_connection_failed"
  | "internal_server_error"
  | "unauthorized"
  | "bad_request"
  | "sandbox_error"
  | "response_stream_disconnected"
  | "response_too_many_failed_attempts"
  | "active_turn_not_steerable"
  | "thread_rollback_failed"
  | "other";

export interface CodexCliFeasibilityArtifact {
  readonly schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly authenticatedWith: "ChatGPT";
  readonly disabledFeatures: Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>;
  readonly strictExecConfig: true;
  readonly messageInputsObserved: true;
  readonly diagnosticWorkingDirectory: "fresh_validated_empty";
  readonly closedChildEnvironment: true;
  readonly projectContextPaths: readonly [];
  readonly projectRuleInputsObserved: false;
  readonly projectSkillPayloadsObserved: false;
  readonly callableSkillFeaturesDisabled: true;
  readonly codexExecProcessCount: 1;
  readonly eventTypes: readonly string[];
  readonly startupNotices: CodexStartupNotices;
  readonly toolEventTypes: readonly [];
  readonly resultSchemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly resultDigest: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly eventCount: number;
  readonly elapsedMs: number;
  readonly residualTempDirectories: readonly [];
  readonly sensitiveSentinelHits: readonly [];
}

export interface CodexCliFeasibilityDiagnostic {
  readonly schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  readonly stage:
    | "input_validation"
    | "preflight"
    | "feature_inventory"
    | "message_inputs"
    | "model_process"
    | "model_protocol"
    | "result_validation"
    | "artifact_write";
  readonly errorCode: CodexRuntimeErrorCode;
  readonly failureKind: CodexCliDiagnosticFailureKind;
  readonly stdoutObserved: boolean;
  readonly eventCount: number;
  readonly eventTypes: readonly string[];
  readonly itemCount: number;
  readonly itemTypes: readonly string[];
  readonly overflowed: boolean;
}

export interface CodexCliDiagnosticProtocolObservation {
  readonly stdoutObserved: boolean;
  readonly eventCount: number;
  readonly eventTypes: readonly string[];
  readonly itemCount: number;
  readonly itemTypes: readonly string[];
  readonly failureKind: CodexCliDiagnosticFailureKind;
  readonly overflowed: boolean;
}

export interface CodexCliDiagnosticProtocolObserver {
  observe(chunk: Uint8Array): void;
  finish(): void;
  snapshot(): CodexCliDiagnosticProtocolObservation;
}

interface SyntheticFixture {
  readonly fixtureVersion: "codex-cli-runtime-case@1";
  readonly sensitiveSentinels: readonly string[];
  readonly prompt: string;
  readonly outputSchema: JsonObject;
  readonly expectedResult: {
    readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
    readonly status: typeof RESULT_STATUS;
  };
}

interface FeasibilityDependencies {
  readonly runPreflight: () => Promise<unknown>;
  readonly readFeatureInventory: () => Promise<unknown>;
  readonly inspectMessageInputs: () => Promise<unknown>;
  readonly runModelProbe: () => Promise<unknown>;
}

interface FailureDiagnosticInput {
  readonly path: string;
  readonly readModelObservation: () => unknown;
}

type RuntimeFeasibilityInput = {
  readonly artifactPath: string;
  readonly configuredExecutable?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
};

type InternalFeasibilityStage =
  | "input_validation"
  | "preflight"
  | "feature_inventory"
  | "message_inputs"
  | "model_probe"
  | "result_validation"
  | "artifact_write";

interface ModelProof {
  readonly strictExecConfig: true;
  readonly closedChildEnvironment: true;
  readonly codexExecProcessCount: 1;
  readonly eventTypes: readonly string[];
  readonly startupNotices: CodexStartupNotices;
  readonly toolEventTypes: readonly [];
  readonly finalMessage: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly eventCount: number;
  readonly elapsedMs: number;
  readonly residualTempDirectories: readonly [];
}

export function createCodexCliMessageInputProof(input: {
  readonly messageInputs: {
    readonly messageInputsObserved: boolean;
    readonly projectContextPaths: readonly string[];
    readonly projectRuleInputsObserved: boolean;
    readonly projectSkillPayloadsObserved: boolean;
  };
  readonly diagnosticWorkingDirectory: "fresh_validated_empty" | "unproven";
  readonly closedChildEnvironment: boolean;
  readonly callableSkillFeaturesDisabled: boolean;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    messageInputsObserved: input.messageInputs.messageInputsObserved,
    diagnosticWorkingDirectory: input.diagnosticWorkingDirectory,
    closedChildEnvironment: input.closedChildEnvironment,
    projectContextPaths: input.messageInputs.projectContextPaths,
    projectRuleInputsObserved: input.messageInputs.projectRuleInputsObserved,
    projectSkillPayloadsObserved: input.messageInputs.projectSkillPayloadsObserved,
    callableSkillFeaturesDisabled: input.callableSkillFeaturesDisabled,
  });
}

export async function runCodexCliFeasibility(
  input: RuntimeFeasibilityInput,
): Promise<CodexCliFeasibilityArtifact> {
  return runCodexCliFeasibilityWithRuntime(input);
}

export async function runCodexCliFeasibilityDiagnostic(
  input: RuntimeFeasibilityInput & { readonly diagnosticPath: string },
): Promise<CodexCliFeasibilityArtifact> {
  return runCodexCliFeasibilityWithRuntime(input, input.diagnosticPath);
}

async function runCodexCliFeasibilityWithRuntime(
  input: RuntimeFeasibilityInput,
  diagnosticPath?: string,
): Promise<CodexCliFeasibilityArtifact> {
  const fixture = await loadSyntheticFixture();
  const childEnv = createClosedCodexEnvironment(definedEnvironment(input.env));
  let preflight: CodexPreflightResult | undefined;
  let tempRoot: ValidatedCodexTempRoot | undefined;
  let observedSpawner: ObservedSpawner | undefined;

  return runCodexCliFeasibilityForTest({
    artifactPath: input.artifactPath,
    fixture,
    signal: input.signal,
    runPreflight: async () => {
      preflight = await preflightCodexCli({
        configuredExecutable: input.configuredExecutable,
        pathValue: input.env.PATH,
        spawner: nodeCodexProcessSpawner,
        childEnv,
        signal: input.signal,
      });
      return {
        cliVersion: preflight.cliVersion,
        authenticatedWith: preflight.authenticatedWith,
      };
    },
    readFeatureInventory: async () => {
      const provenPreflight = requireInitialized(preflight);
      return readDisabledFeatureInventory({
        preflight: provenPreflight,
        spawner: nodeCodexProcessSpawner,
        childEnv,
        signal: input.signal,
      });
    },
    inspectMessageInputs: async () => {
      const provenPreflight = requireInitialized(preflight);
      tempRoot = await validateRuntimeTempRoot(input.env);
      observedSpawner = createObservedSpawner(nodeCodexProcessSpawner, tempRoot, childEnv);
      const messageInputs = await inspectModelVisibleInputs({
        preflight: provenPreflight,
        spawner: observedSpawner.spawner,
        tempRoot,
        childEnv,
        signal: input.signal,
      });
      return createCodexCliMessageInputProof({
        messageInputs,
        diagnosticWorkingDirectory: observedSpawner.diagnosticWorkingDirectory,
        closedChildEnvironment: observedSpawner.diagnosticClosedEnvironment,
        callableSkillFeaturesDisabled: true,
      });
    },
    runModelProbe: async () => {
      const provenPreflight = requireInitialized(preflight);
      const provenTempRoot = requireInitialized(tempRoot);
      const observer = requireInitialized(observedSpawner);
      const invocation = createCodexJsonInvocation({
        capability: "onboarding_extract",
        templateVersion: "codex-runtime-feasibility@1",
        schemaVersion: RESULT_SCHEMA_VERSION,
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
      const startedAt = Date.now();
      const result = await runCodexJsonProbe({
        invocation,
        preflight: provenPreflight,
        spawner: observer.spawner,
        tempRoot: provenTempRoot,
        childEnv,
      });
      const elapsedMs = Date.now() - startedAt;
      return {
        strictExecConfig: observer.strictExecConfig,
        closedChildEnvironment: observer.modelClosedEnvironment,
        codexExecProcessCount: observer.codexExecProcessCount,
        eventTypes: result.eventTypes,
        startupNotices: result.startupNotices,
        toolEventTypes: [],
        finalMessage: result.finalMessage,
        stdoutBytes: observer.modelStdoutBytes,
        stderrBytes: observer.modelStderrBytes,
        eventCount: result.eventTypes.length,
        elapsedMs,
        residualTempDirectories: await listResidualTempDirectories(provenTempRoot),
      };
    },
    ...(diagnosticPath === undefined ? {} : {
      diagnostic: {
        path: diagnosticPath,
        readModelObservation: () => observedSpawner?.modelProtocolObservation ?? emptyProtocolObservation(),
      },
    }),
  });
}

export async function runCodexCliFeasibilityForTest(input: {
  readonly artifactPath: string;
  readonly fixture: unknown;
  readonly signal: AbortSignal;
  readonly diagnostic?: FailureDiagnosticInput;
} & FeasibilityDependencies): Promise<CodexCliFeasibilityArtifact> {
  const artifactPath = requireArtifactPath(input.artifactPath);
  const diagnosticPath = input.diagnostic === undefined ? undefined : requireArtifactPath(input.diagnostic.path);
  if (diagnosticPath === artifactPath) throw isolationUnproven();
  await rm(artifactPath, { force: true });
  if (diagnosticPath !== undefined) await rm(diagnosticPath, { force: true });
  let stage: InternalFeasibilityStage = "input_validation";

  try {
    requireActiveSignal(input.signal);
    const fixture = readSyntheticFixture(input.fixture);
    stage = "preflight";
    const preflight = readPreflightProof(await input.runPreflight());
    stage = "feature_inventory";
    const disabledFeatures = readDisabledFeatures(await input.readFeatureInventory());
    stage = "message_inputs";
    const messageInputs = readMessageInputProof(await input.inspectMessageInputs());
    requireCallableSkillsDisabled(disabledFeatures, messageInputs.callableSkillFeaturesDisabled);

    stage = "model_probe";
    const rawModelProof = await input.runModelProbe();
    stage = "result_validation";
    const model = readModelProof(rawModelProof, fixture);
    const resultDigest = digestExactResult(model.finalMessage);
    const artifact: CodexCliFeasibilityArtifact = Object.freeze({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      cliVersion: preflight.cliVersion,
      authenticatedWith: preflight.authenticatedWith,
      disabledFeatures,
      strictExecConfig: true,
      messageInputsObserved: true,
      diagnosticWorkingDirectory: "fresh_validated_empty",
      closedChildEnvironment: true,
      projectContextPaths: EMPTY_TUPLE,
      projectRuleInputsObserved: false,
      projectSkillPayloadsObserved: false,
      callableSkillFeaturesDisabled: true,
      codexExecProcessCount: 1,
      eventTypes: model.eventTypes,
      startupNotices: model.startupNotices,
      toolEventTypes: EMPTY_TUPLE,
      resultSchemaVersion: RESULT_SCHEMA_VERSION,
      resultDigest,
      stdoutBytes: model.stdoutBytes,
      stderrBytes: model.stderrBytes,
      eventCount: model.eventCount,
      elapsedMs: model.elapsedMs,
      residualTempDirectories: EMPTY_TUPLE,
      sensitiveSentinelHits: EMPTY_TUPLE,
    });
    stage = "artifact_write";
    await writeArtifactAtomically(artifactPath, artifact);
    return artifact;
  } catch (error) {
    await rm(artifactPath, { force: true });
    if (input.diagnostic !== undefined && diagnosticPath !== undefined) {
      await tryWriteFailureDiagnostic({
        path: diagnosticPath,
        stage,
        error,
        readModelObservation: input.diagnostic.readModelObservation,
      });
    }
    throw isolationUnproven();
  }
}

export function createCodexCliDiagnosticProtocolObserver(): CodexCliDiagnosticProtocolObserver {
  const decoder = new TextDecoder("utf-8");
  const eventTypes: string[] = [];
  const itemTypes: string[] = [];
  const failureKinds = new Set<CodexCliDiagnosticFailureKind>();
  const failureState = { unknownObserved: false };
  const retentionState = { overflowed: false };
  let pending = "";
  let stdoutObserved = false;
  let isFinished = false;

  const consumeCompleteLines = (): void => {
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline === -1) return;
      observeDiagnosticLine(
        pending.slice(0, newline),
        eventTypes,
        itemTypes,
        failureKinds,
        failureState,
        retentionState,
      );
      pending = pending.slice(newline + 1);
    }
  };

  return {
    observe(chunk): void {
      if (isFinished) return;
      const owned = Uint8Array.from(chunk);
      if (owned.byteLength > 0) stdoutObserved = true;
      pending += decoder.decode(owned, { stream: true });
      consumeCompleteLines();
    },
    finish(): void {
      if (isFinished) return;
      isFinished = true;
      pending += decoder.decode();
      if (pending.length > 0) {
        observeDiagnosticLine(pending, eventTypes, itemTypes, failureKinds, failureState, retentionState);
      }
      pending = "";
    },
    snapshot(): CodexCliDiagnosticProtocolObservation {
      return Object.freeze({
        stdoutObserved,
        eventCount: eventTypes.length,
        eventTypes: Object.freeze([...eventTypes]),
        itemCount: itemTypes.length,
        itemTypes: Object.freeze([...itemTypes]),
        failureKind: collapseFailureKinds(failureKinds, failureState.unknownObserved),
        overflowed: retentionState.overflowed,
      });
    },
  };
}

function observeDiagnosticLine(
  line: string,
  eventTypes: string[],
  itemTypes: string[],
  failureKinds: Set<CodexCliDiagnosticFailureKind>,
  failureState: { unknownObserved: boolean },
  retentionState: { overflowed: boolean },
): void {
  if (line.length === 0) return;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    retainDiagnosticName(eventTypes, "malformed", retentionState);
    return;
  }
  if (!isObject(event)) {
    retainDiagnosticName(eventTypes, "unknown", retentionState);
    return;
  }
  retainDiagnosticName(eventTypes, sanitizeEventType(event.type), retentionState);
  if (isObject(event.item)) {
    retainDiagnosticName(itemTypes, sanitizeItemType(event.item.type), retentionState);
  }
  const failureKind = readFailureKind(event);
  if (failureKind === "unknown") failureState.unknownObserved = true;
  else if (failureKind !== undefined) failureKinds.add(failureKind);
}

function retainDiagnosticName(names: string[], name: string, state: { overflowed: boolean }): void {
  if (names.length < MAX_CODEX_EVENTS) names.push(name);
  else state.overflowed = true;
}

function sanitizeEventType(value: unknown): string {
  return typeof value === "string" && DIAGNOSTIC_EVENT_TYPES.has(value) ? value : "unknown";
}

function sanitizeObservedEventType(value: unknown): string {
  return value === "malformed" ? value : sanitizeEventType(value);
}

function sanitizeItemType(value: unknown): string {
  return typeof value === "string" && DIAGNOSTIC_ITEM_TYPES.has(value) ? value : "unknown";
}

function readFailureKind(event: Record<string, unknown>): CodexCliDiagnosticFailureKind | undefined {
  if (event.type !== "turn.failed" || !isPlainObject(event.error)) {
    return event.type === "turn.failed" ? "unknown" : undefined;
  }
  const candidate = event.error.codex_error_info;
  return typeof candidate === "string" && DIAGNOSTIC_FAILURE_KINDS.has(candidate)
    ? candidate as CodexCliDiagnosticFailureKind
    : "unknown";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isObject(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function collapseFailureKinds(
  failureKinds: ReadonlySet<CodexCliDiagnosticFailureKind>,
  unknownObserved: boolean,
): CodexCliDiagnosticFailureKind {
  if (failureKinds.size > 1) return "multiple";
  const [failureKind] = failureKinds;
  if (failureKind !== undefined) return failureKind;
  return unknownObserved ? "unknown" : "none";
}

async function tryWriteFailureDiagnostic(input: {
  readonly path: string;
  readonly stage: InternalFeasibilityStage;
  readonly error: unknown;
  readonly readModelObservation: () => unknown;
}): Promise<void> {
  try {
    const observation = safelyReadProtocolObservation(input.readModelObservation);
    const diagnostic: CodexCliFeasibilityDiagnostic = Object.freeze({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      stage: classifyDiagnosticStage(input.stage, input.error),
      errorCode: diagnosticErrorCode(input.error),
      failureKind: observation.failureKind,
      stdoutObserved: observation.stdoutObserved,
      eventCount: observation.eventCount,
      eventTypes: observation.eventTypes,
      itemCount: observation.itemCount,
      itemTypes: observation.itemTypes,
      overflowed: observation.overflowed,
    });
    await writeJsonAtomically(input.path, diagnostic);
  } catch {
    await rm(input.path, { force: true });
  }
}

function safelyReadProtocolObservation(readObservation: () => unknown): CodexCliDiagnosticProtocolObservation {
  try {
    const observation = readExactObject(readObservation(), [
      "stdoutObserved", "eventCount", "eventTypes", "itemCount", "itemTypes", "failureKind", "overflowed",
    ]);
    const eventTypes = readBoundedStringArray(observation.eventTypes, MAX_CODEX_EVENTS);
    const itemTypes = readBoundedStringArray(observation.itemTypes, MAX_CODEX_EVENTS);
    if (typeof observation.stdoutObserved !== "boolean" || !isNonNegativeInteger(observation.eventCount) ||
      !isNonNegativeInteger(observation.itemCount) || eventTypes.length !== observation.eventCount ||
      itemTypes.length !== observation.itemCount || typeof observation.overflowed !== "boolean" ||
      (!observation.stdoutObserved && (observation.eventCount !== 0 || observation.itemCount !== 0))) {
      return emptyProtocolObservation();
    }
    return Object.freeze({
      stdoutObserved: observation.stdoutObserved,
      eventCount: observation.eventCount,
      eventTypes: Object.freeze(eventTypes.map(sanitizeObservedEventType)),
      itemCount: observation.itemCount,
      itemTypes: Object.freeze(itemTypes.map(sanitizeItemType)),
      failureKind: sanitizeFailureKind(observation.failureKind),
      overflowed: observation.overflowed,
    });
  } catch {
    return emptyProtocolObservation();
  }
}

function emptyProtocolObservation(): CodexCliDiagnosticProtocolObservation {
  return Object.freeze({
    stdoutObserved: false,
    eventCount: 0,
    eventTypes: EMPTY_TUPLE,
    itemCount: 0,
    itemTypes: EMPTY_TUPLE,
    failureKind: "none",
    overflowed: false,
  });
}

function sanitizeFailureKind(value: unknown): CodexCliDiagnosticFailureKind {
  if (value === "none" || value === "unknown" || value === "multiple") return value;
  return typeof value === "string" && DIAGNOSTIC_FAILURE_KINDS.has(value)
    ? value as CodexCliDiagnosticFailureKind
    : "unknown";
}

function classifyDiagnosticStage(
  stage: InternalFeasibilityStage,
  error: unknown,
): CodexCliFeasibilityDiagnostic["stage"] {
  if (stage !== "model_probe") return stage;
  const code = diagnosticErrorCode(error);
  return code === "codex_protocol_invalid" || code === "codex_tool_event" ||
    code === "codex_event_limit" || code === "codex_json_invalid"
    ? "model_protocol"
    : "model_process";
}

function diagnosticErrorCode(error: unknown): CodexRuntimeErrorCode {
  return error instanceof CodexRuntimeError ? error.code : "codex_tool_isolation_unproven";
}

function readSyntheticFixture(value: unknown): SyntheticFixture {
  const fixture = readExactObject(value, [
    "fixtureVersion", "sensitiveSentinels", "prompt", "outputSchema", "expectedResult",
  ]);
  if (fixture.fixtureVersion !== "codex-cli-runtime-case@1" || typeof fixture.prompt !== "string") {
    throw isolationUnproven();
  }
  const prompt = fixture.prompt;
  const sentinels = readStringArray(fixture.sensitiveSentinels);
  if (sentinels.length === 0 || sentinels.some((sentinel) =>
    !sentinel.startsWith("SYNTHETIC_") || !prompt.includes(sentinel))) {
    throw isolationUnproven();
  }
  const requiredPromptTerms = [
    "repository", "pwd", "browser", "app", "plugin", "MCP", "skill", "multi-agent", "image", "schema",
  ];
  if (requiredPromptTerms.some((term) => !prompt.includes(term))) throw isolationUnproven();
  requireExactOutputSchema(fixture.outputSchema);
  const expectedResult = readExactObject(fixture.expectedResult, ["schemaVersion", "status"]);
  if (expectedResult.schemaVersion !== RESULT_SCHEMA_VERSION || expectedResult.status !== RESULT_STATUS) {
    throw isolationUnproven();
  }
  return Object.freeze({
    fixtureVersion: "codex-cli-runtime-case@1",
    sensitiveSentinels: Object.freeze([...sentinels]),
    prompt,
    outputSchema: fixture.outputSchema as JsonObject,
    expectedResult: Object.freeze({ schemaVersion: RESULT_SCHEMA_VERSION, status: RESULT_STATUS }),
  });
}

function requireExactOutputSchema(value: unknown): void {
  const schema = readExactObject(value, ["type", "additionalProperties", "required", "properties"]);
  if (schema.type !== "object" || schema.additionalProperties !== false ||
    !sameStrings(readStringArray(schema.required), ["schemaVersion", "status"])) {
    throw isolationUnproven();
  }
  const properties = readExactObject(schema.properties, ["schemaVersion", "status"]);
  const schemaVersion = readExactObject(properties.schemaVersion, ["type", "enum"]);
  const status = readExactObject(properties.status, ["type", "enum"]);
  if (schemaVersion.type !== "string" || status.type !== "string" ||
    !sameStrings(readStringArray(schemaVersion.enum), [RESULT_SCHEMA_VERSION]) ||
    !sameStrings(readStringArray(status.enum), [RESULT_STATUS])) {
    throw isolationUnproven();
  }
}

function readPreflightProof(value: unknown): {
  readonly cliVersion: typeof CODEX_CLI_VERSION;
  readonly authenticatedWith: "ChatGPT";
} {
  const proof = readExactObject(value, ["cliVersion", "authenticatedWith"]);
  if (proof.cliVersion !== CODEX_CLI_VERSION || proof.authenticatedWith !== "ChatGPT") throw isolationUnproven();
  return { cliVersion: CODEX_CLI_VERSION, authenticatedWith: "ChatGPT" };
}

function readDisabledFeatures(
  value: unknown,
): Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>> {
  const inventory = readExactObject(value, CODEX_DISABLED_FEATURES);
  const disabled = {} as Record<(typeof CODEX_DISABLED_FEATURES)[number], false>;
  for (const feature of CODEX_DISABLED_FEATURES) {
    if (inventory[feature] !== false) throw isolationUnproven();
    disabled[feature] = false;
  }
  return Object.freeze(disabled);
}

function readMessageInputProof(value: unknown): {
  readonly callableSkillFeaturesDisabled: true;
} {
  const proof = readExactObject(value, [
    "messageInputsObserved",
    "diagnosticWorkingDirectory",
    "closedChildEnvironment",
    "projectContextPaths",
    "projectRuleInputsObserved",
    "projectSkillPayloadsObserved",
    "callableSkillFeaturesDisabled",
  ]);
  if (proof.messageInputsObserved !== true || proof.diagnosticWorkingDirectory !== "fresh_validated_empty" ||
    proof.closedChildEnvironment !== true || !isEmptyArray(proof.projectContextPaths) ||
    proof.projectRuleInputsObserved !== false || proof.projectSkillPayloadsObserved !== false ||
    proof.callableSkillFeaturesDisabled !== true) {
    throw isolationUnproven();
  }
  return { callableSkillFeaturesDisabled: true };
}

function requireCallableSkillsDisabled(
  disabledFeatures: Readonly<Record<(typeof CODEX_DISABLED_FEATURES)[number], false>>,
  diagnosticProof: true,
): void {
  if (diagnosticProof !== true || disabledFeatures.skill_search !== false ||
    disabledFeatures.skill_mcp_dependency_install !== false) {
    throw isolationUnproven();
  }
}

function readModelProof(value: unknown, fixture: SyntheticFixture): ModelProof {
  const proof = readExactObject(value, [
    "strictExecConfig",
    "closedChildEnvironment",
    "codexExecProcessCount",
    "eventTypes",
    "startupNotices",
    "toolEventTypes",
    "finalMessage",
    "stdoutBytes",
    "stderrBytes",
    "eventCount",
    "elapsedMs",
    "residualTempDirectories",
  ]);
  const eventTypes = readStringArray(proof.eventTypes);
  const startupNotices = readStartupNotices(proof.startupNotices);
  const finalMessage = proof.finalMessage;
  if (proof.strictExecConfig !== true || proof.closedChildEnvironment !== true ||
    proof.codexExecProcessCount !== 1 || !isEmptyArray(proof.toolEventTypes) ||
    typeof finalMessage !== "string" || !isValidEventSequence(eventTypes) ||
    !isPositiveInteger(proof.stdoutBytes) || !isNonNegativeInteger(proof.stderrBytes) ||
    proof.eventCount !== eventTypes.length || !isNonNegativeInteger(proof.elapsedMs) ||
    !isEmptyArray(proof.residualTempDirectories) ||
    fixture.sensitiveSentinels.some((sentinel) => finalMessage.includes(sentinel))) {
    throw isolationUnproven();
  }
  requireExactResult(finalMessage);
  return {
    strictExecConfig: true,
    closedChildEnvironment: true,
    codexExecProcessCount: 1,
    eventTypes: Object.freeze([...eventTypes]),
    startupNotices,
    toolEventTypes: EMPTY_TUPLE,
    finalMessage,
    stdoutBytes: proof.stdoutBytes,
    stderrBytes: proof.stderrBytes,
    eventCount: proof.eventCount,
    elapsedMs: proof.elapsedMs,
    residualTempDirectories: EMPTY_TUPLE,
  };
}

function requireExactResult(finalMessage: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalMessage);
  } catch {
    throw isolationUnproven();
  }
  const result = readExactObject(parsed, ["schemaVersion", "status"]);
  if (result.schemaVersion !== RESULT_SCHEMA_VERSION || result.status !== RESULT_STATUS) throw isolationUnproven();
}

function readStartupNotices(value: unknown): CodexStartupNotices {
  if (!Array.isArray(value) || value.length !== CODEX_STARTUP_NOTICES.length ||
    value[0] !== CODEX_STARTUP_NOTICES[0] || value[1] !== CODEX_STARTUP_NOTICES[1]) {
    throw isolationUnproven();
  }
  return Object.freeze([CODEX_STARTUP_NOTICES[0], CODEX_STARTUP_NOTICES[1]] as const);
}

function isValidEventSequence(eventTypes: readonly string[]): boolean {
  const turnStartIndex = 3;
  if (eventTypes.length < turnStartIndex + 3 || eventTypes[0] !== "thread.started" ||
    eventTypes[1] !== "item.completed" || eventTypes[2] !== "item.completed" ||
    eventTypes[turnStartIndex] !== "turn.started" ||
    eventTypes.at(-2) !== "item.completed" || eventTypes.at(-1) !== "turn.completed") {
    return false;
  }
  const progress = eventTypes.slice(turnStartIndex + 1, -2);
  if (progress.length % 2 !== 0) return false;
  for (let index = 0; index < progress.length; index += 2) {
    if (progress[index] !== "item.started" || progress[index + 1] !== "item.completed") return false;
  }
  return true;
}

function digestExactResult(finalMessage: string): string {
  requireExactResult(finalMessage);
  const canonical = JSON.stringify({ schemaVersion: RESULT_SCHEMA_VERSION, status: RESULT_STATUS });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readExactObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw isolationUnproven();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw isolationUnproven();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw isolationUnproven();
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) throw isolationUnproven();
    result[key] = descriptor.value;
  }
  return result;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw isolationUnproven();
  return [...value] as string[];
}

function readBoundedStringArray(value: unknown, maximumLength: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumLength ||
    value.some((entry) => typeof entry !== "string")) {
    throw isolationUnproven();
  }
  return [...value] as string[];
}

function isEmptyArray(value: unknown): value is readonly [] {
  return Array.isArray(value) && value.length === 0;
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requireActiveSignal(signal: unknown): asserts signal is AbortSignal {
  try {
    if (NATIVE_ABORTED_GETTER === undefined || NATIVE_ABORTED_GETTER.call(signal) !== false) throw isolationUnproven();
  } catch (error) {
    if (error instanceof CodexRuntimeError) throw error;
    throw isolationUnproven();
  }
}

function requireArtifactPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw isolationUnproven();
  return resolve(value);
}

async function writeArtifactAtomically(path: string, artifact: CodexCliFeasibilityArtifact): Promise<void> {
  await writeJsonAtomically(path, artifact);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function loadSyntheticFixture(): Promise<SyntheticFixture> {
  return readSyntheticFixture(JSON.parse(await readFile(FIXTURE_URL, "utf8")) as unknown);
}

function definedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of ["CODEX_HOME", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

async function validateRuntimeTempRoot(
  env: Readonly<Record<string, string | undefined>>,
): Promise<ValidatedCodexTempRoot> {
  const currentUid = process.getuid?.();
  if (currentUid === undefined) throw isolationUnproven();
  return validateCodexTempRoot({
    path: env.TMPDIR ?? tmpdir(),
    currentUid,
    userHomePath: env.HOME ?? homedir(),
    workspacePath: process.cwd(),
  });
}

interface ObservedSpawner {
  readonly spawner: CodexProcessSpawner;
  readonly diagnosticWorkingDirectory: "fresh_validated_empty" | "unproven";
  readonly diagnosticClosedEnvironment: boolean;
  readonly strictExecConfig: boolean;
  readonly modelClosedEnvironment: boolean;
  readonly codexExecProcessCount: number;
  readonly modelStdoutBytes: number;
  readonly modelStderrBytes: number;
  readonly modelProtocolObservation: CodexCliDiagnosticProtocolObservation;
}

function createObservedSpawner(
  delegate: CodexProcessSpawner,
  tempRoot: ValidatedCodexTempRoot,
  expectedEnvironment: Readonly<Record<string, string>>,
): ObservedSpawner {
  const protocolObserver = createCodexCliDiagnosticProtocolObserver();
  const state = {
    diagnosticFresh: false,
    diagnosticClosed: false,
    strictExecConfig: false,
    modelClosed: false,
    execCount: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  const spawner: CodexProcessSpawner = {
    spawn(input) {
      const isDiagnostic = sameStrings(input.args, CODEX_MESSAGE_INPUT_INSPECTION_ARGS);
      const isModel = input.args[0] === "exec";
      if (isDiagnostic) {
        state.diagnosticFresh = isFreshDirectChild(input.cwd, tempRoot);
        state.diagnosticClosed = sameEnvironment(input.env, expectedEnvironment);
      }
      if (isModel) {
        state.execCount += 1;
        state.strictExecConfig = hasExactExecArguments(input.args, input.cwd);
        state.modelClosed = sameEnvironment(input.env, expectedEnvironment);
      }
      const spawned = delegate.spawn(input);
      return isModel ? observeModelStreams(spawned, state, protocolObserver) : spawned;
    },
  };
  return {
    spawner,
    get diagnosticWorkingDirectory() {
      return state.diagnosticFresh ? "fresh_validated_empty" : "unproven";
    },
    get diagnosticClosedEnvironment() {
      return state.diagnosticClosed;
    },
    get strictExecConfig() {
      return state.strictExecConfig;
    },
    get modelClosedEnvironment() {
      return state.modelClosed;
    },
    get codexExecProcessCount() {
      return state.execCount;
    },
    get modelStdoutBytes() {
      return state.stdoutBytes;
    },
    get modelStderrBytes() {
      return state.stderrBytes;
    },
    get modelProtocolObservation() {
      return protocolObserver.snapshot();
    },
  };
}

function observeModelStreams(
  process: SpawnedCodexProcess,
  state: { stdoutBytes: number; stderrBytes: number },
  protocolObserver: CodexCliDiagnosticProtocolObserver,
): SpawnedCodexProcess {
  return {
    ...process,
    stdout: observeModelStdout(process.stdout, state, protocolObserver),
    stderr: countBytes(process.stderr, (bytes) => {
      state.stderrBytes += bytes;
    }),
  };
}

async function* observeModelStdout(
  stream: AsyncIterable<Uint8Array>,
  state: { stdoutBytes: number },
  protocolObserver: CodexCliDiagnosticProtocolObserver,
): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of stream) {
      state.stdoutBytes += chunk.byteLength;
      protocolObserver.observe(chunk);
      yield chunk;
    }
  } finally {
    protocolObserver.finish();
  }
}

async function* countBytes(
  stream: AsyncIterable<Uint8Array>,
  observe: (bytes: number) => void,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of stream) {
    observe(chunk.byteLength);
    yield chunk;
  }
}

function isFreshDirectChild(path: string, tempRoot: ValidatedCodexTempRoot): boolean {
  try {
    return dirname(path) === tempRoot.path && basename(path).startsWith(TEMP_DIRECTORY_PREFIX) &&
      readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

function hasExactExecArguments(args: readonly string[], cwd: string): boolean {
  if (!sameStrings(args.slice(0, CODEX_EXEC_ARGS.length), CODEX_EXEC_ARGS)) return false;
  const suffix = args.slice(CODEX_EXEC_ARGS.length);
  return suffix.length === 6 && suffix[0] === "--cd" && suffix[1] === cwd && suffix[2] === "--output-schema" &&
    typeof suffix[3] === "string" && dirname(suffix[3]) === cwd && basename(suffix[3]) === "schema.json" &&
    suffix[4] === "--json" && suffix[5] === "-";
}

function sameEnvironment(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(actual);
  return keys.every((key) => CLOSED_ENVIRONMENT_KEYS.has(key)) && keys.length === Object.keys(expected).length &&
    keys.every((key) => actual[key] === expected[key]);
}

async function listResidualTempDirectories(root: ValidatedCodexTempRoot): Promise<readonly string[]> {
  return (await readdir(root.path, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(TEMP_DIRECTORY_PREFIX))
    .map((entry) => entry.name);
}

function requireInitialized<T>(value: T | undefined): T {
  if (value === undefined) throw isolationUnproven();
  return value;
}

function isolationUnproven(): CodexRuntimeError {
  return new CodexRuntimeError("codex_tool_isolation_unproven");
}

export function parseCodexCliFeasibilityArguments(args: readonly string[]): {
  readonly artifactPath: string;
  readonly diagnosticPath?: string;
} {
  const artifactPath = args[0] === "--artifact" ? args[1] : undefined;
  if (artifactPath === undefined || artifactPath.length === 0) throw isolationUnproven();
  if (args.length === 2) return { artifactPath };
  const diagnosticPath = args[2] === "--diagnostic" ? args[3] : undefined;
  if (args.length !== 4 || diagnosticPath === undefined || diagnosticPath.length === 0) throw isolationUnproven();
  return { artifactPath, diagnosticPath };
}

async function main(): Promise<void> {
  const paths = parseCodexCliFeasibilityArguments(process.argv.slice(2));
  const runtimeInput = {
    artifactPath: paths.artifactPath,
    configuredExecutable: process.env.CODEX_EXECUTABLE,
    env: process.env,
    signal: new AbortController().signal,
  };
  if (paths.diagnosticPath === undefined) {
    await runCodexCliFeasibility(runtimeInput);
    return;
  }
  await runCodexCliFeasibilityDiagnostic({
    ...runtimeInput,
    diagnosticPath: paths.diagnosticPath,
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const code = error instanceof CodexRuntimeError ? error.code : "codex_tool_isolation_unproven";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
