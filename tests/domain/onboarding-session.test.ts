import { describe, expect, test, vi } from "vitest";

import {
  projectQuestionnaireForModel,
  type GuardedExtraction,
} from "../../src/decision/onboarding-model-contract";
import {
  applyGuardedExtraction,
  applySessionFieldChange,
  createOnboardingSession,
  ONBOARDING_SESSION_LIMITS,
  reconstructOnboardingSessionState,
  type OnboardingSessionState,
} from "../../src/decision/onboarding-session";
import type { OnboardingFieldId } from "../../src/decision/onboarding-questionnaire";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const SPOUSE_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_ID = "00000000-0000-4000-8000-000000000003";
const COMMAND_1 = "10000000-0000-4000-8000-000000000001";
const COMMAND_2 = "10000000-0000-4000-8000-000000000002";
const COMMAND_3 = "10000000-0000-4000-8000-000000000003";
const COMMAND_4 = "10000000-0000-4000-8000-000000000004";
const USER_MESSAGE_1 = "20000000-0000-4000-8000-000000000001";
const USER_MESSAGE_2 = "20000000-0000-4000-8000-000000000002";
const USER_MESSAGE_3 = "20000000-0000-4000-8000-000000000003";
const ASSISTANT_MESSAGE_1 = "30000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_2 = "30000000-0000-4000-8000-000000000002";
const ASSISTANT_MESSAGE_3 = "30000000-0000-4000-8000-000000000003";

function createSession(): OnboardingSessionState {
  return createOnboardingSession({
    nextParticipantId: () => SELF_ID,
    nextCompletionCommandId: () => COMMAND_1,
  });
}

function field(session: OnboardingSessionState, fieldId: OnboardingFieldId) {
  const result = session.draft.fields.find((candidate) => candidate.fieldId === fieldId);
  if (result === undefined) throw new Error(`missing ${fieldId}`);
  return result;
}

function firstCoupleExtraction(): GuardedExtraction {
  return {
    proposals: [
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "remote_continuation",
        normalizedValue: "yes",
      },
      {
        kind: "participant_roster",
        roster: [
          { descriptor: "self", relationship: "self" },
          { descriptor: "companion.0", relationship: "spouse" },
        ],
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "current_work",
        normalizedValue: { status: "employment", occupation: "Engineer" },
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "citizenships",
        normalizedValue: ["RU"],
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "passport",
        normalizedValue: "absent",
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "monthly_income",
        normalizedValue: { amount: "0", currency: "EUR", basis: "net" },
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "education",
        normalizedValue: { level: "higher", field: "Physics" },
      },
      {
        kind: "participant_leaf",
        descriptor: "companion.0",
        leafId: "relevant_experience_years",
        normalizedValue: 0,
      },
    ],
    nextQuestion: "Где вы живёте сейчас?",
  };
}

function applyExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly extraction: GuardedExtraction;
  readonly participantId?: string;
  readonly completionCommandId?: string;
  readonly messageId?: string;
  readonly assistantMessageId?: string;
}) {
  return applyGuardedExtraction({
    session: input.session,
    userMessage: {
      messageId: input.messageId ?? USER_MESSAGE_1,
      role: "user",
      text: "Я переезжаю с супругой",
    },
    extraction: input.extraction,
    nextParticipantId: () => input.participantId ?? SPOUSE_ID,
    nextCompletionCommandId: () => input.completionCommandId ?? COMMAND_2,
    nextAssistantMessageId: () => input.assistantMessageId ?? ASSISTANT_MESSAGE_1,
  });
}

describe("onboarding session", () => {
  test("creates one frozen browser-safe session with stable self and completion command", () => {
    const session = createSession();
    expect(session).toMatchObject({
      sessionVersion: "onboarding-session@1",
      completionCommandId: COMMAND_1,
      messages: [],
      descriptorBindings: { self: SELF_ID },
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.descriptorBindings)).toBe(true);
  });

  test("applies roster, work, then remote leaves independent of proposal order", () => {
    const participantAllocator = vi.fn(() => SPOUSE_ID);
    const session = applyGuardedExtraction({
      session: createSession(),
      userMessage: { messageId: USER_MESSAGE_1, role: "user", text: "Я переезжаю с супругой" },
      extraction: firstCoupleExtraction(),
      nextParticipantId: participantAllocator,
      nextCompletionCommandId: () => COMMAND_2,
      nextAssistantMessageId: () => ASSISTANT_MESSAGE_1,
    });

    expect(participantAllocator).toHaveBeenCalledTimes(1);
    expect(session.completionCommandId).toBe(COMMAND_2);
    expect(session.descriptorBindings).toEqual({ self: SELF_ID, "companion.0": SPOUSE_ID });
    expect(field(session, `participants.${SPOUSE_ID}.remote_continuation`)).toMatchObject({
      applicability: "required",
      normalizedValue: "yes",
      origin: "model",
    });
    expect(field(session, `participants.${SPOUSE_ID}.monthly_income`).normalizedValue).toEqual({
      amount: "0",
      currency: "EUR",
      basis: "net",
    });
    expect(session.messages).toEqual([
      { messageId: USER_MESSAGE_1, role: "user", text: "Я переезжаю с супругой" },
      { messageId: ASSISTANT_MESSAGE_1, role: "assistant", text: "Где вы живёте сейчас?" },
    ]);
    expect(session.draft.fields.every(({ fieldId }) =>
      !fieldId.includes("self") && !fieldId.includes("companion."))).toBe(true);
  });

  test("keeps the completion command for message-only updates and rotates once per mutation", () => {
    const nextCommand = vi.fn(() => COMMAND_2);
    const messageOnly = applyGuardedExtraction({
      session: createSession(),
      userMessage: { messageId: USER_MESSAGE_1, role: "user", text: "Расскажу позже" },
      extraction: { proposals: [], nextQuestion: "Что для вас важно?" },
      nextParticipantId: () => SPOUSE_ID,
      nextCompletionCommandId: nextCommand,
      nextAssistantMessageId: () => ASSISTANT_MESSAGE_1,
    });
    expect(messageOnly.completionCommandId).toBe(COMMAND_1);
    expect(nextCommand).not.toHaveBeenCalled();

    const manual = applySessionFieldChange({
      session: messageOnly,
      change: {
        kind: "manual_set",
        fieldId: `participants.${SELF_ID}.current_work`,
        rawInput: { status: "employment" },
      },
      nextCompletionCommandId: () => COMMAND_2,
    });
    expect(manual.completionCommandId).toBe(COMMAND_2);

    const yellow = applyExtraction({
      session: manual,
      extraction: {
        proposals: [{
          kind: "participant_leaf",
          descriptor: "self",
          leafId: "current_work",
          normalizedValue: { status: "self_employment" },
        }],
        nextQuestion: "Продолжим?",
      },
      completionCommandId: COMMAND_3,
      messageId: USER_MESSAGE_2,
      assistantMessageId: ASSISTANT_MESSAGE_2,
    });
    expect(field(yellow, `participants.${SELF_ID}.current_work`).overwrite).toMatchObject({
      reviewState: "model_overwrite_unreviewed",
    });
    expect(yellow.completionCommandId).toBe(COMMAND_3);

    const confirmed = applySessionFieldChange({
      session: yellow,
      change: { kind: "confirm_model_overwrite", fieldId: `participants.${SELF_ID}.current_work` },
      nextCompletionCommandId: () => COMMAND_4,
    });
    expect(confirmed.completionCommandId).toBe(COMMAND_4);
    expect(field(confirmed, `participants.${SELF_ID}.current_work`).overwrite).toMatchObject({
      reviewState: "model_overwrite_confirmed",
    });
  });

  test("clears inapplicable values and reconciles only unambiguous model roster tails", () => {
    const couple = applyExtraction({ session: createSession(), extraction: firstCoupleExtraction() });
    const notWorking = applyExtraction({
      session: couple,
      extraction: {
        proposals: [{
          kind: "participant_leaf",
          descriptor: "companion.0",
          leafId: "current_work",
          normalizedValue: { status: "not_working" },
        }],
        nextQuestion: "Что ещё?",
      },
      completionCommandId: COMMAND_3,
      messageId: USER_MESSAGE_2,
      assistantMessageId: ASSISTANT_MESSAGE_2,
    });
    expect(field(notWorking, `participants.${SPOUSE_ID}.remote_continuation`)).toMatchObject({
      applicability: "not_applicable",
      normalizedValue: null,
      overwrite: null,
    });

    const removed = applyExtraction({
      session: notWorking,
      extraction: {
        proposals: [{
          kind: "participant_roster",
          roster: [{ descriptor: "self", relationship: "self" }],
        }],
        nextQuestion: "Переезжаете один?",
      },
      completionCommandId: COMMAND_4,
      messageId: USER_MESSAGE_3,
      assistantMessageId: ASSISTANT_MESSAGE_3,
    });
    expect(removed.descriptorBindings).toEqual({ self: SELF_ID });
    expect(removed.draft.fields.some(({ fieldId }) => fieldId.includes(SPOUSE_ID))).toBe(false);

    expect(() => applyExtraction({
      session: couple,
      extraction: {
        proposals: [{
          kind: "participant_roster",
          roster: [
            { descriptor: "self", relationship: "self" },
            { descriptor: "companion.0", relationship: "other_family" },
          ],
        }],
        nextQuestion: "Кто едет?",
      },
      completionCommandId: COMMAND_3,
      messageId: USER_MESSAGE_2,
      assistantMessageId: ASSISTANT_MESSAGE_2,
    })).toThrow(TypeError);
    expect(couple.descriptorBindings).toEqual({ self: SELF_ID, "companion.0": SPOUSE_ID });
  });

  test("manual roster reorder preserves participant IDs and rebuilds descriptor bindings", () => {
    const couple = applyExtraction({ session: createSession(), extraction: firstCoupleExtraction() });
    const three = applyExtraction({
      session: couple,
      extraction: {
        proposals: [{
          kind: "participant_roster",
          roster: [
            { descriptor: "self", relationship: "self" },
            { descriptor: "companion.0", relationship: "spouse" },
            { descriptor: "companion.1", relationship: "other_family" },
          ],
        }],
        nextQuestion: "Кто ещё?",
      },
      participantId: OTHER_ID,
      completionCommandId: COMMAND_3,
      messageId: USER_MESSAGE_2,
      assistantMessageId: ASSISTANT_MESSAGE_2,
    });
    const reordered = applySessionFieldChange({
      session: three,
      change: {
        kind: "manual_set",
        fieldId: "participants",
        rawInput: [
          { participantId: SELF_ID, relationship: "self" },
          { participantId: OTHER_ID, relationship: "other_family" },
          { participantId: SPOUSE_ID, relationship: "spouse" },
        ],
      },
      nextCompletionCommandId: () => COMMAND_4,
    });
    expect(reordered.descriptorBindings).toEqual({
      self: SELF_ID,
      "companion.0": OTHER_ID,
      "companion.1": SPOUSE_ID,
    });

    const participantAllocator = vi.fn(() => "00000000-0000-4000-8000-000000000099");
    const commandAllocator = vi.fn(() => COMMAND_4);
    const messageAllocator = vi.fn(() => ASSISTANT_MESSAGE_3);
    expect(() => applyGuardedExtraction({
      session: three,
      userMessage: { messageId: USER_MESSAGE_3, role: "user", text: "едем без супруги" },
      extraction: {
        proposals: [{
          kind: "participant_roster",
          roster: [
            { descriptor: "self", relationship: "self" },
            { descriptor: "companion.0", relationship: "other_family" },
          ],
        }],
        nextQuestion: "Кто едет?",
      },
      nextParticipantId: participantAllocator,
      nextAssistantMessageId: messageAllocator,
      nextCompletionCommandId: commandAllocator,
    })).toThrow(TypeError);
    expect(participantAllocator).not.toHaveBeenCalled();
    expect(messageAllocator).not.toHaveBeenCalled();
    expect(commandAllocator).not.toHaveBeenCalled();
  });

  test("projects no command, internal IDs, raw input, overwrite, or transcript text", () => {
    const session = applySessionFieldChange({
      session: createSession(),
      change: { kind: "manual_set", fieldId: "move_horizon", rawInput: "-" },
      nextCompletionCommandId: () => COMMAND_2,
    });
    const projection = projectQuestionnaireForModel(session);
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(COMMAND_1);
    expect(serialized).not.toContain(SELF_ID);
    expect(serialized).not.toContain("rawInput");
    expect(serialized).not.toContain("overwrite");
    expect(serialized).not.toContain("messages");
    expect(serialized).not.toContain('"-"');
    expect(serialized).toContain("participants.self.passport");
  });

  test("rejects hostile, rebound, oversized, and non-dense sessions before mutation", () => {
    const original = structuredClone(createSession());
    const reconstructed = reconstructOnboardingSessionState(original);
    expect(reconstructed).not.toBe(original);
    expect(Object.isFrozen(reconstructed)).toBe(true);

    const rebound = structuredClone(original) as unknown as {
      descriptorBindings: Record<string, string>;
    };
    rebound.descriptorBindings.self = SPOUSE_ID;
    expect(() => reconstructOnboardingSessionState(rebound)).toThrow(TypeError);

    const sparse = structuredClone(original) as unknown as { messages: unknown[] };
    sparse.messages.length = 2;
    sparse.messages[1] = { messageId: USER_MESSAGE_1, role: "user", text: "hello" };
    expect(() => reconstructOnboardingSessionState(sparse)).toThrow(TypeError);

    const oversized = structuredClone(original) as unknown as { messages: unknown[] };
    oversized.messages = Array.from({ length: ONBOARDING_SESSION_LIMITS.maxMessages + 1 }, (_, index) => ({
      messageId: `20000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      role: "user",
      text: "hello",
    }));
    expect(() => reconstructOnboardingSessionState(oversized)).toThrow(TypeError);

    const oversizedText = structuredClone(original) as unknown as { messages: unknown[] };
    oversizedText.messages = [{
      messageId: USER_MESSAGE_1,
      role: "user",
      text: "я".repeat(ONBOARDING_SESSION_LIMITS.maxMessageUtf8Bytes),
    }];
    expect(() => reconstructOnboardingSessionState(oversizedText)).toThrow(TypeError);

    const withGetter = structuredClone(original);
    Object.defineProperty(withGetter, "completionCommandId", {
      enumerable: true,
      get: () => COMMAND_1,
    });
    expect(() => reconstructOnboardingSessionState(withGetter)).toThrow(TypeError);

    const withConversation = applyExtraction({
      session: createSession(),
      extraction: { proposals: [], nextQuestion: "Продолжим?" },
    });
    const collidingCommand = vi.fn(() => COMMAND_2);
    expect(() => applySessionFieldChange({
      session: withConversation,
      change: {
        kind: "manual_set",
        fieldId: "participants",
        rawInput: [
          { participantId: SELF_ID, relationship: "self" },
          { participantId: USER_MESSAGE_1, relationship: "spouse" },
        ],
      },
      nextCompletionCommandId: collidingCommand,
    })).toThrow(TypeError);
    expect(collidingCommand).not.toHaveBeenCalled();

    expect(() => applySessionFieldChange({
      session: withConversation,
      change: {
        kind: "manual_set",
        fieldId: "participants",
        rawInput: [
          { participantId: SELF_ID, relationship: "self" },
          { participantId: OTHER_ID, relationship: "spouse" },
        ],
      },
      nextCompletionCommandId: () => OTHER_ID,
    })).toThrow(TypeError);

    const aggregateOverflow = structuredClone(original) as unknown as { messages: unknown[] };
    aggregateOverflow.messages = Array.from({ length: 15 }, (_, index) => ({
      messageId: `20000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      role: "user",
      text: "a".repeat(ONBOARDING_SESSION_LIMITS.maxMessageUtf8Bytes),
    }));
    expect(() => reconstructOnboardingSessionState(aggregateOverflow)).toThrow(TypeError);
  });
});
