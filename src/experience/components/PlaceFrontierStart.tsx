"use client";

import { useState, type FormEvent } from "react";

import type { RelocationProfileDraft } from "../../decision/relocation-profile";
import type {
  Importance,
  PlaceCriterionId,
  PreferenceCriterion,
  PreferenceMode,
} from "../../decision/preference-profile";
import { openPlaceFrontierStreamResponse } from "../place-frontier-stream";
import { replacePlaceFrontierRunUrl } from "../run-url";
import { PlaceFrontierJourney } from "./PlaceFrontierJourney";
import { ProductShell } from "./ProductShell";

type Companion = RelocationProfileDraft["companions"][number];

const COMPANION_LABELS: Readonly<Record<Companion["relationship"], string>> = {
  spouse: "Супруг или супруга",
  minor_child: "Несовершеннолетний ребёнок",
  other_family: "Другой член семьи",
};

const CRITERION_LABELS: Readonly<Record<PlaceCriterionId, string>> = {
  outside_cis: "За пределами СНГ",
  europe: "Европа",
  personal_safety: "Личная безопасность",
  infrastructure: "Инфраструктура",
  peace_and_stability: "Мир и стабильность",
};

const DEFAULT_CRITERIA: readonly PreferenceCriterion[] = [
  { id: "outside_cis", mode: "required", importance: 5, target: "required_true" },
  { id: "europe", mode: "weighted", importance: 4, target: "maximize" },
  { id: "personal_safety", mode: "weighted", importance: 5, target: "maximize" },
  { id: "infrastructure", mode: "weighted", importance: 5, target: "maximize" },
  { id: "peace_and_stability", mode: "weighted", importance: 5, target: "maximize" },
];

function criterionWithMode(criterion: PreferenceCriterion, mode: PreferenceMode): PreferenceCriterion {
  return mode === "required"
    ? { id: criterion.id, mode, importance: criterion.importance, target: "required_true" }
    : { id: criterion.id, mode, importance: criterion.importance, target: "maximize" };
}

export function PlaceFrontierStart() {
  const [monthlyIncome, setMonthlyIncome] = useState("210000");
  const [companions, setCompanions] = useState<readonly Companion[]>([]);
  const [companionType, setCompanionType] = useState<Companion["relationship"]>("spouse");
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [launched, setLaunched] = useState<ReturnType<typeof openPlaceFrontierStreamResponse>>();
  const edited = () => setConfirmed(false);

  const profile: RelocationProfileDraft = {
    currentCountryCode: "RU",
    citizenships: ["RU"],
    monthlyIncome: { amount: monthlyIncome, currency: "RUB", basis: "net" },
    remoteWork: { relation: "foreign_employment", legallyAllowed: true },
    education: "none",
    relevantExperienceYears: "unknown",
    passportValidUntil: "unknown",
    healthInsurance: "unknown",
    companions,
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/place-frontier", {
        body: JSON.stringify({ profile, preferences: { criteria } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { code?: unknown } | undefined;
        throw new Error(body?.code === "invalid_input" ? "invalid_input" : "request_failed");
      }
      const opened = openPlaceFrontierStreamResponse(response);
      replacePlaceFrontierRunUrl(opened.runId);
      setLaunched(opened);
    } catch (caught) {
      setError(caught instanceof Error && caught.message === "invalid_input"
        ? "Профиль и предпочтения не прошли проверку. Проверьте введённые значения."
        : "Поиск стран не запущен. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  };

  if (launched !== undefined) {
    return <PlaceFrontierJourney mode="live" {...launched} />;
  }

  return (
    <ProductShell activeDestination="overview" onDestinationChange={() => undefined} setup>
      <section aria-labelledby="place-frontier-setup-heading" className="scenario-setup place-frontier-setup">
        <header>
          <p className="eyebrow">VS-3 · frontier стран</p>
          <h1 id="place-frontier-setup-heading">Найти формально доступные страны</h1>
          <p>
            Ранжирование ограничено установленными пакетами стран и может честно вернуть меньше пяти вариантов.
          </p>
        </header>
        <form className="start-form" onSubmit={submit}>
          <fieldset>
            <legend>Подтверждённый профиль</legend>
            <label>
              Месячный доход, RUB
              <input inputMode="decimal" onChange={(event) => {
                setMonthlyIncome(event.currentTarget.value);
                edited();
              }} value={monthlyIncome} />
            </label>
          </fieldset>
          <fieldset>
            <legend>Сопровождающие</legend>
            {companions.length === 0 ? <p>Без сопровождающих</p> : (
              <ul className="cold-start-setup__companions">
                {companions.map((companion, index) => (
                  <li key={`${companion.relationship}-${index}`}>
                    <span>{COMPANION_LABELS[companion.relationship]}</span>
                    <button onClick={() => {
                      setCompanions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                      edited();
                    }} type="button">Удалить</button>
                  </li>
                ))}
              </ul>
            )}
            <label>
              Тип сопровождающего
              <select onChange={(event) => {
                setCompanionType(event.currentTarget.value as Companion["relationship"]);
                edited();
              }} value={companionType}>
                {Object.entries(COMPANION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <button onClick={() => {
              setCompanions((current) => [...current, { relationship: companionType }]);
              edited();
            }} type="button">Добавить сопровождающего</button>
          </fieldset>
          <fieldset aria-label="Предпочтения" className="place-frontier-setup__preferences">
            <legend>Предпочтения</legend>
            {criteria.map((criterion, index) => (
              <div className="place-frontier-setup__criterion" key={criterion.id}>
                <strong>{CRITERION_LABELS[criterion.id]}</strong>
                <label>
                  Режим: {CRITERION_LABELS[criterion.id]}
                  <select aria-label={`Режим: ${CRITERION_LABELS[criterion.id]}`} onChange={(event) => {
                    const mode = event.currentTarget.value as PreferenceMode;
                    setCriteria((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? criterionWithMode(item, mode) : item));
                    edited();
                  }} value={criterion.mode}>
                    <option value="required">Обязательное</option>
                    <option value="weighted">Взвешенное</option>
                  </select>
                </label>
                <label>
                  Важность: {CRITERION_LABELS[criterion.id]}
                  <input aria-label={`Важность: ${CRITERION_LABELS[criterion.id]}`} max={5} min={1}
                    onChange={(event) => {
                      const importance = Number(event.currentTarget.value) as Importance;
                      setCriteria((current) => current.map((item, itemIndex) => itemIndex === index
                        ? { ...item, importance }
                        : item));
                      edited();
                    }} type="number" value={criterion.importance} />
                </label>
              </div>
            ))}
          </fieldset>
          <section aria-labelledby="place-frontier-review-heading" className="scenario-review">
            <h2 id="place-frontier-review-heading">Проверка перед запуском</h2>
            <p>Один человек, Россия, гражданство РФ; пять структурированных предпочтений.</p>
            <label className="profile-card__confirmation">
              <input checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} type="checkbox" />
              Подтверждаю профиль и предпочтения
            </label>
            <button disabled={!confirmed || pending} type="submit">
              {pending ? "Запускаем…" : "Запустить поиск"}
            </button>
            {error === undefined ? null : <p role="alert">{error}</p>}
          </section>
        </form>
      </section>
    </ProductShell>
  );
}
