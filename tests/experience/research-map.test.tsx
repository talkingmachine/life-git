// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchMap } from "../../src/experience/components/ResearchMap";
import type { ResearchGlobeCanvasProps } from "../../src/experience/research-map/ResearchGlobeCanvas";
import type {
  CandidateState,
  GlobeUnavailableReason,
  ResearchCandidate,
} from "../../src/experience/research-map/contracts";
import {
  MOSCOW_ORIGIN,
  TIRANA_PRESENTATION,
} from "../../src/experience/research-map/product-route";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function candidate(status: CandidateState): ResearchCandidate {
  return {
    id: "tirana",
    ...TIRANA_PRESENTATION,
    status,
    ...(status === "yellow" || status === "red"
      ? {
          reason: {
            summary: "Источник временно недоступен",
            officialUrl: "https://official.example/al-law-79",
          },
        }
      : {}),
  };
}

function captureGlobe(): {
  readonly current: () => ResearchGlobeCanvasProps;
  readonly renderGlobe: (props: ResearchGlobeCanvasProps) => ReactNode;
} {
  let props: ResearchGlobeCanvasProps | undefined;
  return {
    current: () => {
      if (props === undefined) throw new Error("Globe props were not captured");
      return props;
    },
    renderGlobe: (next) => {
      props = next;
      return <div data-testid="globe" />;
    },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("ResearchMap product globe shell", () => {
  it.each(["green", "yellow", "red"] as const)(
    "renders a completed globe for an initial %s result without replay",
    (status) => {
      const globe = captureGlobe();
      const { container } = render(
        <ResearchMap
          candidates={[candidate(status)]}
          detectWebGL={() => true}
          mode={status}
          renderGlobe={globe.renderGlobe}
        />,
      );

      expect(globe.current().routes).toHaveLength(1);
      expect(globe.current().routes[0]?.status).toBe(status);
      expect(globe.current().activeFlight).toBeUndefined();
      expect(screen.getByRole("region", { name: /карта проверки маршрута/i })).toBeTruthy();
      expect(container.querySelector("[data-collapsed]" )).toBeNull();
    },
  );

  it("runs exactly one Moscow to Tirana flight while pending", () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        candidates={[candidate("pending")]}
        detectWebGL={() => true}
        mode="pending"
        renderGlobe={globe.renderGlobe}
      />,
    );

    expect(globe.current().origin).toEqual(MOSCOW_ORIGIN);
    expect(globe.current().activeFlight?.key).toBe("moscow-tirana");
    act(() => globe.current().onFlightComplete("moscow-tirana"));
    expect(globe.current().activeFlight).toBeUndefined();
    expect(globe.current().routes).toHaveLength(1);
  });

  it("remounts behind a loader before starting a terminal-to-pending flight", () => {
    const seenProps: ResearchGlobeCanvasProps[] = [];
    let mounts = 0;
    function MountProbe(): React.JSX.Element {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div data-testid="globe" />;
    }
    const renderGlobe = (next: ResearchGlobeCanvasProps) => {
      seenProps.push(next);
      return <MountProbe />;
    };
    const { rerender } = render(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        renderGlobe={renderGlobe}
      />,
    );
    const oldProps = seenProps.at(-1)!;
    act(() => oldProps.onReady());
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <ResearchMap
        candidates={[candidate("pending")]}
        detectWebGL={() => true}
        mode="pending"
        renderGlobe={renderGlobe}
      />,
    );
    const newProps = seenProps.at(-1)!;

    expect(mounts).toBe(2);
    expect(newProps.overview.key).toBeGreaterThan(oldProps.overview.key);
    expect(newProps.activeFlight?.key).toBe("moscow-tirana");
    expect(seenProps
      .filter((props) => props.overview.key === oldProps.overview.key)
      .every((props) => props.activeFlight === undefined)).toBe(true);
    expect(screen.getByRole("status")).toBeTruthy();

    act(() => oldProps.onReady());
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => newProps.onReady());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders a loader on the server without detecting WebGL or rendering an error", () => {
    const detectWebGL = vi.fn(() => false);
    const renderGlobe = vi.fn<(props: ResearchGlobeCanvasProps) => ReactNode>();

    const html = renderToString(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={detectWebGL}
        mode="green"
        renderGlobe={renderGlobe}
      />,
    );

    expect(detectWebGL).not.toHaveBeenCalled();
    expect(renderGlobe).not.toHaveBeenCalled();
    expect(html).toContain('role="status"');
    expect(html).toContain("Загружаем глобус и маршрут…");
    expect(html).not.toContain('role="alert"');
  });

  it("hydrates from checking loader before client capability enables the renderer", async () => {
    const detectWebGL = vi.fn(() => true);
    const globe = captureGlobe();
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={detectWebGL}
        mode="green"
        renderGlobe={globe.renderGlobe}
      />,
    );
    document.body.append(container);
    expect(container.querySelector('[role="status"]')).toBeTruthy();

    const root = hydrateRoot(
      container,
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={detectWebGL}
        mode="green"
        renderGlobe={globe.renderGlobe}
      />,
    );
    try {
      expect(container.querySelector('[role="status"]')).toBeTruthy();

      await act(async () => undefined);
      expect(detectWebGL).toHaveBeenCalledOnce();
      expect(globe.current().routes).toHaveLength(1);
      expect(container.querySelector('[role="status"]')).toBeTruthy();
      act(() => globe.current().onReady());
      expect(container.querySelector('[role="status"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("keeps an opaque status loader until the Canvas reports ready", () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={globe.renderGlobe}
      />,
    );

    const loader = screen.getByRole("status");
    expect(loader.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Загружаем глобус и маршрут…")).toBeTruthy();
    expect(screen.getByTestId("globe")).toBeTruthy();
    const interactiveLayer = screen.getByRole("region").querySelector("[inert]");
    expect(interactiveLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(interactiveLayer?.contains(screen.getByTestId("globe"))).toBe(true);

    act(() => globe.current().onReady());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("region").querySelector("[inert]")).toBeNull();
  });

  it("shows the mandatory error instead of mounting a renderer when WebGL is unsupported", () => {
    const renderGlobe = vi.fn<(props: ResearchGlobeCanvasProps) => ReactNode>();
    render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => false}
        mode="green"
        renderGlobe={renderGlobe}
      />,
    );

    expect(renderGlobe).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить глобус");
    expect(screen.getByText("Проверьте соединение и попробуйте снова.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    const interactiveLayer = screen.getByRole("region").querySelector("[inert]");
    expect(interactiveLayer?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("alert").closest("[inert]")).toBeNull();
  });

  it.each([
    "context-lost",
    "dynamic-import",
    "earth-material",
    "model-load",
    "react-render",
    "renderer-init",
    "webgl-unsupported",
  ] satisfies readonly GlobeUnavailableReason[])(
    "turns %s unavailability into the mandatory error overlay",
    (reason) => {
      const globe = captureGlobe();
      render(
        <ResearchMap
          candidates={[candidate("green")]}
          detectWebGL={() => true}
          mode="green"
          renderGlobe={globe.renderGlobe}
        />,
      );

      act(() => globe.current().onUnavailable(reason, new Error(reason)));
      expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить глобус");
      expect(screen.queryByRole("status")).toBeNull();
      const interactiveLayer = screen.getByRole("region").querySelector("[inert]");
      expect(interactiveLayer?.getAttribute("aria-hidden")).toBe("true");
      expect(interactiveLayer?.contains(screen.getByTestId("globe"))).toBe(true);
      expect(screen.getByRole("alert").closest("[inert]")).toBeNull();
    },
  );

  it("remounts the renderer under a fresh loader for a non-dynamic retry", () => {
    let props: ResearchGlobeCanvasProps | undefined;
    let mounts = 0;
    function MountProbe(): React.JSX.Element {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <div data-testid="globe-probe" />;
    }
    const renderGlobe = (next: ResearchGlobeCanvasProps) => {
      props = next;
      return <MountProbe />;
    };
    render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={renderGlobe}
      />,
    );

    act(() => props?.onUnavailable("renderer-init", new Error("renderer")));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

    expect(mounts).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByTestId("globe-probe")).toBeTruthy();
  });

  it("ignores ready, failure, and completion callbacks from an obsolete attempt", () => {
    const attempts = new Map<number, ResearchGlobeCanvasProps>();
    let latestProps: ResearchGlobeCanvasProps | undefined;
    const renderGlobe = (next: ResearchGlobeCanvasProps) => {
      attempts.set(next.overview.key, next);
      latestProps = next;
      return <div data-testid="globe" />;
    };
    render(
      <ResearchMap
        candidates={[candidate("pending")]}
        detectWebGL={() => true}
        mode="pending"
        renderGlobe={renderGlobe}
      />,
    );
    const oldProps = latestProps!;
    act(() => oldProps.onReady());
    act(() => oldProps.onUnavailable("renderer-init", new Error("first attempt")));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    const newProps = latestProps!;
    expect(newProps.overview.key).toBeGreaterThan(oldProps.overview.key);
    expect(attempts.size).toBe(2);
    expect(screen.getByRole("status")).toBeTruthy();

    act(() => {
      oldProps.onReady();
      oldProps.onUnavailable("model-load", new Error("late old failure"));
      oldProps.onFlightComplete("moscow-tirana");
    });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(latestProps?.activeFlight?.key).toBe("moscow-tirana");

    act(() => newProps.onReady());
    expect(screen.queryByRole("status")).toBeNull();
    act(() => newProps.onFlightComplete("moscow-tirana"));
    expect(latestProps?.activeFlight).toBeUndefined();
  });

  it("reloads the page for a dynamic-import retry", () => {
    const globe = captureGlobe();
    const reload = vi.fn();
    render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onUnavailable("dynamic-import", new Error("chunk")));
    const originalWindow = window;
    vi.stubGlobal("window", new Proxy(originalWindow, {
      get(target, property) {
        if (property === "location") return { reload };
        return Reflect.get(target, property, target);
      },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("turns a renderer exception into a react-render failure without alternate visuals", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={() => {
          throw new Error("render failed");
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить глобус");
    expect(screen.queryByTestId("globe")).toBeNull();
  });

  it("keeps yellow retry snapshot lineage above the mandatory globe", async () => {
    const globe = captureGlobe();
    const oldRun = Object.freeze({ runId: "run-old", evidenceSnapshotId: "snapshot-old" });
    const before = JSON.stringify(oldRun);
    const retry = vi.fn(async () => ({ runId: "run-new", evidenceSnapshotId: "snapshot-new" }));
    render(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={oldRun}
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onReady());

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));

    expect(await screen.findByText("Новый запуск: run-new")).toBeTruthy();
    expect(screen.getByText("Новый снимок: snapshot-new")).toBeTruthy();
    expect(screen.getByText("Предыдущий снимок: snapshot-old")).toBeTruthy();
    expect(screen.getByTestId("globe")).toBeTruthy();
    expect(retry).toHaveBeenCalledWith("run-old");
    expect(JSON.stringify(oldRun)).toBe(before);
  });

  it("resets yellow retry output for a new run and ignores a stale concurrent result", async () => {
    const globe = captureGlobe();
    const runA = deferred<{ runId: string; evidenceSnapshotId: string }>();
    const runB = deferred<{ runId: string; evidenceSnapshotId: string }>();
    const retry = vi.fn((runId: string) => runId === "run-a" ? runA.promise : runB.promise);
    const { rerender } = render(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={{ runId: "run-a", evidenceSnapshotId: "snapshot-a" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onReady());

    const retryButton = screen.getByRole("button", { name: /проверить ещё раз/i });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryButton.getAttribute("disabled")).not.toBeNull();

    rerender(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={{ runId: "run-b", evidenceSnapshotId: "snapshot-b" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    expect(screen.getByText("Предыдущий снимок: snapshot-b")).toBeTruthy();
    expect(screen.queryByText(/Новый запуск:/)).toBeNull();
    const runBButton = screen.getByRole("button", { name: /проверить ещё раз/i });
    expect(runBButton.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(runBButton);
    expect(retry).toHaveBeenCalledTimes(1);

    await act(async () => runA.resolve({ runId: "result-a", evidenceSnapshotId: "result-a-snapshot" }));
    expect(screen.queryByText("Новый запуск: result-a")).toBeNull();
    expect(screen.getByText("Предыдущий снимок: snapshot-b")).toBeTruthy();
    expect(runBButton.getAttribute("disabled")).toBeNull();
    fireEvent.click(runBButton);
    expect(retry).toHaveBeenCalledTimes(2);

    await act(async () => runB.resolve({ runId: "result-b", evidenceSnapshotId: "result-b-snapshot" }));
    expect(await screen.findByText("Новый запуск: result-b")).toBeTruthy();
    expect(screen.getByText("Новый снимок: result-b-snapshot")).toBeTruthy();
  });

  it("clears yellow retry result and error when previousRun changes", async () => {
    const globe = captureGlobe();
    const retry = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ runId: "result-b", evidenceSnapshotId: "result-b-snapshot" });
    const { rerender } = render(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={{ runId: "run-a", evidenceSnapshotId: "snapshot-a" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onReady());
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    expect(await screen.findByText(
      "Повторная проверка не выполнена. Предыдущий снимок сохранён.",
    )).toBeTruthy();

    rerender(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={{ runId: "run-b", evidenceSnapshotId: "snapshot-b" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    expect(screen.queryByText(
      "Повторная проверка не выполнена. Предыдущий снимок сохранён.",
    )).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    expect(await screen.findByText("Новый запуск: result-b")).toBeTruthy();

    rerender(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={retry}
        previousRun={{ runId: "run-c", evidenceSnapshotId: "snapshot-c" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    expect(screen.queryByText("Новый запуск: result-b")).toBeNull();
    expect(screen.getByText("Предыдущий снимок: snapshot-c")).toBeTruthy();
  });

  it("keeps the existing yellow retry failure copy", async () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        candidates={[candidate("yellow")]}
        detectWebGL={() => true}
        mode="yellow"
        onRetry={async () => { throw new Error("offline"); }}
        previousRun={{ runId: "run-old", evidenceSnapshotId: "snapshot-old" }}
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onReady());

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    expect(await screen.findByText(
      "Повторная проверка не выполнена. Предыдущий снимок сохранён.",
    )).toBeTruthy();
    expect(screen.getByTestId("globe")).toBeTruthy();
  });

  it("contains none of the deleted flat-map presentation", () => {
    const globe = captureGlobe();
    const { container } = render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={globe.renderGlobe}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[style*="%"]')).toBeNull();
    expect(screen.queryByRole("img", { name: /самолёт/i })).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.querySelector("[data-collapsed]")).toBeNull();
  });

  it("treats an explicit null renderGlobe result as the whole renderer", async () => {
    const renderGlobe = vi.fn(() => null);
    const { container } = render(
      <ResearchMap
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        mode="green"
        renderGlobe={renderGlobe}
      />,
    );

    await waitFor(() => expect(renderGlobe).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
