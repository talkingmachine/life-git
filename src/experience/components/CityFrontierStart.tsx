"use client";

import { useState, type FormEvent } from "react";

import type { CityFrontierSetupReadModel } from "../../application/city-frontier";

type CityCriteriaDraft = CityFrontierSetupReadModel["criteriaDraft"];

interface CityFrontierStartProps {
  readonly error?: string;
  readonly onStart: (criteria: CityCriteriaDraft) => void;
  readonly pending: boolean;
  readonly setup: CityFrontierSetupReadModel;
}

const CRITERION_LABELS = {
  safety: "Безопасность",
  long_term_rent: "Долгосрочная аренда",
  urban_transit: "Городской транспорт",
  fixed_broadband: "Фиксированный интернет",
} as const;

export function CityFrontierStart({
  error,
  onStart,
  pending,
  setup,
}: CityFrontierStartProps) {
  const [criteria, setCriteria] = useState<CityCriteriaDraft>(() =>
    structuredClone(setup.criteriaDraft));
  const [confirmed, setConfirmed] = useState(false);

  const updateCriterion = (
    index: number,
    update: Partial<CityCriteriaDraft[number]>,
  ) => {
    setCriteria((current) => current.map((criterion, itemIndex) =>
      itemIndex === index ? { ...criterion, ...update } : criterion) as unknown as CityCriteriaDraft);
    setConfirmed(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed || pending) return;
    onStart(criteria);
  };

  return (
    <section aria-labelledby="city-frontier-setup-heading" className="scenario-setup">
      <header>
        <p className="eyebrow">VS-4A · frontier городов</p>
        <h1 id="city-frontier-setup-heading">Исследовать города</h1>
        <p>
          Установленный каталог содержит {setup.catalogMemberCount} городов страны {setup.countryCode}.
        </p>
      </header>
      <form className="start-form" onSubmit={submit}>
        <fieldset>
          <legend>Критерии города</legend>
          {criteria.map((criterion, index) => {
            const definition = setup.criterionDefinitions[index];
            const label = CRITERION_LABELS[criterion.criterionId];
            return (
              <section key={criterion.criterionId}>
                <h2>{label}</h2>
                <p>{definition.definitionId} · {definition.unit}</p>
                <label>
                  Режим: {label}
                  <select
                    aria-label={`Режим: ${label}`}
                    onChange={(event) => updateCriterion(index, {
                      mode: event.currentTarget.value as "required" | "weighted",
                    })}
                    value={criterion.mode}
                  >
                    <option value="required">Обязательное</option>
                    <option value="weighted">Взвешенное</option>
                  </select>
                </label>
                <label>
                  Важность: {label}
                  <input
                    aria-label={`Важность: ${label}`}
                    max={5}
                    min={1}
                    onChange={(event) => updateCriterion(index, {
                      importance: Number(event.currentTarget.value) as 1 | 2 | 3 | 4 | 5,
                    })}
                    type="number"
                    value={criterion.importance}
                  />
                </label>
                <label>
                  Целевое значение: {label}
                  <input
                    aria-label={`Целевое значение: ${label}`}
                    onChange={(event) => updateCriterion(index, {
                      target: event.currentTarget.value,
                    })}
                    value={criterion.target}
                  />
                </label>
              </section>
            );
          })}
        </fieldset>
        <section className="scenario-review">
          <label className="profile-card__confirmation">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            Подтверждаю четыре критерия и ограничение установленного каталога
          </label>
          <button disabled={!confirmed || pending} type="submit">
            {pending ? "Запускаем…" : "Запустить поиск городов"}
          </button>
          {error === undefined ? null : <p role="alert">{error}</p>}
        </section>
      </form>
    </section>
  );
}
