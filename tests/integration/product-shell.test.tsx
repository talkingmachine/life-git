// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductShell } from "../../src/experience/components/ProductShell";

afterEach(cleanup);

describe("responsive product shell", () => {
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
    expect(controls.map((control) => control.textContent?.trim())).toEqual([
      "◉Обзор",
      "⌕Проверка",
      "⑂Ветка",
      "⌘Life Git",
      "▤Источники",
    ]);
    for (const control of controls) {
      expect(control.textContent?.trim()).not.toBe("");
      expect(control.querySelector('[aria-hidden="true"]')).toBeTruthy();
    }
  });
});
