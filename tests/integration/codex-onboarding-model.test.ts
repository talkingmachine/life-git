import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, test, vi } from "vitest";

import {
  OnboardingModelError,
  type OnboardingExtractionRetryReason,
  type OnboardingModelPort,
} from "../../src/application/onboarding-contracts";
import { ONBOARDING_MODEL_VERSIONS_V8 } from
  "../../src/application/onboarding-model-versions";
import { projectQuestionnaireForModel } from "../../src/decision/onboarding-model-contract";
import { createOnboardingSession, type SessionMessage } from "../../src/decision/onboarding-session";
import {
  CODEX_CLI_VERSION,
  CODEX_CLI_COMPATIBILITY_POLICY,
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_INVOCATION_VERSION,
  CODEX_MODEL,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "../../src/infrastructure/codex-cli/contracts";
import type { CodexCliModelAdapter } from "../../src/infrastructure/codex-cli/model-adapter";
import { snapshotOwnedJson } from "../../src/infrastructure/codex-cli/owned-json";
import {
  ONBOARDING_EXTRACTION_WIRE_ALGEBRA,
  ONBOARDING_EXTRACTION_WIRE_CODEBOOK,
} from "../../src/infrastructure/codex-cli/onboarding-extraction-wire";
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
  nextQuestion = "Где вы живёте сейчас?",
): CodexJsonResult {
  return {
    value: {
      schemaVersion: "onboarding-extraction-wire@2",
      proposals: [{
        f: "b2",
        v: "alone",
        s: 0,
        e: MESSAGE_TEXT.length,
      }],
      nextQuestion,
    },
    metadata,
  };
}

function decodedExtractionResult(): unknown {
  return {
    schemaVersion: "onboarding-model-output@1",
    proposals: [{
      fieldId: "moving_party",
      typedValue: "alone",
      messageId: USER_MESSAGE_ID,
      sourceSpan: { start: 0, end: MESSAGE_TEXT.length },
    }],
    nextQuestion: "Где вы живёте сейчас?",
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
    protocolVersion: CODEX_CLI_PROTOCOL_VERSION,
    compatibilityPolicy: CODEX_CLI_COMPATIBILITY_POLICY,
    cliVersion: CODEX_CLI_VERSION,
    model: CODEX_MODEL,
    reasoningEffort: "low",
    toolPolicy: "codex-tools-none@2",
    templateVersion: "onboarding-extract@8",
    schemaVersion: "onboarding-extraction-wire@2",
  };
}

function reviewMetadata(): CodexJsonResult["metadata"] {
  return {
    invocationVersion: CODEX_INVOCATION_VERSION,
    protocolVersion: CODEX_CLI_PROTOCOL_VERSION,
    compatibilityPolicy: CODEX_CLI_COMPATIBILITY_POLICY,
    cliVersion: CODEX_CLI_VERSION,
    model: CODEX_MODEL,
    reasoningEffort: "low",
    toolPolicy: "codex-tools-none@2",
    templateVersion: "onboarding-review@2",
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

function extractionPromptPayload(prompt: string): Record<string, unknown> {
  const payload = prompt.match(
    /BEGIN_ONBOARDING_INPUT_JSON\n([\s\S]+)\nEND_ONBOARDING_INPUT_JSON/,
  )?.[1];
  return JSON.parse(payload ?? "null") as Record<string, unknown>;
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
    })).resolves.toEqual(decodedExtractionResult());
  });

  test("pins a frozen, minimal port surface and the approved process contract", () => {
    const { model } = successfulModel();

    expect(ONBOARDING_MODEL_VERSIONS).toEqual({
      invocation: "codex-cli-invocation@2",
      cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
      extractionPrompt: "onboarding-extract@8",
      reviewPrompt: "onboarding-review@2",
      extractionSchema: "onboarding-extraction-wire@2",
      reviewSchema: "onboarding-review-output@1",
    });
    expect(ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES).toBe(65_536);
    expect(ONBOARDING_REVIEW_MAX_PROMPT_BYTES).toBe(98_304);
    expect(ONBOARDING_EXTRACTION_LIMITS).toEqual({
      timeoutMs: 60_000,
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
    expect(model.versions).toBe(ONBOARDING_MODEL_VERSIONS_V8);
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
    })).resolves.toEqual(decodedExtractionResult());

    expect(invokeJson).toHaveBeenCalledTimes(1);
    const invocation = invokeJson.mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      capability: "onboarding.extract",
      templateVersion: "onboarding-extract@8",
      schemaVersion: "onboarding-extraction-wire@2",
      limits: ONBOARDING_EXTRACTION_LIMITS,
    });
    expect(invocation?.outputSchema).toEqual(ONBOARDING_EXTRACTION_SCHEMA);
    expect(invocation?.prompt).toContain(MESSAGE_TEXT);
    expect(invocation?.prompt.startsWith(
      ONBOARDING_EXTRACTION_PROMPT_TEMPLATE.split("\nBEGIN_ONBOARDING_INPUT_JSON")[0] ?? "",
    )).toBe(true);
    expect(invocation?.prompt).not.toContain(USER_MESSAGE_ID);
    expect(invocation?.prompt).not.toContain("messageId");
    expect(invocation?.prompt).toContain("onboarding-questionnaire-projection@1");
    const staticTemplate = ONBOARDING_EXTRACTION_PROMPT_TEMPLATE;
    expect(utf8Bytes(staticTemplate)).toBe(2_494);
    expect(createHash("sha256").update(staticTemplate).digest("hex")).toBe(
      "f333b9490485072faa4b1936845664c913e0de8c68c91244673640b267d6405d",
    );
    expect(utf8Bytes(staticTemplate)).toBeLessThanOrEqual(2_500);
    expect(staticTemplate).toContain(ONBOARDING_EXTRACTION_WIRE_ALGEBRA);
    for (const line of ONBOARDING_EXTRACTION_WIRE_ALGEBRA.split("\n")) {
      expect(staticTemplate).toContain(line);
    }
    expect(staticTemplate).not.toContain("Exact catalog-order codebook:");
    expect(staticTemplate).toContain("none,schema_invalid,guard_invalid,canonical_mismatch,evidence_mismatch");
    expect(staticTemplate).toContain("schema_invalid: return schema-valid wire JSON");
    expect(staticTemplate).toContain(
      "guard_invalid: rebuild from currentUserMessage.text; recheck bounds/slice/all rules",
    );
    expect(staticTemplate).toContain("canonical_mismatch: re-normalize explicit values");
    expect(staticTemplate).toContain("evidence_mismatch: recompute whole-token s,e");
    for (const { code, fieldId } of ONBOARDING_EXTRACTION_WIRE_CODEBOOK) {
      expect(staticTemplate).not.toContain(`${code}=${fieldId}`);
    }
    const canonicalFixture = JSON.parse(readFileSync(
      new URL("../../evals/fixtures/onboarding/canonical-journey.json", import.meta.url),
      "utf8",
    )) as {
      ids: { initialParticipantId: string; initialCompletionCommandId: string };
      messages: readonly [{ text: string }];
    };
    const emptySession = createOnboardingSession({
      nextParticipantId: () => canonicalFixture.ids.initialParticipantId,
      nextCompletionCommandId: () => canonicalFixture.ids.initialCompletionCommandId,
    });
    const canonicalPrompt = ONBOARDING_EXTRACTION_PROMPT_TEMPLATE.replace(
      "{{ONBOARDING_INPUT_JSON}}",
      JSON.stringify({
        currentUserMessage: {
          text: canonicalFixture.messages[0].text,
          utf16Length: canonicalFixture.messages[0].text.length,
        },
        questionnaire: projectQuestionnaireForModel(emptySession),
        retryFeedback: "none",
      }),
    );
    expect(utf8Bytes(canonicalPrompt)).toBe(8_732);
    expect(createHash("sha256").update(canonicalPrompt).digest("hex")).toBe(
      "a9da5b98b22c0a853be72c453bb11485098c3ba9fbcb894d3ae1adcde2428fc9",
    );
    expect(utf8Bytes(canonicalPrompt)).toBeLessThanOrEqual(9_000);
    expect(invocation?.prompt).toContain("Never emit the same f twice");
    expect(invocation?.prompt).toContain(
      "Use integer UTF-16 offsets s,e with 0 <= s < e <= currentUserMessage.utf16Length; evidence must equal currentUserMessage.text.slice(s,e).",
    );
    expect(invocation?.prompt).toContain(
      "Use shortest complete whole-token evidence for v. Omit if unverifiable; never clamp or split a Unicode letter, combining mark, number, or surrogate pair.",
    );
    expect(invocation?.prompt).toContain(
      "Normalize city names to their canonical nominative Russian form",
    );
    expect(invocation?.prompt).not.toContain(SELF_ID);
    expect(invocation?.prompt).not.toContain(COMMAND_ID);
    expect(extractionPromptPayload(invocation?.prompt ?? "")).toEqual({
      currentUserMessage: { text: MESSAGE_TEXT, utf16Length: MESSAGE_TEXT.length },
      questionnaire: questionnaire(),
      retryFeedback: "none",
    });
    expect(utf8Bytes(invocation?.prompt ?? "")).toBeLessThanOrEqual(
      ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES,
    );
  });

  test.each([
    ["BMP", "Москва", 6],
    ["surrogate pair", "A😀Б", 4],
    ["decomposed combining sequence", "е\u0301", 2],
  ] as const)("adds the exact code-owned UTF-16 length for %s text to initial and retry payloads", async (
    _case,
    text,
    utf16Length,
  ) => {
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      value: {
        schemaVersion: "onboarding-extraction-wire@2",
        proposals: [],
        nextQuestion: "Что ещё важно?",
      },
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime);

    await expect(model.extract({
      message: { ...message(), text },
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
      acceptExtraction: (_output, attempt) => attempt.attempt === "initial"
        ? Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const })
        : Object.freeze({ kind: "accepted" as const }),
    })).resolves.toMatchObject({ proposals: [] });

    expect(invokeJson).toHaveBeenCalledTimes(2);
    expect(invokeJson.mock.calls.map(([invocation]) =>
      extractionPromptPayload(invocation.prompt).currentUserMessage)).toEqual([
      { text, utf16Length },
      { text, utf16Length },
    ]);
  });

  test.each([
    "schema_invalid",
    "guard_invalid",
    "canonical_mismatch",
    "evidence_mismatch",
  ] as const)("rebuilds medium prompt with exact %s feedback", async (retryFeedback) => {
    const rejectedSentinel = `${SECRET}-${retryFeedback}`;
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => {
      if (invocation.reasoningEffort === "medium") {
        return extractionResult({ ...extractionMetadata(), reasoningEffort: "medium" });
      }
      return retryFeedback === "schema_invalid"
        ? { value: { invalid: true, rejectedSentinel }, metadata: extractionMetadata() }
        : extractionResult(extractionMetadata(), rejectedSentinel);
    });
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = retryFeedback === "schema_invalid"
      ? undefined
      : vi.fn((_output, attempt) => attempt.attempt === "initial"
        ? Object.freeze({ kind: "retryable" as const, reason: retryFeedback as OnboardingExtractionRetryReason })
        : Object.freeze({ kind: "accepted" as const }));

    await expect(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
      ...(acceptExtraction === undefined ? {} : { acceptExtraction }),
    })).resolves.toEqual(decodedExtractionResult());

    expect(invokeJson).toHaveBeenCalledTimes(2);
    const low = invokeJson.mock.calls[0]![0];
    const medium = invokeJson.mock.calls[1]![0];
    expect([low.reasoningEffort, medium.reasoningEffort]).toEqual(["low", "medium"]);
    expect(low.toolPolicy).toBe("codex-tools-none@2");
    expect(medium.toolPolicy).toBe("codex-tools-none@2");
    expect(extractionPromptPayload(low.prompt).retryFeedback).toBe("none");
    expect(extractionPromptPayload(medium.prompt).retryFeedback).toBe(retryFeedback);
    expect(extractionPromptPayload(low.prompt).currentUserMessage).toEqual({
      text: MESSAGE_TEXT,
      utf16Length: MESSAGE_TEXT.length,
    });
    expect(extractionPromptPayload(medium.prompt).currentUserMessage).toEqual({
      text: MESSAGE_TEXT,
      utf16Length: MESSAGE_TEXT.length,
    });
    expect(medium.prompt).not.toBe(low.prompt);
    expect(medium.prompt).not.toContain(rejectedSentinel);
  });

  test("keeps out-of-bounds evidence unchanged for guard validation and retries without clamping or filtering", async () => {
    const end = MESSAGE_TEXT.length + 1;
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      value: {
        schemaVersion: "onboarding-extraction-wire@2",
        proposals: [{ f: "b2", v: "alone", s: 0, e: end }],
        nextQuestion: "Где вы живёте сейчас?",
      },
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = vi.fn((output: unknown) => {
      expect(output).toMatchObject({
        proposals: [{ sourceSpan: { start: 0, end } }],
      });
      return Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
    });

    const error = await modelError(model.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
      acceptExtraction,
    }));

    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson).toHaveBeenCalledTimes(2);
    expect(acceptExtraction).toHaveBeenCalledTimes(2);
    expect(invokeJson.mock.calls.map(([invocation]) =>
      extractionPromptPayload(invocation.prompt).retryFeedback)).toEqual(["none", "guard_invalid"]);
  });

  test("shares one low-to-medium budget with a semantic acceptance retry", async () => {
    // Break caught: a schema-valid but guard-invalid low result bypasses the one allowed medium retry.
    const signal = new AbortController().signal;
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      ...extractionResult(),
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime);
    let acceptanceCalls = 0;
    const acceptExtraction = vi.fn((output: unknown) => {
      acceptanceCalls += 1;
      expect(Object.isFrozen(output)).toBe(true);
      const proposal = (output as { proposals: readonly unknown[] }).proposals[0];
      expect(Object.isFrozen((output as { proposals: readonly unknown[] }).proposals)).toBe(true);
      expect(Object.isFrozen(proposal)).toBe(true);
      return acceptanceCalls === 1
        ? Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const })
        : Object.freeze({ kind: "accepted" as const });
    });

    await expect(model.extract({
      message: message(), questionnaire: questionnaire(), signal, acceptExtraction,
    })).resolves.toEqual(decodedExtractionResult());

    expect(invokeJson.mock.calls.map(([call]) => [call.reasoningEffort, call.signal])).toEqual([
      ["low", signal],
      ["medium", signal],
    ]);
    expect(acceptExtraction).toHaveBeenCalledTimes(2);
  });

  test("shares one monotonic deadline across semantic low-to-medium retry", async () => {
    let nowMs = 1_000;
    const signal = new AbortController().signal;
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      ...extractionResult(),
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime, { monotonicNowMs: () => nowMs });
    const attempts: unknown[] = [];

    await expect(model.extract({
      message: message(), questionnaire: questionnaire(), signal,
      acceptExtraction: (_output, attempt) => {
        attempts.push(attempt);
        expect(Object.isFrozen(attempt)).toBe(true);
        if (attempt.attempt === "initial") {
          nowMs += 12_345;
          return Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
        }
        return Object.freeze({ kind: "accepted" as const });
      },
    })).resolves.toEqual(decodedExtractionResult());

    expect(invokeJson.mock.calls.map(([invocation]) => ({
      effort: invocation.reasoningEffort,
      timeoutMs: invocation.limits.timeoutMs,
      frozen: Object.isFrozen(invocation.limits),
      signal: invocation.signal,
    }))).toEqual([
      { effort: "low", timeoutMs: 60_000, frozen: true, signal },
      { effort: "medium", timeoutMs: 47_655, frozen: true, signal },
    ]);
    expect(attempts).toEqual([{ attempt: "initial" }, { attempt: "retry" }]);
  });

  test("starts medium after the former 30-second cutoff with the remaining shared deadline", async () => {
    let nowMs = 0;
    const signal = new AbortController().signal;
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      ...extractionResult(),
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime, { monotonicNowMs: () => nowMs });

    await expect(model.extract({
      message: message(), questionnaire: questionnaire(), signal,
      acceptExtraction: (_output, attempt) => {
        if (attempt.attempt === "initial") {
          nowMs = 30_001;
          return Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
        }
        return Object.freeze({ kind: "accepted" as const });
      },
    })).resolves.toEqual(decodedExtractionResult());

    expect(invokeJson.mock.calls.map(([invocation]) => ({
      effort: invocation.reasoningEffort,
      timeoutMs: invocation.limits.timeoutMs,
      signal: invocation.signal,
    }))).toEqual([
      { effort: "low", timeoutMs: 60_000, signal },
      { effort: "medium", timeoutMs: 29_999, signal },
    ]);
  });

  test("does not start medium after the shared extraction deadline is exhausted", async () => {
    let nowMs = 0;
    const { runtime, invokeJson } = fakeRuntime(async () => extractionResult());
    const model = createCodexOnboardingModel(runtime, { monotonicNowMs: () => nowMs });
    const acceptExtraction = vi.fn(() => {
      nowMs = ONBOARDING_EXTRACTION_LIMITS.timeoutMs;
      return Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
    });

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(),
      signal: new AbortController().signal, acceptExtraction,
    }));

    expectContentFreeError(error, "onboarding_model_runtime_failed");
    expect(error.runtimeCode).toBe("codex_timeout");
    expect(invokeJson).toHaveBeenCalledOnce();
  });

  test("rejects a schema-valid result that arrives after the shared extraction deadline", async () => {
    let nowMs = 0;
    const { runtime, invokeJson } = fakeRuntime(async () => {
      nowMs = ONBOARDING_EXTRACTION_LIMITS.timeoutMs;
      return extractionResult();
    });
    const model = createCodexOnboardingModel(runtime, { monotonicNowMs: () => nowMs });

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_runtime_failed");
    expect(error.runtimeCode).toBe("codex_timeout");
    expect(invokeJson).toHaveBeenCalledOnce();
  });

  test("fails closed when the extraction clock moves backwards", async () => {
    const values = [10, 9];
    const { runtime, invokeJson } = fakeRuntime(async () => extractionResult());
    const model = createCodexOnboardingModel(runtime, {
      monotonicNowMs: () => values.shift() ?? 9,
    });

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledOnce();
  });

  test("fails closed before invocation when the extraction clock is invalid", async () => {
    const { runtime, invokeJson } = fakeRuntime(async () => extractionResult());
    const model = createCodexOnboardingModel(runtime, { monotonicNowMs: () => Number.NaN });

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).not.toHaveBeenCalled();
  });

  test("stops after two retryable semantic outcomes", async () => {
    // Break caught: semantic ambiguity creates a third call or returns a rejected medium result.
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      ...extractionResult(),
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = vi.fn(() =>
      Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const }));

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(),
      signal: new AbortController().signal, acceptExtraction,
    }));

    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson.mock.calls.map(([call]) => call.reasoningEffort)).toEqual(["low", "medium"]);
    expect(acceptExtraction).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["throws", () => { throw new Error(SECRET); }],
    ["returns a malformed outcome", () => "retryable" as unknown],
    ["returns an unknown reason", () => ({ kind: "retryable", reason: "unknown" })],
    ["returns an accessor reason", () => Object.defineProperty(
      { kind: "retryable" },
      "reason",
      { enumerable: true, get: () => { throw new Error(SECRET); } },
    )],
    ["returns a proxied reason", () => new Proxy(
      { kind: "retryable", reason: "guard_invalid" },
      {},
    )],
  ] as const)("maps an acceptance callback that %s to integrity failure without retry", async (_case, implementation) => {
    // Break caught: callback bugs become retries/fallbacks or leak their thrown content.
    const { runtime, invokeJson } = fakeRuntime(async () => extractionResult());
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = vi.fn(implementation) as unknown as
      (output: unknown) => Readonly<{ kind: "accepted" }>;

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(),
      signal: new AbortController().signal, acceptExtraction,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledOnce();
    expect(acceptExtraction).toHaveBeenCalledOnce();
  });

  test("does not start medium when the caller aborts during semantic acceptance", async () => {
    // Break caught: a false low semantic result wins over abort and launches a late medium child.
    const controller = new AbortController();
    const { runtime, invokeJson } = fakeRuntime(async () => extractionResult());
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = vi.fn(() => {
      controller.abort(new Error(SECRET));
      return Object.freeze({ kind: "retryable" as const, reason: "guard_invalid" as const });
    });

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(),
      signal: controller.signal, acceptExtraction,
    }));

    expectContentFreeError(error, "onboarding_model_aborted");
    expect(invokeJson).toHaveBeenCalledOnce();
    expect(acceptExtraction).toHaveBeenCalledOnce();
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
      capability: "onboarding.review",
      reasoningEffort: "low",
      toolPolicy: "codex-tools-none@2",
      templateVersion: "onboarding-review@2",
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

  test("maps review metadata mismatch to a content-free integrity failure", async () => {
    const { runtime, invokeJson } = fakeRuntime(async () => reviewResult({
      ...reviewMetadata(),
      toolPolicy: "codex-tools-web-search@1",
    }));
    const model = createCodexOnboardingModel(runtime);

    const error = await modelError(model.review({
      questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledOnce();
  });

  test("reserves the longest retry feedback at the extraction prompt boundary", async () => {
    const { runtime, invokeJson } = fakeRuntime(async (invocation) => ({
      ...extractionResult(),
      metadata: { ...extractionMetadata(), reasoningEffort: invocation.reasoningEffort },
    }));
    const model = createCodexOnboardingModel(runtime);
    const acceptExtraction = vi.fn((_output, attempt) => attempt.attempt === "initial"
      ? Object.freeze({ kind: "retryable" as const, reason: "canonical_mismatch" as const })
      : Object.freeze({ kind: "accepted" as const }));
    const call = (value: unknown) => model.extract({
      message: message(), questionnaire: value,
      signal: new AbortController().signal, acceptExtraction,
    });

    await call(projectionWithSavingsDigits(1));
    const baselineMedium = invokeJson.mock.calls[1]?.[0].prompt ?? "";
    expect(extractionPromptPayload(baselineMedium).currentUserMessage).toEqual({
      text: MESSAGE_TEXT,
      utf16Length: MESSAGE_TEXT.length,
    });
    const addedBytes = ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES - utf8Bytes(baselineMedium);
    expect(addedBytes).toBeGreaterThan(0);

    invokeJson.mockClear();
    acceptExtraction.mockClear();
    await call(projectionWithSavingsDigits(1 + addedBytes));
    expect(invokeJson).toHaveBeenCalledTimes(2);
    expect(utf8Bytes(invokeJson.mock.calls[1]?.[0].prompt ?? ""))
      .toBe(ONBOARDING_EXTRACTION_MAX_PROMPT_BYTES);
    expect(extractionPromptPayload(invokeJson.mock.calls[1]?.[0].prompt ?? "").retryFeedback)
      .toBe("canonical_mismatch");
    expect(extractionPromptPayload(invokeJson.mock.calls[1]?.[0].prompt ?? "").currentUserMessage)
      .toEqual({ text: MESSAGE_TEXT, utf16Length: MESSAGE_TEXT.length });

    invokeJson.mockClear();
    acceptExtraction.mockClear();
    const error = await modelError(call(projectionWithSavingsDigits(2 + addedBytes)));
    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson).not.toHaveBeenCalled();
    expect(acceptExtraction).not.toHaveBeenCalled();
  });

  test("accepts the exact review prompt byte limit and rejects one byte more", async () => {
    const { model, invokeJson } = successfulModel(reviewResult());
    const call = (value: unknown) => model.review({
      questionnaire: value,
      signal: new AbortController().signal,
    });

    await call(projectionWithSavingsDigits(1));
    const baseline = invokeJson.mock.calls[0]?.[0].prompt ?? "";
    const addedBytes = ONBOARDING_REVIEW_MAX_PROMPT_BYTES - utf8Bytes(baseline);
    expect(addedBytes).toBeGreaterThan(0);

    await call(projectionWithSavingsDigits(1 + addedBytes));
    expect(utf8Bytes(invokeJson.mock.calls[1]?.[0].prompt ?? ""))
      .toBe(ONBOARDING_REVIEW_MAX_PROMPT_BYTES);

    const error = await modelError(call(projectionWithSavingsDigits(2 + addedBytes)));
    expectContentFreeError(error, "onboarding_model_invalid");
    expect(invokeJson).toHaveBeenCalledTimes(2);
  });

  test("rejects proxied runtime metadata after one invocation", async () => {
    const metadata = new Proxy(extractionMetadata(), {});
    const { model, invokeJson } = successfulModel(extractionResult(metadata));

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledTimes(1);
  });

  test("rejects a coercible non-string runtime CLI version after one invocation", async () => {
    const metadata = {
      ...extractionMetadata(),
      cliVersion: { toString: () => "codex-cli 0.149.0-alpha.4" },
    } as unknown as CodexJsonResult["metadata"];
    const { model, invokeJson } = successfulModel(extractionResult(metadata));

    const error = await modelError(model.extract({
      message: message(), questionnaire: questionnaire(), signal: new AbortController().signal,
    }));

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledTimes(1);
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

    expectContentFreeError(error, "onboarding_model_integrity_failed");
    expect(invokeJson).toHaveBeenCalledTimes(1);
  });

  test("maps parser rejection and hostile runtime results to one content-free invalid error", async () => {
    const invalidValue: CodexJsonResult = {
      value: {
        schemaVersion: "onboarding-extraction-wire@2",
        proposals: [],
        nextQuestion: SECRET,
        extra: SECRET,
      },
      metadata: extractionMetadata(),
    };
    const firstRuntime = fakeRuntime(vi.fn()
      .mockResolvedValueOnce(invalidValue)
      .mockResolvedValueOnce({
        ...invalidValue,
        metadata: { ...extractionMetadata(), reasoningEffort: "medium" },
      }));
    const firstModel = createCodexOnboardingModel(firstRuntime.runtime);
    const firstError = await modelError(firstModel.extract({
      message: message(),
      questionnaire: questionnaire(),
      signal: new AbortController().signal,
    }));
    expectContentFreeError(firstError, "onboarding_model_invalid");
    expect(firstRuntime.invokeJson).toHaveBeenCalledTimes(2);

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
    expectContentFreeError(secondError, "onboarding_model_integrity_failed");
    expect(getter).not.toHaveBeenCalled();
    expect(second.invokeJson).toHaveBeenCalledTimes(1);
  });

  test("maps runtime and arbitrary failures without retry or raw content", async () => {
    for (const runtimeCode of [
      "codex_not_authenticated",
      "codex_rate_limited",
      "codex_timeout",
      "codex_process_failed",
    ] as const) {
      const runtimeFailure = fakeRuntime(async () => {
        throw new CodexRuntimeError(runtimeCode);
      });
      const runtimeModel = createCodexOnboardingModel(runtimeFailure.runtime);
      const runtimeError = await modelError(runtimeModel.extract({
        message: message(),
        questionnaire: questionnaire(),
        signal: new AbortController().signal,
      }));
      expectContentFreeError(runtimeError, "onboarding_model_runtime_failed");
      expect(runtimeError.runtimeCode).toBe(runtimeCode);
      expect(runtimeFailure.invokeJson).toHaveBeenCalledTimes(1);
    }

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
