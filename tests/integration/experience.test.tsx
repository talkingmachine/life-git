// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHousingBranchApplication } from "../../src/application/fork-housing";
import { createPresentRun } from "../../src/application/present-run";
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
} from "../../src/app/actions";
import type { BranchCommit } from "../../src/branch/life-git";
import { EvidencePassport } from "../../src/experience/components/EvidencePassport";
import { LifeBranch } from "../../src/experience/components/LifeBranch";
import { LifeGitDiff } from "../../src/experience/components/LifeGitDiff";
import { ProfileCard } from "../../src/experience/components/ProfileCard";
import { ResearchMap } from "../../src/experience/components/ResearchMap";
import { Vs1Journey } from "../../src/experience/components/Vs1Journey";
import {
  createOpenAiNarrative,
  FALLBACK_NARRATIVE,
} from "../../src/infrastructure/narrative";
import type { NarrativeParse } from "../../src/infrastructure/narrative";

afterEach(cleanup);

describe("confirmed-life visual journey", () => {
  it("requires explicit confirmation of every initial profile condition", () => {
    const confirm = vi.fn();

    render(
      <ProfileCard
        onConfirm={confirm}
        profile={{
          housingAll: "70000",
          hasContract: true,
          hasResources: true,
          hasLawfulStay: true,
          companionMode: "staged",
        }}
      />,
    );

    expect(screen.getByText(/жильё.*70 000 ALL/i)).toBeTruthy();
    expect(screen.getByText(/контракт/i)).toBeTruthy();
    expect(screen.getByText(/ресурс/i)).toBeTruthy();
    expect(screen.getByText(/законн/i)).toBeTruthy();
    expect(screen.getByText(/спутник.*поэтапно/i)).toBeTruthy();

    const submit = screen.getByRole("button", { name: /подтвердить профиль/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /подтверждаю исходные условия/i }));
    fireEvent.click(submit);

    expect(confirm).toHaveBeenCalledOnce();
  });

  it("labels profile inputs as user/scenario conditions rather than official verification", () => {
    render(
      <ProfileCard
        onConfirm={() => undefined}
        profile={{
          housingAll: "70000",
          hasContract: true,
          hasResources: true,
          hasLawfulStay: true,
          companionMode: "staged",
        }}
      />,
    );

    expect(screen.getByText(/контракт.*ввод пользователя/i)).toBeTruthy();
    expect(screen.getByText(/ресурсы.*ввод пользователя/i)).toBeTruthy();
    expect(screen.getByText(/законное пребывание.*условие сценария/i)).toBeTruthy();
    expect(screen.queryByText(/ресурсы подтверждены/i)).toBeNull();
    expect(screen.queryByText(/законное пребывание подтверждено/i)).toBeNull();
  });

  it("supports a route without a companion without implying a couple", () => {
    render(
      <ProfileCard
        onConfirm={() => undefined}
        profile={{
          housingAll: "70000",
          hasContract: true,
          hasResources: true,
          hasLawfulStay: true,
          companionMode: "none" as "staged",
        }}
      />,
    );

    expect(screen.getByText(/маршрут без спутника/i)).toBeTruthy();
    expect(screen.queryByText(/спутник.*поэтапно/i)).toBeNull();
  });

  it("shows a gray pending map scoped to the single Russia to Tirana candidate", () => {
    render(
      <ResearchMap
        mode="pending"
        candidates={[
          {
            id: "tirana",
            origin: "Россия",
            destination: "Тирана",
            status: "pending",
          },
        ]}
      />,
    );

    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.getAttribute("data-tone")).toBe("gray");
    expect(map.getAttribute("data-scope")).toBe("single-candidate");
    expect(within(map).getAllByRole("listitem")).toHaveLength(1);
    expect(within(map).getByRole("img", { name: /самолёт/i })).toBeTruthy();
    expect(within(map).getByText(/Россия.*Тирана/i)).toBeTruthy();
    expect(within(map).getByText("Проверка")).toBeTruthy();
    expect(within(map).getByRole("status", { name: /идёт проверка/i })).toBeTruthy();
  });

  it("collapses a green result without leaving a map popover", () => {
    render(
      <ResearchMap
        mode="green"
        candidates={[{
          id: "tirana",
          origin: "Россия",
          destination: "Тирана",
          status: "green",
        }]}
      />,
    );

    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(map.getAttribute("data-collapsed")).toBe("true");
    expect(within(map).getByText(/маршрут предварительно совместим/i)).toBeTruthy();
    expect(within(map).getByText(/Тирана.*проверено в заявленном scope/i)).toBeTruthy();
    expect(within(map).queryByText(/Тирана подтверждена/i)).toBeNull();
    expect(within(map).queryByRole("img", { name: /самолёт/i })).toBeNull();
    expect(within(map).queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["yellow", "Enter", "Не подтверждён официальный источник о договоре"],
    ["red", " ", "Доход зависит только от местного работодателя"],
  ] as const)("reveals a concise official-linked %s reason from the native marker button", (status, key, reason) => {
    render(
      <ResearchMap
        mode={status}
        candidates={[{
          id: "tirana",
          origin: "Россия",
          destination: "Тирана",
          status,
          reason: {
            summary: reason,
            officialUrl: "https://official.example/al-law-79",
          },
        }]}
      />,
    );

    const marker = screen.getByRole("button", { name: new RegExp(`Тирана.*${status === "yellow" ? "уточнить" : "не подходит"}`, "i") });
    expect(marker.tagName).toBe("BUTTON");
    expect(screen.queryByText(reason)).toBeNull();
    fireEvent.keyDown(marker, { key });

    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByRole("link", { name: /официальный источник/i }).getAttribute("href"))
      .toBe("https://official.example/al-law-79");
  });

  it("keeps the old yellow snapshot while retry reports a new run and snapshot", async () => {
    const oldRun = Object.freeze({ runId: "run-old", evidenceSnapshotId: "snapshot-old" });
    const before = JSON.stringify(oldRun);
    const retry = vi.fn(async () => ({ runId: "run-new", evidenceSnapshotId: "snapshot-new" }));

    render(
      <ResearchMap
        mode="yellow"
        previousRun={oldRun}
        onRetry={retry}
        candidates={[{
          id: "tirana",
          origin: "Россия",
          destination: "Тирана",
          status: "yellow",
          reason: {
            summary: "Источник временно недоступен",
            officialUrl: "https://official.example/al-law-79",
          },
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /проверить ещё раз/i }));

    expect(await screen.findByText(/Новый запуск: run-new/i)).toBeTruthy();
    expect(screen.getByText(/Снимок: snapshot-new/i)).toBeTruthy();
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
    expect(within(flow).getByText(/налоги.*неизвестно/i)).toBeTruthy();
    expect(within(flow).getByText(/стоимость жизни.*неизвестно/i)).toBeTruthy();
  });

  it("renders all six Evidence Passport classes with verified and blocked provenance", () => {
    render(
      <EvidencePassport
        items={[
          {
            class: "official_fact",
            label: "Требования к договору",
            displayValue: "Иностранный договор допустим",
            sourceId: "al-law-79",
            scope: "VS-1 confirmed-life",
            sourcePeriod: "cons-2026-08-01",
            anchor: "Art. 68#abc",
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
            text: "Маршрут опирается на официальные данные",
            claimIds: ["al-law-79-facts-1"],
          },
          bullets: [{
            text: "Договор и законное пребывание подтверждены источником",
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

    const narrative = await adapter.render(input);

    expect(narrative).toEqual({
      headline: "Маршрут опирается на официальные данные",
      bullets: ["Договор и законное пребывание подтверждены источником"],
      origin: "model",
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

    await expect(adapter.render({ claimIds: [], typedValues: [] })).resolves.toEqual(FALLBACK_NARRATIVE);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", async () => { throw new Error("timeout"); }],
    ["refusal", async () => ({
      output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      output_parsed: {
        headline: { text: "Маршрут проверен", claimIds: ["al-law-79-facts-1"] },
        bullets: [{ text: "Источник доступен", claimIds: ["al-law-79-facts-1"] }],
      },
    })],
    ["invalid schema", async () => ({ output: [], output_parsed: { headline: "неверная схема" } })],
    ["unknown claim ID", async () => ({
      output: [],
      output_parsed: {
        headline: { text: "Маршрут проверен", claimIds: ["al-law-79-facts-1"] },
        bullets: [{ text: "Источник доступен", claimIds: ["unknown-claim"] }],
      },
    })],
    ["digit in generated prose", async () => ({
      output: [],
      output_parsed: {
        headline: { text: "Маршрут проверен", claimIds: ["al-law-79-facts-1"] },
        bullets: [{ text: "Проверено дважды 2", claimIds: ["al-law-79-facts-1"] }],
      },
    })],
  ] as const)("falls back for %s", async (_case, parse) => {
    const adapter = createOpenAiNarrative({ apiKey: "test-key", parse });

    await expect(adapter.render({
      claimIds: ["al-law-79-facts-1"],
      typedValues: [{ claimId: "al-law-79-facts-1", value: true }],
    })).resolves.toEqual(FALLBACK_NARRATIVE);
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
          reasons: [{ code: "foreign_contract_not_verified", claimId: "al-law-79-art-68-contract" }],
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
        render: async (input) => {
          outbound = input;
          return {
            headline: "Нужна дополнительная проверка",
            bullets: ["Официальный источник остаётся единственным основанием"],
            origin: "model",
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
          reasons: [{ code: "foreign_contract_not_verified", claimId: "al-law-79-art-68-contract" }],
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
    expect(screen.getByRole("heading", { name: /исходный профиль/i })).toBeTruthy();
    const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
    expect(within(map).getAllByRole("listitem")).toHaveLength(1);
    expect(within(map).getByRole("button", { name: /Тирана.*уточнить/i })).toBeTruthy();
    expect(screen.getByText("Паспорт доказательств")).toBeTruthy();
  });

  it("rejects malformed server-action IDs and decimal text before composition access", async () => {
    await expect(retryConfirmedLifeRunAction(" run-one ")).rejects.toThrow("invalid_run_id");
    await expect(saveInitialHousingBranchAction("run/one")).rejects.toThrow("invalid_run_id");
    await expect(rewindHousingBranchAction("not-a-sha256")).rejects.toThrow("invalid_commit_id");
    await expect(forkHousingBranchAction(
      { commitId: "a".repeat(64) },
      "90,000",
    )).rejects.toThrow("invalid_housing_all");
  });
});
