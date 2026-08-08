"use client";

import { useState } from "react";

export interface ProfileCardData {
  housingAll: string;
  hasContract: boolean;
  hasResources: boolean;
  hasLawfulStay: boolean;
  companionMode: "staged" | "none" | "separate";
}

interface ProfileCardProps {
  profile: ProfileCardData;
  onConfirm: () => void;
}

function formatAll(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function ProfileCard({ profile, onConfirm }: ProfileCardProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <section aria-labelledby="profile-heading" className="profile-card">
      <h2 id="profile-heading">Исходный профиль</h2>
      <ul>
        <li>Жильё: {formatAll(profile.housingAll)} ALL</li>
        <li>{profile.hasContract ? "Контракт: ввод пользователя" : "Контракт: не указан пользователем"}</li>
        <li>{profile.hasResources ? "Ресурсы: ввод пользователя" : "Ресурсы: не указаны пользователем"}</li>
        <li>{profile.hasLawfulStay ? "Законное пребывание: условие сценария" : "Законное пребывание: не заявлено"}</li>
        <li>{
          profile.companionMode === "staged"
            ? "Спутник: поэтапно — условие сценария"
            : profile.companionMode === "none"
              ? "Маршрут без спутника"
              : "Спутник: отдельный маршрут требует проверки"
        }</li>
      </ul>
      <label className="profile-card__confirmation">
        <input
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          type="checkbox"
        />
        Подтверждаю исходные условия
      </label>
      <button disabled={!confirmed} onClick={onConfirm} type="button">
        Подтвердить профиль
      </button>
    </section>
  );
}
