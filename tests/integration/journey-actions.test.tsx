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

function details(marker: "green" | "yellow" | "red", suffix: string, branch = false): RunDetails {
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
        conditions: {
          incomeContinues12Months: true,
          lawfulStayPrerequisiteAccepted: true,
          stagedSpouseRouteAccepted: false,
        },
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
  it("navigates a green C0 journey through the five focused workspaces without mutating its snapshot", () => {
    const seeded = details("green", "workspaces", true);
    const c0: RunDetails = {
      ...seeded,
      branchCursor: seeded.initialBranchCursor,
    };
    const before = JSON.stringify(c0);

    render(<Vs1Journey details={c0} />);

    const overview = screen.getByRole("region", { name: /обзор маршрута/i });
    expect(within(overview).getByRole("heading", { name: "Проверка маршрута" })).toBeTruthy();
    expect(within(overview).getByText(/официальных фактов/i).parentElement?.textContent).toMatch(/1/);
    expect(within(overview).getByText(/нерешённых вопросов/i).parentElement?.textContent).toMatch(/0/);
    expect(within(overview).getByText(/известный остаток/i).parentElement?.textContent).toMatch(/139 864,57 ALL/);

    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
    expect(screen.getByRole("heading", { name: /подтверждённый снимок/i })).toBeTruthy();
    expect(screen.getByRole("figure", { name: /поток бюджета/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Life Git/i }));
    expect(screen.getByRole("heading", { name: /ветка жилья/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /источники/i }));
    expect(screen.getByRole("heading", { name: /паспорт доказательств/i })).toBeTruthy();
    expect(JSON.stringify(c0)).toBe(before);
  });

  it("opens a yellow journey in Research with its reason and retry available", () => {
    render(<Vs1Journey details={details("yellow", "research")} />);

    expect(screen.getByRole("button", { name: /проверка/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /проверить ещё раз/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Тирана.*уточнить/i }));
    expect(screen.getByText(/не подтверждён официальный источник о договоре/i)).toBeTruthy();
  });

  it("filters source classes locally and resets them without mutating the journey snapshot", () => {
    const c0 = details("green", "sources", true);
    const before = JSON.stringify(c0);
    render(<Vs1Journey details={c0} />);

    fireEvent.click(screen.getByRole("button", { name: /источники/i }));
    const official = screen.getByRole("button", { name: "Официальный факт" });
    expect(official.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Официальный факт" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Допущение" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Допущение" }));
    expect(screen.getByRole("button", { name: "Допущение" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Допущение" })).toBeTruthy();
    expect(screen.getByText(/Initial housing/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Официальный факт" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /все классы/i }));
    expect(screen.getByRole("button", { name: /все классы/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Официальный факт" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Допущение" })).toBeTruthy();
    expect(JSON.stringify(c0)).toBe(before);
  });

  it("runs the real confirmed-life start from explicit confirmation through gray to terminal green", async () => {
    const started = deferred<RunDetails>();
    const replaceState = vi.spyOn(window.history, "replaceState");
    actionMocks.startConfirmedLife.mockReturnValue(started.promise);
    render(<Vs1Start />);

    expect(screen.getByRole("heading", { name: /настройте сценарий/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: /ресурсы/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: /занятость/i })).toBeTruthy();
    expect(screen.getByRole("group", { name: /состав переезда/i })).toBeTruthy();
    expect(screen.getByRole("region", { name: /резюме сценария/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /начать проверку/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("region", { name: /карта проверки маршрута/i })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /доход продолжает.*12 месяцев/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /законное пребывание.*предварительное условие/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю синтетический снимок/i }));
    fireEvent.click(screen.getByRole("button", { name: /начать проверку/i }));

    expect(actionMocks.startConfirmedLife).toHaveBeenCalledWith(expect.objectContaining({
      conditions: {
        incomeContinues12Months: true,
        lawfulStayPrerequisiteAccepted: true,
        stagedSpouseRouteAccepted: false,
      },
    }), { currency: "ALL", initialHousingAll: "70000" });

    await waitFor(() => {
      const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
      expect(map.getAttribute("data-tone")).toBe("gray");
      expect(within(map).getByText(/Россия.*Тирана/i)).toBeTruthy();
    });

    await act(async () => started.resolve(details("green", "started:id")));
    expect(await screen.findByRole("region", { name: /обзор маршрута/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /проверка/i }));
    expect((await screen.findByRole("region", { name: /карта проверки маршрута/i }))
      .getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
    expect(screen.getByRole("button", { name: /зафиксировать C0/i })).toBeTruthy();
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe("?run=run-started%3Aid");
  });

  it("requires a fresh snapshot confirmation after any profile or housing edit", () => {
    render(<Vs1Start />);
    const confirmation = screen.getByRole("checkbox", { name: /подтверждаю синтетический снимок/i });
    const submit = screen.getByRole("button", { name: /начать проверку/i }) as HTMLButtonElement;

    fireEvent.click(confirmation);
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/исходное жильё C0/i), { target: { value: "71000" } });

    expect((confirmation as HTMLInputElement).checked).toBe(false);
    expect(submit.disabled).toBe(true);
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

  it("moves a terminal green retry to Overview", async () => {
    const next = deferred<RunDetails>();
    actionMocks.retryConfirmedLifeRun.mockReturnValue(next.promise);
    render(<Vs1Journey details={details("yellow", "retry-green-old")} />);

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    await act(async () => next.resolve(details("green", "retry-green-new")));

    expect(await screen.findByRole("region", { name: /обзор маршрута/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /обзор/i }).getAttribute("aria-current")).toBe("page");
  });

  it.each(["yellow", "red"] as const)(
    "keeps retry snapshot history after navigating away before a terminal %s result",
    async (marker) => {
      const next = deferred<RunDetails>();
      const original = details("yellow", `race-${marker}-old`);
      const before = JSON.stringify(original);
      actionMocks.retryConfirmedLifeRun.mockReturnValue(next.promise);
      render(<Vs1Journey details={original} />);

      fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
      fireEvent.click(screen.getByRole("button", { name: /источники/i }));
      expect(screen.queryByRole("region", { name: /карта проверки маршрута/i })).toBeNull();

      await act(async () => next.resolve(details(marker, `race-${marker}-new`)));

      expect(await screen.findByText(`Предыдущий снимок: snapshot-race-${marker}-old`)).toBeTruthy();
      expect(screen.getByText(`Новый снимок: snapshot-race-${marker}-new`)).toBeTruthy();
      expect(JSON.stringify(original)).toBe(before);
    },
  );

  it("keeps a retry rejection after navigating away and returning to Research", async () => {
    const retry = deferred<RunDetails>();
    const original = details("yellow", "race-error-old");
    const before = JSON.stringify(original);
    actionMocks.retryConfirmedLifeRun.mockReturnValue(retry.promise);
    render(<Vs1Journey details={original} />);

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));
    fireEvent.click(screen.getByRole("button", { name: /источники/i }));
    await act(async () => retry.reject(new Error("offline")));
    fireEvent.click(screen.getByRole("button", { name: /проверка/i }));

    expect((await screen.findByRole("alert")).textContent)
      .toMatch(/повторная проверка не выполнена.*предыдущий снимок сохранён/i);
    expect(screen.getByText(/Предыдущий снимок: snapshot-race-error-old/i)).toBeTruthy();
    expect(JSON.stringify(original)).toBe(before);
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

  it("rewinds both the cursor and the visible C1 budget/diff back to the saved C0 view", async () => {
    const seeded = details("green", "branch", true);
    const c0: RunDetails = {
      ...seeded,
      branchCursor: seeded.initialBranchCursor,
    };
    const c1: RunDetails = {
      ...c0,
      branchCursor: { commitId: "b".repeat(64) },
      budget: {
        incomeAll: "209864.57",
        housingAll: "90000.00",
        knownResidualAll: "119864.57",
        unknowns: ["taxes", "living_costs"],
      },
      branchDiff: {
        housing: { before: "70000.00", after: "90000.00", delta: "20000.00" },
        knownResidual: {
          before: "139864.57",
          after: "119864.57",
          delta: "-20000.00",
          cause: "housing",
        },
        reused: ["profile", "evidence", "rules"],
      },
    };
    const rewind = deferred<{ readonly commitId: string }>();
    actionMocks.forkHousingBranch.mockResolvedValue(c1);
    actionMocks.rewindHousingBranch.mockReturnValue(rewind.promise);
    render(<Vs1Journey details={c0} />);

    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
    fireEvent.click(screen.getByRole("button", { name: /создать C1/i }));
    expect(await within(screen.getByRole("figure", { name: /поток бюджета/i })).findByText("90 000,00 ALL"))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Life Git/i }));
    expect(await screen.findByRole("heading", { name: /Life Git: C0 → C1/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));

    fireEvent.click(screen.getByRole("button", { name: /перемотать к C0/i }));

    expect(actionMocks.rewindHousingBranch).toHaveBeenCalledWith("a".repeat(64));

    await act(async () => rewind.resolve({ commitId: "a".repeat(64) }));
    expect(within(screen.getByRole("figure", { name: /поток бюджета/i })).getByText("70 000,00 ALL"))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Life Git/i }));
    expect(screen.queryByRole("heading", { name: /Life Git: C0 → C1/i })).toBeNull();
  });

  it("submits C0 at most once while the first append is pending", async () => {
    const save = deferred<RunDetails>();
    actionMocks.saveInitialHousingBranch.mockReturnValue(save.promise);
    render(<Vs1Journey details={details("green", "before-c0")} />);
    fireEvent.click(within(screen.getByRole("navigation", { name: /основная навигация/i }))
      .getByRole("button", { name: /моя ветвь/i }));
    const button = screen.getByRole("button", { name: /зафиксировать C0/i });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(actionMocks.saveInitialHousingBranch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /зафиксировать C0/i })).toBeNull();
    const saved = details("green", "saved-c0", true);
    await act(async () => save.resolve({
      ...saved,
      branchCursor: saved.initialBranchCursor,
    }));
    expect(screen.getByRole("heading", { name: /подтверждённый снимок/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /моя ветвь/i }).getAttribute("aria-current")).toBe("page");
  });

  it("does not offer C0 on a non-green run and cannot submit C2 from a C1 cursor", () => {
    const yellow = render(<Vs1Journey details={details("yellow", "blocked")} />);
    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
    expect(screen.queryByRole("button", { name: /зафиксировать C0/i })).toBeNull();
    yellow.unmount();

    render(<Vs1Journey details={details("green", "c1", true)} />);
    fireEvent.click(screen.getByRole("button", { name: /моя ветвь/i }));
    expect(screen.queryByRole("button", { name: /создать C1/i })).toBeNull();
  });
});
