import {
  ArrowClockwise,
  ArrowUpRight,
  Books,
  CheckCircle,
  CircleNotch,
  FirstAid,
  GitBranch,
  GitCommit,
  GlobeHemisphereWest,
  MagnifyingGlass,
  Minus,
  Plus,
  SidebarSimple,
  TrendUp,
  WarningCircle,
  Waves,
  XCircle,
} from "@phosphor-icons/react";

const UI_ICONS = {
  overview: GlobeHemisphereWest,
  research: MagnifyingGlass,
  branch: GitBranch,
  "life-git": GitCommit,
  sources: Books,
  "rail-toggle": SidebarSimple,
  "status-pending": CircleNotch,
  "status-green": CheckCircle,
  "status-yellow": WarningCircle,
  "status-red": XCircle,
  medical: FirstAid,
  sea: Waves,
  income: TrendUp,
  external: ArrowUpRight,
  expand: Plus,
  collapse: Minus,
  retry: ArrowClockwise,
} as const;

export type UiIconName = keyof typeof UI_ICONS;

interface UiIconProps {
  readonly className?: string;
  readonly name: UiIconName;
  readonly size?: number;
  readonly weight?: "regular" | "duotone";
}

export function UiIcon({ className, name, size = 20, weight = "regular" }: UiIconProps) {
  const Icon = UI_ICONS[name];
  return (
    <span aria-hidden="true" className={className} data-icon={name}>
      <Icon focusable="false" size={size} weight={weight} />
    </span>
  );
}
