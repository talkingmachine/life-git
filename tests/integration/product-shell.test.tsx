// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductShell,
  type CommandCenterStatus,
} from "../../src/experience/components/ProductShell";

afterEach(cleanup);

const statusCases = [
  { status: "pending", icon: "…", label: "Идёт проверка" },
  { status: "green", icon: "✓", label: "Подтверждено в scope" },
  { status: "yellow", icon: "!", label: "Нужно уточнить" },
  { status: "red", icon: "×", label: "Не подходит" },
] satisfies readonly {
  readonly status: CommandCenterStatus;
  readonly icon: string;
  readonly label: string;
}[];

describe("responsive product shell", () => {
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
    expect(statusIcon?.textContent).toBe(icon);
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

    const controls = within(navigation).getAllByRole("button");
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
      "Ветка",
      "Life Git",
      "Источники",
    ]);
    for (const control of controls) {
      expect(control.querySelector('[aria-hidden="true"]')).toBeTruthy();
      expect(control.getAttribute("aria-label")?.trim().length).toBeGreaterThan(0);
      expect(control.querySelector(".navigation-rail__label")?.classList.contains("visually-hidden")).toBe(true);
      expect(control.querySelector(".navigation-rail__label")?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });
});
