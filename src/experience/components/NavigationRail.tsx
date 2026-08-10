"use client";

import { UiIcon } from "./UiIcon";

export type CommandCenterDestination =
  | "overview"
  | "research"
  | "branch"
  | "life-git"
  | "sources";

interface NavigationRailProps {
  readonly activeDestination: CommandCenterDestination;
  readonly expanded: boolean;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly onExpandedChange: (expanded: boolean) => void;
}

const destinations: readonly {
  readonly id: CommandCenterDestination;
  readonly label: string;
}[] = [
  { id: "overview", label: "Обзор" },
  { id: "research", label: "Проверка" },
  { id: "branch", label: "Ветка" },
  { id: "life-git", label: "Life Git" },
  { id: "sources", label: "Источники" },
];

export function NavigationRail({
  activeDestination,
  expanded,
  onDestinationChange,
  onExpandedChange,
}: NavigationRailProps) {
  return (
    <nav aria-label="Основная навигация" className="navigation-rail navigation-rail--responsive">
      <ul className="navigation-rail__destinations">
        {destinations.map((destination) => {
          const isActive = destination.id === activeDestination;
          return (
            <li key={destination.id}>
              <button
                aria-label={destination.id === "branch" ? "Моя ветвь" : destination.label}
                aria-current={isActive ? "page" : undefined}
                className="navigation-rail__destination"
                data-destination={destination.id}
                onClick={() => onDestinationChange(destination.id)}
                type="button"
              >
                <UiIcon className="navigation-rail__icon" name={destination.id} />
                <span
                  className={`navigation-rail__label${expanded ? " navigation-rail__label--expanded" : " visually-hidden"}`}
                >
                  {destination.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        aria-expanded={expanded}
        aria-label={expanded ? "Свернуть навигацию" : "Раскрыть навигацию"}
        className="navigation-rail__toggle"
        onClick={() => onExpandedChange(!expanded)}
        type="button"
      >
        <UiIcon name="rail-toggle" />
      </button>
    </nav>
  );
}
