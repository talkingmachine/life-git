"use client";

import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

export interface OnboardingChatItem {
  readonly key: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface OnboardingChatProps {
  readonly busy: boolean;
  readonly composer: string;
  readonly composerRef?: RefObject<HTMLTextAreaElement | null>;
  readonly error?: string;
  readonly items: readonly OnboardingChatItem[];
  readonly latestQuestion?: string;
  readonly onComposerChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function OnboardingChat({
  busy,
  composer,
  composerRef: externalComposerRef,
  error,
  items,
  latestQuestion,
  onComposerChange,
  onSubmit,
}: OnboardingChatProps) {
  const internalComposerRef = useRef<HTMLTextAreaElement>(null);
  const chat = useRef<HTMLElement>(null);
  const composerRef = externalComposerRef ?? internalComposerRef;

  useLayoutEffect(() => {
    composerRef.current?.focus();
  }, [composerRef]);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (busy || composer.trim().length === 0) return;
    onSubmit();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) return;
    event.preventDefault();
    submit();
  };

  return (
    <section
      aria-labelledby="onboarding-chat-heading"
      aria-busy={busy}
      className="onboarding-chat"
      ref={chat}
    >
      {latestQuestion === undefined ? null : (
        <button
          aria-label="К последнему вопросу"
          className="onboarding-chat__latest-question"
          onClick={() => {
            chat.current?.scrollIntoView({ block: "end" });
            composerRef.current?.focus();
          }}
          type="button"
        >
          <span>К последнему вопросу</span>
          <small>{latestQuestion}</small>
        </button>
      )}
      <h2 id="onboarding-chat-heading">Диалог</h2>
      <ol aria-label="Диалог анкеты" aria-live="polite" className="onboarding-chat__messages" role="log">
        {items.map((item) => (
          <li className={`onboarding-chat__message onboarding-chat__message--${item.role}`} key={item.key}>
            <span className="visually-hidden">{item.role === "user" ? "Вы" : "Помощник"}: </span>
            {item.text}
          </li>
        ))}
      </ol>
      <form className="onboarding-chat__composer" onSubmit={submit}>
        <label>
          Расскажите о вашей ситуации и цели
          <textarea
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onComposerChange(event.currentTarget.value)}
            onKeyDown={keyDown}
            ref={composerRef}
            rows={4}
            value={composer}
          />
        </label>
        <button disabled={busy || composer.trim().length === 0} type="submit">
          {busy ? "Обрабатываем…" : "Отправить"}
        </button>
      </form>
      {busy ? <p aria-live="polite" role="status">Codex обрабатывает анкету…</p> : null}
      {error === undefined ? null : <p className="onboarding-chat__error" role="alert">{error}</p>}
    </section>
  );
}
