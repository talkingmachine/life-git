import {
  readDemoRelocationSeed,
  type DemoCitySeed,
  type DemoCountrySeed,
  type DemoLocalizedName,
} from "./demo-relocation-seed";

export type DemoCityResearchJob = Readonly<{
  schemaVersion: "demo-city-research-job@1";
  jobId: string;
  countryCode: string;
  cityId: string;
  countryName: DemoLocalizedName;
  cityName: DemoLocalizedName;
  localeHints: readonly string[];
  selectionRole: "national_capital" | "relocation_city";
  authority: "none_demo_seed_only";
}>;

export type DemoCityResearchBatch = Readonly<{
  schemaVersion: "demo-city-research-batch@1";
  batchId: string;
  jobs: readonly [
    DemoCityResearchJob,
    DemoCityResearchJob,
    DemoCityResearchJob,
    DemoCityResearchJob,
    DemoCityResearchJob,
  ];
}>;

const BATCHES = Object.freeze(
  readDemoRelocationSeed().countries.map((country, index) => createBatch(country, index)),
);

const JOBS = Object.freeze(BATCHES.flatMap(({ jobs }) => [...jobs]));

export function planDemoCityResearchJobs(): readonly DemoCityResearchJob[] {
  return JOBS;
}

export function planDemoCityResearchBatches(): readonly DemoCityResearchBatch[] {
  return BATCHES;
}

function createBatch(country: DemoCountrySeed, index: number): DemoCityResearchBatch {
  const jobs = country.cities.map((city) => createJob(country, city));
  return Object.freeze({
    schemaVersion: "demo-city-research-batch@1" as const,
    batchId: `demo-city-research-batch:${String(index + 1).padStart(2, "0")}`,
    jobs: Object.freeze(jobs) as DemoCityResearchBatch["jobs"],
  });
}

function createJob(country: DemoCountrySeed, city: DemoCitySeed): DemoCityResearchJob {
  return Object.freeze({
    schemaVersion: "demo-city-research-job@1" as const,
    jobId: `demo-city-research:${country.countryCode.toLowerCase()}:${city.cityId}`,
    countryCode: country.countryCode,
    cityId: city.cityId,
    countryName: Object.freeze({ ...country.name }),
    cityName: Object.freeze({ ...city.name }),
    localeHints: Object.freeze([...country.localeHints]),
    selectionRole: city.selectionRole,
    authority: "none_demo_seed_only" as const,
  });
}
