// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const dynamicHarness = vi.hoisted(() => ({
  dynamicCalls: vi.fn(),
  load: vi.fn(),
}));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  interface LoadingProps {
    readonly error: Error | null;
    readonly isLoading: boolean;
    readonly pastDelay: boolean;
    readonly retry: () => void;
    readonly timedOut: boolean;
  }
  interface DynamicOptions {
    readonly loading?: (props: LoadingProps) => ReactNode;
  }
  return {
    default: (_loader: () => Promise<unknown>, options: DynamicOptions) => {
      dynamicHarness.dynamicCalls();
      const listeners = new Set<() => void>();
      let started = false;
      let version = 0;
      let state: {
        error?: Error;
        loaded?: ComponentType<Record<string, unknown>>;
      } = {};
      const notify = () => {
        version += 1;
        listeners.forEach((listener) => listener());
      };
      const start = () => {
        if (started) return;
        started = true;
        void dynamicHarness.load().then(
          (loaded: ComponentType<Record<string, unknown>>) => {
            state = { loaded };
            notify();
          },
          (error: Error) => {
            state = { error };
            notify();
          },
        );
      };
      return function ControlledDynamic(props: Record<string, unknown>) {
        start();
        React.useSyncExternalStore(
          (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          () => version,
          () => version,
        );
        if (state.error !== undefined) {
          return options.loading?.({
            error: state.error,
            isLoading: false,
            pastDelay: true,
            retry: () => undefined,
            timedOut: false,
          }) ?? null;
        }
        if (state.loaded !== undefined) return React.createElement(state.loaded, props);
        return options.loading?.({
          error: null,
          isLoading: true,
          pastDelay: false,
          retry: () => undefined,
          timedOut: false,
        }) ?? null;
      };
    },
  };
});

import { WorkspaceGlobe } from "../../src/experience/components/WorkspaceGlobe";
import type { ResearchGlobeCanvasProps } from "../../src/experience/research-map/ResearchGlobeCanvas";
import {
  CompactProfilePanel,
  DestinationDetailPanel,
  RouteCandidatePanel,
} from "../../src/experience/components/OrbitPanels";

afterEach(cleanup);
afterEach(() => {
  dynamicHarness.dynamicCalls.mockClear();
  dynamicHarness.load.mockReset();
  vi.unstubAllGlobals();
});

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

  it("keeps the shared flight lifecycle inputs stable across parent rerenders", () => {
    const renderGlobe = vi.fn((props: ResearchGlobeCanvasProps) => (
      <div data-flight-key={props.activeFlight?.key} data-testid="research-globe-engine" />
    ));
    const globe = render(<WorkspaceGlobe renderGlobe={renderGlobe} status="green" />);
    const firstProps = renderGlobe.mock.calls[0]?.[0];

    globe.rerender(<WorkspaceGlobe renderGlobe={renderGlobe} status="green" />);

    const nextProps = renderGlobe.mock.calls.at(-1)?.[0];
    expect(nextProps?.activeFlight).toBe(firstProps?.activeFlight);
    expect(nextProps?.routes).toBe(firstProps?.routes);
  });

  it("retries the globe locally after the dynamic module rejects", async () => {
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    dynamicHarness.load
      .mockRejectedValueOnce(new Error("ResearchGlobeCanvas chunk failed"))
      .mockResolvedValueOnce(() => <div data-testid="retried-globe" />);

    render(<WorkspaceGlobe status="green" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /повторить загрузку 3D Земли/i })).toBeTruthy();
    });
    expect(dynamicHarness.load).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /повторить загрузку 3D Земли/i }));
    await waitFor(() => {
      expect(screen.getByTestId("retried-globe")).toBeTruthy();
    });
    expect(dynamicHarness.load).toHaveBeenCalledTimes(2);
    expect(dynamicHarness.dynamicCalls.mock.calls.length).toBeGreaterThanOrEqual(2);

    getContext.mockRestore();
    consoleError.mockRestore();
  });

  it("presents the single scoped candidate as a floating search result", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <RouteCandidatePanel marker="green" onSelect={onSelect} unresolvedItems={2} />,
    );

    expect(screen.getByRole("heading", { name: "Найденный маршрут" })).toBeTruthy();
    expect(screen.getByText("Тирана, Албания")).toBeTruthy();
    expect(screen.getByText(/единственный кандидат/i)).toBeTruthy();
    expect(screen.getByText("2 вопроса требуют проверки")).toBeTruthy();
    expect(container.querySelector('[data-icon="status-green"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="external"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[●↗]/u);
    fireEvent.click(screen.getByRole("button", { name: /Тирана, Албания/i }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("expands the confirmed profile without pretending it is editable", () => {
    const { container } = render(<CompactProfilePanel profile={{
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
    expect(toggle.querySelector('[data-icon="expand"]')).toBeTruthy();
    expect(screen.queryByText("500 000 ALL")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.querySelector('[data-icon="collapse"]')).toBeTruthy();
    expect(screen.getByText("500 000 ALL")).toBeTruthy();
    expect(screen.getByText(/неизменяемый снимок/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/[+−]/u);
  });

  it("labels unsupported destination traits as unexplored", () => {
    const onOpenResearch = vi.fn();
    const { container } = render(
      <DestinationDetailPanel marker="green" onOpenResearch={onOpenResearch} />,
    );

    expect(screen.getByRole("heading", { name: "Тирана" })).toBeTruthy();
    expect(screen.getByText("Албания")).toBeTruthy();
    expect(screen.getByText("Медицина").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText("Море").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText("Доходы").closest("li")?.textContent).toMatch(/не исследовано/i);
    expect(screen.getByText(/внж и пмж/i).closest("section")?.textContent).toMatch(/официальн.*источник/i);
    expect(container.querySelector('[data-icon="status-green"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="medical"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="sea"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="income"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[✚≈↗●]/u);
    fireEvent.click(screen.getByRole("button", { name: "Открыть проверку" }));
    expect(onOpenResearch).toHaveBeenCalledOnce();
  });

  it.each(["green", "yellow", "red"] as const)("maps %s panel markers to a status icon", (marker) => {
    const { container } = render(
      <DestinationDetailPanel marker={marker} onOpenResearch={() => undefined} />,
    );

    expect(container.querySelector(`[data-icon="status-${marker}"]`)).toBeTruthy();
  });
});
