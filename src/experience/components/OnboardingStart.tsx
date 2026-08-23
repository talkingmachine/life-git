"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import type { CompleteOnboardingResult } from "../../application/onboarding-contracts";
import {
  QUESTIONNAIRE_ISSUE_CODES,
  type ParticipantRelationship,
} from "../../decision/onboarding-catalog";
import {
  parseOnboardingFieldIdForDecision,
  type OnboardingFieldId,
  type ParticipantId,
  type ParticipantRosterValue,
  type QuestionnaireFieldChange,
  type QuestionnaireIssue,
} from "../../decision/onboarding-questionnaire";
import {
  applySessionFieldChange,
  createOnboardingSession,
  reconstructOnboardingSessionState,
  type OnboardingSessionState,
  type SessionMessage,
} from "../../decision/onboarding-session";
import {
  createPlaceFrontierStreamHandoff,
  openPlaceFrontierStreamResponse,
  type PlaceFrontierStreamHandoff,
} from "../place-frontier-stream";
import { replacePlaceFrontierRunUrl } from "../run-url";
import { OnboardingChat, type OnboardingChatItem } from "./OnboardingChat";
import { OnboardingQuestionnaire } from "./OnboardingQuestionnaire";
import {
  PlaceFrontierJourney,
  type PlaceFrontierLiveInput,
} from "./PlaceFrontierJourney";
import { ProductShell } from "./ProductShell";
import { NEUTRAL_WORKSPACE_GLOBE_PRESENTATION } from "./WorkspaceGlobe";

const DISCLOSURE = "Содержимое анкеты передаётся в OpenAI через установленный Codex CLI с вашим текущим личным входом ChatGPT/Codex. API-ключ не нужен; обработка моделью не является локальной.";
const FOLLOW_UP = "Заполните выделенные поля.";
const MESSAGE_ERROR = "Не удалось обработать сообщение. Анкета и текст сохранены.";
const CONTINUE_ERROR = "Не удалось проверить анкету. Анкета сохранена.";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

interface FollowUpItem {
  readonly afterMessageCount: number;
  readonly key: number;
  readonly text: string;
}

interface EditingState {
  readonly kind: "editing";
  readonly session: OnboardingSessionState;
  readonly composer: string;
  readonly issues: readonly QuestionnaireIssue[];
  readonly followUps: readonly FollowUpItem[];
  readonly focusRequest?: {
    readonly fieldId: OnboardingFieldId;
    readonly sequence: number;
  };
  readonly request?: "message" | "continue";
  readonly error?: string;
}

interface FrontierState {
  readonly kind: "frontier";
  readonly live: PlaceFrontierLiveInput;
}

type OnboardingScreen = EditingState | FrontierState;

type EditingAction =
  | { readonly type: "composer_changed"; readonly value: string }
  | { readonly type: "request_started"; readonly request: "message" | "continue" }
  | { readonly type: "request_failed"; readonly message: string }
  | { readonly type: "message_succeeded"; readonly session: OnboardingSessionState }
  | {
      readonly type: "field_changed";
      readonly change: QuestionnaireFieldChange;
      readonly completionCommandId: string;
    }
  | {
      readonly type: "blocked";
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
    }
  | { readonly type: "frontier_started"; readonly live: PlaceFrontierLiveInput };

function nextUuid(): string {
  return crypto.randomUUID();
}

function initialScreen(): OnboardingScreen {
  return {
    kind: "editing",
    session: createOnboardingSession({
      nextParticipantId: nextUuid,
      nextCompletionCommandId: nextUuid,
    }),
    composer: "",
    issues: [],
    followUps: [],
  };
}

function reduceScreen(state: OnboardingScreen, action: EditingAction): OnboardingScreen {
  if (state.kind === "frontier") return state;
  switch (action.type) {
    case "composer_changed":
      if (state.request !== undefined) return state;
      return { ...state, composer: action.value, error: undefined };
    case "request_started":
      if (state.request !== undefined) return state;
      return { ...state, request: action.request, error: undefined };
    case "request_failed":
      return { ...state, request: undefined, error: action.message };
    case "message_succeeded":
      return {
        ...state,
        session: action.session,
        composer: "",
        issues: [],
        request: undefined,
        error: undefined,
        focusRequest: undefined,
      };
    case "field_changed":
      if (state.request !== undefined) return state;
      return {
        ...state,
        session: applySessionFieldChange({
          session: state.session,
          change: action.change,
          nextCompletionCommandId: () => action.completionCommandId,
        }),
        error: undefined,
      };
    case "blocked": {
      const key = state.followUps.length + 1;
      return {
        ...state,
        issues: action.issues,
        followUps: [
          ...state.followUps,
          { afterMessageCount: state.session.messages.length, key, text: FOLLOW_UP },
        ],
        focusRequest: { fieldId: action.issues[0].fieldId, sequence: key },
        request: undefined,
        error: undefined,
      };
    }
    case "frontier_started":
      return { kind: "frontier", live: action.live };
  }
}

function exactJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok || response.headers.get("content-type") !== JSON_CONTENT_TYPE) {
    throw new Error("invalid_onboarding_response");
  }
  return response.json() as Promise<unknown>;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readMessageSession(
  value: unknown,
  previous: OnboardingSessionState,
  outgoing: SessionMessage,
): OnboardingSessionState {
  const session = reconstructOnboardingSessionState(value);
  if (session.messages.length !== previous.messages.length + 2) {
    throw new Error("invalid_onboarding_message_transition");
  }
  if (!sameJson(session.messages.slice(0, previous.messages.length), previous.messages)) {
    throw new Error("invalid_onboarding_message_transition");
  }
  const appendedUser = session.messages[previous.messages.length];
  const appendedAssistant = session.messages[previous.messages.length + 1];
  if (!sameJson(appendedUser, outgoing) || appendedAssistant?.role !== "assistant") {
    throw new Error("invalid_onboarding_message_transition");
  }
  return session;
}

function plainExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw new Error("invalid_onboarding_blocked_response");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => key in descriptors)
  ) throw new Error("invalid_onboarding_blocked_response");
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_onboarding_blocked_response");
    }
    record[key] = descriptor.value;
  }
  return record;
}

function readBlockedResult(
  value: unknown,
  submitted: OnboardingSessionState,
): Extract<CompleteOnboardingResult, { readonly kind: "blocked" }> {
  const record = plainExactRecord(value, ["kind", "session", "issues", "followUpQuestion"]);
  if (record.kind !== "blocked" || record.followUpQuestion !== FOLLOW_UP) {
    throw new Error("invalid_onboarding_blocked_response");
  }
  const session = reconstructOnboardingSessionState(record.session);
  if (!sameJson(session, submitted) || !Array.isArray(record.issues) || record.issues.length === 0) {
    throw new Error("invalid_onboarding_blocked_response");
  }
  const fieldIds = new Set(session.draft.fields.map(({ fieldId }) => fieldId));
  const issueCodes = new Set<string>(QUESTIONNAIRE_ISSUE_CODES);
  const seenIssues = new Set<string>();
  const issues = record.issues.map((candidate) => {
    const issue = plainExactRecord(candidate, ["fieldId", "reasonCode"]);
    const fieldId = parseOnboardingFieldIdForDecision(issue.fieldId);
    if (!fieldIds.has(fieldId) || typeof issue.reasonCode !== "string" || !issueCodes.has(issue.reasonCode)) {
      throw new Error("invalid_onboarding_blocked_response");
    }
    const key = `${fieldId}:${issue.reasonCode}`;
    if (seenIssues.has(key)) throw new Error("invalid_onboarding_blocked_response");
    seenIssues.add(key);
    return { fieldId, reasonCode: issue.reasonCode } as QuestionnaireIssue;
  }) as unknown as readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
  return Object.freeze({
    kind: "blocked",
    session,
    issues,
    followUpQuestion: FOLLOW_UP,
  });
}

function questionnaireItems(
  session: OnboardingSessionState,
  followUps: readonly FollowUpItem[],
): readonly OnboardingChatItem[] {
  const result: OnboardingChatItem[] = [];
  for (let index = 0; index <= session.messages.length; index += 1) {
    for (const followUp of followUps) {
      if (followUp.afterMessageCount === index) {
        result.push({ key: `follow-up-${followUp.key}`, role: "assistant", text: followUp.text });
      }
    }
    const message = session.messages[index];
    if (message !== undefined) {
      result.push({ key: message.messageId, role: message.role, text: message.text });
    }
  }
  return result;
}

function roster(session: OnboardingSessionState): readonly ParticipantRosterValue[] {
  const field = session.draft.fields.find(({ fieldId }) => fieldId === "participants");
  return (field?.normalizedValue ?? []) as readonly ParticipantRosterValue[];
}

function freshUuidFor(
  session: OnboardingSessionState,
  additionallyForbidden: readonly string[] = [],
): string {
  const existing = new Set([
    session.completionCommandId,
    ...session.messages.map(({ messageId }) => messageId),
    ...roster(session).map(({ participantId }) => participantId),
    ...additionallyForbidden,
  ]);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = nextUuid();
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate an onboarding identifier");
}

function requestOptions(body: unknown, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

export function OnboardingStart() {
  const [screen, dispatch] = useReducer(reduceScreen, undefined, initialScreen);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const pendingHandoff = useRef<PlaceFrontierStreamHandoff | undefined>(undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort(new DOMException("Onboarding screen closed", "AbortError"));
      pendingHandoff.current?.cancel(new DOMException("Onboarding handoff closed", "AbortError"));
    };
  }, []);

  useEffect(() => {
    if (screen.kind === "frontier") pendingHandoff.current = screen.live.streamHandoff;
  }, [screen]);

  const editing = screen.kind === "editing" ? screen : undefined;
  const items = useMemo(
    () => editing === undefined ? [] : questionnaireItems(editing.session, editing.followUps),
    [editing],
  );
  const latestQuestion = [...items].reverse().find(({ role }) => role === "assistant")?.text;

  if (screen.kind === "frontier") {
    return <PlaceFrontierJourney mode={{ kind: "automatic-live", automatic: screen.live }} />;
  }

  const fieldChange = (
    change: QuestionnaireFieldChange,
    additionallyForbidden: readonly string[] = [],
  ) => {
    if (screen.request !== undefined || inFlight.current) return;
    dispatch({
      type: "field_changed",
      change,
      completionCommandId: freshUuidFor(screen.session, additionallyForbidden),
    });
  };
  const changeRoster = (participants: readonly ParticipantRosterValue[]) => fieldChange(
    { kind: "manual_set", fieldId: "participants", rawInput: participants },
    participants.map(({ participantId }) => participantId),
  );
  const addParticipant = (relationship: Exclude<ParticipantRelationship, "self">) => {
    if (screen.request !== undefined || inFlight.current) return;
    const participantId = freshUuidFor(screen.session) as ParticipantId;
    changeRoster([...roster(screen.session), { participantId, relationship }]);
  };
  const removeParticipant = (participantId: ParticipantId) => {
    changeRoster(roster(screen.session).filter((candidate) => candidate.participantId !== participantId));
  };
  const changeRelationship = (
    participantId: ParticipantId,
    relationship: Exclude<ParticipantRelationship, "self">,
  ) => {
    changeRoster(roster(screen.session).map((candidate) => candidate.participantId === participantId
      ? { ...candidate, relationship }
      : candidate));
  };

  const submitMessage = async () => {
    if (inFlight.current || screen.request !== undefined || screen.composer.trim().length === 0) return;
    inFlight.current = true;
    const submitted = screen.session;
    const message: SessionMessage = {
      messageId: freshUuidFor(submitted),
      role: "user",
      text: screen.composer,
    };
    const abortController = new AbortController();
    controller.current = abortController;
    dispatch({ type: "request_started", request: "message" });
    try {
      const response = await fetch("/api/onboarding/message", requestOptions({
        schemaVersion: "onboarding-message-command@1",
        session: submitted,
        message,
      }, abortController.signal));
      const next = readMessageSession(await exactJsonResponse(response), submitted, message);
      if (mounted.current) dispatch({ type: "message_succeeded", session: next });
    } catch {
      if (mounted.current) dispatch({ type: "request_failed", message: MESSAGE_ERROR });
    } finally {
      if (controller.current === abortController) controller.current = undefined;
      inFlight.current = false;
    }
  };

  const continueOnboarding = async () => {
    if (inFlight.current || screen.request !== undefined) return;
    inFlight.current = true;
    const submitted = screen.session;
    const abortController = new AbortController();
    controller.current = abortController;
    let handoff: PlaceFrontierStreamHandoff | undefined;
    dispatch({ type: "request_started", request: "continue" });
    try {
      const response = await fetch("/api/onboarding/continue", requestOptions({
        schemaVersion: "onboarding-continue-command@1",
        session: submitted,
      }, abortController.signal));
      if (response.headers.get("content-type") === JSON_CONTENT_TYPE) {
        const blocked = readBlockedResult(await exactJsonResponse(response), submitted);
        if (mounted.current) dispatch({ type: "blocked", issues: blocked.issues });
        return;
      }
      const opened = openPlaceFrontierStreamResponse(response);
      handoff = createPlaceFrontierStreamHandoff(opened.stream);
      pendingHandoff.current = handoff;
      if (!mounted.current) {
        handoff.cancel(new DOMException("Onboarding screen closed", "AbortError"));
        return;
      }
      replacePlaceFrontierRunUrl(opened.runId);
      const live: PlaceFrontierLiveInput = {
        runId: opened.runId,
        profileId: opened.profileId,
        preferenceProfileId: opened.preferenceProfileId,
        stream: opened.stream,
        streamHandoff: handoff,
      };
      dispatch({ type: "frontier_started", live });
    } catch (error) {
      handoff?.cancel(error);
      if (pendingHandoff.current === handoff) pendingHandoff.current = undefined;
      if (mounted.current) dispatch({ type: "request_failed", message: CONTINUE_ERROR });
    } finally {
      if (controller.current === abortController) controller.current = undefined;
      inFlight.current = false;
    }
  };

  const expanded = screen.session.messages.length > 0 || screen.followUps.length > 0;
  const busy = screen.request !== undefined;
  return (
    <ProductShell
      activeDestination="overview"
      globe={NEUTRAL_WORKSPACE_GLOBE_PRESENTATION}
      globeMode="onboarding"
      onDestinationChange={() => undefined}
      setup
    >
      <div className="onboarding" ref={chatRef}>
        <p className="onboarding__disclosure">{DISCLOSURE}</p>
        {latestQuestion === undefined ? null : (
          <button
            aria-label={`К последнему вопросу ${latestQuestion}`}
            className="onboarding__latest-question"
            onClick={() => {
              chatRef.current?.scrollIntoView({ block: "end" });
              composerRef.current?.focus();
            }}
            type="button"
          >
            <span>К последнему вопросу</span>
            <small>{latestQuestion}</small>
          </button>
        )}
        <div className="onboarding__questionnaire-pane">
          <OnboardingQuestionnaire
            disabled={busy}
            draft={screen.session.draft}
            expanded={expanded}
            focusRequest={screen.focusRequest}
            issues={screen.issues}
            onAddParticipant={addParticipant}
            onChange={fieldChange}
            onRemoveParticipant={removeParticipant}
            onRelationshipChange={changeRelationship}
          />
          <button
            className="onboarding__continue"
            disabled={busy}
            onClick={() => void continueOnboarding()}
            type="button"
          >
            {screen.request === "continue" ? "Проверяем…" : "Продолжить"}
          </button>
        </div>
        <OnboardingChat
          busy={busy}
          composer={screen.composer}
          composerRef={composerRef}
          error={screen.error}
          items={items}
          onComposerChange={(value) => dispatch({ type: "composer_changed", value })}
          onSubmit={() => void submitMessage()}
        />
      </div>
    </ProductShell>
  );
}
