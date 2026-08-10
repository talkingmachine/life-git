"use client";

export type CommandCenterDestination =
  | "overview"
  | "research"
  | "branch"
  | "life-git"
  | "sources";

interface NavigationRailProps {
  readonly activeDestination: CommandCenterDestination;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
}

const destinations: readonly {
  readonly icon: string;
  readonly id: CommandCenterDestination;
  readonly label: string;
}[] = [
  { id: "overview", label: "Обзор", icon: "◉" },
  { id: "research", label: "Проверка", icon: "⌕" },
  { id: "branch", label: "Ветка", icon: "⑂" },
  { id: "life-git", label: "Life Git", icon: "⌘" },
  { id: "sources", label: "Источники", icon: "▤" },
];

export function NavigationRail({ activeDestination, onDestinationChange }: NavigationRailProps) {
  return (
    <nav aria-label="Основная навигация" className="navigation-rail navigation-rail--responsive">
      <ul className="navigation-rail__destinations">
        {destinations.map((destination) => {
          const isActive = destination.id === activeDestination;
          return (
            <li key={destination.id}>
              <button
                aria-label={destination.id === "branch" ? "Моя ветвь" : undefined}
                aria-current={isActive ? "page" : undefined}
                className="navigation-rail__destination"
                data-destination={destination.id}
                onClick={() => onDestinationChange(destination.id)}
                type="button"
              >
                <span aria-hidden="true" className="navigation-rail__icon">{destination.icon}</span>
                <span className="navigation-rail__label">{destination.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
