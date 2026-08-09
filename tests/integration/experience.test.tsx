// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHousingBranchApplication } from "../../src/application/fork-housing";
import {
  createPresentRun,
  FALLBACK_NARRATIVE,
} from "../../src/application/present-run";
import type {
  BranchRunRevision,
  NarrativeInput,
  RunDetails,
  RunDetailsCore,
} from "../../src/application/contracts";
import {
  forkHousingBranch as forkHousingBranchAction,
  retryConfirmedLifeRun as retryConfirmedLifeRunAction,
  rewindHousingBranch as rewindHousingBranchAction,
  saveInitialHousingBranch as saveInitialHousingBranchAction,
  startConfirmedLife as startConfirmedLifeAction,
} from "../../src/app/actions";
import type { BranchCommit } from "../../src/branch/life-git";
import { EvidencePassport } from "../../src/experience/components/EvidencePassport";
import { LifeBranch } from "../../src/experience/components/LifeBranch";
import { LifeGitDiff } from "../../src/experience/components/LifeGitDiff";
import { ProfileCard } from "../../src/experience/components/ProfileCard";
import { ResearchMap } from "../../src/experience/components/ResearchMap";
import { Vs1Journey } from "../../src/experience/components/Vs1Journey";
import type { ResearchGlobeCanvasProps } from "../../src/experience/research-map/ResearchGlobeCanvas";
import type { GlobeRoute, ResearchCandidate } from "../../src/experience/research-map/contracts";
import { TIRANA_PRESENTATION } from "../../src/experience/research-map/product-route";
import { createJourneyView } from "../../src/experience/view-model";
import {
  createOpenAiNarrative,
} from "../../src/infrastructure/narrative";
import type { NarrativeParse } from "../../src/infrastructure/narrative";

afterEach(cleanup);

const soloConditions = Object.freeze({
  incomeContinues12Months: true,
  lawfulStayPrerequisiteAccepted: true,
  stagedSpouseRouteAccepted: false,
});

const spouseConditions = Object.freeze({
  ...soloConditions,
  stagedSpouseRouteAccepted: true,
});

function candidate(
  status: ResearchCandidate["status"],
  reason?: ResearchCandidate["reason"],
): ResearchCandidate {
  return {
    id: "tirana",
    ...TIRANA_PRESENTATION,
    status,
    ...(reason === undefined ? {} : { reason }),
  };
}

function GlobeRendererProbe({ routes }: { readonly routes: readonly GlobeRoute[] }) {
  const [selected, setSelected] = useState<GlobeRoute>();
  return (
    <div data-testid="production-globe-renderer">
      {routes.map((route) => (
        <button
          aria-label={`${route.city} — ${route.status === "yellow" ? "уточнить" : "не подходит"}`}
          key={route.key}
          onClick={() => setSelected(route)}
          type="button"
        >
          {route.flag}{route.city}
        </button>
      ))}
      {selected === undefined ? null : (
        <div aria-label={selected.city} role="dialog">
          <p>{selected.rejectionReason}</p>
          {selected.officialUrl === undefined ? null : (
            <a href={selected.officialUrl}>Официальный источник</a>
          )}
        </div>
      )}
    </div>
  );
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
      return <GlobeRendererProbe routes={next.routes} />;
    },
  };
}

describe("confirmed-life visual journey", () => {
  it("passes Moscow and Tirana geo metadata to the pending production renderer", () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        candidates={[candidate("pending")]}
        detectWebGL={() => true}
        mode="pending"
        renderGlobe={globe.renderGlobe}
      />,
    );

    act(() => globe.current().onReady());
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.hasAttribute("data-collapsed")).toBe(false);
    expect(globe.current().origin.city).toBe("Москва");
    expect(globe.current().origin.coordinate).toEqual({ lat: 55.7558, lng: 37.6173 });
    expect(globe.current().routes[0]).toMatchObject({
      city: "Тирана",
      country: "Албания",
      flag: "🇦🇱",
      to: { lat: 41.3275, lng: 19.8187 },
    });
    expect(globe.current().activeFlight?.key).toBe("moscow-tirana");
  });

  it("shows the confirmed snapshot read-only and offers an explicit green C0 action", () => {
    const saveC0 = vi.fn();

    render(
      <ProfileCard
        canSaveC0
        onSaveC0={saveC0}
        profile={{
          housingAll: "70000",
          incomeBasis: "foreign_contract",
          monthlyIncomeRub: "210000",
          availableResourcesAll: "500000",
          companionMode: "staged",
          conditions: {
            incomeContinues12Months: true,
            lawfulStayPrerequisiteAccepted: true,
            stagedSpouseRouteAccepted: true,
          },
        }}
      />,
    );

    expect(screen.getByText(/жильё.*70 000 ALL/i)).toBeTruthy();
    expect(screen.getByText(/контракт/i)).toBeTruthy();
    expect(screen.getByText(/месячный доход.*210 000 RUB.*ввод пользователя/i)).toBeTruthy();
    expect(screen.getByText(/ресурс/i)).toBeTruthy();
    expect(screen.getByText(/спутник.*поэтапно/i)).toBeTruthy();
    expect(screen.getByText(/доход.*12 месяцев.*подтверждено пользователем/i)).toBeTruthy();
    expect(screen.getByText(/предварительное условие законного пребывания.*принято/i)).toBeTruthy();
    expect(screen.getByText(/маршрут супруга.*после разрешения спонсора.*принят/i)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/законное пребывание подтверждено/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /зафиксировать C0/i }));
    expect(saveC0).toHaveBeenCalledOnce();
  });

  it("labels profile inputs as user/scenario conditions rather than official verification", () => {
    render(
      <ProfileCard
        canSaveC0={false}
        onSaveC0={() => undefined}
        profile={{
          housingAll: "70000",
          incomeBasis: "albanian_employer_only",
          monthlyIncomeRub: "210000",
          availableResourcesAll: "407999",
          companionMode: "staged",
          conditions: {
            incomeContinues12Months: false,
            lawfulStayPrerequisiteAccepted: false,
            stagedSpouseRouteAccepted: false,
          },
        }}
      />,
    );

    expect(screen.getByText(/основание дохода.*только албанский работодатель.*ввод пользователя/i)).toBeTruthy();
    expect(screen.getByText(/ресурсы.*407 999 ALL.*ввод пользователя/i)).toBeTruthy();
    expect(screen.queryByText(/ресурсы подтверждены/i)).toBeNull();
    expect(screen.queryByText(/законное пребывание подтверждено/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /зафиксировать C0/i })).toBeNull();
  });

  it("supports a route without a companion without implying a couple", () => {
    render(
      <ProfileCard
        canSaveC0={false}
        onSaveC0={() => undefined}
        profile={{
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
        }}
      />,
    );

    expect(screen.getByText(/маршрут без спутника/i)).toBeTruthy();
    expect(screen.queryByText(/спутник.*поэтапно/i)).toBeNull();
  });

  it("keeps the single-candidate pending map full-screen", () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        mode="pending"
        candidates={[candidate("pending")]}
        detectWebGL={() => true}
        renderGlobe={globe.renderGlobe}
      />,
    );

    act(() => globe.current().onReady());
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.hasAttribute("data-collapsed")).toBe(false);
    expect(screen.getByTestId("production-globe-renderer")).toBeTruthy();
    expect(globe.current().routes).toHaveLength(1);
    expect(globe.current().routes[0]?.status).toBe("pending");
  });

  it("keeps a green result full-screen without collapsed presentation", () => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        mode="green"
        candidates={[candidate("green")]}
        detectWebGL={() => true}
        renderGlobe={globe.renderGlobe}
      />,
    );

    act(() => globe.current().onReady());
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.hasAttribute("data-collapsed")).toBe(false);
    expect(globe.current().routes[0]?.status).toBe("green");
    expect(globe.current().activeFlight).toBeUndefined();
  });

  it.each([
    ["yellow", "Enter", "Не подтверждён официальный источник о договоре"],
    ["red", " ", "Доход зависит только от местного работодателя"],
  ] as const)("reveals a concise official-linked %s reason from the globe balloon", (status, _key, reason) => {
    const globe = captureGlobe();
    render(
      <ResearchMap
        mode={status}
        candidates={[candidate(status, {
            summary: reason,
            officialUrl: "https://official.example/al-law-79",
        })]}
        detectWebGL={() => true}
        renderGlobe={globe.renderGlobe}
      />,
    );

    act(() => globe.current().onReady());
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.hasAttribute("data-collapsed")).toBe(false);
    const marker = screen.getByRole("button", { name: new RegExp(`Тирана.*${status === "yellow" ? "уточнить" : "не подходит"}`, "i") });
    expect(marker.tagName).toBe("BUTTON");
    expect(screen.queryByText(reason)).toBeNull();
    fireEvent.click(marker);

    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByRole("link", { name: /официальный источник/i }).getAttribute("href"))
      .toBe("https://official.example/al-law-79");
    expect(globe.current().routes[0]).toMatchObject({
      rejectionReason: reason,
      officialUrl: "https://official.example/al-law-79",
      status,
    });
  });

  it("uses exact reason source lineage and distinguishes an unavailable rule from a verified mismatch", () => {
    const base: RunDetails = {
      run: {
        runId: "run-reason",
        runRevisionId: "revision-reason",
        assessmentDate: "2026-08-08",
        profileId: "profile-reason",
        evidenceSnapshotId: "snapshot-reason",
        assessmentId: "assessment-reason",
        assessment: { marker: "yellow", reasons: [] },
        mode: "current",
      },
      profile: {
        id: "profile-reason",
        confirmedAt: "2026-08-08T10:00:00.000Z",
        profile: {
          availableResourcesAll: "407999",
          monthlyIncome: { amount: "210000", currency: "RUB" },
          incomeBasis: "foreign_contract",
          companionBasis: "none",
          relationship: "none",
          conditions: soloConditions,
        },
      },
      evidenceItems: [{
        class: "unknown",
        label: "Правило доступных средств",
        provenance: "source_unavailable",
        sourceId: "al-decision-858",
        blockerKind: "semantic_mismatch",
        navigationUrl: "https://official.example/decision-858",
      }],
      narrative: FALLBACK_NARRATIVE,
    };
    const unavailable = createJourneyView({
      ...base,
      run: {
        ...base.run,
        assessment: {
          marker: "yellow",
          reasons: [{
            code: "available_resources_rule_unavailable",
            claimId: "al-decision-858-facts-1",
            sourceId: "al-decision-858",
            blockerKind: "semantic_mismatch",
          }],
        },
      },
    });
    const threshold = createJourneyView({
      ...base,
      run: {
        ...base.run,
        assessment: {
          marker: "yellow",
          reasons: [{
            code: "available_resources_below_threshold",
            claimId: "al-decision-858-facts-1",
            sourceId: "al-decision-858",
          }],
        },
      },
      evidenceItems: [{
        class: "official_fact",
        label: "al-decision-858-facts-1",
        displayValue: JSON.stringify({ availableAmount: "408000" }),
        sourceId: "al-decision-858",
        scope: "VS-1 confirmed-life",
        sourcePeriod: "cons-2026-08-01",
        anchor: "Decision 858#abc",
        resolvedUrl: "https://official.example/decision-858",
        integrity: "verified",
      }],
    });
    const declinedCondition = createJourneyView({
      ...base,
      run: {
        ...base.run,
        assessment: {
          marker: "yellow",
          reasons: [{
            code: "income_continuation_not_confirmed",
            claimId: "al-law-79-art-68-contract",
            sourceId: "al-law-79",
          }],
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
      }],
    });

    expect(unavailable.candidate.reason).toEqual({
      summary: "Официальное правило о доступных средствах не прошло смысловую проверку",
      officialUrl: "https://official.example/decision-858",
    });
    expect(threshold.candidate.reason).toEqual({
      summary: "Заявленные ресурсы ниже подтверждённого официального порога",
      officialUrl: "https://official.example/decision-858",
    });
    expect(declinedCondition.candidate.reason).toEqual({
      summary: "Поступление дохода в течение двенадцати месяцев не подтверждено",
    });
    expect(unavailable.candidate).toMatchObject({
      id: "tirana",
      city: "Тирана",
      country: "Албания",
      flag: "🇦🇱",
      coordinate: { lat: 41.3275, lng: 19.8187 },
      description: "Проверяем визовые, финансовые и бытовые условия сценария.",
      photoUrl: "/cities/tirana.jpg",
      status: "yellow",
    });

    const globe = captureGlobe();
    render(
      <ResearchMap
        candidates={[declinedCondition.candidate]}
        detectWebGL={() => true}
        mode="yellow"
        renderGlobe={globe.renderGlobe}
      />,
    );
    act(() => globe.current().onReady());
    fireEvent.click(screen.getByRole("button", { name: /Тирана.*уточнить/i }));
    expect(screen.getByText(/поступление дохода.*не подтверждено/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /официальный источник/i })).toBeNull();
  });

  it("keeps the old yellow snapshot while retry reports a new run and snapshot", async () => {
    const oldRun = Object.freeze({ runId: "run-old", evidenceSnapshotId: "snapshot-old" });
    const before = JSON.stringify(oldRun);
    const retry = vi.fn(async () => ({ runId: "run-new", evidenceSnapshotId: "snapshot-new" }));
    const globe = captureGlobe();

    render(
      <ResearchMap
        detectWebGL={() => true}
        mode="yellow"
        previousRun={oldRun}
        onRetry={retry}
        candidates={[candidate("yellow", {
            summary: "Источник временно недоступен",
            officialUrl: "https://official.example/al-law-79",
        })]}
        renderGlobe={globe.renderGlobe}
      />,
    );

    act(() => globe.current().onReady());
    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));

    expect(await screen.findByText(/Новый запуск: run-new/i)).toBeTruthy();
    expect(screen.getByText(/Новый снимок: snapshot-new/i)).toBeTruthy();
    expect(screen.getByText(/Предыдущий снимок: snapshot-old/i)).toBeTruthy();
    expect(retry).toHaveBeenCalledWith("run-old");
    expect(JSON.stringify(oldRun)).toBe(before);
  });

  it("renders the server-calculated budget flow without hiding unknown taxes or living costs", () => {
    render(
      <LifeBranch
        budget={{
          incomeAll: "209864.57",
          housingAll: "70000.00",
          knownResidualAll: "139864.57",
          unknowns: ["taxes", "living_costs"],
        }}
      />,
    );

    const flow = screen.getByRole("figure", { name: /поток бюджета/i });
    const bars = within(flow).getAllByTestId("budget-bar");
    expect(bars).toHaveLength(3);
    expect(within(bars[0]!).getByText("Доход")).toBeTruthy();
    expect(within(bars[0]!).getByText("209 864,57 ALL")).toBeTruthy();
    expect(within(bars[1]!).getByText("Жильё")).toBeTruthy();
    expect(within(bars[1]!).getByText("70 000,00 ALL")).toBeTruthy();
    expect(within(bars[2]!).getByText("Известный остаток")).toBeTruthy();
    expect(within(bars[2]!).getByText("139 864,57 ALL")).toBeTruthy();
    const meters = flow.querySelectorAll("meter");
    expect(meters).toHaveLength(3);
    expect([...meters].map((meter) => ({
      max: meter.getAttribute("max"),
      value: meter.getAttribute("value"),
    }))).toEqual([
      { max: "209864.57", value: "209864.57" },
      { max: "209864.57", value: "70000.00" },
      { max: "209864.57", value: "139864.57" },
    ]);
    expect(within(flow).getByText(/налоги.*неизвестно/i)).toBeTruthy();
    expect(within(flow).getByText(/стоимость жизни.*неизвестно/i)).toBeTruthy();
  });

  it("renders all six Evidence Passport classes with verified and blocked provenance", () => {
    render(
      <EvidencePassport
        companionMode="staged"
        items={[
          {
            class: "official_fact",
            label: "al-law-79-facts-1",
            displayValue: JSON.stringify({ digitalWorker: { requiresLawfulStay: true } }),
            sourceId: "al-law-79",
            scope: "VS-1 confirmed-life",
            sourcePeriod: "cons-2026-08-01",
            anchor: "Art. 68#abc",
            resolvedUrl: "https://official.example/law-79",
            integrity: "verified",
          },
          {
            class: "official_fact",
            label: "al-law-79-facts-2",
            displayValue: JSON.stringify({ digitalWorker: { requiresLawfulStay: true } }),
            sourceId: "al-law-79",
            scope: "VS-1 confirmed-life",
            sourcePeriod: "cons-2026-08-01",
            anchor: "Art. 3(1)#def",
            resolvedUrl: "https://official.example/law-79",
            integrity: "verified",
          },
          {
            class: "user_fact",
            label: "Ресурсы",
            displayValue: "500000 ALL",
            provenance: "confirmed_profile",
          },
          {
            class: "calculation",
            label: "Конвертация дохода",
            displayValue: "209864.57 ALL",
            formulaId: "FORMULA-VS1-FX-01",
            formulaVersion: "1",
            inputs: [{
              binding: "CBR_RUB_PER_EUR",
              value: "93.1901",
              unit: "RUB/EUR",
              provenance: "claim",
              ref: "cbr-eur-facts-1@2026-08-08#artifact",
            }],
            rounding: "UNROUNDED_THEN_HALF_UP_2DP",
            outputHash: "a".repeat(64),
          },
          {
            class: "assumption",
            label: "Жильё",
            displayValue: "70000 ALL",
            provenance: "scenario",
          },
          {
            class: "projection",
            label: "Сценарий спутника",
            displayValue: "Поэтапно",
            provenance: "scenario",
          },
          {
            class: "unknown",
            label: "Городской транспорт",
            provenance: "source_unavailable",
            sourceId: "tirana-urban-lines",
            blockerKind: "timeout",
            navigationUrl: "https://official.example/tirana",
          },
          {
            class: "unknown",
            label: "Налоги",
            provenance: "unmodelled",
          },
        ]}
      />,
    );

    const passport = screen.getByText("Паспорт доказательств").closest("details");
    expect(passport?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Паспорт доказательств"));
    expect(passport?.hasAttribute("open")).toBe(true);

    for (const heading of [
      "Официальный факт",
      "Факт пользователя",
      "Расчёт",
      "Допущение",
      "Проекция",
      "Неизвестно",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByRole("heading", { name: /Закон № 79.*цифровой работник/i })).toHaveLength(1);
    expect(screen.getByText(/официальные условия для цифрового работника и семейного маршрута/i)).toBeTruthy();
    expect(screen.getByText("Период источника: cons-2026-08-01")).toBeTruthy();
    const rawOfficial = screen.getByText(JSON.stringify({ digitalWorker: { requiresLawfulStay: true } }));
    const officialTechnical = rawOfficial.closest("details");
    expect(officialTechnical?.textContent).toContain("al-law-79-facts-1");
    expect(officialTechnical?.textContent).toContain("al-law-79-facts-2");
    expect(officialTechnical?.hasAttribute("open")).toBe(false);
    expect(officialTechnical?.querySelector("summary")?.textContent).toMatch(/технические данные и якоря/i);
    const blockerTechnical = screen.getByText("timeout").closest("details");
    expect(blockerTechnical?.hasAttribute("open")).toBe(false);
    expect(screen.getByText(/источник не ответил вовремя/i)).toBeTruthy();
    const officialLink = screen.getByRole("link", { name: /проверенный официальный источник/i });
    expect(officialLink.getAttribute("href")).toBe("https://official.example/law-79");
    expect(officialLink.getAttribute("target")).toBe("_blank");
    expect(officialLink.getAttribute("rel")).toMatch(/noopener/);
    expect(screen.getByText(/FORMULA-VS1-FX-01.*версия 1/i)).toBeTruthy();
    expect(screen.getByText(/CBR_RUB_PER_EUR.*93.1901.*RUB\/EUR/i)).toBeTruthy();
    expect(screen.getByText(/UNROUNDED_THEN_HALF_UP_2DP/i)).toBeTruthy();
    expect(screen.getByText("a".repeat(64))).toBeTruthy();
    expect(screen.getByRole("link", { name: /открыть официальный источник для повторной проверки/i }).getAttribute("href"))
      .toBe("https://official.example/tirana");
    expect(screen.getByText(/timeout/i)).toBeTruthy();
  });

  it("explains why a solo route has no companion projection", () => {
    render(
      <EvidencePassport
        companionMode="none"
        items={[{
          class: "user_fact",
          label: "Companion route",
          displayValue: "none:none",
          provenance: "confirmed_profile",
        }]}
      />,
    );

    fireEvent.click(screen.getByText("Паспорт доказательств"));

    expect(
      screen.getByText("Сценарий без спутника: отдельная семейная проекция не требуется."),
    ).toBeTruthy();
  });

  it("drives bound C0 through rewind to C1 and renders the server-produced causal diff", async () => {
    const commits = new Map<string, BranchCommit>();
    const revisions = new Map<string, BranchRunRevision>();
    const assessmentRevision = Object.freeze({
      id: "assessment-revision",
      runId: "run-1",
      stage: "assessment" as const,
      assessmentDate: "2026-08-08",
      initialHousing: Object.freeze({ currency: "ALL" as const, initialHousingAll: "70000" }),
      profileId: "profile-1",
      evidenceSnapshotId: "evidence-1",
      assessmentId: "assessment-1",
      rulesVersion: "vs1-assessment@1",
      hmac: "assessment-hmac",
    });
    let revisionNumber = 0;
    const application = createHousingBranchApplication({
      profileStore: {
        append: async () => undefined,
        loadVerified: async () => Object.freeze({
          id: "profile-1",
          confirmedAt: "2026-08-08T10:00:00.000Z",
          profile: Object.freeze({
            availableResourcesAll: "500000",
            monthlyIncome: Object.freeze({ amount: "210000", currency: "RUB" as const }),
            incomeBasis: "foreign_contract" as const,
            companionBasis: "family" as const,
            relationship: "spouse" as const,
            conditions: spouseConditions,
          }),
        }),
      },
      runStore: {
        appendAssessment: async () => ({
          revision: assessmentRevision,
          assessment: { marker: "green" as const, reasons: [] },
        }),
        loadAssessmentByRunId: async () => ({
          revision: assessmentRevision,
          assessment: { marker: "green" as const, reasons: [] },
        }),
        appendBranch: (input) => Object.freeze({ ...input, hmac: "branch-hmac" }),
        loadBranchByCommitId: async (commitId) => {
          const revision = revisions.get(commitId);
          if (revision === undefined) throw new Error("branch_revision_not_found");
          return revision;
        },
        loadInitialBranchByRunId: async () => {
          const revision = [...revisions.values()][0];
          if (revision === undefined) throw new Error("branch_revision_not_found");
          return revision;
        },
      },
      branchStore: {
        loadVerified: async (id) => {
          const commit = commits.get(id);
          if (commit === undefined) throw new Error("branch_commit_not_found");
          return commit;
        },
      },
      housingBranchAppend: {
        append: (commit, input) => {
          const revision = Object.freeze({ ...input, hmac: "branch-hmac" });
          commits.set(commit.id, commit);
          revisions.set(commit.id, revision);
          return revision;
        },
      },
      budgetFacts: {
        loadVerifiedBudgetFacts: async () => ({
          cbrRate: {
            sourceId: "cbr-eur",
            rate: "93.1901",
            base: "EUR",
            quote: "RUB",
            claimId: "cbr-eur-facts-1",
            sourcePeriod: "2026-08-08",
            ref: "cbr-artifact#rate",
          },
          boaRate: {
            sourceId: "boa-eur",
            rate: "93.13",
            base: "EUR",
            quote: "ALL",
            claimId: "boa-eur-facts-1",
            sourcePeriod: "2026-08-08",
            ref: "boa-artifact#rate",
          },
        }),
      },
      nextRevisionId: () => `branch-revision-${++revisionNumber}`,
    });

    const c0 = await application.saveInitialHousingBranch("run-1");
    const c0Before = JSON.stringify(c0.commit);
    const cursor = await application.rewindHousingBranch(c0.commit.id);
    const c1 = await application.forkHousingBranch(cursor, "90000");

    expect(c0.commit.decision.initialHousingAll).toBe("70000");
    expect(JSON.stringify(c0.commit)).toBe(c0Before);
    expect(c1.commit.decision.initialHousingAll).toBe("90000");
    expect(c1.diff).toEqual({
      housing: { before: "70000.00", after: "90000.00", delta: "20000.00" },
      knownResidual: { before: "139864.57", after: "119864.57", delta: "-20000.00", cause: "housing" },
      reused: ["profile", "evidence", "rules"],
    });
    await expect(application.forkHousingBranch(
      { commitId: c1.commit.id },
      "100000",
    )).rejects.toThrow("fork_requires_c0");

    render(<LifeGitDiff diff={c1.diff} />);
    expect(screen.getByText(/70 000,00.*90 000,00.*\+20 000,00 ALL/i)).toBeTruthy();
    expect(screen.getByText(/139 864,57.*119 864,57.*−20 000,00 ALL/i)).toBeTruthy();
    expect(screen.getByText(/переиспользовано.*профиль.*доказательства.*правила/i)).toBeTruthy();
  });

  it("uses one bounded gpt-5.6 structured-output call with no storage or tools", async () => {
    const parse = vi.fn(async (...args: Parameters<NarrativeParse>) => {
      void args;
      return {
        output: [],
        output_parsed: {
          headline: {
            phraseId: "scoped_official_route",
            claimIds: ["al-law-79-facts-1"],
          },
          bullets: [{
            phraseId: "official_facts_separated",
            claimIds: ["al-law-79-facts-1"],
          }],
        },
      };
    });
    const adapter = createOpenAiNarrative({ apiKey: "test-key", parse });
    const input: NarrativeInput = {
      claimIds: ["al-law-79-facts-1"],
      typedValues: [{ claimId: "al-law-79-facts-1", value: { requiresLawfulStay: true } }],
    };

    const selection = await adapter.select(input);

    expect(selection).toEqual({
      headline: { phraseId: "scoped_official_route", claimIds: ["al-law-79-facts-1"] },
      bullets: [{ phraseId: "official_facts_separated", claimIds: ["al-law-79-facts-1"] }],
    });
    expect(parse).toHaveBeenCalledOnce();
    const [body, requestOptions] = parse.mock.calls[0]!;
    expect(body).toMatchObject({ model: "gpt-5.6", store: false, tools: [] });
    expect(body.text.format).toMatchObject({ type: "json_schema" });
    expect(JSON.parse(body.input)).toEqual(input);
    expect(requestOptions).toEqual({ timeout: 8_000, maxRetries: 0 });
  });

  it("uses deterministic copy without calling OpenAI when the API key is missing", async () => {
    const parse = vi.fn();
    const adapter = createOpenAiNarrative({ apiKey: "", parse });

    await expect(adapter.select({ claimIds: [], typedValues: [] })).resolves.toBeUndefined();
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", async () => { throw new Error("timeout"); }],
    ["refusal", async () => ({
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      output_parsed: {
        headline: { phraseId: "scoped_official_route", claimIds: ["al-law-79-facts-1"] },
        bullets: [{ phraseId: "official_facts_separated", claimIds: ["al-law-79-facts-1"] }],
      },
    })],
    ["invalid schema", async () => ({ output: [], output_parsed: { headline: "неверная схема" } })],
  ] as const)("falls back for %s", async (_case, parse) => {
    const adapter = createOpenAiNarrative({ apiKey: "test-key", parse });

    await expect(adapter.select({
      claimIds: ["al-law-79-facts-1"],
      typedValues: [{ claimId: "al-law-79-facts-1", value: true }],
    })).resolves.toBeUndefined();
  });

  it("presents only typed official claims and leaves evidence, assessment and calculations byte-equal", async () => {
    const core: RunDetailsCore = {
      run: {
        runId: "run-private",
        runRevisionId: "revision-private",
        assessmentDate: "2026-08-08",
        profileId: "profile-private",
        evidenceSnapshotId: "evidence-private",
        assessmentId: "assessment-private",
        assessment: {
          marker: "yellow",
          reasons: [{
            code: "foreign_contract_not_verified",
            claimId: "al-law-79-art-68-contract",
            sourceId: "al-law-79",
          }],
        },
        mode: "current",
      },
      profile: {
        id: "profile-private",
        confirmedAt: "2026-08-08T10:00:00.000Z",
        profile: {
          availableResourcesAll: "987654",
          monthlyIncome: { amount: "456789", currency: "RUB" },
          incomeBasis: "foreign_contract",
          companionBasis: "family",
          relationship: "spouse",
          conditions: spouseConditions,
        },
      },
      evidenceItems: [
        {
          class: "user_fact",
          label: "Секрет пользователя",
          displayValue: "PRIVATE FREE TEXT",
          provenance: "confirmed_profile",
        },
        {
          class: "official_fact",
          label: "al-law-79-facts-1",
          displayValue: JSON.stringify({ requiresLawfulStay: true, contractTypes: ["foreign_employment"] }),
          sourceId: "al-law-79",
          scope: "VS-1 confirmed-life",
          sourcePeriod: "cons-2026-08-01",
          anchor: "Art. 68#abc",
          resolvedUrl: "https://official.example/law-79",
          integrity: "verified",
        },
        {
          class: "calculation",
          label: "Бюджет",
          displayValue: "209864.57 ALL",
          formulaId: "FORMULA-VS1-FX-01",
          formulaVersion: "1",
          inputs: [],
          rounding: "UNROUNDED_THEN_HALF_UP_2DP",
          outputHash: "a".repeat(64),
        },
      ],
      budget: {
        incomeAll: "209864.57",
        housingAll: "70000.00",
        knownResidualAll: "139864.57",
        unknowns: ["taxes", "living_costs"],
      },
    };
    const evidenceBefore = JSON.stringify(core.evidenceItems);
    const assessmentBefore = JSON.stringify(core.run.assessment);
    const budgetBefore = JSON.stringify(core.budget);
    let outbound: NarrativeInput | undefined;
    const presentRun = createPresentRun({
      loadRunDetailsCore: async () => core,
      narrative: {
        select: async (input) => {
          outbound = input;
          return {
            headline: {
              phraseId: "scoped_official_route",
              claimIds: ["al-law-79-facts-1"],
            },
            bullets: [{
              phraseId: "official_facts_separated",
              claimIds: ["al-law-79-facts-1"],
            }],
          };
        },
      },
    });

    const details = await presentRun("run-private");

    expect(outbound).toEqual({
      claimIds: ["al-law-79-facts-1"],
      typedValues: [{
        claimId: "al-law-79-facts-1",
        value: { requiresLawfulStay: true, contractTypes: ["foreign_employment"] },
      }],
    });
    const serializedOutbound = JSON.stringify(outbound);
    expect(serializedOutbound).not.toContain("PRIVATE FREE TEXT");
    expect(serializedOutbound).not.toContain("987654");
    expect(serializedOutbound).not.toContain("456789");
    expect(JSON.stringify(details.evidenceItems)).toBe(evidenceBefore);
    expect(JSON.stringify(details.run.assessment)).toBe(assessmentBefore);
    expect(JSON.stringify(details.budget)).toBe(budgetBefore);
    expect(details.narrative).toEqual({
      headline: "Маршрут показан в границах официальных источников",
      bullets: ["Официальные факты отделены от пользовательских данных и допущений."],
      origin: "model",
    });
  });

  it("rejects untrusted narrative prose at the application boundary", async () => {
    const core: RunDetailsCore = {
      run: {
        runId: "run-untrusted",
        runRevisionId: "revision-untrusted",
        assessmentDate: "2026-08-08",
        profileId: "profile-untrusted",
        evidenceSnapshotId: "evidence-untrusted",
        assessmentId: "assessment-untrusted",
        assessment: { marker: "green", reasons: [] },
        mode: "current",
      },
      profile: {
        id: "profile-untrusted",
        confirmedAt: "2026-08-08T10:00:00.000Z",
        profile: {
          availableResourcesAll: "500000",
          monthlyIncome: { amount: "210000", currency: "RUB" },
          incomeBasis: "foreign_contract",
          companionBasis: "none",
          relationship: "none",
          conditions: soloConditions,
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
      }],
    };
    const presentRun = createPresentRun({
      loadRunDetailsCore: async () => core,
      narrative: {
        render: async () => ({
          headline: "Тирана — самый безопасный и лучший вариант",
          bullets: ["Переезд гарантирован"],
          origin: "model",
        }),
        select: async () => ({
          headline: "Тирана — самый безопасный и лучший вариант",
          bullets: ["Переезд гарантирован"],
        }),
      } as never,
    });

    await expect(presentRun("run-untrusted")).resolves.toMatchObject({
      narrative: FALLBACK_NARRATIVE,
    });
  });

  it("rejects an unknowns narrative phrase when the presented core has no unknown item", async () => {
    const core: RunDetailsCore = {
      run: {
        runId: "run-no-unknowns",
        runRevisionId: "revision-no-unknowns",
        assessmentDate: "2026-08-08",
        profileId: "profile-no-unknowns",
        evidenceSnapshotId: "evidence-no-unknowns",
        assessmentId: "assessment-no-unknowns",
        assessment: { marker: "green", reasons: [] },
        mode: "current",
      },
      profile: {
        id: "profile-no-unknowns",
        confirmedAt: "2026-08-08T10:00:00.000Z",
        profile: {
          availableResourcesAll: "500000",
          monthlyIncome: { amount: "210000", currency: "RUB" },
          incomeBasis: "foreign_contract",
          companionBasis: "none",
          relationship: "none",
          conditions: soloConditions,
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
      }],
    };
    const presentRun = createPresentRun({
      loadRunDetailsCore: async () => core,
      narrative: {
        select: async () => ({
          headline: {
            phraseId: "scoped_official_route",
            claimIds: ["al-law-79-facts-1"],
          },
          bullets: [{
            phraseId: "unknowns_explicit",
            claimIds: ["al-law-79-facts-1"],
          }],
        }),
      },
    });

    const presented = await presentRun("run-no-unknowns");

    expect(presented).toMatchObject({ narrative: FALLBACK_NARRATIVE });
    expect(presented.narrative.bullets.join(" ")).not.toMatch(/неизвест|пробел/i);
  });

  it("keeps fallback wording valid even when no official source is available", () => {
    expect(FALLBACK_NARRATIVE.headline).toBe("Маршрут показан без недоказанных выводов");
  });

  it("renders the scoped journey from a JSON-serializable RunDetails value only", () => {
    const details: RunDetails = {
      run: {
        runId: "run-one",
        runRevisionId: "revision-one",
        assessmentDate: "2026-08-08",
        profileId: "profile-one",
        evidenceSnapshotId: "snapshot-one",
        assessmentId: "assessment-one",
        assessment: {
          marker: "yellow",
          reasons: [{
            code: "foreign_contract_not_verified",
            claimId: "al-law-79-art-68-contract",
            sourceId: "al-law-79",
          }],
        },
        mode: "current",
      },
      profile: {
        id: "profile-one",
        confirmedAt: "2026-08-08T10:00:00.000Z",
        profile: {
          availableResourcesAll: "500000",
          monthlyIncome: { amount: "210000", currency: "RUB" },
          incomeBasis: "foreign_contract",
          companionBasis: "family",
          relationship: "spouse",
          conditions: spouseConditions,
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
      narrative: {
        headline: "Нужна официальная проверка договора",
        bullets: ["Причина привязана к проверяемому источнику"],
        origin: "fallback",
      },
    };
    const serialized = JSON.parse(JSON.stringify(details)) as RunDetails;

    render(<Vs1Journey details={serialized} />);

    expect(screen.getByRole("heading", { name: "Нужна официальная проверка договора" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /подтверждённый снимок условий/i })).toBeTruthy();
    expect(screen.getByText(/месячный доход.*210 000 RUB.*ввод пользователя/i)).toBeTruthy();
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.hasAttribute("data-collapsed")).toBe(false);
    expect(screen.getByText("Паспорт доказательств")).toBeTruthy();
  });

  it("rejects malformed server-action IDs and decimal text before composition access", async () => {
    await expect(startConfirmedLifeAction({
      availableResourcesAll: "500000",
      monthlyIncome: { amount: "210000", currency: "RUB" },
      incomeBasis: "foreign_contract",
      companionBasis: "none",
      relationship: "none",
      conditions: soloConditions,
      freeText: "must never cross the boundary",
    } as never, { currency: "ALL", initialHousingAll: "70000" }))
      .rejects.toThrow();
    await expect(retryConfirmedLifeRunAction(" run-one ")).rejects.toThrow("invalid_run_id");
    await expect(saveInitialHousingBranchAction("run/one")).rejects.toThrow("invalid_run_id");
    await expect(rewindHousingBranchAction("not-a-sha256")).rejects.toThrow("invalid_commit_id");
    await expect(forkHousingBranchAction(
      { commitId: "a".repeat(64) },
      "90,000",
    )).rejects.toThrow("invalid_housing_all");
  });
});
