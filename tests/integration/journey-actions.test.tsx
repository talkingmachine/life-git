// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunDetails } from "../../src/application/contracts";

const actionMocks = vi.hoisted(() => ({
  startConfirmedLife: vi.fn(),
  retryConfirmedLifeRun: vi.fn(),
  saveInitialHousingBranch: vi.fn(),
  rewindHousingBranch: vi.fn(),
  forkHousingBranch: vi.fn(),
}));

vi.mock("../../src/app/actions", () => actionMocks);

import { Vs1Journey } from "../../src/experience/components/Vs1Journey";
import { Vs1Start } from "../../src/experience/components/Vs1Start";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function details(marker: "green" | "yellow", suffix: string, branch = false): RunDetails {
  return {
    run: {
      runId: `run-${suffix}`,
      runRevisionId: `revision-${suffix}`,
      assessmentDate: "2026-08-08",
      profileId: `profile-${suffix}`,
      evidenceSnapshotId: `snapshot-${suffix}`,
      assessmentId: `assessment-${suffix}`,
      assessment: marker === "green" ? { marker, reasons: [] } : {
        marker,
        reasons: [{
          code: "foreign_contract_not_verified",
          claimId: "al-law-79-art-68-contract",
          sourceId: "al-law-79",
        }],
      },
      mode: "current",
    },
    profile: {
      id: `profile-${suffix}`,
      confirmedAt: "2026-08-08T10:00:00.000Z",
      profile: {
        availableResourcesAll: "500000",
        monthlyIncome: { amount: "210000", currency: "RUB" },
        incomeBasis: "foreign_contract",
        companionBasis: "none",
        relationship: "none",
      },
    },
    evidenceItems: [{
      class: "official_fact",
      label: "al-law-79-facts-1",
      displayValue: JSON.stringify({ requiresLawfulStay: true }),
      sourceId: "al-law-79",
      scope: "VS-1 confirmed-life",
      sourcePeriod: "cons-2026-08-01",
      anchor: "Art. 68#abc",
      resolvedUrl: "https://official.example/law-79",
      integrity: "verified",
    }, {
      class: "assumption",
      label: "Initial housing",
      displayValue: "70000 ALL",
      provenance: "scenario",
    }],
    ...(branch ? {
      initialBranchCursor: { commitId: "a".repeat(64) },
      branchCursor: { commitId: "b".repeat(64) },
      budget: {
        incomeAll: "209864.57",
        housingAll: "70000.00",
        knownResidualAll: "139864.57",
        unknowns: ["taxes", "living_costs"],
      },
    } : {}),
    narrative: {
      headline: "Проверка маршрута",
      bullets: ["Только официальный контур"],
      origin: "fallback",
    },
  };
}

describe("journey action pending states", () => {
  it("runs the real confirmed-life start from explicit confirmation through gray to terminal green", async () => {
    const started = deferred<RunDetails>();
    const replaceState = vi.spyOn(window.history, "replaceState");
    actionMocks.startConfirmedLife.mockReturnValue(started.promise);
    render(<Vs1Start />);

    expect(screen.queryByRole("region", { name: /карта проверки маршрута/i })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю синтетический снимок/i }));
    fireEvent.click(screen.getByRole("button", { name: /начать проверку/i }));

    await waitFor(() => {
      const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
      expect(map.getAttribute("data-tone")).toBe("gray");
      expect(within(map).getByText(/Россия.*Тирана/i)).toBeTruthy();
    });

    await act(async () => started.resolve(details("green", "started:id")));
    expect((await screen.findByRole("region", { name: /карта проверки маршрута/i }))
      .getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: /зафиксировать C0/i })).toBeTruthy();
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe("?run=run-started%3Aid");
  });

  it("turns the map gray while yellow retry research is pending", async () => {
    const next = deferred<RunDetails>();
    const replaceState = vi.spyOn(window.history, "replaceState");
    actionMocks.retryConfirmedLifeRun.mockReturnValue(next.promise);
    render(<Vs1Journey details={details("yellow", "old")} />);

    fireEvent.click(screen.getByRole("button", { name: /Тирана.*уточнить/i }));
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /карта проверки маршрута/i }).getAttribute("data-tone"))
        .toBe("gray");
    });

    await act(async () => next.resolve(details("yellow", "new:id")));
    expect(await screen.findByText(/Предыдущий снимок: snapshot-old/i)).toBeTruthy();
    expect(screen.getByText(/Новый снимок: snapshot-new:id/i)).toBeTruthy();
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe("?run=run-new%3Aid");
  });

  it("shows a retry failure without losing the previous snapshot or leaking a rejection", async () => {
    const retry = deferred<RunDetails>();
    actionMocks.retryConfirmedLifeRun.mockReturnValue(retry.promise);
    render(<Vs1Journey details={details("yellow", "old")} />);

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    await act(async () => retry.reject(new Error("offline")));

    expect((await screen.findByRole("alert")).textContent).toMatch(/повторная проверка не выполнена/i);
    expect(screen.getByText(/Предыдущий снимок: snapshot-old/i)).toBeTruthy();
    expect(screen.getByRole("region", { name: /карта проверки маршрута/i }).getAttribute("data-tone"))
      .toBe("yellow");
  });

  it("keeps the green map collapsed while a housing rewind is pending", async () => {
    const rewind = deferred<{ readonly commitId: string }>();
    actionMocks.rewindHousingBranch.mockReturnValue(rewind.promise);
    render(<Vs1Journey details={details("green", "branch", true)} />);

    fireEvent.click(screen.getByRole("button", { name: /перемотать к C0/i }));

    expect(actionMocks.rewindHousingBranch).toHaveBeenCalledWith("a".repeat(64));

    await waitFor(() => {
      const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
      expect(map.getAttribute("data-tone")).toBe("green");
      expect(map.getAttribute("data-collapsed")).toBe("true");
    });

    await act(async () => rewind.resolve({ commitId: "a".repeat(64) }));
  });

  it("does not offer C0 on a non-green run and cannot submit C2 from a C1 cursor", () => {
    const yellow = render(<Vs1Journey details={details("yellow", "blocked")} />);
    expect(screen.queryByRole("button", { name: /зафиксировать C0/i })).toBeNull();
    yellow.unmount();

    render(<Vs1Journey details={details("green", "c1", true)} />);
    expect((screen.getByRole("button", { name: /создать C1/i }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
