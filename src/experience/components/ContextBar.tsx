import { UiIcon, type UiIconName } from "./UiIcon";

export type CommandCenterStatus = "pending" | "green" | "yellow" | "red";

export interface CommandCenterContext {
  readonly route: string;
  readonly branch: string;
  readonly snapshot: string;
  readonly status: CommandCenterStatus;
}

interface ContextBarProps {
  readonly context: CommandCenterContext;
}

const statusPresentation: Record<CommandCenterStatus, { readonly icon: UiIconName; readonly label: string }> = {
  pending: { icon: "status-pending", label: "Идёт проверка" },
  green: { icon: "status-green", label: "Подтверждено в scope" },
  yellow: { icon: "status-yellow", label: "Нужно уточнить" },
  red: { icon: "status-red", label: "Не подходит" },
};

export function ContextBar({ context }: ContextBarProps) {
  const status = statusPresentation[context.status];

  return (
    <header aria-label="Контекст рабочего пространства" className="context-bar">
      <dl className="context-bar__details">
        <div>
          <dt>Маршрут</dt>
          <dd>{context.route}</dd>
        </div>
        <div>
          <dt>Ветка</dt>
          <dd>{context.branch}</dd>
        </div>
        <div>
          <dt>Снимок</dt>
          <dd>{context.snapshot}</dd>
        </div>
      </dl>
      <span className={`context-bar__status context-bar__status--${context.status}`} role="status">
        <UiIcon className="context-bar__status-icon" name={status.icon} />
        <span>{status.label}</span>
      </span>
    </header>
  );
}
