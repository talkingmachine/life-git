"use client";

import type { CityFrontierReadModel } from "../../application/city-frontier-contracts";
import type {
  CityFrontierCardView,
  CityFrontierView,
} from "../city-frontier-view-model";

interface CityFrontierCardsProps {
  readonly cards: CityFrontierView["cards"];
  readonly error?: string;
  readonly onSelect: (card: CityFrontierCardView) => void;
  readonly pendingCityId?: string;
  readonly registry: CityFrontierReadModel["registry"];
  readonly selectionHistory: NonNullable<CityFrontierView["selectionHistory"]>;
  readonly selectionEnabled: boolean;
}

const UNKNOWN_RISK_COPY =
  "По одному или нескольким критериям сохранены неполные данные.";

export function CityFrontierCards({
  cards,
  error,
  onSelect,
  pendingCityId,
  registry,
  selectionEnabled,
  selectionHistory,
}: CityFrontierCardsProps) {
  return (
    <section aria-label="Города для выбора" className="research-workspace">
      {error === undefined ? null : <p role="alert">{error}</p>}
      <ul aria-label="Карточки городов">
        {cards.map((card) => (
          <li className="orbit-panel" key={card.city.cityId}>
            <h3>{card.city.officialName}</h3>
            <p>{card.statusLabel}</p>
            <p>Место в рейтинге: {card.rank}</p>
            <p>Оценка: {card.score}</p>
            <p>Покрытие: {card.coverage}</p>
            {card.status === "yellow" ? <p>{UNKNOWN_RISK_COPY}</p> : null}
            {selectionEnabled ? (
              <button
                disabled={pendingCityId !== undefined}
                onClick={() => onSelect(card)}
                type="button"
              >
                Выбрать город
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {selectionHistory.length === 0 ? null : (
        <section aria-label="История выбора города">
          {selectionHistory.map(({ commit, selection }) => {
            const city = registry.entries.find(({ cityId }) => cityId === selection.cityId);
            if (city === undefined) throw new Error("invalid_city_selection_history_view");
            return (
              <article key={selection.id}>
                <p>Выбранный город: {city.officialName}</p>
                <p>{commit.id}</p>
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}
