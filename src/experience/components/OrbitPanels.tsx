"use client";

import { useState } from "react";

import type { ProfileCardData } from "./ProfileCard";

type Marker = "green" | "yellow" | "red";

interface RouteCandidatePanelProps {
  readonly marker: Marker;
  readonly unresolvedItems: number;
}

interface CompactProfilePanelProps {
  readonly profile: ProfileCardData;
}

interface DestinationDetailPanelProps {
  readonly marker: Marker;
}

const markerCopy: Record<Marker, string> = {
  green: "Подтверждено в scope",
  yellow: "Нужно уточнить",
  red: "Не подходит",
};

function formatAmount(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function RouteCandidatePanel({ marker, unresolvedItems }: RouteCandidatePanelProps) {
  const questionWord = unresolvedItems % 10 === 1 && unresolvedItems % 100 !== 11
    ? "вопрос требует"
    : [2, 3, 4].includes(unresolvedItems % 10) && ![12, 13, 14].includes(unresolvedItems % 100)
      ? "вопроса требуют"
      : "вопросов требуют";
  const questionLabel = `${unresolvedItems} ${questionWord} проверки`;

  return (
    <section aria-labelledby="route-candidate-heading" className="orbit-panel route-candidate-panel">
      <p className="orbit-panel__index">01 / РЕЗУЛЬТАТ</p>
      <h2 id="route-candidate-heading">Найденный маршрут</h2>
      <button className="route-candidate-panel__candidate" type="button">
        <span aria-hidden="true" className={`signal signal--${marker}`}>●</span>
        <span>
          <strong>Тирана, Албания</strong>
          <small>Единственный кандидат текущего scope</small>
        </span>
        <span aria-hidden="true">↗</span>
      </button>
      <div className="route-candidate-panel__meta">
        <span>{markerCopy[marker]}</span>
        <span>{questionLabel}</span>
      </div>
    </section>
  );
}

export function CompactProfilePanel({ profile }: CompactProfilePanelProps) {
  const [isExpanded, setExpanded] = useState(false);
  const panelId = "compact-profile-details";

  return (
    <section aria-labelledby="compact-profile-heading" className="orbit-panel compact-profile-panel">
      <button
        aria-controls={panelId}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Скрыть" : "Показать"} подтверждённый профиль`}
        className="compact-profile-panel__toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="compact-profile-panel__avatar">VS</span>
        <span>
          <strong id="compact-profile-heading">Ваш сценарий</strong>
          <small>Снимок C0 · Россия → Тирана</small>
        </span>
        <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
      </button>
      {isExpanded ? (
        <div className="compact-profile-panel__details" id={panelId}>
          <dl>
            <div><dt>Ресурсы</dt><dd>{formatAmount(profile.availableResourcesAll)} ALL</dd></div>
            <div><dt>Доход</dt><dd>{formatAmount(profile.monthlyIncomeRub)} RUB</dd></div>
            <div><dt>Жильё</dt><dd>{formatAmount(profile.housingAll)} ALL</dd></div>
            <div><dt>Маршрут</dt><dd>{profile.companionMode === "none" ? "Без спутника" : "Со спутником"}</dd></div>
          </dl>
          <p>Неизменяемый снимок условий этого запуска. Новый ввод создаётся в отдельной ветке.</p>
        </div>
      ) : null}
    </section>
  );
}

const traits = [
  { icon: "✚", label: "Медицина" },
  { icon: "≈", label: "Море" },
  { icon: "↗", label: "Доходы" },
] as const;

export function DestinationDetailPanel({ marker }: DestinationDetailPanelProps) {
  return (
    <aside aria-labelledby="destination-heading" className="orbit-panel destination-detail-panel">
      <div aria-hidden="true" className="destination-detail-panel__image">
        <svg viewBox="0 0 520 260">
          <defs>
            <linearGradient id="tirana-sky" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#b9d8e4" />
              <stop offset="1" stopColor="#f2b694" />
            </linearGradient>
          </defs>
          <rect fill="url(#tirana-sky)" height="260" width="520" />
          <path d="M0 179L70 135l45 32 82-91 75 89 58-50 71 58 57-76 62 66v97H0z" fill="#dfe7e5" />
          <path d="M0 213l70-20 54 12 54-31 62 21 64-15 46 23 76-22 64 28 30-9v60H0z" fill="#78939a" />
          <g fill="#f4efe5">
            <rect height="76" width="48" x="55" y="155" /><rect height="104" width="62" x="115" y="127" />
            <rect height="66" width="51" x="188" y="165" /><rect height="91" width="70" x="253" y="140" />
            <rect height="55" width="56" x="339" y="176" /><rect height="85" width="68" x="410" y="146" />
          </g>
        </svg>
        <span>41.3275° N · 19.8187° E</span>
      </div>

      <header className="destination-detail-panel__header">
        <div>
          <p>АЛБАНИЯ / ВЫБРАНО</p>
          <h2 id="destination-heading">Тирана</h2>
          <span>Албания</span>
        </div>
        <span className={`destination-detail-panel__marker signal--${marker}`}>●</span>
      </header>

      <ul aria-label="Характеристики места" className="destination-detail-panel__traits">
        {traits.map((trait) => (
          <li key={trait.label}>
            <span aria-hidden="true" className="destination-detail-panel__trait-icon">{trait.icon}</span>
            <span><strong>{trait.label}</strong><small>Не исследовано</small></span>
          </li>
        ))}
      </ul>

      <section className="destination-detail-panel__copy">
        <h3>О месте</h3>
        <p>Город выбран заранее для технического маршрута VS-1. Сравнение с другими направлениями в этот запуск не входит.</p>
      </section>
      <section className="destination-detail-panel__copy">
        <h3>ВНЖ и ПМЖ</h3>
        <p>В подтверждённом scope доступны только проверенные условия сценария. Детали открываются вместе с официальными источниками.</p>
      </section>
      <button className="destination-detail-panel__action" type="button">Открыть проверку</button>
    </aside>
  );
}
