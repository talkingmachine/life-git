import { describe, expect, test, vi } from "vitest";

import {
  completeOnboarding,
  extractMessage,
  reconstructContinueOnboardingCommand,
  reconstructExtractOnboardingMessageCommand,
} from "../../src/application/onboarding";
import { OnboardingModelError, type OnboardingModelPort } from "../../src/application/onboarding-contracts";
import { CITY_PREFERENCE_IDS, COUNTRY_PREFERENCE_IDS } from "../../src/decision/onboarding-catalog";
import type { LocalExtractionResult, LocalReviewResult } from "../../src/decision/onboarding-catalog";
import {
  applyGuardedExtraction,
  applySessionFieldChange,
  createOnboardingSession,
  ONBOARDING_SESSION_LIMITS,
  type OnboardingSessionState,
} from "../../src/decision/onboarding-session";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND_1 = "10000000-0000-4000-8000-000000000001";
const COMMAND_2 = "10000000-0000-4000-8000-000000000002";
const USER_MESSAGE = "20000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE = "30000000-0000-4000-8000-000000000001";

const receipt = Object.freeze({
  schemaVersion: "onboarding-receipt@1" as const,
  receiptId: "receipt-1",
  completionCommandId: COMMAND_2,
  confirmationDigest: "digest-1",
  profileId: "profile-1",
  preferenceProfileId: "preferences-1",
  frontierRunId: "run-1",
  confirmedAt: "2026-08-22T00:00:00.000Z",
});
const prepared = Object.freeze({
  runId: "run-1",
  profileId: "profile-1",
  preferenceProfileId: "preferences-1",
  assessmentAt: "2026-08-22T00:00:00.000Z",
  rankingSnapshotId: "ranking-1",
  contextHash: "context-1",
});

function emptySession(): OnboardingSessionState {
  return createOnboardingSession({
    nextParticipantId: () => SELF_ID,
    nextCompletionCommandId: () => COMMAND_1,
  });
}

function completeSession(): OnboardingSessionState {
  let session = emptySession();
  let nextCommand = 2;
  const change = (fieldId: string, rawInput: unknown) => {
    session = applySessionFieldChange({
      session,
      change: { kind: "manual_set", fieldId: fieldId as never, rawInput },
      nextCompletionCommandId: () => `10000000-0000-4000-8000-${String(nextCommand++).padStart(12, "0")}`,
    });
  };
  change("current_location", { countryCode: "RU", city: "Moscow" });
  change("move_horizon", "within_3_months");
  change("moving_party", "alone");
  change("savings", { min: "0", max: "10000", currency: "EUR" });
  change(`participants.${SELF_ID}.citizenships`, ["RU"]);
  change(`participants.${SELF_ID}.passport`, "absent");
  change(`participants.${SELF_ID}.current_work`, { status: "not_working" });
  change(`participants.${SELF_ID}.monthly_income`, { amount: "0", currency: "RUB", basis: "net" });
  change(`participants.${SELF_ID}.education`, { level: "none" });
  change(`participants.${SELF_ID}.relevant_experience_years`, 0);
  for (const id of COUNTRY_PREFERENCE_IDS) {
    change(`country_preferences.${id}.mode`, "required");
    change(`country_preferences.${id}.importance`, 3);
    change(`country_preferences.${id}.target`, "required_true");
  }
  for (const id of CITY_PREFERENCE_IDS) {
    change(`city_preferences.${id}.mode`, "weighted");
    change(`city_preferences.${id}.importance`, 3);
    change(`city_preferences.${id}.target`, `${id}-target`);
  }
  return session;
}

function sessionWithMessages(count: number): OnboardingSessionState {
  const session = structuredClone(emptySession()) as unknown as { messages: unknown[] };
  session.messages = Array.from({ length: count }, (_, index) => ({
    messageId: `20000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    role: "user",
    text: "Already sent.",
  }));
  return session as unknown as OnboardingSessionState;
}

function model(input: {
  readonly extraction?: unknown;
  readonly extractionError?: Error;
  readonly review?: unknown;
  readonly reviewError?: Error;
} = {}): OnboardingModelPort {
  return {
    versions: {
      invocation: "codex-cli-invocation@1",
      cliVersion: "codex-cli 0.148.0-alpha.15",
      extractionPrompt: "onboarding-extract@1",
      reviewPrompt: "onboarding-review@1",
      extractionSchema: "onboarding-model-output@1",
      reviewSchema: "onboarding-review-output@1",
    },
    async extract() {
      if (input.extractionError !== undefined) throw input.extractionError;
      return (input.extraction ?? {
        schemaVersion: "onboarding-model-output@1",
        proposals: [],
        nextQuestion: "What is your move horizon?",
      }) as LocalExtractionResult;
    },
    async review() {
      if (input.reviewError !== undefined) throw input.reviewError;
      return (input.review ?? { schemaVersion: "onboarding-review-output@1", issues: [] }) as LocalReviewResult;
    },
  };
}

describe("onboarding application use cases", () => {
  test("reconstructs only exact bounded commands", () => {
    const message = { messageId: USER_MESSAGE, role: "user" as const, text: "I am moving" };
    const extracted = reconstructExtractOnboardingMessageCommand({
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message,
    });
    const continued = reconstructContinueOnboardingCommand({
      schemaVersion: "onboarding-continue-command@1",
      session: emptySession(),
    });

    expect(extracted).toMatchObject({ schemaVersion: "onboarding-message-command@1", message });
    expect(continued).toMatchObject({ schemaVersion: "onboarding-continue-command@1" });
    expect(() => reconstructExtractOnboardingMessageCommand({ ...extracted, extra: true })).toThrow(TypeError);
    expect(() => reconstructContinueOnboardingCommand({ ...continued, schemaVersion: "wrong" })).toThrow(TypeError);
  });

  test.each([
    [
      "a user-assistant pair without two remaining transcript slots",
      () => sessionWithMessages(ONBOARDING_SESSION_LIMITS.maxMessages - 1),
      USER_MESSAGE,
    ],
    ["a message ID owned by the completion command", emptySession, COMMAND_1],
    ["a message ID owned by a participant", emptySession, SELF_ID],
    [
      "a message ID owned by the prior transcript",
      () => sessionWithMessages(1),
      "20000000-0000-4000-8000-000000000100",
    ],
  ] as const)("rejects %s during command reconstruction", (_case, currentSession, messageId) => {
    expect(() => reconstructExtractOnboardingMessageCommand({
      schemaVersion: "onboarding-message-command@1",
      session: currentSession(),
      message: { messageId, role: "user", text: "New message" },
    })).toThrow(TypeError);
  });

  test("rejects a coercible message ID without invoking it or the extraction model", async () => {
    const toString = vi.fn(() => USER_MESSAGE);
    const localModel = model();
    const extract = vi.spyOn(localModel, "extract");
    const command = {
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message: { messageId: { toString }, role: "user", text: "Hello" },
    };

    expect(() => reconstructExtractOnboardingMessageCommand(command)).toThrow(TypeError);
    await expect(extractMessage(command as never, {
      model: localModel,
      nextParticipantId: vi.fn(() => "40000000-0000-4000-8000-000000000001"),
      nextAssistantMessageId: vi.fn(() => ASSISTANT_MESSAGE),
      nextCompletionCommandId: vi.fn(() => COMMAND_2),
    }, new AbortController().signal)).rejects.toThrow(TypeError);
    expect(toString).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  test("extracts through one model call, adds the injected assistant UUID, and rotates once", async () => {
    const localModel = model({
      extraction: {
        schemaVersion: "onboarding-model-output@1",
        proposals: [{
          fieldId: "move_horizon",
          typedValue: "within_3_months",
          messageId: USER_MESSAGE,
          sourceSpan: { start: 0, end: 10 },
        }],
        nextQuestion: "When are you moving?",
      },
    });
    const extract = vi.spyOn(localModel, "extract");
    const session = await extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message: { messageId: USER_MESSAGE, role: "user", text: "This winter" },
    }, {
      model: localModel,
      nextParticipantId: () => "40000000-0000-4000-8000-000000000001",
      nextAssistantMessageId: () => ASSISTANT_MESSAGE,
      nextCompletionCommandId: () => COMMAND_2,
    }, new AbortController().signal);

    expect(extract).toHaveBeenCalledOnce();
    expect(session.completionCommandId).toBe(COMMAND_2);
    expect(session.messages).toEqual([
      { messageId: USER_MESSAGE, role: "user", text: "This winter" },
      { messageId: ASSISTANT_MESSAGE, role: "assistant", text: "When are you moving?" },
    ]);
  });

  test("offers guard-only semantic acceptance without allocating IDs before final revalidation", async () => {
    // Break caught: the application cannot ask for a guard retry, or its advisory validator mutates session state.
    const valid = {
      schemaVersion: "onboarding-model-output@1" as const,
      proposals: [{
        fieldId: "move_horizon" as const,
        typedValue: "within_3_months" as const,
        messageId: USER_MESSAGE,
        sourceSpan: { start: 0, end: 10 },
      }],
      nextQuestion: "When are you moving?",
    };
    const invalid = {
      ...valid,
      proposals: [{ ...valid.proposals[0], sourceSpan: { start: 0, end: 0 } }],
    };
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);
    const base = model();
    const extract = vi.fn<OnboardingModelPort["extract"]>(async (input) => {
      expect(input.acceptExtraction).toBeTypeOf("function");
      const attempt = Object.freeze({ attempt: "initial" as const });
      expect(input.acceptExtraction?.(invalid, attempt)).toEqual({
        kind: "retryable",
        reason: "guard_invalid",
      });
      expect(nextParticipantId).not.toHaveBeenCalled();
      expect(nextAssistantMessageId).not.toHaveBeenCalled();
      expect(nextCompletionCommandId).not.toHaveBeenCalled();
      expect(input.acceptExtraction?.(valid, attempt)).toEqual({ kind: "accepted" });
      expect(nextParticipantId).not.toHaveBeenCalled();
      expect(nextAssistantMessageId).not.toHaveBeenCalled();
      expect(nextCompletionCommandId).not.toHaveBeenCalled();
      return valid;
    });
    const localModel: OnboardingModelPort = Object.freeze({ ...base, extract });

    const session = await extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message: { messageId: USER_MESSAGE, role: "user", text: "This winter" },
    }, {
      model: localModel,
      nextParticipantId,
      nextAssistantMessageId,
      nextCompletionCommandId,
    }, new AbortController().signal);

    expect(session.messages).toEqual([
      { messageId: USER_MESSAGE, role: "user", text: "This winter" },
      { messageId: ASSISTANT_MESSAGE, role: "assistant", text: "When are you moving?" },
    ]);
    expect(nextParticipantId).not.toHaveBeenCalled();
    expect(nextAssistantMessageId).toHaveBeenCalledOnce();
    expect(nextCompletionCommandId).toHaveBeenCalledOnce();
  });

  test("falls back to one fixed question when extraction model is unavailable", async () => {
    // Break caught: rejecting an unavailable model instead of preserving the deterministic questionnaire.
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);
    const original = emptySession();

    const session = await extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: original,
      message: { messageId: USER_MESSAGE, role: "user", text: "I am moving" },
    }, {
      model: model({ extractionError: new OnboardingModelError("onboarding_model_runtime_failed", "codex_timeout") }),
      nextParticipantId,
      nextAssistantMessageId,
      nextCompletionCommandId,
    }, new AbortController().signal);

    expect(session.draft).toEqual(original.draft);
    expect(session.messages).toEqual([
      { messageId: USER_MESSAGE, role: "user", text: "I am moving" },
      { messageId: ASSISTANT_MESSAGE, role: "assistant", text: "Заполните выделенные поля." },
    ]);
    expect(nextParticipantId).not.toHaveBeenCalled();
    expect(nextAssistantMessageId).toHaveBeenCalledOnce();
    expect(nextCompletionCommandId).not.toHaveBeenCalled();
  });

  test("never falls back or allocates IDs when extraction reports caller abort", async () => {
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);
    const abort = new OnboardingModelError("onboarding_model_aborted");

    await expect(extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message: { messageId: USER_MESSAGE, role: "user", text: "I am moving" },
    }, {
      model: model({ extractionError: abort }),
      nextParticipantId,
      nextAssistantMessageId,
      nextCompletionCommandId,
    }, new AbortController().signal)).rejects.toBe(abort);
    expect(nextParticipantId).not.toHaveBeenCalled();
    expect(nextAssistantMessageId).not.toHaveBeenCalled();
    expect(nextCompletionCommandId).not.toHaveBeenCalled();
  });

  test("propagates extraction integrity failure without appending a fallback transcript", async () => {
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);
    const integrity = new OnboardingModelError("onboarding_model_integrity_failed");

    await expect(extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: emptySession(),
      message: { messageId: USER_MESSAGE, role: "user", text: "I am moving" },
    }, {
      model: model({ extractionError: integrity }),
      nextParticipantId,
      nextAssistantMessageId,
      nextCompletionCommandId,
    }, new AbortController().signal)).rejects.toBe(integrity);
    expect(nextParticipantId).not.toHaveBeenCalled();
    expect(nextAssistantMessageId).not.toHaveBeenCalled();
    expect(nextCompletionCommandId).not.toHaveBeenCalled();
  });

  test("rejects assistant identifiers that collide, are invalid, or consume a command/participant ID", async () => {
    const command = {
      schemaVersion: "onboarding-message-command@1" as const,
      session: emptySession(),
      message: { messageId: USER_MESSAGE, role: "user" as const, text: "Hello" },
    };
    for (const assistantId of [USER_MESSAGE, COMMAND_1, SELF_ID, "UPPERCASE-NOT-A-UUID"]) {
      await expect(extractMessage(command, {
        model: model(),
        nextParticipantId: () => "40000000-0000-4000-8000-000000000001",
        nextAssistantMessageId: () => assistantId,
        nextCompletionCommandId: () => COMMAND_2,
      }, new AbortController().signal)).rejects.toThrow(TypeError);
    }
  });

  test("rejects a user identifier already owned by the session before model or ID allocation", async () => {
    const transcript = applyGuardedExtraction({
      session: emptySession(),
      userMessage: { messageId: USER_MESSAGE, role: "user", text: "Existing message" },
      extraction: { proposals: [], nextQuestion: "Question?" },
      nextParticipantId: () => "40000000-0000-4000-8000-000000000001",
      nextAssistantMessageId: () => ASSISTANT_MESSAGE,
      nextCompletionCommandId: () => COMMAND_2,
    });
    for (const [session, messageId] of [
      [emptySession(), COMMAND_1],
      [emptySession(), SELF_ID],
      [transcript, USER_MESSAGE],
    ] as const) {
      const localModel = model();
      const extract = vi.spyOn(localModel, "extract");
      const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
      const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
      const nextCompletionCommandId = vi.fn(() => COMMAND_2);

      await expect(extractMessage({
        schemaVersion: "onboarding-message-command@1",
        session,
        message: { messageId, role: "user", text: "New message" },
      }, { model: localModel, nextParticipantId, nextAssistantMessageId, nextCompletionCommandId },
      new AbortController().signal)).rejects.toThrow(TypeError);
      expect(extract).not.toHaveBeenCalled();
      expect(nextParticipantId).not.toHaveBeenCalled();
      expect(nextAssistantMessageId).not.toHaveBeenCalled();
      expect(nextCompletionCommandId).not.toHaveBeenCalled();
    }
  });

  test("admits exactly one remaining user-assistant message pair and rejects an over-capacity pair before model work", async () => {
    const localModel = model();
    const extract = vi.spyOn(localModel, "extract");
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);
    const allowed = sessionWithMessages(ONBOARDING_SESSION_LIMITS.maxMessages - 2);

    await expect(extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: allowed,
      message: { messageId: USER_MESSAGE, role: "user", text: "Last slot" },
    }, { model: localModel, nextParticipantId, nextAssistantMessageId, nextCompletionCommandId },
    new AbortController().signal)).resolves.toMatchObject({ messages: expect.any(Array) });
    expect(extract).toHaveBeenCalledOnce();

    const rejectedModel = model();
    const rejectedExtract = vi.spyOn(rejectedModel, "extract");
    const rejectedParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const rejectedAssistantId = vi.fn(() => ASSISTANT_MESSAGE);
    const rejectedCommandId = vi.fn(() => COMMAND_2);
    await expect(extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: sessionWithMessages(ONBOARDING_SESSION_LIMITS.maxMessages - 1),
      message: { messageId: USER_MESSAGE, role: "user", text: "One too many" },
    }, {
      model: rejectedModel,
      nextParticipantId: rejectedParticipantId,
      nextAssistantMessageId: rejectedAssistantId,
      nextCompletionCommandId: rejectedCommandId,
    }, new AbortController().signal)).rejects.toThrow(TypeError);
    expect(rejectedExtract).not.toHaveBeenCalled();
    expect(rejectedParticipantId).not.toHaveBeenCalled();
    expect(rejectedAssistantId).not.toHaveBeenCalled();
    expect(rejectedCommandId).not.toHaveBeenCalled();
  });

  test("closes an extraction guard failure before any ID allocation", async () => {
    const original = emptySession();
    const localModel = model({
      extraction: {
        schemaVersion: "onboarding-model-output@1",
        proposals: [{
          fieldId: "move_horizon",
          typedValue: "within_3_months",
          messageId: COMMAND_1,
          sourceSpan: { start: 0, end: 5 },
        }],
        nextQuestion: "When?",
      },
    });
    const nextParticipantId = vi.fn(() => "40000000-0000-4000-8000-000000000001");
    const nextAssistantMessageId = vi.fn(() => ASSISTANT_MESSAGE);
    const nextCompletionCommandId = vi.fn(() => COMMAND_2);

    await expect(extractMessage({
      schemaVersion: "onboarding-message-command@1",
      session: original,
      message: { messageId: USER_MESSAGE, role: "user", text: "Hello" },
    }, { model: localModel, nextParticipantId, nextAssistantMessageId, nextCompletionCommandId },
    new AbortController().signal)).rejects.toThrow("Invalid onboarding model contract");
    expect(original).toEqual(emptySession());
    expect(nextParticipantId).not.toHaveBeenCalled();
    expect(nextAssistantMessageId).not.toHaveBeenCalled();
    expect(nextCompletionCommandId).not.toHaveBeenCalled();
  });

  test("returns only deterministic corroborated blockers and keeps the caller session intact", async () => {
    const session = emptySession();
    const localModel = model({
      review: {
        schemaVersion: "onboarding-review-output@1",
        issues: [
          { fieldId: "current_location", reasonCode: "required_empty" },
          { fieldId: "savings", reasonCode: "invalid_value" },
        ],
      },
    });
    const replayCommitted = vi.fn(async () => receipt);
    const completion = { replayCommitted, commitOrReplay: vi.fn() };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    const result = await completeOnboarding({ schemaVersion: "onboarding-continue-command@1", session }, {
      model: localModel,
      completion,
      frontier,
    }, new AbortController().signal);

    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.session).toEqual(session);
      expect(result.issues[0]).toEqual({ fieldId: "current_location", reasonCode: "required_empty" });
      expect(result.followUpQuestion).toBe("Заполните выделенные поля.");
    }
    expect(replayCommitted).not.toHaveBeenCalled();
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
    expect(session).toEqual(emptySession());
  });

  test("keeps deterministic blockers when the model review is unavailable", async () => {
    const replayCommitted = vi.fn(async () => receipt);
    const completion = { replayCommitted, commitOrReplay: vi.fn() };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    const result = await completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: emptySession(),
    }, {
      model: model({ reviewError: new OnboardingModelError("onboarding_model_runtime_failed", "codex_timeout") }),
      completion,
      frontier,
    }, new AbortController().signal);

    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.issues[0]).toEqual({ fieldId: "current_location", reasonCode: "required_empty" });
    }
    expect(replayCommitted).not.toHaveBeenCalled();
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
  });

  test("replays an exact durable completion before model review and launches its fixed receipt", async () => {
    // Break caught: asking the model again after the same completion command became durable.
    const session = completeSession();
    const durableReceipt = Object.freeze({
      ...receipt,
      completionCommandId: session.completionCommandId,
    });
    const replayCommitted = vi.fn(async () => durableReceipt);
    const commitOrReplay = vi.fn(async () => {
      throw new Error("writer_must_not_run");
    });
    const prepareFromOnboardingReceipt = vi.fn(async () => prepared);
    const localModel = model({ reviewError: new Error("model_must_not_run") });
    const review = vi.spyOn(localModel, "review");

    const result = await completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session,
    }, {
      model: localModel,
      completion: { replayCommitted, commitOrReplay },
      frontier: { prepareFromOnboardingReceipt },
    }, new AbortController().signal);

    expect(result).toEqual({ kind: "launched", receipt: durableReceipt, prepared });
    expect(replayCommitted).toHaveBeenCalledOnce();
    expect(replayCommitted).toHaveBeenCalledWith(expect.objectContaining({
      completionCommandId: session.completionCommandId,
      confirmed: expect.objectContaining({ schemaVersion: "confirmed-onboarding-values@1" }),
      versions: localModel.versions,
    }));
    expect(review).not.toHaveBeenCalled();
    expect(commitOrReplay).not.toHaveBeenCalled();
    expect(prepareFromOnboardingReceipt).toHaveBeenCalledWith(durableReceipt);
  });

  test("reviews and commits once when no durable completion exists", async () => {
    // Break caught: skipping the read probe or invoking the model more than once after a replay miss.
    const session = completeSession();
    const durableReceipt = Object.freeze({
      ...receipt,
      completionCommandId: session.completionCommandId,
    });
    const replayCommitted = vi.fn(async () => undefined);
    const commitOrReplay = vi.fn(async () => durableReceipt);
    const prepareFromOnboardingReceipt = vi.fn(async () => prepared);
    const localModel = model();
    const review = vi.spyOn(localModel, "review");

    const result = await completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session,
    }, {
      model: localModel,
      completion: { replayCommitted, commitOrReplay },
      frontier: { prepareFromOnboardingReceipt },
    }, new AbortController().signal);

    expect(result).toEqual({ kind: "launched", receipt: durableReceipt, prepared });
    expect(replayCommitted).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
    expect(commitOrReplay).toHaveBeenCalledOnce();
    expect(replayCommitted.mock.invocationCallOrder[0])
      .toBeLessThan(review.mock.invocationCallOrder[0] ?? 0);
    expect(review.mock.invocationCallOrder[0])
      .toBeLessThan(commitOrReplay.mock.invocationCallOrder[0] ?? 0);
  });

  test("commits timestamp-free confirmed values once, publishes unresolved yellow provenance, then prepares from its receipt", async () => {
    const completed = completeSession();
    const session = applyGuardedExtraction({
      session: completed,
      userMessage: { messageId: USER_MESSAGE, role: "user", text: "I live in Saint Petersburg." },
      extraction: {
        proposals: [{
          kind: "non_participant_field",
          fieldId: "current_location",
          normalizedValue: { countryCode: "RU", city: "Saint Petersburg" },
        }],
        nextQuestion: "Anything else?",
      },
      nextParticipantId: () => "40000000-0000-4000-8000-000000000001",
      nextAssistantMessageId: () => ASSISTANT_MESSAGE,
      nextCompletionCommandId: () => "10000000-0000-4000-8000-000000000099",
    });
    const committedInputs: unknown[] = [];
    const commitOrReplay = vi.fn(async (input: unknown) => {
      committedInputs.push(input);
      return receipt;
    });
    const replayCommitted = vi.fn(async () => undefined);
    const prepareFromOnboardingReceipt = vi.fn(async () => prepared);
    const localModel = model();
    const review = vi.spyOn(localModel, "review");

    const result = await completeOnboarding({ schemaVersion: "onboarding-continue-command@1", session }, {
      model: localModel,
      completion: { replayCommitted, commitOrReplay },
      frontier: { prepareFromOnboardingReceipt },
    }, new AbortController().signal);

    expect(result).toEqual({ kind: "launched", receipt, prepared });
    expect(review).toHaveBeenCalledOnce();
    expect(commitOrReplay).toHaveBeenCalledWith(expect.objectContaining({
      completionCommandId: session.completionCommandId,
      versions: localModel.versions,
      confirmed: expect.objectContaining({ schemaVersion: "confirmed-onboarding-values@1" }),
    }));
    const committed = committedInputs[0] as {
      readonly confirmed: { readonly provenance: { readonly fields: readonly unknown[] } };
    };
    expect(JSON.stringify(committed?.confirmed)).not.toContain("confirmedAt");
    expect(committed?.confirmed.provenance.fields[0]).toMatchObject({
      fieldId: "current_location",
      reviewState: "model_overwrite_unreviewed",
    });
    expect(prepareFromOnboardingReceipt).toHaveBeenCalledWith(receipt);
    expect(commitOrReplay.mock.invocationCallOrder[0]).toBeLessThan(prepareFromOnboardingReceipt.mock.invocationCallOrder[0] ?? 0);
  });

  test("surfaces an untyped review failure without writing or handoff", async () => {
    const completion = { commitOrReplay: vi.fn() };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };
    await expect(completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: completeSession(),
    }, {
      model: model({ reviewError: new Error("secret model transcript") }),
      completion: { replayCommitted: vi.fn(async () => undefined), ...completion },
      frontier,
    }, new AbortController().signal)).rejects.toThrow("secret model transcript");
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
  });

  test("commits deterministic complete values when typed model review is unavailable", async () => {
    const typedError = new OnboardingModelError("onboarding_model_runtime_failed", "codex_timeout");
    const completion = {
      replayCommitted: vi.fn(async () => undefined),
      commitOrReplay: vi.fn(async () => receipt),
    };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    await expect(completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: completeSession(),
    }, {
      model: model({ reviewError: typedError }),
      completion,
      frontier,
    }, new AbortController().signal)).resolves.toEqual({ kind: "launched", receipt, prepared: undefined });
    expect(completion.commitOrReplay).toHaveBeenCalledOnce();
    expect(frontier.prepareFromOnboardingReceipt).toHaveBeenCalledOnce();
  });

  test("propagates review integrity failure without completion or Frontier writes", async () => {
    const integrity = new OnboardingModelError("onboarding_model_integrity_failed");
    const completion = {
      replayCommitted: vi.fn(async () => undefined),
      commitOrReplay: vi.fn(),
    };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    await expect(completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: completeSession(),
    }, {
      model: model({ reviewError: integrity }),
      completion,
      frontier,
    }, new AbortController().signal)).rejects.toBe(integrity);
    expect(completion.replayCommitted).toHaveBeenCalledOnce();
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
  });

  test("closes malformed review output before completion or Frontier writes", async () => {
    const completion = {
      replayCommitted: vi.fn(async () => undefined),
      commitOrReplay: vi.fn(),
    };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    await expect(completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: completeSession(),
    }, {
      model: model({ review: { schemaVersion: "onboarding-review-output@1", issues: [{ fieldId: "unknown" }] } }),
      completion,
      frontier,
    }, new AbortController().signal)).rejects.toThrow("Invalid onboarding model output");
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
  });

  test("surfaces a Frontier handoff failure after the receipt becomes durable and reuses the command on retry", async () => {
    const replayCommitted = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(receipt);
    const commitOrReplay = vi.fn(async () => receipt);
    const handoff = new Error("frontier unavailable");
    const prepareFromOnboardingReceipt = vi.fn()
      .mockRejectedValueOnce(handoff)
      .mockResolvedValueOnce(prepared);
    const ports = {
      model: model(),
      completion: { replayCommitted, commitOrReplay },
      frontier: { prepareFromOnboardingReceipt },
    };
    const review = vi.spyOn(ports.model, "review");
    const command = { schemaVersion: "onboarding-continue-command@1" as const, session: completeSession() };

    await expect(completeOnboarding(command, ports, new AbortController().signal)).rejects.toBe(handoff);
    await expect(completeOnboarding(command, ports, new AbortController().signal)).resolves.toEqual({
      kind: "launched", receipt, prepared,
    });
    expect(replayCommitted).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledOnce();
    expect(commitOrReplay).toHaveBeenCalledOnce();
    expect(commitOrReplay).toHaveBeenCalledWith(expect.objectContaining({
      completionCommandId: command.session.completionCommandId,
    }));
  });

  test("honors a native abort before model, completion, or Frontier work and exposes no retry parameter", async () => {
    const controller = new AbortController();
    const aborted = new DOMException("The operation was aborted", "AbortError");
    controller.abort(aborted);
    const localModel = model();
    const review = vi.spyOn(localModel, "review");
    const completion = {
      replayCommitted: vi.fn(async () => undefined),
      commitOrReplay: vi.fn(),
    };
    const frontier = { prepareFromOnboardingReceipt: vi.fn() };

    await expect(completeOnboarding({
      schemaVersion: "onboarding-continue-command@1",
      session: completeSession(),
    }, { model: localModel, completion, frontier }, controller.signal)).rejects.toBe(aborted);
    expect(review).not.toHaveBeenCalled();
    expect(completion.replayCommitted).not.toHaveBeenCalled();
    expect(completion.commitOrReplay).not.toHaveBeenCalled();
    expect(frontier.prepareFromOnboardingReceipt).not.toHaveBeenCalled();
    expect(completeOnboarding.length).toBe(3);
  });
});
