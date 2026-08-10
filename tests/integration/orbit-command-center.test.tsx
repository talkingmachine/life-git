// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => function RejectedGlobeModule() {
    throw new Error("ResearchGlobeCanvas module failed to load");
  },
}));

import { WorkspaceGlobe } from "../../src/experience/components/WorkspaceGlobe";
import {
  CompactProfilePanel,
  DestinationDetailPanel,
  RouteCandidatePanel,
} from "../../src/experience/components/OrbitPanels";

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

describe("Orbit command center", () => {
  it("passes the fixed route and bundled dark background to the shared globe", () => {
    const renderGlobe = vi.fn(() => <div data-testid="research-globe-engine" />);
    render(<WorkspaceGlobe renderGlobe={renderGlobe} status="green" />);

    expect(screen.getByRole("region", { name: /3D Земля.*Россия.*Тирана/i })).toBeTruthy();
    expect(screen.getByTestId("research-globe-engine")).toBeTruthy();
    expect(renderGlobe).toHaveBeenCalledWith(expect.objectContaining({
      backgroundColor: "#061014",
      origin: expect.objectContaining({ city: "Москва", country: "Россия" }),
      routes: [expect.objectContaining({ city: "Тирана", country: "Албания" })],
    }));
  });

  it("offers the retry control when the dynamic globe module rejects", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<WorkspaceGlobe status="green" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /повторить загрузку 3D Земли/i })).toBeTruthy();
    });

    getContext.mockRestore();
    consoleError.mockRestore();
  });

  it("presents the single scoped candidate as a floating search result", () => {
    render(<RouteCandidatePanel marker="green" unresolvedItems={2} />);

    expect(screen.getByRole("heading", { name: "Найденный маршрут" })).toBeTruthy();
    expect(screen.getByText("Тирана, Албания")).toBeTruthy();
    expect(screen.getByText(/единственный кандидат/i)).toBeTruthy();
    expect(screen.getByText("2 вопроса требуют проверки")).toBeTruthy();
  });

  it("expands the confirmed profile without pretending it is editable", () => {
    render(<CompactProfilePanel profile={{
      housingAll: "70000",
      incomeBasis: "foreign_contract",
      monthlyIncomeRub: "210000",
      availableResourcesAll: "500000",
      companionMode: "none",
      conditions: {
        incomeContinues12Months: true,
        lawfulStayPrerequisiteAccepted: true,
        stagedSpouseRouteAccepted: false,
      },
    }} />);

    const toggle = screen.getByRole("button", { name: /показать подтверждённый профиль/i });
    expect(screen.queryByText("500 000 ALL")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("500 000 ALL")).toBeTruthy();
    expect(screen.getByText(/неизменяемый снимок/i)).toBeTruthy();
  });

  it("labels unsupported destination traits as unexplored", () => {
    render(<DestinationDetailPanel marker="green" />);

    expect(screen.getByRole("heading", { name: "Тирана" })).toBeTruthy();
    expect(screen.getByText("Албания")).toBeTruthy();
    expect(screen.getByText("Медицина").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText("Море").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText("Доходы").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText(/внж и пмж/i).closest("section")?.textContent).toMatch(/официальн.*источник/i);
  });
});
