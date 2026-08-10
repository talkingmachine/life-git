import type { ProfileDraft } from "../../decision/profile";

interface ScenarioSummaryProps {
  readonly draft: ProfileDraft;
  readonly housingAll: string;
}

const incomeBasisLabels: Readonly<Record<ProfileDraft["incomeBasis"], string>> = {
  foreign_contract: "Иностранный контракт",
  albanian_employer_only: "Только албанский работодатель",
};

const companionBasisLabels: Readonly<Record<ProfileDraft["companionBasis"], string>> = {
  none: "Без спутника",
  family: "Семейный маршрут",
  independent: "Независимый маршрут",
  unknown: "Маршрут спутника не указан",
};

const relationshipLabels: Readonly<Record<ProfileDraft["relationship"], string>> = {
  none: "отношение не указано",
  spouse: "супруг",
  non_family: "не семья",
  other_family: "другой член семьи",
};

function formatAmount(amount: string, currency: "ALL" | "RUB"): string {
  const parsed = Number(amount);
  const value = Number.isFinite(parsed)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(parsed)
    : amount;
  return `${value} ${currency}`;
}

function companionRoute(draft: ProfileDraft): string {
  if (draft.companionBasis !== "family") return companionBasisLabels[draft.companionBasis];
  return `${companionBasisLabels.family}: ${relationshipLabels[draft.relationship]}`;
}

export function ScenarioSummary({ draft, housingAll }: ScenarioSummaryProps) {
  const acceptedConditions = Object.values(draft.conditions).filter(Boolean).length;

  return (
    <aside aria-label="Резюме сценария" className="scenario-summary" role="region">
      <p className="eyebrow">Перед запуском</p>
      <h2>Резюме сценария</h2>
      <p>Значения ниже — ввод пользователя и условия сценария для текущей проверки.</p>
      <dl>
        <div>
          <dt>Сценарий маршрута</dt>
          <dd>Россия → Тирана</dd>
        </div>
        <div>
          <dt>Ввод пользователя: доступные ресурсы</dt>
          <dd>{formatAmount(draft.availableResourcesAll, "ALL")}</dd>
        </div>
        <div>
          <dt>Ввод пользователя: месячный доход</dt>
          <dd>{formatAmount(draft.monthlyIncome.amount, draft.monthlyIncome.currency)}</dd>
        </div>
        <div>
          <dt>Ввод пользователя: основание дохода</dt>
          <dd>{incomeBasisLabels[draft.incomeBasis]}</dd>
        </div>
        <div>
          <dt>Ввод пользователя: исходное жильё C0</dt>
          <dd>{formatAmount(housingAll, "ALL")}</dd>
        </div>
        <div>
          <dt>Ввод пользователя: состав переезда</dt>
          <dd>{companionRoute(draft)}</dd>
        </div>
        <div>
          <dt>Принятые условия сценария</dt>
          <dd>{acceptedConditions}</dd>
        </div>
      </dl>
    </aside>
  );
}
