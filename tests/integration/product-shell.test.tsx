// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductShell,
  type CommandCenterStatus,
} from "../../src/experience/components/ProductShell";
import {
  NEUTRAL_WORKSPACE_GLOBE_PRESENTATION,
  WorkspaceGlobe,
} from "../../src/experience/components/WorkspaceGlobe";
import type {
  ResearchGlobeCanvasProps,
} from "../../src/experience/research-map/ResearchGlobeCanvas";

afterEach(cleanup);

const statusCases = [
  { status: "pending", icon: "status-pending", label: "Идёт проверка" },
  { status: "green", icon: "status-green", label: "Подтверждено в scope" },
  { status: "yellow", icon: "status-yellow", label: "Нужно уточнить" },
  { status: "red", icon: "status-red", label: "Не подходит" },
] satisfies readonly {
  readonly status: CommandCenterStatus;
  readonly icon: string;
  readonly label: string;
}[];

describe("responsive product shell", () => {
  it("renders one explicit neutral globe during setup without inventing route context", () => {
    const shell = render(
      <ProductShell
        activeDestination="overview"
        globe={NEUTRAL_WORKSPACE_GLOBE_PRESENTATION}
        globeMode="onboarding"
        onDestinationChange={() => undefined}
        setup
      >
        <p>Анкета и чат</p>
      </ProductShell>,
    );

    const workspace = shell.container.querySelector(".product-shell__workspace");
    const globe = screen.getByRole("region", {
      name: "3D Земля без выбранного маршрута",
    });
    expect(screen.queryByRole("navigation", { name: /основная навигация/i })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(workspace?.getAttribute("data-globe-mode")).toBe("onboarding");
    expect(workspace?.querySelectorAll(".workspace-globe")).toHaveLength(1);
    expect(workspace?.firstElementChild).toBe(globe);
    expect(globe.getAttribute("data-mode")).toBe("onboarding");
    expect(within(workspace!.querySelector("main")!).getByText("Анкета и чат")).toBeTruthy();
    expect(shell.container.textContent).not.toMatch(
      /Идёт проверка|Подтверждено в scope|Нужно уточнить|Не подходит/,
    );
  });

  it("keeps legacy setup shells globe-free when no presentation is explicit", () => {
    const shell = render(
      <ProductShell activeDestination="overview" onDestinationChange={() => undefined} setup>
        <p>Legacy setup</p>
      </ProductShell>,
    );

    expect(shell.container.querySelector(".workspace-globe")).toBeNull();
    expect(screen.queryByRole("navigation", { name: /основная навигация/i })).toBeNull();
    expect(screen.getByRole("main").textContent).toContain("Legacy setup");
  });

  it("projects the closed neutral scene to the shared canvas without routed inputs", () => {
    const renderGlobe = vi.fn<(props: ResearchGlobeCanvasProps) => ReactNode>(() => (
      <div data-testid="neutral-globe-engine" />
    ));
    render(
      <WorkspaceGlobe
        presentation={NEUTRAL_WORKSPACE_GLOBE_PRESENTATION}
        renderGlobe={renderGlobe}
      />,
    );

    expect(screen.getByTestId("neutral-globe-engine")).toBeTruthy();
    expect(renderGlobe).toHaveBeenCalled();
    const props = renderGlobe.mock.calls[renderGlobe.mock.calls.length - 1]![0];
    expect(props).toEqual(expect.objectContaining({
      backgroundColor: "#061014",
      idleRotation: true,
      overview: { coordinates: [], key: -1 },
      routes: [],
    }));
    expect(props.activeFlight).toBeUndefined();
    expect(props.origin).toBeUndefined();
    expect(Object.isFrozen(NEUTRAL_WORKSPACE_GLOBE_PRESENTATION)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_WORKSPACE_GLOBE_PRESENTATION.overview)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_WORKSPACE_GLOBE_PRESENTATION.overview.coordinates)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_WORKSPACE_GLOBE_PRESENTATION.routes)).toBe(true);
  });

  it("does not widen the routed canvas input shape with neutral-only controls", () => {
    const renderGlobe = vi.fn<(props: ResearchGlobeCanvasProps) => ReactNode>(() => (
      <div data-testid="routed-globe-engine" />
    ));
    render(<WorkspaceGlobe renderGlobe={renderGlobe} status="green" />);

    const props = renderGlobe.mock.calls[0]![0];
    expect(Object.keys(props).sort()).toEqual([
      "activeFlight",
      "backgroundColor",
      "onFlightComplete",
      "onReady",
      "onUnavailable",
      "origin",
      "overview",
      "routes",
    ]);
    expect(props.origin).toEqual(expect.objectContaining({ city: "Москва", country: "Россия" }));
    expect(props.routes).toEqual([
      expect.objectContaining({ city: "Тирана", country: "Албания" }),
    ]);
  });

  it.each(statusCases)("renders the exact $status context status semantics", ({ icon, label, status }) => {
    render(
      <ProductShell
        activeDestination="overview"
        context={{ route: "Россия → Тирана", branch: "C0", snapshot: "06.08.2026", status }}
        onDestinationChange={() => undefined}
      >
        <p>Workspace content</p>
      </ProductShell>,
    );

    const badge = screen.getByRole("status");
    const statusIcon = badge.querySelector(".context-bar__status-icon");
    expect(statusIcon?.getAttribute("data-icon")).toBe(icon);
    expect(statusIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(within(badge).getByText(label)).toBeTruthy();
    expect(badge.textContent?.trim()).toContain(label);
  });

  it("provides accessible destination navigation and route context", () => {
    const change = vi.fn();

    render(
      <ProductShell
        activeDestination="overview"
        context={{ route: "Россия → Тирана", branch: "C0", snapshot: "06.08.2026", status: "green" }}
        onDestinationChange={change}
      >
        <p>Workspace content</p>
      </ProductShell>,
    );

    const navigation = screen.getByRole("navigation", { name: /основная навигация/i });
    expect(screen.getAllByRole("navigation", { name: /основная навигация/i })).toHaveLength(1);
    const mainRegions = screen.getAllByRole("main");
    expect(mainRegions).toHaveLength(1);
    expect(mainRegions[0]?.hidden).toBe(false);
    expect(mainRegions[0]?.getAttribute("aria-hidden")).not.toBe("true");
    expect(within(mainRegions[0]!).getByText("Workspace content")).toBeTruthy();
    expect(screen.getByRole("button", { name: /обзор/i }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: /источники/i }));
    expect(change).toHaveBeenCalledWith("sources");
    expect(screen.getByText("Россия → Тирана")).toBeTruthy();
    expect(screen.getByText(/C0/)).toBeTruthy();
    expect(screen.getByText("06.08.2026")).toBeTruthy();
    expect(screen.getAllByText(/подтверждено/i).length).toBeGreaterThan(0);

    const controls = within(navigation)
      .getAllByRole("button")
      .filter((control) => control.dataset.destination !== undefined);
    expect(controls.map((control) => control.dataset.destination)).toEqual([
      "overview",
      "research",
      "branch",
      "life-git",
      "sources",
    ]);
    expect(controls.map((control) => control.querySelector(".navigation-rail__label")?.textContent)).toEqual([
      "Обзор",
      "Проверка",
      "Моя ветвь",
      "Life Git",
      "Источники",
    ]);
    for (const control of controls) {
      expect(control.querySelector('[data-icon]')).toBeTruthy();
      expect(control.getAttribute("aria-label")).toBe(
        control.querySelector(".navigation-rail__label")?.textContent,
      );
      expect(control.querySelector(".navigation-rail__label")?.classList.contains("visually-hidden")).toBe(true);
      expect(control.querySelector(".navigation-rail__label")?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("expands the navigation rail while retaining accessible destination names", () => {
    const shell = render(
      <ProductShell
        activeDestination="overview"
        context={{ route: "Россия → Тирана", branch: "C0", snapshot: "06.08.2026", status: "green" }}
        onDestinationChange={() => undefined}
      >
        Workspace
      </ProductShell>,
    );

    const toggle = screen.getByRole("button", { name: /раскрыть навигацию/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(shell.container.querySelector(".product-shell")?.getAttribute("data-rail-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /обзор/i }).querySelector('[data-icon="overview"]')).toBeTruthy();

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: /свернуть навигацию/i }).getAttribute("aria-expanded")).toBe("true");
    expect(shell.container.querySelector(".product-shell")?.getAttribute("data-rail-expanded")).toBe("true");
    expect(screen.getByText("Обзор").classList.contains("visually-hidden")).toBe(false);
  });

  it("keeps one shared globe before active workspace content when destinations change", () => {
    const context = {
      route: "Россия → Тирана",
      branch: "C0",
      snapshot: "06.08.2026",
      status: "green" as const,
    };
    const { rerender } = render(
      <ProductShell
        activeDestination="overview"
        context={context}
        onDestinationChange={() => undefined}
      >
        <p>Overview content</p>
      </ProductShell>,
    );

    const workspace = document.querySelector(".product-shell__workspace");
    expect(workspace?.querySelectorAll(".workspace-globe")).toHaveLength(1);
    expect(workspace?.firstElementChild?.classList.contains("workspace-globe")).toBe(true);
    expect(workspace?.querySelector("main")?.textContent).toContain("Overview content");

    rerender(
      <ProductShell
        activeDestination="sources"
        context={context}
        onDestinationChange={() => undefined}
      >
        <p>Sources content</p>
      </ProductShell>,
    );

    expect(workspace?.querySelectorAll(".workspace-globe")).toHaveLength(1);
    expect(workspace?.querySelector("main")?.textContent).toContain("Sources content");
  });

  it("keeps the same globe instance when a frontier changes from full to collapsed", () => {
    const context = {
      route: "Россия → страны",
      branch: "Проверка стран",
      snapshot: "ranking-1",
      status: "pending" as const,
    };
    const shell = render(
      <ProductShell activeDestination="research" context={context} globeMode="full"
        onDestinationChange={() => undefined}>
        <p>Frontier</p>
      </ProductShell>,
    );
    const globe = shell.container.querySelector(".workspace-globe");
    const sentinel = Symbol("same-product-shell-globe");
    Object.assign(globe!, { sentinel });
    expect(globe?.getAttribute("data-mode")).toBe("full");

    shell.rerender(
      <ProductShell activeDestination="research" context={{ ...context, status: "yellow" }}
        globeMode="collapsed" onDestinationChange={() => undefined}>
        <p>Frontier cards</p>
      </ProductShell>,
    );

    expect(shell.container.querySelector(".workspace-globe")).toBe(globe);
    expect((shell.container.querySelector(".workspace-globe") as Element & {
      sentinel?: symbol;
    }).sentinel).toBe(sentinel);
    expect(globe?.getAttribute("data-mode")).toBe("collapsed");
  });
});
