"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  type ParticipantRelationship,
  type QuestionnaireIssueCode,
} from "../../decision/onboarding-catalog";
import type {
  OnboardingDraft,
  OnboardingFieldId,
  ParticipantId,
  ParticipantRosterValue,
  QuestionnaireFieldChange,
  QuestionnaireFieldState,
  QuestionnaireIssue,
} from "../../decision/onboarding-questionnaire";

export interface OnboardingQuestionnaireProps {
  readonly disabled: boolean;
  readonly draft: OnboardingDraft;
  readonly expanded: boolean;
  readonly focusRequest?: {
    readonly fieldId: OnboardingFieldId;
    readonly sequence: number;
  };
  readonly issues: readonly QuestionnaireIssue[];
  readonly onAddParticipant: (
    relationship: Exclude<ParticipantRelationship, "self">,
  ) => void;
  readonly onChange: (change: QuestionnaireFieldChange) => void;
  readonly onRemoveParticipant: (participantId: ParticipantId) => void;
  readonly onRelationshipChange: (
    participantId: ParticipantId,
    relationship: Exclude<ParticipantRelationship, "self">,
  ) => void;
}

interface OverwriteModalBoundaryValue {
  readonly activeFieldId?: OnboardingFieldId;
  readonly close: (
    fieldId: OnboardingFieldId,
    focusAfterClose?: () => void,
  ) => void;
  readonly open: (fieldId: OnboardingFieldId) => void;
  readonly portalHost: HTMLElement | null;
}

const OverwriteModalContext = createContext<OverwriteModalBoundaryValue | undefined>(undefined);

function useOverwriteModal(): OverwriteModalBoundaryValue {
  const value = useContext(OverwriteModalContext);
  if (value === undefined) throw new Error("Missing onboarding overwrite modal boundary");
  return value;
}

function OverwriteModalBoundary({ children }: { readonly children: ReactNode }) {
  const [activeFieldId, setActiveFieldId] = useState<OnboardingFieldId>();
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const activeFieldIdRef = useRef<OnboardingFieldId | undefined>(undefined);
  const pendingFocus = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.dataset.onboardingOverwriteLayer = "";
    document.body.append(host);
    setPortalHost(host);
    return () => host.remove();
  }, []);

  useLayoutEffect(() => {
    if (activeFieldId === undefined || portalHost === null) return;
    const previousInert = new Map<HTMLElement, boolean>();
    const makeInert = (element: HTMLElement) => {
      if (element === portalHost || previousInert.has(element)) return;
      previousInert.set(element, element.hasAttribute("inert"));
      element.setAttribute("inert", "");
    };
    const makeBodyChildrenInert = () => {
      for (const child of document.body.children) {
        if (child instanceof HTMLElement) makeInert(child);
      }
    };
    makeBodyChildrenInert();
    const observer = new MutationObserver(makeBodyChildrenInert);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      for (const [element, wasInert] of previousInert) {
        if (!wasInert) element.removeAttribute("inert");
      }
    };
  }, [activeFieldId, portalHost]);

  useLayoutEffect(() => {
    if (activeFieldId !== undefined) return;
    const focus = pendingFocus.current;
    pendingFocus.current = undefined;
    focus?.();
  }, [activeFieldId]);

  const open = useCallback((fieldId: OnboardingFieldId) => {
    if (activeFieldIdRef.current !== undefined) return;
    activeFieldIdRef.current = fieldId;
    setActiveFieldId(fieldId);
  }, []);
  const close = useCallback((
    fieldId: OnboardingFieldId,
    focusAfterClose?: () => void,
  ) => {
    if (activeFieldIdRef.current !== fieldId) return;
    activeFieldIdRef.current = undefined;
    pendingFocus.current = focusAfterClose;
    setActiveFieldId(undefined);
  }, []);
  const value = useMemo<OverwriteModalBoundaryValue>(() => ({
    activeFieldId,
    close,
    open,
    portalHost,
  }), [activeFieldId, close, open, portalHost]);

  return (
    <OverwriteModalContext.Provider value={value}>
      {children}
    </OverwriteModalContext.Provider>
  );
}

const MOVE_HORIZON_LABELS = Object.freeze({
  within_3_months: "До 3 месяцев",
  "3_to_6_months": "От 3 до 6 месяцев",
  "6_to_12_months": "От 6 до 12 месяцев",
  more_than_12_months: "Больше 12 месяцев",
});

const RELATIONSHIP_LABELS = Object.freeze({
  self: "Вы",
  spouse: "Супруг или супруга",
  minor_child: "Несовершеннолетний ребёнок",
  other_family: "Другой член семьи",
});

const COUNTRY_LABELS = Object.freeze({
  outside_cis: "За пределами СНГ",
  europe: "Европа",
  personal_safety: "Личная безопасность",
  infrastructure: "Инфраструктура",
  peace_and_stability: "Мир и стабильность",
});

const CITY_LABELS = Object.freeze({
  safety: "Безопасность",
  long_term_rent: "Долгосрочная аренда",
  urban_transit: "Городской транспорт",
  fixed_broadband: "Стационарный интернет",
});

const ISSUE_LABELS: Readonly<Record<QuestionnaireIssueCode, string>> = Object.freeze({
  required_empty: "Заполните обязательное поле.",
  invalid_value: "Проверьте формат значения.",
  placeholder_value: "Укажите конкретное значение.",
  party_mismatch: "Состав переезда не совпадает с участниками анкеты.",
  work_mismatch: "Условия продолжения работы противоречат текущей занятости.",
  range_mismatch: "Минимальное значение не может быть больше максимального.",
});

interface FieldFrameProps {
  readonly children: (accessibility: {
    readonly "aria-describedby"?: string;
    readonly "aria-invalid"?: true;
  }) => ReactNode;
  readonly disabled: boolean;
  readonly field: QuestionnaireFieldState;
  readonly issue?: QuestionnaireIssue;
  readonly label: string;
  readonly onChange: (change: QuestionnaireFieldChange) => void;
}

function safeId(fieldId: string): string {
  return fieldId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function displayValue(field: QuestionnaireFieldState): unknown {
  return field.normalizedValue !== null ? field.normalizedValue : field.rawInput;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({});
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function participantRosterLabel(value: readonly unknown[]): string {
  const participants = value.map((item, index) => {
    const relationship = recordValue(item).relationship;
    const label = typeof relationship === "string" && relationship in RELATIONSHIP_LABELS
      ? RELATIONSHIP_LABELS[relationship as ParticipantRelationship]
      : "Участник";
    return `${index + 1}. ${label}`;
  });
  return `Участников: ${participants.length}${participants.length === 0
    ? ""
    : ` · ${participants.join(" · ")}`}`;
}

function formatValue(fieldId: OnboardingFieldId, value: unknown): string {
  if (fieldId === "move_horizon" && typeof value === "string" && value in MOVE_HORIZON_LABELS) {
    return MOVE_HORIZON_LABELS[value as keyof typeof MOVE_HORIZON_LABELS];
  }
  if (fieldId === "moving_party") {
    if (value === "alone") return "Переезжаю один или одна";
    if (value === "with_companions") return "Переезжаю с близкими";
  }
  if (fieldId === "participants" && Array.isArray(value)) {
    return participantRosterLabel(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(String).join(" · ");
  }
  return value === null || value === undefined || value === "" ? "Не заполнено" : String(value);
}

function FieldFrame({
  children,
  disabled,
  field,
  issue,
  label,
  onChange,
}: FieldFrameProps) {
  const modal = useOverwriteModal();
  const frame = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const yellow = field.overwrite?.reviewState === "model_overwrite_unreviewed";
  const dialogOpen = modal.activeFieldId === field.fieldId;
  const baseId = `onboarding-field-${safeId(field.fieldId)}`;
  const errorId = issue === undefined ? undefined : `${baseId}-error`;
  const dialogId = `${baseId}-overwrite`;

  useLayoutEffect(() => {
    if (dialogOpen) heading.current?.focus();
  }, [dialogOpen]);

  const closeDialog = () => {
    modal.close(field.fieldId, () => trigger.current?.focus());
  };
  const resolveDialog = (change: QuestionnaireFieldChange) => {
    modal.close(field.fieldId, () => frame.current?.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
    )?.focus());
    onChange(change);
  };

  const accessibility = issue === undefined
    ? {}
    : { "aria-describedby": errorId, "aria-invalid": true as const };

  return (
    <div
      className="onboarding-field"
      data-field-id={field.fieldId}
      data-tone={yellow ? "yellow" : undefined}
      ref={frame}
    >
      {children(accessibility)}
      {yellow ? (
        <button
          aria-controls={dialogId}
          aria-expanded={dialogOpen}
          aria-haspopup="dialog"
          aria-label={`Проверить изменение: ${label}`}
          className="onboarding-field__overwrite-trigger"
          disabled={disabled}
          onClick={() => modal.open(field.fieldId)}
          ref={trigger}
          type="button"
        >
          <span aria-hidden="true">!</span>
        </button>
      ) : null}
      {issue === undefined ? null : (
        <p className="onboarding-field__error" id={errorId} role="alert">
          {ISSUE_LABELS[issue.reasonCode]}
        </p>
      )}
      {!yellow || !dialogOpen || field.overwrite === null || modal.portalHost === null ? null
        : createPortal(
        <section
          aria-labelledby={`${dialogId}-heading`}
          aria-modal="true"
          className="onboarding-field__overwrite-dialog"
          id={dialogId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDialog();
              return;
            }
            if (event.key !== "Tab") return;
            const targets = [...(dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [])];
            if (targets.length === 0) return;
            const current = targets.indexOf(document.activeElement as HTMLButtonElement);
            if (event.shiftKey && current <= 0) {
              event.preventDefault();
              targets.at(-1)?.focus();
            } else if (!event.shiftKey && (current < 0 || current === targets.length - 1)) {
              event.preventDefault();
              targets[0]?.focus();
            }
          }}
          ref={dialog}
          role="dialog"
        >
          <h3 id={`${dialogId}-heading`} ref={heading} tabIndex={-1}>
            Изменение поля «{label}»
          </h3>
          <p>Новая явная информация изменила введённое вручную значение.</p>
          <dl>
            <div>
              <dt>Было</dt>
              <dd>{formatValue(field.fieldId, field.overwrite.previousValue)}</dd>
            </div>
            <div>
              <dt>Стало</dt>
              <dd>{formatValue(field.fieldId, field.overwrite.proposedValue)}</dd>
            </div>
          </dl>
          <div className="onboarding-field__overwrite-actions">
            <button disabled={disabled} onClick={() => {
              resolveDialog({ kind: "confirm_model_overwrite", fieldId: field.fieldId });
            }} type="button">
              Подтвердить
            </button>
            <button disabled={disabled} onClick={() => {
              resolveDialog({ kind: "revert_model_overwrite", fieldId: field.fieldId });
            }} type="button">
              Вернуть
            </button>
          </div>
        </section>,
        modal.portalHost,
      )}
    </div>
  );
}

export function OnboardingQuestionnaire({
  disabled,
  draft,
  expanded,
  focusRequest,
  issues,
  onAddParticipant,
  onChange,
  onRemoveParticipant,
  onRelationshipChange,
}: OnboardingQuestionnaireProps) {
  const [participantRelationship, setParticipantRelationship] =
    useState<Exclude<ParticipantRelationship, "self">>("spouse");
  const focusTargets = useRef(new Map<OnboardingFieldId, HTMLElement>());
  const fields = useMemo(
    () => new Map(draft.fields.map((candidate) => [candidate.fieldId, candidate])),
    [draft],
  );
  const issueByField = useMemo(
    () => new Map(issues.map((issue) => [issue.fieldId, issue])),
    [issues],
  );
  const participants = (fields.get("participants")?.normalizedValue ?? []) as
    readonly ParticipantRosterValue[];

  useLayoutEffect(() => {
    if (focusRequest === undefined) return;
    focusTargets.current.get(focusRequest.fieldId)?.focus();
  }, [focusRequest]);

  const registerFocus = (fieldId: OnboardingFieldId) => (element: HTMLElement | null) => {
    if (element === null) return;
    focusTargets.current.set(fieldId, element);
  };
  const requiredField = (fieldId: OnboardingFieldId): QuestionnaireFieldState => {
    const result = fields.get(fieldId);
    if (result === undefined) throw new TypeError(`Missing questionnaire field ${fieldId}`);
    return result;
  };
  const manual = (fieldId: OnboardingFieldId, rawInput: unknown) => onChange({
    kind: "manual_set",
    fieldId,
    rawInput,
  });

  return (
    <OverwriteModalBoundary>
    <section
      aria-labelledby="onboarding-questionnaire-heading"
      className="onboarding-questionnaire"
      data-expanded={expanded}
    >
      <header className="onboarding-questionnaire__header">
        <p className="eyebrow">Первый этап</p>
        <h1 id="onboarding-questionnaire-heading">Анкета</h1>
        <p>Она станет единственным источником данных для поиска стран и городов.</p>
      </header>

      <section aria-labelledby="onboarding-situation-heading">
        <h2 id="onboarding-situation-heading">Моя ситуация</h2>
        {!expanded ? <p>Расскажите о себе в чате — заполненные поля появятся здесь.</p> : (
          <div className="onboarding-questionnaire__fields">
            <CurrentLocationField
              disabled={disabled}
              field={requiredField("current_location")}
              issue={issueByField.get("current_location")}
              manual={manual}
              registerFocus={registerFocus("current_location")}
              onChange={onChange}
            />
            <SelectField
              disabled={disabled}
              field={requiredField("move_horizon")}
              issue={issueByField.get("move_horizon")}
              label="Срок переезда"
              onChange={onChange}
              onValue={(value) => manual("move_horizon", value)}
              options={Object.entries(MOVE_HORIZON_LABELS)}
              registerFocus={registerFocus("move_horizon")}
            />
            <SelectField
              disabled={disabled}
              field={requiredField("moving_party")}
              issue={issueByField.get("moving_party")}
              label="Кто переезжает"
              onChange={onChange}
              onValue={(value) => manual("moving_party", value)}
              options={[
                ["alone", "Переезжаю один или одна"],
                ["with_companions", "Переезжаю с близкими"],
              ]}
              registerFocus={registerFocus("moving_party")}
            />
            <FieldFrame
              disabled={disabled}
              field={requiredField("participants")}
              issue={issueByField.get("participants")}
              label="Участники переезда"
              onChange={onChange}
            >
              {(accessibility) => (
                <div className="onboarding-participants" {...accessibility}>
                  <h3>Участники переезда</h3>
                  {participants.map((participant, index) => (
                    <article className="onboarding-participant" key={participant.participantId}>
                      <header>
                        <h4>{index === 0 ? "Вы" : `Сопровождающий ${index}`}</h4>
                        {participant.relationship === "self" ? null : (
                          <button
                            disabled={disabled}
                            onClick={() => onRemoveParticipant(participant.participantId)}
                            type="button"
                          >
                            Удалить
                          </button>
                        )}
                      </header>
                      {participant.relationship === "self" ? (
                        <p>{RELATIONSHIP_LABELS.self}</p>
                      ) : (
                        <label>
                          Родство
                          <select
                            disabled={disabled}
                            onChange={(event) => onRelationshipChange(
                              participant.participantId,
                              event.currentTarget.value as Exclude<ParticipantRelationship, "self">,
                            )}
                            value={participant.relationship}
                          >
                            <option value="spouse">{RELATIONSHIP_LABELS.spouse}</option>
                            <option value="minor_child">{RELATIONSHIP_LABELS.minor_child}</option>
                            <option value="other_family">{RELATIONSHIP_LABELS.other_family}</option>
                          </select>
                        </label>
                      )}
                      <ParticipantFields
                        disabled={disabled}
                        fields={fields}
                        issueByField={issueByField}
                        manual={manual}
                        onChange={onChange}
                        participant={participant}
                        registerFocus={registerFocus}
                      />
                    </article>
                  ))}
                  <div className="onboarding-participants__add">
                    <label>
                      Добавить сопровождающего
                      <select
                        {...accessibility}
                        disabled={disabled}
                        onChange={(event) => setParticipantRelationship(
                          event.currentTarget.value as Exclude<ParticipantRelationship, "self">,
                        )}
                        ref={registerFocus("participants") as (element: HTMLSelectElement | null) => void}
                        value={participantRelationship}
                      >
                        <option value="spouse">{RELATIONSHIP_LABELS.spouse}</option>
                        <option value="minor_child">{RELATIONSHIP_LABELS.minor_child}</option>
                        <option value="other_family">{RELATIONSHIP_LABELS.other_family}</option>
                      </select>
                    </label>
                    <button
                      disabled={disabled}
                      onClick={() => onAddParticipant(participantRelationship)}
                      type="button"
                    >
                      Добавить
                    </button>
                  </div>
                </div>
              )}
            </FieldFrame>
            <SavingsField
              disabled={disabled}
              field={requiredField("savings")}
              issue={issueByField.get("savings")}
              manual={manual}
              onChange={onChange}
              registerFocus={registerFocus("savings")}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="onboarding-importance-heading">
        <h2 id="onboarding-importance-heading">Что для меня важно</h2>
        {!expanded ? <p>Здесь появятся приоритеты поиска стран и городов.</p> : (
          <div className="onboarding-questionnaire__criteria">
            <CriteriaGroup
              disabled={disabled}
              ids={COUNTRY_PREFERENCE_IDS}
              kind="country"
              labels={COUNTRY_LABELS}
              fields={fields}
              issueByField={issueByField}
              manual={manual}
              onChange={onChange}
              registerFocus={registerFocus}
              title="Критерии стран"
            />
            <CriteriaGroup
              disabled={disabled}
              ids={CITY_PREFERENCE_IDS}
              kind="city"
              labels={CITY_LABELS}
              fields={fields}
              issueByField={issueByField}
              manual={manual}
              onChange={onChange}
              registerFocus={registerFocus}
              title="Критерии городов"
            />
          </div>
        )}
      </section>
    </section>
    </OverwriteModalBoundary>
  );
}

interface CommonFieldProps {
  readonly disabled: boolean;
  readonly field: QuestionnaireFieldState;
  readonly issue?: QuestionnaireIssue;
  readonly onChange: (change: QuestionnaireFieldChange) => void;
}

function CurrentLocationField({
  disabled,
  field,
  issue,
  manual,
  onChange,
  registerFocus,
}: CommonFieldProps & {
  readonly manual: (fieldId: OnboardingFieldId, value: unknown) => void;
  readonly registerFocus: (element: HTMLInputElement | null) => void;
}) {
  const location = recordValue(displayValue(field));
  const countryCode = stringValue(location.countryCode);
  const city = stringValue(location.city);
  return (
    <FieldFrame disabled={disabled} field={field} issue={issue} label="Текущее место" onChange={onChange}>
      {(accessibility) => (
        <div className="onboarding-field__compound">
          <label>
            Страна текущего проживания
            <input
              {...accessibility}
              autoCapitalize="characters"
              disabled={disabled}
              maxLength={2}
              onChange={(event) => manual(field.fieldId, {
                countryCode: event.currentTarget.value.toUpperCase(),
                city,
              })}
              ref={registerFocus}
              value={countryCode}
            />
          </label>
          <label>
            Город текущего проживания
            <input
              {...accessibility}
              disabled={disabled}
              onChange={(event) => manual(field.fieldId, {
                countryCode,
                city: event.currentTarget.value,
              })}
              value={city}
            />
          </label>
        </div>
      )}
    </FieldFrame>
  );
}

function SelectField({
  disabled,
  field,
  issue,
  label,
  onChange,
  onValue,
  options,
  registerFocus,
}: CommonFieldProps & {
  readonly label: string;
  readonly onValue: (value: string) => void;
  readonly options: readonly (readonly [string, string])[];
  readonly registerFocus: (element: HTMLSelectElement | null) => void;
}) {
  return (
    <FieldFrame disabled={disabled} field={field} issue={issue} label={label} onChange={onChange}>
      {(accessibility) => (
        <label>
          {label}
          <select
            {...accessibility}
            disabled={disabled}
            onChange={(event) => onValue(event.currentTarget.value)}
            ref={registerFocus}
            value={stringValue(displayValue(field))}
          >
            <option value="">Не выбрано</option>
            {options.map(([value, optionLabel]) => (
              <option key={value} value={value}>{optionLabel}</option>
            ))}
          </select>
        </label>
      )}
    </FieldFrame>
  );
}

function SavingsField({
  disabled,
  field,
  issue,
  manual,
  onChange,
  registerFocus,
}: CommonFieldProps & {
  readonly manual: (fieldId: OnboardingFieldId, value: unknown) => void;
  readonly registerFocus: (element: HTMLInputElement | null) => void;
}) {
  const savings = recordValue(displayValue(field));
  const min = stringValue(savings.min);
  const max = stringValue(savings.max);
  const currency = stringValue(savings.currency);
  const update = (patch: Readonly<Record<string, string>>) => manual(field.fieldId, {
    min,
    max,
    currency,
    ...patch,
  });
  return (
    <FieldFrame disabled={disabled} field={field} issue={issue} label="Накопления" onChange={onChange}>
      {(accessibility) => (
        <div className="onboarding-field__compound onboarding-field__compound--three">
          <label>Накопления от<input {...accessibility} disabled={disabled} inputMode="decimal"
            onChange={(event) => update({ min: event.currentTarget.value })} ref={registerFocus} value={min} /></label>
          <label>Накопления до<input {...accessibility} disabled={disabled} inputMode="decimal"
            onChange={(event) => update({ max: event.currentTarget.value })} value={max} /></label>
          <label>Валюта накоплений<input {...accessibility} disabled={disabled} maxLength={3}
            onChange={(event) => update({ currency: event.currentTarget.value.toUpperCase() })} value={currency} /></label>
        </div>
      )}
    </FieldFrame>
  );
}

function ParticipantFields({
  disabled,
  fields,
  issueByField,
  manual,
  onChange,
  participant,
  registerFocus,
}: {
  readonly disabled: boolean;
  readonly fields: ReadonlyMap<OnboardingFieldId, QuestionnaireFieldState>;
  readonly issueByField: ReadonlyMap<OnboardingFieldId, QuestionnaireIssue>;
  readonly manual: (fieldId: OnboardingFieldId, value: unknown) => void;
  readonly onChange: (change: QuestionnaireFieldChange) => void;
  readonly participant: ParticipantRosterValue;
  readonly registerFocus: (fieldId: OnboardingFieldId) => (element: HTMLElement | null) => void;
}) {
  const prefix = `participants.${participant.participantId}` as const;
  const read = (leaf: string) => fields.get(`${prefix}.${leaf}` as OnboardingFieldId)!;
  const citizenships = read("citizenships");
  const passport = read("passport");
  const work = read("current_work");
  const remote = read("remote_continuation");
  const income = read("monthly_income");
  const education = read("education");
  const experience = read("relevant_experience_years");
  const citizenshipValue = displayValue(citizenships);
  const passportValue = displayValue(passport);
  const passportRecord = recordValue(passportValue);
  const passportKind = passportValue === "absent" ? "absent"
    : typeof passportRecord.validUntil === "string" ? "dated" : "";
  const workValue = recordValue(displayValue(work));
  const incomeValue = recordValue(displayValue(income));
  const educationValue = recordValue(displayValue(education));
  return (
    <div className="onboarding-participant__fields">
      <FieldFrame disabled={disabled} field={citizenships} issue={issueByField.get(citizenships.fieldId)}
        label="Гражданства" onChange={onChange}>
        {(accessibility) => <label>Гражданства, коды стран<input {...accessibility} disabled={disabled}
          onChange={(event) => manual(citizenships.fieldId, event.currentTarget.value
            .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean))}
          ref={registerFocus(citizenships.fieldId) as (element: HTMLInputElement | null) => void}
          value={Array.isArray(citizenshipValue) ? citizenshipValue.join(", ") : stringValue(citizenshipValue)} /></label>}
      </FieldFrame>
      <FieldFrame disabled={disabled} field={passport} issue={issueByField.get(passport.fieldId)}
        label="Паспорт" onChange={onChange}>
        {(accessibility) => <div className="onboarding-field__compound">
          <label>Паспорт<select {...accessibility} disabled={disabled} onChange={(event) => {
            manual(passport.fieldId, event.currentTarget.value === "absent"
              ? "absent"
              : { validUntil: "" });
          }} ref={registerFocus(passport.fieldId) as (element: HTMLSelectElement | null) => void}
          value={passportKind}><option value="">Не выбрано</option><option value="absent">Нет паспорта</option>
            <option value="dated">Есть паспорт</option></select></label>
          {passportKind !== "dated" ? null : <label>Паспорт действителен до<input {...accessibility}
            disabled={disabled} onChange={(event) => manual(passport.fieldId, { validUntil: event.currentTarget.value })}
            type="date" value={stringValue(passportRecord.validUntil)} /></label>}
        </div>}
      </FieldFrame>
      {work.applicability === "not_applicable" ? null : (
        <FieldFrame disabled={disabled} field={work} issue={issueByField.get(work.fieldId)}
          label="Текущая работа" onChange={onChange}>
          {(accessibility) => <div className="onboarding-field__compound">
            <label>Текущая работа<select {...accessibility} disabled={disabled}
              onChange={(event) => manual(work.fieldId, event.currentTarget.value === "not_working"
                ? { status: "not_working" }
                : { status: event.currentTarget.value, occupation: stringValue(workValue.occupation) })}
              ref={registerFocus(work.fieldId) as (element: HTMLSelectElement | null) => void}
              value={stringValue(workValue.status)}><option value="">Не выбрано</option>
              <option value="not_working">Не работаю</option><option value="employment">Работа по найму</option>
              <option value="self_employment">Самозанятость</option><option value="contract_service">Контракт</option>
              <option value="other">Другое</option></select></label>
            {workValue.status === "" || workValue.status === "not_working" ? null : <label>Профессия<input
              {...accessibility} disabled={disabled} onChange={(event) => manual(work.fieldId, {
                status: workValue.status,
                occupation: event.currentTarget.value,
              })} value={stringValue(workValue.occupation)} /></label>}
          </div>}
        </FieldFrame>
      )}
      {remote.applicability === "not_applicable" ? null : <SelectField disabled={disabled} field={remote}
        issue={issueByField.get(remote.fieldId)} label="Продолжение работы после переезда" onChange={onChange}
        onValue={(value) => manual(remote.fieldId, value)} options={[["yes", "Да"], ["no", "Нет"]]}
        registerFocus={registerFocus(remote.fieldId) as (element: HTMLSelectElement | null) => void} />}
      {income.applicability === "not_applicable" ? null : (
        <FieldFrame disabled={disabled} field={income} issue={issueByField.get(income.fieldId)}
          label="Месячный доход" onChange={onChange}>
          {(accessibility) => {
            const amount = stringValue(incomeValue.amount);
            const currency = stringValue(incomeValue.currency);
            const basis = stringValue(incomeValue.basis);
            const update = (patch: Readonly<Record<string, string>>) => manual(income.fieldId, {
              amount,
              currency,
              basis,
              ...patch,
            });
            return <div className="onboarding-field__compound onboarding-field__compound--three">
              <label>Месячный доход<input {...accessibility} disabled={disabled} inputMode="decimal"
                onChange={(event) => update({ amount: event.currentTarget.value })}
                ref={registerFocus(income.fieldId) as (element: HTMLInputElement | null) => void} value={amount} /></label>
              <label>Валюта дохода<input {...accessibility} disabled={disabled} maxLength={3}
                onChange={(event) => update({ currency: event.currentTarget.value.toUpperCase() })} value={currency} /></label>
              <label>До налогов или после<select {...accessibility} disabled={disabled}
                onChange={(event) => update({ basis: event.currentTarget.value })} value={basis}>
                <option value="">Не выбрано</option><option value="net">После налогов</option>
                <option value="gross">До налогов</option></select></label>
            </div>;
          }}
        </FieldFrame>
      )}
      {education.applicability === "not_applicable" ? null : (
        <FieldFrame disabled={disabled} field={education} issue={issueByField.get(education.fieldId)}
          label="Образование" onChange={onChange}>
          {(accessibility) => <div className="onboarding-field__compound">
            <label>Образование<select {...accessibility} disabled={disabled}
              onChange={(event) => manual(education.fieldId, event.currentTarget.value === "none"
                ? { level: "none" }
                : { level: event.currentTarget.value, field: stringValue(educationValue.field) })}
              ref={registerFocus(education.fieldId) as (element: HTMLSelectElement | null) => void}
              value={stringValue(educationValue.level)}><option value="">Не выбрано</option>
              <option value="none">Нет</option><option value="secondary">Среднее</option>
              <option value="vocational">Профессиональное</option><option value="higher">Высшее</option>
            </select></label>
            {educationValue.level === "" || educationValue.level === "none" ? null : <label>Специальность<input
              {...accessibility} disabled={disabled} onChange={(event) => manual(education.fieldId, {
                level: educationValue.level,
                field: event.currentTarget.value,
              })} value={stringValue(educationValue.field)} /></label>}
          </div>}
        </FieldFrame>
      )}
      {experience.applicability === "not_applicable" ? null : (
        <FieldFrame disabled={disabled} field={experience} issue={issueByField.get(experience.fieldId)}
          label="Опыт работы, лет" onChange={onChange}>
          {(accessibility) => <label>Опыт работы, лет<input {...accessibility} disabled={disabled} min={0}
            onChange={(event) => manual(experience.fieldId, event.currentTarget.value === ""
              ? ""
              : Number(event.currentTarget.value))}
            ref={registerFocus(experience.fieldId) as (element: HTMLInputElement | null) => void}
            type="number" value={numberValue(displayValue(experience))} /></label>}
        </FieldFrame>
      )}
    </div>
  );
}

function CriteriaGroup<K extends "country" | "city">({
  disabled,
  fields,
  ids,
  issueByField,
  kind,
  labels,
  manual,
  onChange,
  registerFocus,
  title,
}: {
  readonly disabled: boolean;
  readonly fields: ReadonlyMap<OnboardingFieldId, QuestionnaireFieldState>;
  readonly ids: readonly string[];
  readonly issueByField: ReadonlyMap<OnboardingFieldId, QuestionnaireIssue>;
  readonly kind: K;
  readonly labels: Readonly<Record<string, string>>;
  readonly manual: (fieldId: OnboardingFieldId, value: unknown) => void;
  readonly onChange: (change: QuestionnaireFieldChange) => void;
  readonly registerFocus: (fieldId: OnboardingFieldId) => (element: HTMLElement | null) => void;
  readonly title: string;
}) {
  return (
    <fieldset className="onboarding-criteria">
      <legend>{title}</legend>
      {ids.map((id) => {
        const prefix = `${kind}_preferences.${id}`;
        const modeId = `${prefix}.mode` as OnboardingFieldId;
        const importanceId = `${prefix}.importance` as OnboardingFieldId;
        const targetId = `${prefix}.target` as OnboardingFieldId;
        const mode = fields.get(modeId)!;
        const importance = fields.get(importanceId)!;
        const target = fields.get(targetId)!;
        const label = labels[id]!;
        return (
          <article className="onboarding-criterion" key={id}>
            <h3>{label}</h3>
            <SelectField disabled={disabled} field={mode} issue={issueByField.get(modeId)}
              label={`Режим: ${label}`} onChange={onChange} onValue={(value) => manual(modeId, value)}
              options={[["required", "Обязательно"], ["weighted", "Желательно"]]}
              registerFocus={registerFocus(modeId) as (element: HTMLSelectElement | null) => void} />
            <FieldFrame disabled={disabled} field={importance} issue={issueByField.get(importanceId)}
              label={`Важность: ${label}`} onChange={onChange}>
              {(accessibility) => <label>Важность: {label}<select aria-label={`Важность: ${label}`}
                {...accessibility} disabled={disabled} onChange={(event) => manual(importanceId,
                  event.currentTarget.value === "" ? "" : Number(event.currentTarget.value))}
                ref={registerFocus(importanceId) as (element: HTMLSelectElement | null) => void}
                value={numberValue(displayValue(importance))}><option value="">Не выбрано</option>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
            </FieldFrame>
            <FieldFrame disabled={disabled} field={target} issue={issueByField.get(targetId)}
              label={`Цель: ${label}`} onChange={onChange}>
              {(accessibility) => <label>Цель: {label}{kind === "country" ? (
                <select {...accessibility} disabled={disabled} onChange={(event) => manual(targetId,
                  event.currentTarget.value)} ref={registerFocus(targetId) as (element: HTMLSelectElement | null) => void}
                  value={stringValue(displayValue(target))}><option value="">Не выбрано</option>
                  <option value="required_true">Требуется соответствие</option>
                  <option value="maximize">Максимизировать</option></select>
              ) : (
                <input {...accessibility} disabled={disabled} onChange={(event) => manual(targetId,
                  event.currentTarget.value)} ref={registerFocus(targetId) as (element: HTMLInputElement | null) => void}
                  value={stringValue(displayValue(target))} />
              )}</label>}
            </FieldFrame>
          </article>
        );
      })}
    </fieldset>
  );
}
