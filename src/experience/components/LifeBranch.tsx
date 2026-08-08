import type { BudgetView } from "../view-model";
import { formatDecimal } from "../view-model";

interface LifeBranchProps {
  budget: BudgetView;
}

const unknownLabels: Record<string, string> = {
  taxes: "Налоги",
  living_costs: "Стоимость жизни",
};

export function LifeBranch({ budget }: LifeBranchProps) {
  const stages = [
    { key: "income", label: "Доход", value: budget.incomeAll },
    { key: "housing", label: "Жильё", value: budget.housingAll },
    { key: "residual", label: "Известный остаток", value: budget.knownResidualAll },
  ] as const;

  return (
    <figure aria-label="Поток бюджета" className="budget-flow">
      <figcaption>Ветка бюджета</figcaption>
      <div className="budget-flow__bars">
        {stages.map((stage) => (
          <div className={`budget-flow__bar budget-flow__bar--${stage.key}`} data-testid="budget-bar" key={stage.key}>
            <span>{stage.label}</span>
            <strong>{formatDecimal(stage.value)} ALL</strong>
          </div>
        ))}
      </div>
      <ul className="budget-flow__unknowns">
        {budget.unknowns.map((unknown) => (
          <li key={unknown}>{unknownLabels[unknown] ?? unknown}: неизвестно</li>
        ))}
      </ul>
    </figure>
  );
}
