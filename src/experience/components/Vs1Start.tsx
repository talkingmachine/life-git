"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { startConfirmedLife } from "../../app/actions";
import type { RunDetails } from "../../application/contracts";
import type { ProfileDraft } from "../../decision/profile";
import { replaceRunUrl } from "../run-url";
import { ResearchMap } from "./ResearchMap";
import { Vs1Journey } from "./Vs1Journey";

const INITIAL_PROFILE: ProfileDraft = Object.freeze({
  availableResourcesAll: "500000",
  monthlyIncome: Object.freeze({ amount: "210000", currency: "RUB" as const }),
  incomeBasis: "foreign_contract" as const,
  companionBasis: "none" as const,
  relationship: "none" as const,
  conditions: Object.freeze({
    incomeContinues12Months: false,
    lawfulStayPrerequisiteAccepted: false,
    stagedSpouseRouteAccepted: false,
  }),
});

export function Vs1Start() {
  const [draft, setDraft] = useState<ProfileDraft>(INITIAL_PROFILE);
  const [housingAll, setHousingAll] = useState("70000");
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, setPending] = useState(false);
  const [details, setDetails] = useState<RunDetails>();
  const [error, setError] = useState<string>();

  const setCondition = (condition: keyof ProfileDraft["conditions"], value: boolean) => {
    setDraft((current) => ({
      ...current,
      conditions: { ...current.conditions, [condition]: value },
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || isPending) return;
    setError(undefined);
    setPending(true);
    try {
      const next = await startConfirmedLife(draft, {
        currency: "ALL",
        initialHousingAll: housingAll,
      });
      replaceRunUrl(next.run.runId);
      setDetails(next);
    } catch {
      setError("Проверка не запущена. Снимок не был сохранён.");
    } finally {
      setPending(false);
    }
  };

  if (details !== undefined) return <Vs1Journey details={details} />;

  if (isPending) {
    return (
      <main className="journey-shell journey-shell--pending">
        <ResearchMap
          candidates={[{
            id: "tirana",
            origin: "Россия",
            destination: "Тирана",
            status: "pending",
          }]}
          mode="pending"
        />
      </main>
    );
  }

  return (
    <main className="landing landing--start">
      <section className="landing__copy">
        <p className="eyebrow">VS-1 · подтверждённая жизнь</p>
        <h1>Один маршрут.<br />Проверяемые основания.</h1>
        <p>
          Один заранее выбранный технический кандидат: Россия → Тирана.
          Это синтетический VS-1 профиль, не мировой поиск и не рейтинг.
        </p>
        <form className="start-form" onSubmit={submit}>
          <label>
            Доступные ресурсы, ALL
            <input
              inputMode="decimal"
              onChange={(event) => setDraft({ ...draft, availableResourcesAll: event.currentTarget.value })}
              value={draft.availableResourcesAll}
            />
          </label>
          <label>
            Месячный доход, RUB
            <input
              inputMode="decimal"
              onChange={(event) => setDraft({
                ...draft,
                monthlyIncome: { amount: event.currentTarget.value, currency: "RUB" },
              })}
              value={draft.monthlyIncome.amount}
            />
          </label>
          <label>
            Основание дохода
            <select
              onChange={(event) => setDraft({
                ...draft,
                incomeBasis: event.currentTarget.value as ProfileDraft["incomeBasis"],
              })}
              value={draft.incomeBasis}
            >
              <option value="foreign_contract">Иностранный контракт</option>
              <option value="albanian_employer_only">Только албанский работодатель</option>
            </select>
          </label>
          <label>
            Маршрут спутника
            <select
              onChange={(event) => {
                const companionBasis = event.currentTarget.value as ProfileDraft["companionBasis"];
                setDraft({
                  ...draft,
                  companionBasis,
                  relationship: companionBasis === "family" ? draft.relationship : "none",
                  conditions: companionBasis === "family"
                    ? draft.conditions
                    : { ...draft.conditions, stagedSpouseRouteAccepted: false },
                });
              }}
              value={draft.companionBasis}
            >
              <option value="none">Без спутника</option>
              <option value="family">Семейный</option>
              <option value="independent">Независимый</option>
              <option value="unknown">Неизвестно</option>
            </select>
          </label>
          <label>
            Отношение
            <select
              disabled={draft.companionBasis !== "family"}
              onChange={(event) => {
                const relationship = event.currentTarget.value as ProfileDraft["relationship"];
                setDraft({
                  ...draft,
                  relationship,
                  conditions: relationship === "spouse"
                    ? draft.conditions
                    : { ...draft.conditions, stagedSpouseRouteAccepted: false },
                });
              }}
              value={draft.relationship}
            >
              <option value="none">Не указано</option>
              <option value="spouse">Супруг</option>
              <option value="non_family">Не семья</option>
              <option value="other_family">Другой член семьи</option>
            </select>
          </label>
          <label>
            Исходное жильё C0, ALL
            <input
              inputMode="decimal"
              onChange={(event) => setHousingAll(event.currentTarget.value)}
              value={housingAll}
            />
          </label>
          <fieldset className="start-form__conditions">
            <legend>Условия сценария, которые войдут в неизменяемый снимок</legend>
            <label>
              <input
                checked={draft.conditions.incomeContinues12Months}
                onChange={(event) => setCondition("incomeContinues12Months", event.currentTarget.checked)}
                type="checkbox"
              />
              Доход продолжает поступать следующие 12 месяцев
            </label>
            <label>
              <input
                checked={draft.conditions.lawfulStayPrerequisiteAccepted}
                onChange={(event) => setCondition("lawfulStayPrerequisiteAccepted", event.currentTarget.checked)}
                type="checkbox"
              />
              Принимаю законное пребывание как предварительное условие; это не подтверждение документа
            </label>
            {draft.companionBasis === "family" && draft.relationship === "spouse" ? (
              <label>
                <input
                  checked={draft.conditions.stagedSpouseRouteAccepted}
                  onChange={(event) => setCondition("stagedSpouseRouteAccepted", event.currentTarget.checked)}
                  type="checkbox"
                />
                Принимаю поэтапный маршрут супруга после разрешения спонсора
              </label>
            ) : null}
          </fieldset>
          <label className="profile-card__confirmation">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            Подтверждаю синтетический снимок и запускаю текущую проверку
          </label>
          <button disabled={!confirmed || isPending} type="submit">Начать проверку</button>
        </form>
        {error === undefined ? null : <p role="alert">{error}</p>}
      </section>
      <figure className="landing__map">
        <img alt="Схема единственного маршрута Россия — Тирана" src="/world-map.svg" />
        <figcaption><span aria-hidden="true">✈</span> Россия → Тирана</figcaption>
      </figure>
    </main>
  );
}
