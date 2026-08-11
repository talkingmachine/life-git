"use client";

import { useState, type FormEvent } from "react";

import type { RelocationProfileDraft } from "../../decision/relocation-profile";
import { openColdStartStreamResponse } from "../cold-start-stream";
import { replaceColdStartRunUrl } from "../run-url";
import { ColdStartJourney } from "./ColdStartJourney";
import { ProductShell } from "./ProductShell";

type Companion = RelocationProfileDraft["companions"][number];

interface LaunchedColdStart {
  readonly profileId: string;
  readonly runId: string;
  readonly stream: ReadableStream<Uint8Array>;
}

const COMPANION_LABELS: Readonly<Record<Companion["relationship"], string>> = {
  spouse: "Супруг или супруга",
  minor_child: "Несовершеннолетний ребёнок",
  other_family: "Другой член семьи",
};

export function ColdStartStart() {
  const [countryInput, setCountryInput] = useState("Словения");
  const [monthlyIncome, setMonthlyIncome] = useState("210000");
  const [companions, setCompanions] = useState<readonly Companion[]>([]);
  const [companionType, setCompanionType] = useState<Companion["relationship"]>("spouse");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [launched, setLaunched] = useState<LaunchedColdStart>();

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
    if (countryInput.trim().toLocaleLowerCase("ru-RU") !== "словения") {
      setError("Пока доступна только Словения.");
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/cold-start", {
        body: JSON.stringify({ countryInput: "Словения", profile }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as unknown;
        const code = typeof body === "object" && body !== null && "code" in body
          ? body.code
          : undefined;
        throw new Error(code === "invalid_input" ? "invalid_input" : "request_failed");
      }
      const opened = openColdStartStreamResponse(response);
      replaceColdStartRunUrl(opened.runId, opened.profileId);
      setLaunched(opened);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message === "invalid_input"
          ? "Профиль не прошёл проверку. Проверьте введённые значения."
          : "Проверка не запущена. Попробуйте ещё раз.",
      );
    } finally {
      setPending(false);
    }
  };

  if (launched !== undefined) {
    return (
      <ColdStartJourney
        profileId={launched.profileId}
        runId={launched.runId}
        stream={launched.stream}
      />
    );
  }

  return (
    <ProductShell activeDestination="overview" onDestinationChange={() => undefined} setup>
      <section aria-labelledby="cold-start-setup-heading" className="scenario-setup cold-start-setup">
        <header>
          <p className="eyebrow">VS-2 · честный cold start</p>
          <h1 id="cold-start-setup-heading">Проверить страну для релокации</h1>
          <p>
            Система заново проверит официальные источники и покажет только полученные шаги.
          </p>
        </header>
        <div className="scenario-setup__workspace">
          <form className="start-form" onSubmit={submit}>
            <fieldset>
              <legend>Маршрут</legend>
              <label>
                Страна
                <input
                  onChange={(event) => {
                    setCountryInput(event.currentTarget.value);
                    edited();
                  }}
                  value={countryInput}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Подтверждённый доход</legend>
              <label>
                Месячный доход, RUB
                <input
                  inputMode="decimal"
                  onChange={(event) => {
                    setMonthlyIncome(event.currentTarget.value);
                    edited();
                  }}
                  value={monthlyIncome}
                />
              </label>
              <p>После налогов · официальная удалённая работа на иностранного работодателя.</p>
            </fieldset>
            <fieldset>
              <legend>Сопровождающие</legend>
              {companions.length === 0 ? <p>Без сопровождающих</p> : (
                <ul className="cold-start-setup__companions">
                  {companions.map((companion, index) => (
                    <li key={`${companion.relationship}-${index}`}>
                      <span>{COMPANION_LABELS[companion.relationship]}</span>
                      <button
                        aria-label={`Удалить: ${COMPANION_LABELS[companion.relationship]}`}
                        onClick={() => {
                          setCompanions((current) => current.filter((_, itemIndex) => itemIndex !== index));
                          edited();
                        }}
                        type="button"
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label>
                Тип сопровождающего
                <select
                  onChange={(event) => {
                    setCompanionType(event.currentTarget.value as Companion["relationship"]);
                    edited();
                  }}
                  value={companionType}
                >
                  {Object.entries(COMPANION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  setCompanions((current) => [...current, { relationship: companionType }]);
                  edited();
                }}
                type="button"
              >
                Добавить сопровождающего
              </button>
            </fieldset>
            <section aria-labelledby="cold-start-review-heading" className="scenario-review">
              <h2 id="cold-start-review-heading">Проверка перед запуском</h2>
              <p>
                Россия, гражданство РФ, без высшего образования; опыт, срок паспорта и страховка
                пока не подтверждены.
              </p>
              <label className="profile-card__confirmation">
                <input
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.currentTarget.checked)}
                  type="checkbox"
                />
                Подтверждаю профиль и запускаю проверку официальных источников
              </label>
              <button disabled={!confirmed || pending} type="submit">
                {pending ? "Запускаем…" : "Запустить проверку"}
              </button>
              {error === undefined ? null : <p role="alert">{error}</p>}
            </section>
          </form>
          <aside className="scenario-summary">
            <p className="eyebrow">Что попадёт в проверку</p>
            <h2>Синтетический профиль</h2>
            <dl>
              <div><dt>Текущая страна</dt><dd>Россия</dd></div>
              <div><dt>Гражданство</dt><dd>РФ</dd></div>
              <div><dt>Образование</dt><dd>Без высшего</dd></div>
              <div><dt>Состав</dt><dd>{companions.length || "Один человек"}</dd></div>
            </dl>
          </aside>
        </div>
      </section>
    </ProductShell>
  );
}
