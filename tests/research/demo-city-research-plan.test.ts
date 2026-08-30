import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  planDemoCityResearchBatches,
  planDemoCityResearchJobs,
} from "../../src/research/demo-city-research-plan";
import { readDemoRelocationSeed } from "../../src/research/demo-relocation-seed";

const EXPECTED_TARGETS = [
  ["SI", ["ljubljana", "maribor", "koper", "celje", "kranj"]],
  ["PT", ["lisbon", "porto", "braga", "coimbra", "funchal"]],
  ["ES", ["madrid", "barcelona", "valencia", "alicante", "malaga"]],
  ["DE", ["berlin", "munich", "hamburg", "frankfurt-am-main", "dusseldorf"]],
  ["RS", ["belgrade", "novi-sad", "nis", "subotica", "kragujevac"]],
  ["ME", ["podgorica", "budva", "bar", "herceg-novi", "tivat"]],
  ["GE", ["tbilisi", "batumi", "kutaisi", "rustavi", "poti"]],
  ["TR", ["ankara", "istanbul", "izmir", "antalya", "mersin"]],
  ["AE", ["abu-dhabi", "dubai", "sharjah", "ajman", "ras-al-khaimah"]],
  ["TH", ["bangkok", "chiang-mai", "phuket-city", "pattaya", "hua-hin"]],
] as const;

const EXPECTED_JOB_IDS = EXPECTED_TARGETS.flatMap(([countryCode, cityIds]) =>
  cityIds.map((cityId) =>
    `demo-city-research:${countryCode.toLowerCase()}:${cityId}`));

describe("demo city research plan", () => {
  test("projects the exact 50 jobs in literal seed order", () => {
    const jobs = planDemoCityResearchJobs();
    const seed = readDemoRelocationSeed();

    expect(jobs.map(({ jobId }) => jobId)).toEqual(EXPECTED_JOB_IDS);
    expect(new Set(jobs.map(({ jobId }) => jobId)).size).toBe(50);
    expect(planDemoCityResearchJobs).toHaveLength(0);
    expect(planDemoCityResearchJobs()).toBe(jobs);

    let jobIndex = 0;
    for (const country of seed.countries) {
      for (const city of country.cities) {
        const job = jobs[jobIndex++]!;
        expect(Object.keys(job)).toEqual([
          "schemaVersion", "jobId", "countryCode", "cityId", "countryName",
          "cityName", "localeHints", "selectionRole", "authority",
        ]);
        expect(job).toMatchObject({
          schemaVersion: "demo-city-research-job@1",
          countryCode: country.countryCode,
          cityId: city.cityId,
          countryName: country.name,
          cityName: city.name,
          localeHints: country.localeHints,
          selectionRole: city.selectionRole,
          authority: "none_demo_seed_only",
        });
        expect(job.countryName).not.toBe(country.name);
        expect(job.cityName).not.toBe(city.name);
        expect(job.localeHints).not.toBe(country.localeHints);
      }
    }
    assertDeepFrozen(jobs);
  });

  test("forms ten exact country-aligned immutable batches of five", () => {
    const jobs = planDemoCityResearchJobs();
    const batches = planDemoCityResearchBatches();
    expect(planDemoCityResearchBatches).toHaveLength(0);
    expect(planDemoCityResearchBatches()).toBe(batches);
    expect(batches.map(({ batchId }) => batchId)).toEqual(
      Array.from({ length: 10 }, (_, index) =>
        `demo-city-research-batch:${String(index + 1).padStart(2, "0")}`),
    );

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index]!;
      expect(Object.keys(batch)).toEqual(["schemaVersion", "batchId", "jobs"]);
      expect(batch.schemaVersion).toBe("demo-city-research-batch@1");
      expect(batch.jobs).toHaveLength(5);
      expect(new Set(batch.jobs.map(({ countryCode }) => countryCode))).toEqual(
        new Set([EXPECTED_TARGETS[index]![0]]),
      );
    }
    expect(batches.flatMap(({ jobs: batchJobs }) => batchJobs)).toEqual(jobs);
    assertDeepFrozen(batches);

    const original = jobs[0]!.cityName.ru;
    expect(Reflect.set(jobs[0]!.cityName, "ru", "Изменено")).toBe(false);
    expect(() => (batches as unknown[]).push(batches[0])).toThrow(TypeError);
    expect(planDemoCityResearchJobs()[0]!.cityName.ru).toBe(original);
  });

  test("imports only the non-authoritative seed and performs no I/O", () => {
    const source = readFileSync(
      new URL("../../src/research/demo-city-research-plan.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('from "./demo-relocation-seed"');
    expect(source).not.toMatch(/from ["'].*(?:application|infrastructure|package|manifest|evidence|knowledge|frontier)/i);
    expect(source).not.toMatch(/\b(?:fetch|readFile|writeFile|Date\.now|Math\.random)\b/);
  });
});

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}
