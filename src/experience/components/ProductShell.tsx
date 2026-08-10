"use client";

import type { ReactNode } from "react";

import { ContextBar } from "./ContextBar";
import type { CommandCenterContext } from "./ContextBar";
import { NavigationRail } from "./NavigationRail";
import type { CommandCenterDestination } from "./NavigationRail";

export type { CommandCenterDestination } from "./NavigationRail";
export type { CommandCenterContext, CommandCenterStatus } from "./ContextBar";

export interface ProductShellProps {
  readonly activeDestination: CommandCenterDestination;
  readonly children: ReactNode;
  readonly context?: CommandCenterContext;
  readonly onDestinationChange: (destination: CommandCenterDestination) => void;
  readonly setup?: boolean;
}

export function ProductShell({
  activeDestination,
  children,
  context,
  onDestinationChange,
  setup = false,
}: ProductShellProps) {
  return (
    <div className="product-shell" data-setup={setup ? "true" : undefined}>
      <NavigationRail
        activeDestination={activeDestination}
        onDestinationChange={onDestinationChange}
      />
      <div className="product-shell__workspace">
        {context === undefined ? null : <ContextBar context={context} />}
        <main className="product-shell__content">{children}</main>
      </div>
    </div>
  );
}
