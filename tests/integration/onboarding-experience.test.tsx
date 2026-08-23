// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { CompleteOnboardingResult } from
  "../../src/application/onboarding-contracts";
import {
  applySessionFieldChange,
  applyGuardedExtraction,
  createOnboardingSession,
  type OnboardingSessionState,
  type SessionMessage,
} from "../../src/decision/onboarding-session";
import type {
  OnboardingFieldId,
  QuestionnaireFieldChange,
} from "../../src/decision/onboarding-questionnaire";

const DISCLOSURE = "Содержимое анкеты передаётся в OpenAI через установленный Codex CLI с вашим текущим личным входом ChatGPT/Codex. API-ключ не нужен; обработка моделью не является локальной.";
const FOLLOW_UP = "Заполните выделенные поля.";
const SELF_ID = "00000000-0000-4000-8000-000000000001";
const COMPANION_ID = "00000000-0000-4000-8000-000000000002";
const INITIAL_COMMAND_ID = "10000000-0000-4000-8000-000000000001";
const MODEL_COMMAND_ID = "10000000-0000-4000-8000-000000000002";
const MANUAL_COMMAND_ID = "10000000-0000-4000-8000-000000000003";
const RESOLUTION_COMMAND_ID = "10000000-0000-4000-8000-000000000004";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_ID = "30000000-0000-4000-8000-000000000001";

function emptySession(): OnboardingSessionState {
  return createOnboardingSession({
    nextParticipantId: () => SELF_ID,
    nextCompletionCommandId: () => INITIAL_COMMAND_ID,
  });
}

function field(session: OnboardingSessionState, fieldId: OnboardingFieldId) {
  const result = session.draft.fields.find((candidate) => candidate.fieldId === fieldId);
  if (result === undefined) throw new Error(`Missing fixture field ${fieldId}`);
  return result;
}

function change(
  session: OnboardingSessionState,
  fieldId: OnboardingFieldId,
  rawInput: unknown,
  completionCommandId = MANUAL_COMMAND_ID,
): OnboardingSessionState {
  return applySessionFieldChange({
    session,
    change: { kind: "manual_set", fieldId, rawInput },
    nextCompletionCommandId: () => completionCommandId,
  });
}

function messageResult(input: {
  readonly command: {
    readonly session: OnboardingSessionState;
    readonly message: SessionMessage;
  };
  readonly proposals?: Parameters<typeof applyGuardedExtraction>[0]["extraction"]["proposals"];
  readonly nextQuestion?: string;
  readonly completionCommandId?: string;
}): OnboardingSessionState {
  return applyGuardedExtraction({
    session: input.command.session,
    userMessage: input.command.message,
    extraction: {
      proposals: input.proposals ?? [],
      nextQuestion: input.nextQuestion ?? "Когда вы планируете переезд?",
    },
    nextParticipantId: () => "00000000-0000-4000-8000-000000000002",
    nextAssistantMessageId: () => ASSISTANT_MESSAGE_ID,
    nextCompletionCommandId: () => input.completionCommandId ?? MODEL_COMMAND_ID,
  });
}

function expandedSession(): OnboardingSessionState {
  return messageResult({
    command: {
      session: emptySession(),
      message: { messageId: USER_MESSAGE_ID, role: "user", text: "Хочу переехать" },
    },
  });
}

function yellowSession(): OnboardingSessionState {
  const manual = change(expandedSession(), "move_horizon", "within_3_months", MODEL_COMMAND_ID);
  return applySessionFieldChange({
    session: manual,
    change: {
      kind: "guarded_model_set",
      fieldId: "move_horizon",
      normalizedValue: "6_to_12_months",
    },
    nextCompletionCommandId: () => MANUAL_COMMAND_ID,
  });
}

function yellowRosterSession(): OnboardingSessionState {
  const manual = applySessionFieldChange({
    session: expandedSession(),
    change: {
      kind: "manual_set",
      fieldId: "participants",
      rawInput: [
        { participantId: SELF_ID, relationship: "self" },
        { participantId: COMPANION_ID, relationship: "spouse" },
      ],
    },
    nextCompletionCommandId: () => MODEL_COMMAND_ID,
  });
  return applySessionFieldChange({
    session: manual,
    change: {
      kind: "guarded_model_set",
      fieldId: "participants",
      normalizedValue: [
        { participantId: SELF_ID, relationship: "self" },
        { participantId: COMPANION_ID, relationship: "other_family" },
      ],
    },
    nextCompletionCommandId: () => MANUAL_COMMAND_ID,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function frontierResponse(
  stream: ReadableStream<Uint8Array>,
  runId = "frontier-run-onboarding",
): Response {
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-life-run-id": runId,
      "x-life-profile-id": "profile-onboarding",
      "x-life-preference-profile-id": "preferences-onboarding",
    },
  });
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function blocked(session: OnboardingSessionState, fieldId: OnboardingFieldId = "current_location"):
  Extract<CompleteOnboardingResult, { readonly kind: "blocked" }> {
  return {
    kind: "blocked",
    session,
    issues: [{ fieldId, reasonCode: "required_empty" }],
    followUpQuestion: FOLLOW_UP,
  };
}

async function renderStart() {
  const { OnboardingStart } = await import(
    "../../src/experience/components/OnboardingStart"
  );
  return render(<OnboardingStart />);
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("onboarding questionnaire", () => {
  test("renders one expanded Анкета with exact situation and importance sections", async () => {
    const { OnboardingQuestionnaire } = await import(
      "../../src/experience/components/OnboardingQuestionnaire"
    );
    render(
      <OnboardingQuestionnaire
        disabled={false}
        draft={emptySession().draft}
        expanded
        issues={[]}
        onAddParticipant={() => undefined}
        onChange={() => undefined}
        onRemoveParticipant={() => undefined}
        onRelationshipChange={() => undefined}
      />,
    );

    const questionnaire = screen.getByRole("region", { name: "Анкета" });
    expect(within(questionnaire).getByRole("heading", { name: "Моя ситуация" })).toBeTruthy();
    expect(within(questionnaire).getByRole("heading", { name: "Что для меня важно" })).toBeTruthy();
    expect(within(questionnaire).queryByRole("heading", { name: /профиль/i })).toBeNull();
    expect(within(questionnaire).queryByRole("heading", { name: /^предпочтения$/i })).toBeNull();

    const countries = within(questionnaire).getByRole("group", { name: "Критерии стран" });
    const cities = within(questionnaire).getByRole("group", { name: "Критерии городов" });
    expect(within(countries).getAllByLabelText(/^Режим:/)).toHaveLength(5);
    expect(within(countries).getAllByLabelText(/^Важность:/)).toHaveLength(5);
    expect(within(cities).getAllByLabelText(/^Режим:/)).toHaveLength(4);
    expect(within(cities).getAllByLabelText(/^Важность:/)).toHaveLength(4);
  });

  test("emits typed manual changes and never exposes the participant UUID", async () => {
    const onChange = vi.fn<(change: QuestionnaireFieldChange) => void>();
    const { OnboardingQuestionnaire } = await import(
      "../../src/experience/components/OnboardingQuestionnaire"
    );
    const session = expandedSession();
    const questionnaire = render(
      <OnboardingQuestionnaire
        disabled={false}
        draft={session.draft}
        expanded
        issues={[]}
        onAddParticipant={() => undefined}
        onChange={onChange}
        onRemoveParticipant={() => undefined}
        onRelationshipChange={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Срок переезда"), {
      target: { value: "within_3_months" },
    });
    fireEvent.change(screen.getByLabelText("Опыт работы, лет"), {
      target: { value: "0" },
    });

    expect(onChange).toHaveBeenNthCalledWith(1, {
      kind: "manual_set",
      fieldId: "move_horizon",
      rawInput: "within_3_months",
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      kind: "manual_set",
      fieldId: `participants.${SELF_ID}.relevant_experience_years`,
      rawInput: 0,
    });
    expect(questionnaire.container.textContent).not.toContain(SELF_ID);
  });

  test("shows yellow actions only for an unresolved manual overwrite with keyboard focus return", async () => {
    const onChange = vi.fn<(change: QuestionnaireFieldChange) => void>();
    const { OnboardingQuestionnaire } = await import(
      "../../src/experience/components/OnboardingQuestionnaire"
    );
    const session = yellowSession();
    render(
      <OnboardingQuestionnaire
        disabled={false}
        draft={session.draft}
        expanded
        issues={[]}
        onAddParticipant={() => undefined}
        onChange={onChange}
        onRemoveParticipant={() => undefined}
        onRelationshipChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Проверить изменение: Срок переезда" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Изменение поля «Срок переезда»" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog).getByText(/до 3 месяцев/i)).toBeTruthy();
    expect(within(dialog).getByText(/от 6 до 12 месяцев/i)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("heading"));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "confirm_model_overwrite",
      fieldId: "move_horizon",
    });
  });

  test.each(["Подтвердить", "Вернуть"] as const)(
    "moves focus to the surviving field control after %s resolves the yellow overwrite",
    async (actionLabel) => {
      const { OnboardingQuestionnaire } = await import(
        "../../src/experience/components/OnboardingQuestionnaire"
      );
      function StatefulQuestionnaire() {
        const [session, setSession] = useState<OnboardingSessionState>(yellowSession);
        return (
          <OnboardingQuestionnaire
            disabled={false}
            draft={session.draft}
            expanded
            issues={[]}
            onAddParticipant={() => undefined}
            onChange={(change) => setSession((current) => applySessionFieldChange({
              session: current,
              change,
              nextCompletionCommandId: () => RESOLUTION_COMMAND_ID,
            }))}
            onRemoveParticipant={() => undefined}
            onRelationshipChange={() => undefined}
          />
        );
      }
      render(<StatefulQuestionnaire />);

      fireEvent.click(screen.getByRole("button", {
        name: "Проверить изменение: Срок переезда",
      }));
      fireEvent.click(screen.getByRole("button", { name: actionLabel }));

      await waitFor(() => {
        expect(screen.queryByRole("button", {
          name: "Проверить изменение: Срок переезда",
        })).toBeNull();
        expect(document.activeElement).toBe(screen.getByLabelText("Срок переезда"));
      });
    },
  );

  test("describes a yellow participant-roster overwrite without exposing participant IDs", async () => {
    const { OnboardingQuestionnaire } = await import(
      "../../src/experience/components/OnboardingQuestionnaire"
    );
    render(
      <OnboardingQuestionnaire
        disabled={false}
        draft={yellowRosterSession().draft}
        expanded
        issues={[]}
        onAddParticipant={() => undefined}
        onChange={() => undefined}
        onRemoveParticipant={() => undefined}
        onRelationshipChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Проверить изменение: Участники переезда",
    }));

    const dialog = screen.getByRole("dialog", {
      name: "Изменение поля «Участники переезда»",
    });
    expect(within(dialog).getByText(
      "Участников: 2 · 1. Вы · 2. Супруг или супруга",
    )).toBeTruthy();
    expect(within(dialog).getByText(
      "Участников: 2 · 1. Вы · 2. Другой член семьи",
    )).toBeTruthy();
    expect(dialog.textContent).not.toContain(SELF_ID);
    expect(dialog.textContent).not.toContain(COMPANION_ID);
    expect(dialog.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/);
  });

  test("focuses and describes the first server-blocked field", async () => {
    const { OnboardingQuestionnaire } = await import(
      "../../src/experience/components/OnboardingQuestionnaire"
    );
    render(
      <OnboardingQuestionnaire
        disabled={false}
        draft={emptySession().draft}
        expanded
        focusRequest={{ fieldId: "current_location", sequence: 1 }}
        issues={[{ fieldId: "current_location", reasonCode: "required_empty" }]}
        onAddParticipant={() => undefined}
        onChange={() => undefined}
        onRemoveParticipant={() => undefined}
        onRelationshipChange={() => undefined}
      />,
    );

    const country = screen.getByLabelText("Страна текущего проживания");
    expect(document.activeElement).toBe(country);
    expect(country.getAttribute("aria-invalid")).toBe("true");
    const description = country.getAttribute("aria-describedby");
    expect(description).toBeTruthy();
    expect(document.getElementById(description!)?.textContent).toBe("Заполните обязательное поле.");
  });
});

describe("onboarding chat", () => {
  test("keeps native composer keyboard semantics and focuses it from the latest-question shortcut", async () => {
    const submit = vi.fn();
    const { OnboardingChat } = await import(
      "../../src/experience/components/OnboardingChat"
    );
    render(
      <OnboardingChat
        busy={false}
        composer="Ответ"
        items={[
          { key: "user-1", role: "user", text: "Хочу переехать" },
          { key: "assistant-1", role: "assistant", text: "Когда вы планируете переезд?" },
        ]}
        latestQuestion="Когда вы планируете переезд?"
        onComposerChange={() => undefined}
        onSubmit={submit}
      />,
    );

    const composer = screen.getByLabelText("Расскажите о вашей ситуации и цели");
    expect(document.activeElement).toBe(composer);
    expect(screen.getByRole("log", { name: "Диалог анкеты" })).toBeTruthy();

    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(submit).toHaveBeenCalledOnce();

    composer.blur();
    fireEvent.click(screen.getByRole("button", { name: "К последнему вопросу" }));
    expect(document.activeElement).toBe(composer);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe("onboarding start", () => {
  test("renders the compact default route copy and focuses the first-viewport composer", async () => {
    await renderStart();

    expect(screen.getByRole("heading", { name: "Анкета" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Моя ситуация" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Что для меня важно" })).toBeTruthy();
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
    const composer = screen.getByLabelText("Расскажите о вашей ситуации и цели");
    expect(document.activeElement).toBe(composer);
    expect(screen.queryByLabelText("Срок переезда")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /подтверждаю анкету/i })).toBeNull();
  });

  test("sends one exact message command and expands from the guarded server session", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/onboarding/message");
      const command = requestBody(init) as unknown as {
        schemaVersion: string;
        session: OnboardingSessionState;
        message: SessionMessage;
      };
      expect(command.schemaVersion).toBe("onboarding-message-command@1");
      expect(command.message).toMatchObject({ role: "user", text: "Живу в Берлине" });
      expect(command.message.messageId).toMatch(/^[0-9a-f-]{36}$/);
      const next = messageResult({
        command,
        proposals: [{
          kind: "non_participant_field",
          fieldId: "current_location",
          normalizedValue: { countryCode: "DE", city: "Berlin" },
        }],
        completionCommandId: MODEL_COMMAND_ID,
      });
      return jsonResponse(next);
    });
    vi.stubGlobal("fetch", fetch);
    await renderStart();

    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "Живу в Берлине" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByDisplayValue("Berlin")).toBeTruthy();
    expect(screen.getByDisplayValue("DE")).toBeTruthy();
    expect(screen.getByText("Когда вы планируете переезд?")).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/onboarding/message", expect.objectContaining({
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
  });

  test("locks a deferred message action to one request and preserves composer text on failure", async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    const fetch = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    }));
    vi.stubGlobal("fetch", fetch);
    await renderStart();
    const composer = screen.getByLabelText("Расскажите о вашей ситуации и цели");
    fireEvent.change(composer, { target: { value: "private-message" } });
    const send = screen.getByRole("button", { name: "Отправить" });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(fetch).toHaveBeenCalledOnce();
    rejectRequest?.(new Error("offline"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/не удалось/i);
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe("private-message"));
    expect(screen.queryByRole("button", { name: /повторить сообщение/i })).toBeNull();
  });

  test("rotates once for a manual authority change and keeps the command across blocked reviews", async () => {
    const continueCommands: OnboardingSessionState[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const command = requestBody(init) as unknown as {
        session: OnboardingSessionState;
        message: SessionMessage;
      };
      if (url === "/api/onboarding/message") {
        return jsonResponse(messageResult({ command }));
      }
      continueCommands.push(command.session);
      return jsonResponse(blocked(command.session));
    });
    vi.stubGlobal("fetch", fetch);
    await renderStart();

    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "Начнём" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByLabelText("Срок переезда");
    fireEvent.change(screen.getByLabelText("Срок переезда"), {
      target: { value: "within_3_months" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByText(FOLLOW_UP);
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(continueCommands).toHaveLength(2));

    expect(continueCommands[0]?.completionCommandId).not.toBe(INITIAL_COMMAND_ID);
    expect(continueCommands[1]?.completionCommandId)
      .toBe(continueCommands[0]?.completionCommandId);
    expect(field(continueCommands[0]!, "move_horizon")).toMatchObject({
      normalizedValue: "within_3_months",
      origin: "manual",
    });
  });

  test("keeps blocked follow-up outside the submitted session and focuses its first issue", async () => {
    const submitted: OnboardingSessionState[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const command = requestBody(init) as unknown as { session: OnboardingSessionState };
      submitted.push(command.session);
      return jsonResponse(blocked(command.session));
    });
    vi.stubGlobal("fetch", fetch);
    await renderStart();

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByText(FOLLOW_UP)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Страна текущего проживания"));
    expect(submitted[0]?.messages).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted[1]?.messages).toEqual([]);
    expect(screen.queryByRole("button", { name: /повторить проверку анкеты/i })).toBeNull();
  });

  test("rejects a changed blocked-session response and preserves the editing state", async () => {
    const changed = change(emptySession(), "move_horizon", "within_3_months");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(blocked(changed))));
    await renderStart();

    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "private-unsent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByLabelText("Расскажите о вашей ситуации и цели") as HTMLTextAreaElement).value)
      .toBe("private-unsent");
    expect(screen.queryByText(FOLLOW_UP)).toBeNull();
  });

  test("cancels before adoption and reuses the completion command when URL installation fails", async () => {
    const cancel = vi.fn();
    const firstBody = new ReadableStream<Uint8Array>({ cancel });
    const getReader = vi.spyOn(firstBody, "getReader");
    const commands: OnboardingSessionState[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const command = requestBody(init) as unknown as { session: OnboardingSessionState };
      commands.push(command.session);
      return commands.length === 1
        ? frontierResponse(firstBody, "frontier-url-failure")
        : jsonResponse(blocked(command.session));
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(window.history, "replaceState").mockImplementationOnce(() => {
      throw new Error("history unavailable");
    });
    await renderStart();
    const composer = screen.getByLabelText("Расскажите о вашей ситуации и цели");
    fireEvent.change(composer, { target: { value: "private-before-adoption" } });

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(getReader).not.toHaveBeenCalled();
    expect((composer as HTMLTextAreaElement).value).toBe("private-before-adoption");

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByText(FOLLOW_UP);
    expect(commands).toHaveLength(2);
    expect(commands[1]?.completionCommandId).toBe(commands[0]?.completionCommandId);
  });

  test("installs the run URL and purges onboarding before the first stream read", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const nativeReader = stream.getReader.bind(stream);
    let searchAtRead: string | undefined;
    let composerAtRead: Element | null | undefined;
    vi.spyOn(stream, "getReader").mockImplementation(() => {
      searchAtRead = window.location.search;
      composerAtRead = document.querySelector('[aria-label="Расскажите о вашей ситуации и цели"]');
      return nativeReader();
    });
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetch.mockResolvedValue(frontierResponse(stream));
    vi.stubGlobal("fetch", fetch);
    const start = await renderStart();
    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "purge-me-immediately" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(await screen.findByRole("region", { name: "Поиск формально доступных стран" })).toBeTruthy();
    await waitFor(() => expect(searchAtRead).toBe("?flow=place-frontier&run=frontier-run-onboarding"));
    expect(composerAtRead).toBeNull();
    expect(start.container.textContent).not.toContain("purge-me-immediately");
    expect(screen.queryByRole("region", { name: "Анкета" })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/onboarding/continue"]);
  });

  test("keeps a later stream failure inside Frontier without resurrection or automatic launch", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not-json\n"));
        controller.close();
      },
    });
    const fetch = vi.fn(async () => frontierResponse(stream, "frontier-late-failure"));
    vi.stubGlobal("fetch", fetch);
    await renderStart();
    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "never-resurrect" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/поток проверки прерван/i);
    await waitFor(() => expect(screen.getByText(/Поток проверки прерван/)).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Анкета" })).toBeNull();
    expect(screen.queryByText("never-resurrect")).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("does not write sensitive onboarding state to browser persistence or history state", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const historyWrite = vi.spyOn(window.history, "replaceState");
    const stream = new ReadableStream<Uint8Array>();
    vi.stubGlobal("fetch", vi.fn(async () => frontierResponse(stream, "frontier-private")));
    await renderStart();
    fireEvent.change(screen.getByLabelText("Расскажите о вашей ситуации и цели"), {
      target: { value: "private-storage-sentinel" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    await screen.findByRole("region", { name: "Поиск формально доступных стран" });

    expect(storageWrite).not.toHaveBeenCalled();
    expect(JSON.stringify(window.history.state)).not.toContain("private-storage-sentinel");
    expect(historyWrite).toHaveBeenCalledWith(
      window.history.state,
      "",
      "?flow=place-frontier&run=frontier-private",
    );
  });
});

describe("default page", () => {
  test("renders conversational onboarding at the empty root route", async () => {
    const { default: Page } = await import("../../src/app/page");
    render(await Page({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Анкета" })).toBeTruthy();
    expect(screen.getByText(DISCLOSURE)).toBeTruthy();
  });

  test("preserves the legacy empty-run fallback when any query identity is present", async () => {
    const { default: Page } = await import("../../src/app/page");
    render(await Page({ searchParams: Promise.resolve({ profile: "legacy-profile" }) }));

    expect(screen.getByRole("heading", { name: "Настройте сценарий" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Анкета" })).toBeNull();
  });
});
