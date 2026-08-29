import {
  OnboardingModelError,
  type CompleteOnboardingResult,
  type ConfirmedOnboardingFrontierPort,
  type ContinueOnboardingCommand,
  type ExtractOnboardingMessageCommand,
  type OnboardingCompletionPort,
  type OnboardingExtractionAcceptance,
  type OnboardingModelPort,
} from "./onboarding-contracts";
import {
  corroborateModelReview,
  guardExtraction,
  isOnboardingGuardContractError,
  projectQuestionnaireForModel,
} from "../decision/onboarding-model-contract";
import {
  confirmOnboardingValues,
  reviewQuestionnaire,
  type QuestionnaireIssue,
} from "../decision/onboarding-questionnaire";
import {
  applyGuardedExtraction,
  ONBOARDING_SESSION_LIMITS,
  reconstructOnboardingSessionState,
  type OnboardingSessionState,
  type SessionMessage,
} from "../decision/onboarding-session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FOLLOW_UP_QUESTION = "Заполните выделенные поля.";
const EXTRACTION_ACCEPTED = Object.freeze({ kind: "accepted" as const });
const EXTRACTION_GUARD_RETRY = Object.freeze({
  kind: "retryable" as const,
  reason: "guard_invalid" as const,
});

export function reconstructExtractOnboardingMessageCommand(
  value: unknown,
): ExtractOnboardingMessageCommand {
  const command = exactRecord(value, ["schemaVersion", "session", "message"]);
  if (command.schemaVersion !== "onboarding-message-command@1") throw invalidCommand();
  const session = reconstructOnboardingSessionState(command.session);
  const message = reconstructUserMessage(command.message);
  assertUserMessageAdmissible(session, message);
  return freeze({
    schemaVersion: "onboarding-message-command@1" as const,
    session,
    message,
  });
}

export function reconstructContinueOnboardingCommand(value: unknown): ContinueOnboardingCommand {
  const command = exactRecord(value, ["schemaVersion", "session"]);
  if (command.schemaVersion !== "onboarding-continue-command@1") throw invalidCommand();
  return freeze({
    schemaVersion: "onboarding-continue-command@1" as const,
    session: reconstructOnboardingSessionState(command.session),
  });
}

export async function extractMessage(
  command: ExtractOnboardingMessageCommand,
  ports: {
    readonly model: OnboardingModelPort;
    readonly nextParticipantId: () => string;
    readonly nextAssistantMessageId: () => string;
    readonly nextCompletionCommandId: () => string;
  },
  signal: AbortSignal,
): Promise<OnboardingSessionState> {
  const current = reconstructExtractOnboardingMessageCommand(command);
  assertUserMessageAdmissible(current.session, current.message);
  abortIfNeeded(signal);
  let output;
  try {
    output = await ports.model.extract({
      message: current.message,
      questionnaire: projectQuestionnaireForModel(current.session),
      signal,
      acceptExtraction: (candidate) => acceptGuardedExtraction(
        current.session,
        current.message,
        candidate,
      ),
    });
    abortIfNeeded(signal);
  } catch (error) {
    if (!isFallbackModelError(error, signal)) throw error;
    output = Object.freeze({
      schemaVersion: "onboarding-model-output@1" as const,
      proposals: Object.freeze([]),
      nextQuestion: FOLLOW_UP_QUESTION,
    });
  }
  const extraction = guardExtraction({
    session: current.session,
    userMessage: current.message,
    rawModelOutput: output,
  });
  abortIfNeeded(signal);
  return applyGuardedExtraction({
    session: current.session,
    userMessage: current.message,
    extraction,
    nextParticipantId: ports.nextParticipantId,
    nextAssistantMessageId: ports.nextAssistantMessageId,
    nextCompletionCommandId: ports.nextCompletionCommandId,
  });
}

function acceptGuardedExtraction(
  session: OnboardingSessionState,
  message: SessionMessage,
  output: unknown,
): OnboardingExtractionAcceptance {
  try {
    guardExtraction({ session, userMessage: message, rawModelOutput: output });
    return EXTRACTION_ACCEPTED;
  } catch (error) {
    if (!isOnboardingGuardContractError(error)) throw error;
    return EXTRACTION_GUARD_RETRY;
  }
}

export async function completeOnboarding(
  command: ContinueOnboardingCommand,
  ports: {
    readonly model: OnboardingModelPort;
    readonly completion: OnboardingCompletionPort;
    readonly frontier: ConfirmedOnboardingFrontierPort;
  },
  signal: AbortSignal,
): Promise<CompleteOnboardingResult> {
  const current = reconstructContinueOnboardingCommand(command);
  abortIfNeeded(signal);
  const deterministicIssues = reviewQuestionnaire(current.session.draft).issues;
  const confirmed = deterministicIssues.length === 0
    ? confirmOnboardingValues(current.session.draft)
    : undefined;
  if (confirmed !== undefined) {
    abortIfNeeded(signal);
    const replayed = await ports.completion.replayCommitted({
      completionCommandId: current.session.completionCommandId,
      confirmed,
      versions: ports.model.versions,
    });
    abortIfNeeded(signal);
    if (replayed !== undefined) {
      const prepared = await ports.frontier.prepareFromOnboardingReceipt(replayed);
      abortIfNeeded(signal);
      return freeze({ kind: "launched" as const, receipt: replayed, prepared });
    }
  }
  let corroborated: readonly QuestionnaireIssue[];
  try {
    const output = await ports.model.review({
      questionnaire: projectQuestionnaireForModel(current.session),
      signal,
    });
    abortIfNeeded(signal);
    corroborated = corroborateModelReview({ session: current.session, rawModelOutput: output });
  } catch (error) {
    if (!isFallbackModelError(error, signal)) throw error;
    corroborated = Object.freeze([]);
  }
  abortIfNeeded(signal);
  const issues = canonicalIssueUnion(deterministicIssues, corroborated);
  if (issues.length > 0) {
    return freeze({
      kind: "blocked" as const,
      session: current.session,
      issues: issues as [QuestionnaireIssue, ...QuestionnaireIssue[]],
      followUpQuestion: FOLLOW_UP_QUESTION,
    });
  }

  const ready = confirmed ?? confirmOnboardingValues(current.session.draft);
  abortIfNeeded(signal);
  const receipt = await ports.completion.commitOrReplay({
    completionCommandId: current.session.completionCommandId,
    confirmed: ready,
    versions: ports.model.versions,
  });
  abortIfNeeded(signal);
  const prepared = await ports.frontier.prepareFromOnboardingReceipt(receipt);
  abortIfNeeded(signal);
  return freeze({ kind: "launched" as const, receipt, prepared });
}

function isFallbackModelError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  if (!(error instanceof OnboardingModelError) || error.code === "onboarding_model_aborted") return false;
  if (error.code === "onboarding_model_integrity_failed") return false;
  if (error.code === "onboarding_model_invalid") return true;
  return error.code === "onboarding_model_runtime_failed" && (
    error.runtimeCode === "codex_missing" ||
    error.runtimeCode === "codex_version_mismatch" ||
    error.runtimeCode === "codex_not_authenticated" ||
    error.runtimeCode === "codex_output_too_large" ||
    error.runtimeCode === "codex_event_limit" ||
    error.runtimeCode === "codex_timeout" ||
    error.runtimeCode === "codex_process_failed" ||
    error.runtimeCode === "codex_json_invalid" ||
    error.runtimeCode === "codex_rate_limited" ||
    error.runtimeCode === "codex_provider_transient"
  );
}

function reconstructUserMessage(value: unknown): SessionMessage {
  const message = exactRecord(value, ["messageId", "role", "text"]);
  if (
    typeof message.messageId !== "string" ||
    !UUID.test(message.messageId) ||
    message.role !== "user" ||
    typeof message.text !== "string" ||
    message.text.trim().length === 0 ||
    new TextEncoder().encode(message.text).byteLength > ONBOARDING_SESSION_LIMITS.maxMessageUtf8Bytes
  ) throw invalidCommand();
  return freeze({ messageId: message.messageId, role: "user" as const, text: message.text });
}

function assertUserMessageAdmissible(session: OnboardingSessionState, message: SessionMessage): void {
  if (session.messages.length + 2 > ONBOARDING_SESSION_LIMITS.maxMessages) throw invalidCommand();
  const ownedIds = new Set([
    session.completionCommandId,
    ...session.messages.map(({ messageId }) => messageId),
    ...Object.values(session.descriptorBindings),
  ]);
  if (ownedIds.has(message.messageId)) throw invalidCommand();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0) throw invalidCommand();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || !keys.every((key) => key in descriptors)) {
    throw invalidCommand();
  }
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalidCommand();
    record[key] = descriptor.value;
  }
  return record;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function invalidCommand(): TypeError {
  return new TypeError("Invalid onboarding command");
}

function canonicalIssueUnion(
  deterministic: readonly QuestionnaireIssue[],
  corroborated: readonly QuestionnaireIssue[],
): readonly QuestionnaireIssue[] {
  const issues = new Map<string, QuestionnaireIssue>();
  for (const issue of deterministic) issues.set(issueKey(issue), issue);
  for (const issue of corroborated) if (!issues.has(issueKey(issue))) issues.set(issueKey(issue), issue);
  return [...issues.values()];
}

function issueKey(issue: QuestionnaireIssue): string {
  return `${issue.fieldId}:${issue.reasonCode}`;
}
