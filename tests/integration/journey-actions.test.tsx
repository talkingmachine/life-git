// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunDetails } from "../../src/application/contracts";

const actionMocks = vi.hoisted(() => ({
  retryConfirmedLifeRun: vi.fn(),
  saveInitialHousingBranch: vi.fn(),
  rewindHousingBranch: vi.fn(),
  forkHousingBranch: vi.fn(),
}));

vi.mock("../../src/app/actions", () => actionMocks);

import { Vs1Journey } from "../../src/experience/components/Vs1Journey";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
        reasons: [{ code: "foreign_contract_not_verified", claimId: "al-law-79-art-68-contract" }],
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
  it("turns the map gray while yellow retry research is pending", async () => {
    const next = deferred<RunDetails>();
    actionMocks.retryConfirmedLifeRun.mockReturnValue(next.promise);
    render(<Vs1Journey details={details("yellow", "old")} />);

    fireEvent.click(screen.getByRole("button", { name: /Тирана.*уточнить/i }));
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /карта проверки маршрута/i }).getAttribute("data-tone"))
        .toBe("gray");
    });

    await act(async () => next.resolve(details("yellow", "new")));
    expect(await screen.findByText(/Предыдущий снимок: snapshot-new/i)).toBeTruthy();
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
});
