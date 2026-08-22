import { describe, expect, test, vi } from "vitest";

import {
  OnboardingModelError,
  type OnboardingModelPort,
} from "../../src/application/onboarding-contracts";
import { projectQuestionnaireForModel } from "../../src/decision/onboarding-model-contract";
import { createOnboardingSession, type SessionMessage } from "../../src/decision/onboarding-session";
import {
  CODEX_CLI_VERSION,
  CODEX_INVOCATION_VERSION,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "../../src/infrastructure/codex-cli/contracts";
import type { CodexCliModelAdapter } from "../../src/infrastructure/codex-cli/model-adapter";
import { snapshotOwnedJson } from "../../src/infrastructure/codex-cli/owned-json";
import {
  createCodexOnboardingModel,
  ONBOARDING_EXTRACTION_LIMITS,
  ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES,
  ONBOARDING_EXTRACTION_PROMPT_TEMPLATE,
  ONBOARDING_MODEL_VERSIONS,
  ONBOARDING_REVIEW_LIMITS,
  ONBOARDING_REVIEW_MAX_PROMPT_BYTES,
  ONBOARDING_REVIEW_PROMPT_TEMPLATE,
} from "../../src/infrastructure/codex-cli/onboarding-model";
import {
  ONBOARDING_EXTRACTION_SCHEMA,
  ONBOARDING_REVIEW_SCHEMA,
} from "../../src/infrastructure/codex-cli/onboarding-schema";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_TEXT = "Я переезжаю один";
const SECRET = "raw-secret-that-must-not-leak";

type InvokeJson = (input: CodexJsonInvocation) => Promise<CodexJsonResult>;

function questionnaire(): unknown {
  return projectQuestionnaireForModel(createOnboardingSession({
    nextParticipantId: () => SELF_ID,
    nextCompletionCommandId: () => COMMAND_ID,
  }));
}

function message(): SessionMessage {
  return { messageId: USER_MESSAGE_ID, role: "user", text: MESSAGE_TEXT };
}

function extractionResult(
  metadata: CodexJsonResult["metadata"] = extractionMetadata(),
): CodexJsonResult {
  return {
    value: {
      schemaVersion: "onboarding-model-output@1",
      proposals: [{
        fieldId: "moving_party",
        typedValue: "alone",
        messageId: USER_MESSAGE_ID,
        sourceSpan: { start: 0, end: MESSAGE_TEXT.length },
      }],
      nextQuestion: "Где вы живёте сейчас?",
    },
    metadata,
  };
}

function reviewResult(metadata: CodexJsonResult["metadata"] = reviewMetadata()): CodexJsonResult {
  return {
    value: {
      schemaVersion: "onboarding-review-output@1",
      issues: [{ fieldId: "move_horizon", reasonCode: "required_empty" }],
    },
    metadata,
  };
}

function extractionMetadata(): CodexJsonResult["metadata"] {
  return {
    invocationVersion: CODEX_INVOCATION_VERSION,
    cliVersion: CODEX_CLI_VERSION,
    templateVersion: "onboarding-extract@1",
    schemaVersion: "onboarding-model-output@1",
  };
}

function reviewMetadata(): CodexJsonResult["metadata"] {
  return {
    invocationVersion: CODEX_INVOCATION_VERSION,
    cliVersion: CODEX_CLI_VERSION,
    templateVersion: "onboarding-review@1",
    schemaVersion: "onboarding-review-output@1",
  };
}

function fakeRuntime(implementation: InvokeJson): {
  readonly runtime: CodexCliModelAdapter;
  readonly invokeJson: ReturnType<typeof vi.fn<InvokeJson>>;
} {
  const invokeJson = vi.fn<InvokeJson>(implementation);
  return {
    runtime: { invokeJson } as unknown as CodexCliModelAdapter,
    invokeJson,
  };
}

function successfulModel(result: CodexJsonResult = extractionResult()): {
  readonly model: OnboardingModelPort;
  readonly invokeJson: ReturnType<typeof vi.fn<InvokeJson>>;
} {
  const { runtime, invokeJson } = fakeRuntime(async () => result);
  return { model: createCodexOnboardingModel(runtime), invokeJson };
}

async function modelError(promise: Promise<unknown>): Promise<OnboardingModelError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OnboardingModelError);
    return error as OnboardingModelError;
  }
  throw new Error("Expected onboarding model call to fail");
}

function expectContentFreeError(
  error: OnboardingModelError,
  code: OnboardingModelError["code"],
): void {
  expect(error).toMatchObject({ name: "OnboardingModelError", code, message: code });
  expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  expect(`${error.message}\n${JSON.stringify(error)}\n${error.stack ?? ""}`).not.toContain(SECRET);
}

function projectionWithSavingsDigits(length: number): unknown {
  const copy = structuredClone(questionnaire()) as {
    fields: { fieldId: string; normalizedValue: unknown }[];
  };
  const savings = copy.fields.find(({ fieldId }) => fieldId === "savings");
  if (savings === undefined) throw new Error("Missing savings projection");
  const decimal = "1".padEnd(length, "0");
  savings.normalizedValue = { min: "0", max: decimal, currency: "USD" };
  return copy;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe("Codex onboarding model", () => {
  test("accepts the null-prototype owned JSON returned by the real runtime adapter", async () => {
    const baseline = extractionResult();
    const { model } = successfulModel({
      ...baseline,
      value: snapshotOwnedJson(baseline.value),
    });

    await expect(model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    })).resolves.toEqual(baseline.value);
  });

  test("pins a frozen, minimal port surface and the approved process contract", () => {
    const { model } = successfulModel();

    expect(ONBOARDING_MODEL_VERSIONS).toEqual({
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@1",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-model-output@1",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES).toBe(65_536);
    expect(ONBOARDING_REVIEW_MAX_PROMPT_BYTES).toBe(98_304);
    expect(ONBOARDING_EXTRACTION_LIMITS).toEqual({
      timeoutMs: 30_000,
      maxStdoutBytes: 131_072,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    });
    expect(ONBOARDING_REVIEW_LIMITS).toEqual({
      timeoutMs: 15_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    });
    expect(Object.keys(model)).toEqual(["versions", "extract", "review"]);
    expect(model.versions).toBe(ONBOARDING_MODEL_VERSIONS);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_MODEL_VERSIONS)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_EXTRACTION_LIMITS)).toBe(true);
    expect(Object.isFrozen(ONBOARDING_REVIEW_LIMITS)).toBe(true);
    for (const template of [
      ONBOARDING_EXTRACTION_PROMPT_TEMPLATE,
      ONBOARDING_REVIEW_PROMPT_TEMPLATE,
    ]) {
      expect(template).toContain("BEGIN_ONBOARDING_INPUT_JSON\n{{ONBOARDING_INPUT_JSON}}\nEND_ONBOARDING_INPUT_JSON");
    }
  });

  test("extracts through exactly one strictly bound shared-runtime invocation", async () => {
    const { model, invokeJson } = successfulModel();

    await expect(model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    })).resolves.toEqual(extractionResult().value);

    expect(invokeJson).toHaveBeenCalledTimes(1);
    const invocation = invokeJson.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      capability: "onboarding_extract",
      templateVersion: "onboarding-extract@1",
      schemaVersion: "onboarding-model-output@1",
      limits: ONBOARDING_EXTRACTION_LIMITS,
    });
    expect(invocation?.outputSchema).toEqual(ONBOARDING_EXTRACTION_SCHEMA);
    expect(invocation?.prompt).toContain(MESSAGE_TEXT);
    expect(invocation?.prompt.startsWith(
      ONBOARDING_EXTRACTION_PROMPT_TEMPLATE.split("\nBEGIN_ONBOARDING_INPUT_JSON")[0] ?? "",
    )).toBe(true);
    expect(invocation?.prompt).toContain(USER_MESSAGE_ID);
    expect(invocation?.prompt).toContain("onboarding-questionnaire-projection@1");
    expect(invocation?.prompt).toContain(
      "For a participants roster, use self/self first, then companion.0, companion.1, and so on",
    );
    expect(invocation?.prompt).toContain("Never emit the same fieldId twice");
    expect(invocation?.prompt).toContain(
      "Normalize city names to their canonical nominative Russian form",
    );
    expect(invocation?.prompt).not.toContain(SELF_ID);
    expect(invocation?.prompt).not.toContain(COMMAND_ID);
    expect(utf8Bytes(invocation?.prompt ?? "")).toBeLessThanOrEqual(
      ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES,
    );
  });

  test("reviews through exactly one separately bound shared-runtime invocation", async () => {
    const { runtime, invokeJson } = fakeRuntime(async () => reviewResult());
    const model = createCodexOnboardingModel(runtime);

    await expect(model.review({
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    })).resolves.toEqual(reviewResult().value);

    expect(invokeJson).toHaveBeenCalledTimes(1);
    const invocation = invokeJson.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      capability: "onboarding_review",
      templateVersion: "onboarding-review@1",
      schemaVersion: "onboarding-review-output@1",
      limits: ONBOARDING_REVIEW_LIMITS,
    });
    expect(invocation?.outputSchema).toEqual(ONBOARDING_REVIEW_SCHEMA);
    expect(invocation?.prompt.startsWith(
      ONBOARDING_REVIEW_PROMPT_TEMPLATE.split("\nBEGIN_ONBOARDING_INPUT_JSON")[0] ?? "",
    )).toBe(true);
    expect(invocation?.prompt).toContain("onboarding-questionnaire-projection@1");
    expect(invocation?.prompt).not.toContain(SELF_ID);
    expect(invocation?.prompt).not.toContain(COMMAND_ID);
    expect(utf8Bytes(invocation?.prompt ?? "")).toBeLessThanOrEqual(
      ONBOARDING_REVIEW_MAX_PROMPT_BYTES,
    );
  });

  test.each([
    ["extraction", ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES],
    ["review", ONBOARDING_REVIEW_MAX_PROMPT_BYTES],
  ] as const)("accepts the exact %s prompt byte limit and rejects one byte more", async (kind, maximum) => {
    const result = kind === "extraction" ? extractionResult() : reviewResult();
    const { model, invokeJson } = successfulModel(result);
    const controller = new AbortController();
    const call = (value: unknown) => kind === "extraction"
      ? model.extract({ message: message(), questionnaire: value, signal: controller.signal })
      : model.review({ questionnaire: value, signal: controller.signal });

    await call(projectionWithSavingsDigits(1));
    const baseline = invokeJson.mock.calls[0]?.[0].prompt ?? "";
    const addedBytes = maximum - utf8Bytes(baseline);
    expect(addedBytes).toBeGreaterThan(0);

    await call(projectionWithSavingsDigits(1 + addedBytes));
    expect(utf8Bytes(invokeJson.mock.calls[1]?.[0].prompt ?? "")).toBe(maximum);

    const error = await modelError(call(projectionWithSavingsDigits(2 + addedBytes)));
    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson).toHaveBeenCalledTimes(2);
  });

  test("rejects a hostile questionnaire before serialization or a runtime call", async () => {
    const { model, invokeJson } = successfulModel();
    const getter = vi.fn(() => SECRET);
    const hostile = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get: getter,
    });

    const error = await modelError(model.extract({
      message: message(),
      questionnaire: hostile,
      signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_invalid");
    expect(getter).not.toHaveBeenCalled();
    expect(invokeJson).not.toHaveBeenCalled();
  });

  test.each([
    ["invocationVersion", "codex-cli-invocation@stale"],
    ["cliVersion", "codex-cli stale"],
    ["templateVersion", "onboarding-extract@stale"],
    ["schemaVersion", "onboarding-model-output@stale"],
  ] as const)("rejects mismatched %s metadata after one call", async (key, value) => {
    const metadata = { ...extractionMetadata(), [key]: value } as CodexJsonResult["metadata"];
    const { model, invokeJson } = successfulModel(extractionResult(metadata));

    const error = await modelError(model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson).toHaveBeenCalledTimes(1);
  });

  test("maps parser rejection and hostile runtime results to one content-free invalid error", async () => {
    const invalidValue: CodexJsonResult = {
      value: {
        schemaVersion: "onboarding-model-output@1",
        proposals: [],
        nextQuestion: SECRET,
        extra: SECRET,
      },
      metadata: extractionMetadata(),
    };
    const first = successfulModel(invalidValue);
    const firstError = await modelError(first.model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));
    expectContentFreeError(firstError, "onboarding_model_invalid");
    expect(first.invokeJson).toHaveBeenCalledTimes(1);

    const getter = vi.fn(() => extractionResult().value);
    const hostileResult = Object.defineProperties({}, {
      value: { enumerable: true, get: getter },
      metadata: { enumerable: true, value: extractionMetadata() },
    }) as unknown as CodexJsonResult;
    const second = successfulModel(hostileResult);
    const secondError = await modelError(second.model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));
    expectContentFreeError(secondError, "onboarding_model_invalid");
    expect(getter).not.toHaveBeenCalled();
    expect(second.invokeJson).toHaveBeenCalledTimes(1);
  });

  test("maps runtime and arbitrary failures without retry or raw content", async () => {
    const runtimeFailure = fakeRuntime(async () => {
      throw new CodexRuntimeError("codex_process_failed");
    });
    const runtimeModel = createCodexOnboardingModel(runtimeFailure.runtime);
    const runtimeError = await modelError(runtimeModel.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));
    expectContentFreeError(runtimeError, "onboarding_model_runtime_failed");
    expect(runtimeError.runtimeCode).toBe("codex_process_failed");
    expect(runtimeFailure.invokeJson).toHaveBeenCalledTimes(1);

    const arbitraryFailure = fakeRuntime(async () => {
      throw new Error(SECRET);
    });
    const arbitraryModel = createCodexOnboardingModel(arbitraryFailure.runtime);
    const arbitraryError = await modelError(arbitraryModel.review({
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));
    expectContentFreeError(arbitraryError, "onboarding_model_invalid");
    expect(arbitraryFailure.invokeJson).toHaveBeenCalledTimes(1);
  });

  test("maps pre-call and in-flight caller aborts without exposing the abort reason", async () => {
    const before = successfulModel();
    const preAborted = new AbortController();
    preAborted.abort(new Error(SECRET));
    const beforeError = await modelError(before.model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: preAborted.signal,
    }));
    expectContentFreeError(beforeError, "onboarding_model_aborted");
    expect(before.invokeJson).not.toHaveBeenCalled();

    const inFlight = new AbortController();
    const during = fakeRuntime(async () => {
      inFlight.abort(new Error(SECRET));
      return reviewResult();
    });
    const duringModel = createCodexOnboardingModel(during.runtime);
    const duringError = await modelError(duringModel.review({
      questionnaire: questionnaire(),
      signal: inFlight.signal,
    }));
    expectContentFreeError(duringError, "onboarding_model_aborted");
    expect(during.invokeJson).toHaveBeenCalledTimes(1);
  });
});
