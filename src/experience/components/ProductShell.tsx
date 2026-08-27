"use client";

import { useState, type ReactNode } from "react";

import { ContextBar } from "./ContextBar";
import type { CommandCenterContext } from "./ContextBar";
import { NavigationRail } from "./NavigationRail";
import type { CommandCenterDestination } from "./NavigationRail";
import {
  WorkspaceGlobe,
  type WorkspaceGlobeMode,
} from "./WorkspaceGlobe";
import type { WorkspaceGlobePresentation } from "../research-map/contracts";

export type { CommandCenterDestination } from "./NavigationRail";
export type { CommandCenterContext, CommandCenterStatus } from "./ContextBar";

export interface ProductShellProps {
  readonly activeDestination: CommandCenterDestination;
  readonly children: ReactNode;
  readonly context?: CommandCenterContext;
  readonly globe?: WorkspaceGlobePresentation;
  readonly globeMode?: WorkspaceGlobeMode;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly setup?: boolean;
}

export function ProductShell({
  activeDestination,
  children,
  context,
  globe,
  globeMode = "background",
  onDestinationChange,
  setup = false,
}: ProductShellProps) {
  const [railExpanded, setRailExpanded] = useState(false);

  return (
    <div
      className="product-shell"
      data-rail-expanded={railExpanded}
      data-setup={setup || undefined}
    >
      {setup ? null : (
        <NavigationRail
          activeDestination={activeDestination}
          expanded={railExpanded}
          onDestinationChange={onDestinationChange}
          onExpandedChange={setRailExpanded}
        />
      )}
      <div className="product-shell__workspace" data-globe-mode={globeMode}>
        {setup || context === undefined ? null : (
          <WorkspaceGlobe
            mode={globeMode}
            presentation={globe}
            status={context.status}
          />
        )}
        {context === undefined ? null : <ContextBar context={context} />}
        <main className="product-shell__content">{children}</main>
      </div>
    </div>
  );
}
