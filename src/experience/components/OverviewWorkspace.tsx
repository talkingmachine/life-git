import type { NarrativeRead } from "../../application/contracts";
import type { CommandCenterSummary } from "../view-model";
import { formatDecimal } from "../view-model";
import type { CommandCenterDestination } from "./ProductShell";
import type { ProfileCardData } from "./ProfileCard";
import { OrbitGlobe } from "./OrbitGlobe";
import {
  CompactProfilePanel,
  DestinationDetailPanel,
  RouteCandidatePanel,
} from "./OrbitPanels";

interface OverviewWorkspaceProps {
  readonly hasC0: boolean;
  readonly hasDiff: boolean;
  readonly marker: "green" | "yellow" | "red";
  readonly narrative: NarrativeRead;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly profile: ProfileCardData;
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
  profile,
  summary,
}: OverviewWorkspaceProps) {
  const destination = nextDestination({ hasC0, hasDiff, marker });

  return (
    <section aria-label="Обзор маршрута" className="overview-workspace overview-workspace--orbit">
      <h1 className="visually-hidden" id="overview-heading">{narrative.headline}</h1>
      <OrbitGlobe destination="Тирана" origin="Россия" status={marker} />
      <RouteCandidatePanel marker={marker} unresolvedItems={summary.unresolvedItems} />
      <CompactProfilePanel profile={profile} />
      <DestinationDetailPanel marker={marker} />
      <div className="orbit-panel overview-workspace__telemetry" aria-label="Сводка проверки">
        <span>{summary.branchLabel}</span>
        <span aria-hidden="true">{summary.officialFacts} фактов</span>
        <span className="visually-hidden">{summary.officialFacts} официальных фактов</span>
        <span aria-hidden="true">{summary.unresolvedItems} вопросов</span>
        <span className="visually-hidden">Нерешённых вопросов: {summary.unresolvedItems}</span>
        {summary.knownResidualAll === undefined ? null : (
          <span className="visually-hidden">Известный остаток: {formatDecimal(summary.knownResidualAll)} ALL</span>
        )}
        <button onClick={() => onDestinationChange(destination)} type="button">
          {nextActionLabels[destination]}
        </button>
      </div>
    </section>
  );
}
