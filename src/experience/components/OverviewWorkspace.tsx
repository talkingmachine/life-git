import type { NarrativeRead } from "../../application/contracts";
import type { CommandCenterSummary } from "../view-model";
import { formatDecimal } from "../view-model";
import type { CommandCenterDestination } from "./ProductShell";

interface OverviewWorkspaceProps {
  readonly hasC0: boolean;
  readonly hasDiff: boolean;
  readonly marker: "green" | "yellow" | "red";
  readonly narrative: NarrativeRead;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly summary: CommandCenterSummary;
}

function nextDestination({
  hasC0,
  hasDiff,
  marker,
}: Pick<OverviewWorkspaceProps, "hasC0" | "hasDiff" | "marker">): CommandCenterDestination {
  if (marker !== "green") return "research";
  if (!hasC0) return "branch";
  if (!hasDiff) return "life-git";
  return "life-git";
}

const nextActionLabels: Readonly<Record<CommandCenterDestination, string>> = Object.freeze({
  overview: "Обзор",
  research: "Открыть проверку",
  branch: "Моя ветвь",
  "life-git": "Открыть Life Git",
  sources: "Открыть источники",
});

export function OverviewWorkspace({
  hasC0,
  hasDiff,
  marker,
  narrative,
  onDestinationChange,
  summary,
}: OverviewWorkspaceProps) {
  const destination = nextDestination({ hasC0, hasDiff, marker });

  return (
    <section aria-label="Обзор маршрута" className="journey-shell overview-workspace">
      <header className="journey-hero">
        <p className="eyebrow">VS-1 · подтверждённая жизнь</p>
        <h1 id="overview-heading">{narrative.headline}</h1>
        <ul>
          {narrative.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
        <p className="scope-note">
          Один заранее выбранный кандидат: Россия → Тирана. Это не глобальный рейтинг и не список лучших городов.
        </p>
      </header>
      <dl className="overview-workspace__summary">
        <div>
          <dt>Ветка</dt>
          <dd>{summary.branchLabel}</dd>
        </div>
        <div>
          <dt>Официальных фактов</dt>
          <dd>{summary.officialFacts}</dd>
        </div>
        <div>
          <dt>Нерешённых вопросов</dt>
          <dd>{summary.unresolvedItems}</dd>
        </div>
        {summary.knownResidualAll === undefined ? null : (
          <div>
            <dt>Известный остаток</dt>
            <dd>{formatDecimal(summary.knownResidualAll)} ALL</dd>
          </div>
        )}
      </dl>
      <button onClick={() => onDestinationChange(destination)} type="button">
        {nextActionLabels[destination]}
      </button>
    </section>
  );
}
