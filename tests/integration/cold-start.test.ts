import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { createConfirmedLifeComposition } from "../../src/infrastructure/composition-root";
import { createColdStartComposition } from "../../src/infrastructure/cold-start-composition";
import { coldStartEventSchema } from "../../src/experience/cold-start-stream";
import { SqliteDossierStore } from "../../src/infrastructure/sqlite/dossier-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";
import {
  canonicalJson,
  createEvidenceIntegrity,
  hmacSha256,
  sha256Text,
} from "../../src/infrastructure/integrity";
import { replayEvidenceByRules } from "../../src/application/replay-evidence";
import {
  createColdStartApplication,
  type ColdStartApplication,
  type ColdStartEvent,
  type ColdStartPrepared,
  type ColdStartReadModel,
} from "../../src/application/cold-start";
import { confirmProfile } from "../../src/decision/profile";
import { assessColdStart } from "../../src/decision/cold-start-assessment";
import {
  confirmRelocationProfile,
  type RelocationProfileDraft,
} from "../../src/decision/relocation-profile";
import { REQUIRED_CLAIM_KINDS } from "../../src/research/country-registry";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../../src/research/cold-start-contracts";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  buildCountryDossier,
  type DossierPublishResult,
} from "../../src/research/dossier";
import { createSloveniaPlan } from "../../src/research/slovenia-plan";
import { createInstalledCountrySourceIndex } from "../../src/infrastructure/sources/country-source-index";
import {
  sealEvidencePlan,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";

const KEY = "task-3-cold-start-key-at-least-32-bytes";
const ASSESSMENT_DATE = "2026-08-11";
const PUBLISHED_AT = "2026-08-11T10:30:00.000Z";
const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];

const INDEXED_SOURCE_URLS: Readonly<Partial<Record<SloveniaSourceId, string>>> = {
  "si-digital-nomad-route": "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
  "si-income-threshold": "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
  "si-companion-employment": "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
};
const COUNTRY_SOURCE_IDS = SOURCE_IDS.slice(0, 3) as readonly Exclude<
  SloveniaSourceId,
  "cbr-eur"
>[];
const PARSER_VERSIONS = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
} as const;
const SOURCE_URLS = {
  "si-digital-nomad-route": "https://www.gov.si/en/news/digital-nomads/",
  "si-income-threshold": "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
  "si-companion-employment": "https://www.ess.gov.si/conditional-employment/",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
} as const;
const VALUES: ClaimValueByKind = {
  route_basis: {
    route: "temporary_residence_digital_nomad",
    legalBasis: "ZTuj-2 Article 51a",
    effectiveFrom: "2025-11-21",
  },
  citizenship_applicability: {
    eligibleCategory: "third_country_national",
    explicitNationalityExclusions: ["EU", "EEA"],
  },
  remote_work_relations: {
    allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
    slovenianLabourMarketWorkIncluded: false,
  },
  income: {
    metric: "latest_official_average_monthly_net_salary",
    multiplier: "2",
    thresholdEur: "3112.00",
    period: "2026M01",
  },
  qualification: { rule: "not_listed_in_authoritative_requirements" },
  companion_entry: { rule: "immediate_family_reunification_without_waiting_period" },
  companion_local_work_access: {
    access: "conditional",
    labourMarketCheck: true,
    informationSheet: true,
  },
  duration: { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6 },
  general_statutory_prerequisites: {
    passportBeyondPermitMonths: 3,
    healthInsurance: true,
    article55GroundsApply: true,
  },
};

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
}

function fileDatabase(): { readonly database: Database.Database; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "cold-start-concurrency-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const value = openEvidenceDatabase(path);
  databases.push(value);
  return { database: value, path };
}

function sourceFor(kind: ClaimKind): Exclude<SloveniaSourceId, "cbr-eur"> {
  if (kind === "income") return "si-income-threshold";
  if (kind === "companion_local_work_access") return "si-companion-employment";
  return "si-digital-nomad-route";
}

function validatorFor(sourceId: Exclude<SloveniaSourceId, "cbr-eur">): string {
  if (sourceId === "si-income-threshold") return "si-income@2";
  if (sourceId === "si-companion-employment") return "si-companion@2";
  return "si-route@2";
}

function artifact(
  sourceId: SloveniaSourceId,
  runId: string,
  capturedAt: string,
  url: string = SOURCE_URLS[sourceId],
  artifactIdSuffix = "",
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new TextEncoder().encode(`official:${sourceId}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${sourceId}:official:${sha256}${artifactIdSuffix}`,
    runId,
    sourceId,
    role: "official-document",
    url,
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt,
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

interface PreparedOptions {
  readonly snapshotId?: string;
  readonly runId?: string;
  readonly capturedAt?: string;
  readonly contextHash?: string;
  readonly omitKind?: ClaimKind;
  readonly duplicateKind?: ClaimKind;
  readonly mutateClaim?: (claim: VerifiedCountryClaim) => VerifiedCountryClaim;
  readonly rulesVersion?: string;
  readonly incomeUrl?: string;
  readonly incomePeriod?: string;
  readonly incomeExcerpt?: string;
  readonly artifactIdSuffix?: string;
  readonly assessmentDate?: string;
}

async function preparedFixture(
  options: PreparedOptions = {},
): Promise<{
  readonly prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}> {
  const runId = options.runId ?? "cold-start-run";
  const artifacts = COUNTRY_SOURCE_IDS.map((sourceId) =>
    artifact(
      sourceId,
      runId,
      options.capturedAt ?? "2026-08-11T10:00:00.000Z",
      sourceId === "si-income-threshold" && options.incomeUrl !== undefined
        ? options.incomeUrl
        : SOURCE_URLS[sourceId],
      options.artifactIdSuffix ?? "",
    )
  );
  let claims = REQUIRED_CLAIM_KINDS
    .filter((kind) => kind !== options.omitKind)
    .map((kind): VerifiedCountryClaim => {
      const sourceId = sourceFor(kind);
      const sourceArtifact = artifacts.find((candidate) => candidate.sourceId === sourceId)!;
      const anchor = {
        artifactId: sourceArtifact.artifactId,
        locator: `${kind} exact locator`,
        excerptSha256: createHash("sha256").update(
          kind === "income" && options.incomeExcerpt !== undefined
            ? options.incomeExcerpt
            : `${kind} exact excerpt`,
        ).digest("hex"),
      };
      const sourcePeriod = kind === "income" ? options.incomePeriod ?? "2026M01" :
        sourceId === "si-companion-employment" ? "ZAKO6655:NPB 8" : "2025-11-21";
      return {
        claimId: `${sourceId}:${kind}:${validatorFor(sourceId)}`,
        claimKind: kind,
        sourceId,
        value: kind === "income" && options.incomePeriod !== undefined
          ? { ...VALUES.income, period: options.incomePeriod }
          : VALUES[kind],
        scope: "VS-2 Slovenia cold start",
        sourcePeriod,
        anchor,
        evidence: [{
          sourceId,
          artifactId: sourceArtifact.artifactId,
          navigationUrl: sourceArtifact.request.url,
          resolvedEvidenceUrl: sourceArtifact.responseUrl,
          sourcePeriod,
          anchor,
        }],
        validatorVersion: validatorFor(sourceId),
        status: "verified",
      } as VerifiedCountryClaim;
    });
  if (options.duplicateKind !== undefined) {
    claims = [...claims, claims.find((claim) => claim.claimKind === options.duplicateKind)!];
  }
  if (options.mutateClaim !== undefined) claims = claims.map(options.mutateClaim);

  const countryEntries = COUNTRY_SOURCE_IDS.map((sourceId) => ({
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl: SOURCE_URLS[sourceId],
      ...(INDEXED_SOURCE_URLS[sourceId] === undefined
        ? {}
        : { indexedSourceUrl: INDEXED_SOURCE_URLS[sourceId] }),
      resolvedEvidenceUrl: SOURCE_URLS[sourceId],
      artifacts: artifacts.filter((candidate) => candidate.sourceId === sourceId),
    },
    coverage: "verified" as const,
    claims: claims.filter((claim) => claim.sourceId === sourceId),
  }));
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [
    ...countryEntries,
    {
      sourceId: "cbr-eur",
      parserEntry: {
        sourceId: "cbr-eur",
        navigationUrl: SOURCE_URLS["cbr-eur"],
        resolvedEvidenceUrl: SOURCE_URLS["cbr-eur"],
        artifacts: [],
      },
      coverage: "unavailable",
      blocker: {
        sourceId: "cbr-eur",
        kind: "semantic_mismatch",
        navigationUrl: SOURCE_URLS["cbr-eur"],
        artifactIds: [],
      },
    },
  ];
  const prepared = await sealEvidencePlan({
    id: options.snapshotId ?? `${runId}:evidence`,
    assessmentDate: options.assessmentDate ?? ASSESSMENT_DATE,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: PARSER_VERSIONS,
    rulesVersion: options.rulesVersion ?? "vs2-si-evidence@2",
    ...(options.contextHash === undefined ? {} : { contextHash: options.contextHash }),
  }, createEvidenceIntegrity(KEY));
  return { prepared, artifacts };
}

async function appendArtifacts(
  db: Database.Database,
  artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[],
): Promise<void> {
  const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
  for (const sourceArtifact of artifacts) await store.appendArtifact(sourceArtifact);
}

type SloveniaPrepared = SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
type PreparedCopy = {
  snapshot: SloveniaPrepared["snapshot"];
  manifest: SloveniaPrepared["manifest"];
};

function resignPrepared(
  prepared: SloveniaPrepared,
  mutate: (copy: PreparedCopy) => void,
): SloveniaPrepared {
  const copy = structuredClone({ snapshot: prepared.snapshot, manifest: prepared.manifest });
  mutate(copy);
  const canonicalManifest = canonicalJson(copy.manifest);
  const manifestHash = sha256Text(canonicalManifest);
  const hmac = hmacSha256(canonicalManifest, KEY);
  return {
    snapshot: { ...copy.snapshot, manifestHash, hmac },
    manifest: copy.manifest,
    canonicalManifest,
  };
}

function replaceEntries(
  copy: PreparedCopy,
  entries: readonly SloveniaPrepared["manifest"]["entries"][number][],
): void {
  (copy.manifest as unknown as {
    entries: readonly SloveniaPrepared["manifest"]["entries"][number][];
  }).entries = entries;
}

function replaceClaims(
  copy: PreparedCopy,
  claims: readonly ColdStartEvidenceClaim[],
): void {
  (copy.snapshot as unknown as { claims: readonly ColdStartEvidenceClaim[] }).claims = claims;
  (copy.manifest.snapshot as unknown as { claims: readonly ColdStartEvidenceClaim[] }).claims =
    structuredClone(claims);
}

function markCbrVerifiedWithoutClaim(copy: PreparedCopy): void {
  const coverage = { ...copy.snapshot.coverage, "cbr-eur": "verified" as const };
  const blockers = copy.snapshot.blockers.filter(({ sourceId }) => sourceId !== "cbr-eur");
  (copy.snapshot as unknown as { coverage: typeof coverage }).coverage = coverage;
  (copy.snapshot as unknown as { blockers: typeof blockers }).blockers = blockers;
  (copy.manifest.snapshot as unknown as { coverage: typeof coverage }).coverage =
    structuredClone(coverage);
  (copy.manifest.snapshot as unknown as { blockers: typeof blockers }).blockers =
    structuredClone(blockers);
}

type StoredShapeCopy = { snapshot: unknown; manifest: unknown };
type StoredShapeMutation = (copy: StoredShapeCopy) => void;

function mutableRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

const MALFORMED_STORED_SHAPES: readonly [string, StoredShapeMutation][] = [
  ["null snapshot", (copy) => { copy.snapshot = null; }],
  ["non-record manifest", (copy) => { copy.manifest = []; }],
  ["null coverage", (copy) => { mutableRecord(copy.snapshot).coverage = null; }],
  ["non-record parser versions", (copy) => {
    mutableRecord(copy.snapshot).parserVersions = "invalid";
  }],
  ["non-array entries before source dispatch", (copy) => {
    mutableRecord(copy.snapshot).rulesVersion = "unknown-evidence@1";
    mutableRecord(copy.manifest).entries = null;
  }],
  ["non-array artifacts", (copy) => { mutableRecord(copy.manifest).artifacts = {}; }],
  ["non-array claims", (copy) => { mutableRecord(copy.snapshot).claims = null; }],
  ["non-array blockers", (copy) => { mutableRecord(copy.snapshot).blockers = {}; }],
  ["non-array snapshot artifact IDs", (copy) => {
    mutableRecord(copy.snapshot).artifactIds = null;
  }],
  ["non-array entry artifact IDs", (copy) => {
    const entries = mutableRecord(copy.manifest).entries as unknown[];
    mutableRecord(entries[0]).artifactIds = {};
  }],
  ["null manifest-snapshot coverage", (copy) => {
    mutableRecord(mutableRecord(copy.manifest).snapshot).coverage = null;
  }],
  ["non-record manifest-snapshot parser versions", (copy) => {
    mutableRecord(mutableRecord(copy.manifest).snapshot).parserVersions = [];
  }],
  ["non-array manifest-snapshot claims", (copy) => {
    mutableRecord(mutableRecord(copy.manifest).snapshot).claims = {};
  }],
  ["non-array manifest-snapshot blockers", (copy) => {
    mutableRecord(mutableRecord(copy.manifest).snapshot).blockers = null;
  }],
  ["non-array manifest-snapshot artifact IDs", (copy) => {
    mutableRecord(mutableRecord(copy.manifest).snapshot).artifactIds = {};
  }],
];

interface PublishWorkerHandle {
  readonly ready: Promise<void>;
  readonly result: Promise<DossierPublishResult>;
}

function publishWorker(input: {
  readonly path: string;
  readonly preparedEvidence: SloveniaPrepared;
  readonly publishedAt: string;
  readonly start: SharedArrayBuffer;
}): PublishWorkerHandle {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const { SqliteDossierStore } = await tsImport(
          workerData.storeModule,
          workerData.parentModule,
        );
        const Database = (await import("better-sqlite3")).default;
        database = new Database(workerData.path);
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 3000");
        parentPort.postMessage({ type: "ready" });
        const start = new Int32Array(workerData.start);
        Atomics.wait(start, 0, 0);
        const value = new SqliteDossierStore(database, workerData.key).publishWithEvidence({
          preparedEvidence: workerData.preparedEvidence,
          publishedAt: workerData.publishedAt,
        });
        database.close();
        database = undefined;
        parentPort.postMessage({ type: "result", value });
      } catch (error) {
        parentPort.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (database?.open) database.close();
      }
    })();
  `;
  const worker = new Worker(source, {
    eval: true,
    workerData: {
      ...input,
      key: KEY,
      storeModule: pathToFileURL(resolve("src/infrastructure/sqlite/dossier-store.ts")).href,
      parentModule: pathToFileURL(resolve("tests/integration/cold-start.test.ts")).href,
    },
  });
  let readyResolve!: () => void;
  let resultResolve!: (value: DossierPublishResult) => void;
  let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolveReady) => {
    readyResolve = resolveReady;
  });
  const result = new Promise<DossierPublishResult>((resolveResult, rejectResult) => {
    resultResolve = resolveResult;
    resultReject = rejectResult;
  });
  void result.catch(() => undefined);
  const reject = (error: Error): void => {
    readyResolve();
    resultReject(error);
  };
  worker.on("message", (message: {
    readonly type: "ready" | "result" | "error";
    readonly value?: DossierPublishResult;
    readonly message?: string;
  }) => {
    if (message.type === "ready") readyResolve();
    if (message.type === "result") resultResolve(message.value!);
    if (message.type === "error") reject(new Error(message.message ?? "worker_failed"));
  });
  worker.on("error", (error) => reject(error));
  return { ready, result };
}

const RELOCATION_DRAFT: RelocationProfileDraft = {
  currentCountryCode: "RU",
  citizenships: ["RU"],
  monthlyIncome: { amount: "210000.00", currency: "RUB", basis: "net" },
  remoteWork: { relation: "foreign_employment", legallyAllowed: true },
  education: "none",
  relevantExperienceYears: 6,
  passportValidUntil: "2029-11-30",
  healthInsurance: "confirmed",
  companions: [
    { relationship: "minor_child" },
    { relationship: "spouse" },
    { relationship: "minor_child" },
  ],
};

describe("relocation profile confirmation boundary", () => {
  test("normalizes a strict non-PII draft into one stable deeply immutable snapshot", () => {
    const input = structuredClone(RELOCATION_DRAFT);
    let clockCalls = 0;
    const clock = (): Date => {
      clockCalls += 1;
      return new Date("2026-08-11T09:15:00.000Z");
    };

    const first = confirmRelocationProfile(input, clock);
    const second = confirmRelocationProfile(RELOCATION_DRAFT, () =>
      new Date("2026-08-11T09:15:00.000Z")
    );

    expect(clockCalls).toBe(1);
    expect(first).toEqual({
      schemaVersion: "relocation-profile@1",
      id: "006f978ccb642469af54b2241b31f794c85123c211970fd4dac12c559fb6227e",
      confirmedAt: "2026-08-11T09:15:00.000Z",
      profile: {
        ...RELOCATION_DRAFT,
        monthlyIncome: { amount: "210000", currency: "RUB", basis: "net" },
        companions: [
          { relationship: "spouse" },
          { relationship: "minor_child" },
          { relationship: "minor_child" },
        ],
      },
    });
    expect(first).toEqual(second);
    expect(input).toEqual(RELOCATION_DRAFT);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.profile.monthlyIncome)).toBe(true);
    expect(Object.isFrozen(first.profile.companions)).toBe(true);
    expect(Object.isFrozen(first.profile.companions[0])).toBe(true);
  });

  test.each([
    ["top-level PII", { ...RELOCATION_DRAFT, email: "private@example.test" }],
    ["nested unknown key", {
      ...RELOCATION_DRAFT,
      monthlyIncome: { ...RELOCATION_DRAFT.monthlyIncome, employer: "secret" },
    }],
    ["passport number", { ...RELOCATION_DRAFT, passportNumber: "123456789" }],
    ["arbitrary relationship", {
      ...RELOCATION_DRAFT,
      companions: [{ relationship: "partner called Alice" }],
    }],
    ["non-canonical date", { ...RELOCATION_DRAFT, passportValidUntil: "2029-02-29" }],
    ["over-precise income", {
      ...RELOCATION_DRAFT,
      monthlyIncome: { ...RELOCATION_DRAFT.monthlyIncome, amount: "210000.001" },
    }],
  ])("rejects %s before persistence", (_label, draft) => {
    expect(() => confirmRelocationProfile(draft, () => new Date())).toThrow();
  });

  test("stores relocation snapshots explicitly while legacy VS-1 rows stay byte-identical", async () => {
    const db = database();
    const store = new SqliteProfileStore(db);
    const legacy = confirmProfile({
      availableResourcesAll: "408000",
      monthlyIncome: { amount: "210000", currency: "RUB" },
      incomeBasis: "foreign_contract",
      companionBasis: "none",
      relationship: "none",
      conditions: {
        incomeContinues12Months: true,
        lawfulStayPrerequisiteAccepted: true,
        stagedSpouseRouteAccepted: false,
      },
    }, () => new Date("2026-08-11T08:00:00.000Z"));
    await store.append(legacy);
    const legacyJson = db.prepare(
      "SELECT snapshot_json FROM profile_snapshots WHERE id = ?",
    ).pluck().get(legacy.id);

    const relocation = confirmRelocationProfile(
      RELOCATION_DRAFT,
      () => new Date("2026-08-11T09:15:00.000Z"),
    );
    await store.appendRelocation(relocation);

    expect(await store.loadRelocationVerified(relocation.id)).toEqual(relocation);
    expect(await store.loadVerified(legacy.id)).toEqual(legacy);
    expect(db.prepare(
      "SELECT snapshot_json FROM profile_snapshots WHERE id = ?",
    ).pluck().get(legacy.id)).toBe(legacyJson);
    await expect(store.loadRelocationVerified(legacy.id)).rejects.toThrow("integrity_mismatch");
  });
});

async function publishedAssessmentFixture(options: {
  readonly cbrRate?: string;
  readonly cbrEffectiveDate?: string;
  readonly mutateClaim?: (claim: VerifiedCountryClaim) => VerifiedCountryClaim;
} = {}) {
  const db = database();
  const fixture = await replayableFixture({
    cbrRate: options.cbrRate ?? "90",
    cbrEffectiveDate: options.cbrEffectiveDate ?? "2026-08-10",
    ...(options.mutateClaim === undefined ? {} : { mutateClaim: options.mutateClaim }),
  });
  await appendArtifacts(db, fixture.artifacts);
  const published = new SqliteDossierStore(db, KEY).publishWithEvidence({
    preparedEvidence: fixture.prepared,
    publishedAt: PUBLISHED_AT,
  });
  return { fixture, dossier: published.version };
}

function confirmedRelocation(
  overrides: Partial<RelocationProfileDraft> = {},
) {
  return confirmRelocationProfile({
    ...RELOCATION_DRAFT,
    companions: [],
    ...overrides,
  }, () => new Date("2026-08-11T09:15:00.000Z"));
}

describe("pure VS-2 cold-start comparator", () => {
  test("returns a lineage-backed red formula using unrounded Decimal income", async () => {
    const { fixture, dossier } = await publishedAssessmentFixture({ cbrRate: "90" });
    const profile = confirmedRelocation({
      passportValidUntil: "unknown",
      healthInsurance: "unknown",
    });

    const result = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile,
      evidence: fixture.prepared.snapshot,
      dossier,
      sourceNavigation: SOURCE_URLS,
    });

    expect(result).toEqual({
      marker: "red",
      personalFit: "verified_veto",
      cityScope: "not_checked",
      reasons: [{
        code: "income_below_verified_threshold",
        summary: "Подтверждённого чистого дохода недостаточно для порога маршрута.",
        claimIds: ["si-income-threshold:income:si-income@2", "cbr-eur-facts-1"],
        officialUrls: [
          "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/613486752/details",
          SISTAT_API_URL,
          SOURCE_URLS["cbr-eur"],
        ],
      }],
      formula: {
        formulaId: "FORMULA-VS2-INCOME-01",
        formulaVersion: "1",
        expression: "monthlyIncomeRub / eurRub < thresholdEur",
        monthlyIncomeRub: "210000",
        eurRub: "90",
        incomeEur: "2333.33",
        thresholdEur: "3361.60",
        rounding: "UNROUNDED_THEN_HALF_UP_2DP",
        sourceClaimIds: ["si-income-threshold:income:si-income@2", "cbr-eur-facts-1"],
      },
    });
  });

  test("changes the decision when verified FX or threshold changes and never returns green", async () => {
    const compatible = await publishedAssessmentFixture({ cbrRate: "60" });
    const thresholdVeto = await publishedAssessmentFixture({
      cbrRate: "60",
      mutateClaim: (claim) => claim.claimKind === "income"
        ? { ...claim, value: { ...claim.value as ClaimValueByKind["income"], thresholdEur: "3600.00" } }
        : claim,
    });
    const profile = confirmedRelocation();

    const compatibleResult = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile,
      evidence: compatible.fixture.prepared.snapshot,
      dossier: compatible.dossier,
      sourceNavigation: SOURCE_URLS,
    });
    const thresholdResult = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile,
      evidence: thresholdVeto.fixture.prepared.snapshot,
      dossier: thresholdVeto.dossier,
      sourceNavigation: SOURCE_URLS,
    });

    expect(compatibleResult.marker).toBe("yellow");
    expect(compatibleResult.personalFit).toBe("route_compatible_city_unverified");
    expect(compatibleResult.cityScope).toBe("not_checked");
    expect(compatibleResult.formula?.incomeEur).toBe("3500.00");
    expect(thresholdResult.marker).toBe("red");
    expect(thresholdResult.formula?.thresholdEur).toBe("3600.00");
  });

  test("keeps gross, unavailable or stale FX and unresolved prerequisites yellow", async () => {
    const current = await publishedAssessmentFixture();
    const unavailable = await preparedFixture();
    const unavailableDb = database();
    await appendArtifacts(unavailableDb, unavailable.artifacts);
    const unavailableDossier = new SqliteDossierStore(unavailableDb, KEY).publishWithEvidence({
      preparedEvidence: unavailable.prepared,
      publishedAt: PUBLISHED_AT,
    }).version;
    const stale = await publishedAssessmentFixture({ cbrEffectiveDate: "2026-08-01" });

    const gross = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile: confirmedRelocation({
        monthlyIncome: { amount: "210000", currency: "RUB", basis: "gross" },
      }),
      evidence: current.fixture.prepared.snapshot,
      dossier: current.dossier,
      sourceNavigation: SOURCE_URLS,
    });
    const missingFx = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile: confirmedRelocation(),
      evidence: unavailable.prepared.snapshot,
      dossier: unavailableDossier,
      sourceNavigation: SOURCE_URLS,
    });
    const staleFx = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile: confirmedRelocation(),
      evidence: stale.fixture.prepared.snapshot,
      dossier: stale.dossier,
      sourceNavigation: SOURCE_URLS,
    });

    for (const result of [gross, missingFx, staleFx]) {
      expect(result.marker).toBe("yellow");
      expect(result.personalFit).toBe("personal_evidence_missing");
    }
    expect(gross.formula).toBeUndefined();
    expect(missingFx.formula).toBeUndefined();
    expect(staleFx.formula).toBeUndefined();
  });

  test("requires current official dossier lineage and maps blocked country evidence to yellow", async () => {
    const { fixture, dossier } = await publishedAssessmentFixture();
    const withoutIncomeLineage = structuredClone(dossier);
    const income = withoutIncomeLineage.payload.claims.find((claim) => claim.claimKind === "income")!;
    (income as unknown as { evidence: unknown[] }).evidence = [];

    expect(() => assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile: confirmedRelocation(),
      evidence: fixture.prepared.snapshot,
      dossier: withoutIncomeLineage,
      sourceNavigation: SOURCE_URLS,
    })).toThrow("integrity_mismatch");

    const blockedSnapshot = {
      ...fixture.prepared.snapshot,
      coverage: {
        ...fixture.prepared.snapshot.coverage,
        "si-income-threshold": "unavailable" as const,
      },
      claims: fixture.prepared.snapshot.claims.filter(
        (claim) => !("claimKind" in claim) || claim.claimKind !== "income",
      ),
      blockers: [
        ...fixture.prepared.snapshot.blockers,
        {
          sourceId: "si-income-threshold" as const,
          kind: "semantic_mismatch" as const,
          navigationUrl: SOURCE_URLS["si-income-threshold"],
          artifactIds: [],
        },
      ],
    };
    const blocked = assessColdStart({
      assessmentAt: ASSESSMENT_DATE,
      profile: confirmedRelocation(),
      evidence: blockedSnapshot,
      sourceNavigation: SOURCE_URLS,
    });

    expect(blocked.marker).toBe("yellow");
    expect(blocked.personalFit).toBe("research_incomplete");
    expect(blocked.reasons[0]?.officialUrls).toEqual([SOURCE_URLS["si-income-threshold"]]);
  });

  test.each([
    ["month-end", "2026-01-31", "2027-04-30"],
    ["leap-day target", "2022-11-30", "2024-02-29"],
  ])("clamps %s passport arithmetic to the last valid target day", async (
    _label,
    assessmentAt,
    passportValidUntil,
  ) => {
    const db = database();
    const fixture = await preparedFixture({ assessmentDate: assessmentAt });
    await appendArtifacts(db, fixture.artifacts);
    const dossier = new SqliteDossierStore(db, KEY).publishWithEvidence({
      preparedEvidence: fixture.prepared,
      publishedAt: PUBLISHED_AT,
    }).version;
    const profile = confirmRelocationProfile({
      ...RELOCATION_DRAFT,
      passportValidUntil,
      companions: [],
    }, () => new Date(`${assessmentAt}T09:15:00.000Z`));

    const result = assessColdStart({
      assessmentAt,
      profile,
      evidence: fixture.prepared.snapshot,
      dossier,
      sourceNavigation: SOURCE_URLS,
    });

    expect(result.marker).toBe("yellow");
    expect(result.reasons.some(({ code }) => code === "passport_validity_insufficient"))
      .toBe(false);
  });
});

const installedIndexResult = createInstalledCountrySourceIndex().lookup("SI");
if (!installedIndexResult.ok) throw new Error("Slovenia test index must be installed");
const INSTALLED_CANDIDATES = installedIndexResult.candidates;

async function blockedRunFixture(runId: string, contextHash: string) {
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] =
    SOURCE_IDS.map((sourceId) => ({
      sourceId,
      parserEntry: {
        sourceId,
        navigationUrl: SOURCE_URLS[sourceId],
        resolvedEvidenceUrl: SOURCE_URLS[sourceId],
        artifacts: [],
      },
      coverage: "unavailable" as const,
      blocker: {
        sourceId,
        kind: "navigation_mismatch" as const,
        navigationUrl: SOURCE_URLS[sourceId],
        artifactIds: [],
      },
    }));
  return sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: ASSESSMENT_DATE,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: PARSER_VERSIONS,
    rulesVersion: "vs2-si-evidence@2",
    contextHash,
  }, createEvidenceIntegrity(KEY));
}

function coldStartHarness(options: {
  readonly countryInstalled?: boolean;
  readonly afterCountryNotInstalledEvidencePrepared?: () => void;
  readonly afterPrepared?: () => void;
  readonly afterPublish?: () => void;
  readonly tamperPrepared?: boolean;
  readonly sourceIndexError?: Error;
} = {}) {
  const db = database();
  const profiles = new SqliteProfileStore(db);
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
  const dossierStore = new SqliteDossierStore(db, KEY);
  const sourceIndexInputs: string[] = [];
  const researchInputs: unknown[] = [];
  let runCounter = 0;

  const application = createColdStartApplication({
    profiles,
    countrySourceIndex: {
      lookup(countryCode) {
        sourceIndexInputs.push(countryCode);
        if (options.sourceIndexError !== undefined) throw options.sourceIndexError;
        return options.countryInstalled === false
          ? { ok: false as const, kind: "country_not_installed" as const, candidates: [] as const }
          : { ok: true as const, candidates: INSTALLED_CANDIDATES };
      },
    },
    research: {
      prepare: async (input) => {
        researchInputs.push({
          runId: input.runId,
          assessmentDate: input.assessmentDate,
          deadlineAt: input.deadlineAt,
          contextHash: input.contextHash,
          candidates: structuredClone(input.candidates),
        });
        const fixture = options.countryInstalled === false
          ? { prepared: await blockedRunFixture(input.runId, input.contextHash), artifacts: [] }
          : await replayableFixture({
              runId: input.runId,
              contextHash: input.contextHash,
              cbrRate: "90",
              cbrEffectiveDate: "2026-08-10",
            });
        for (const captured of fixture.artifacts) await evidenceStore.appendArtifact(captured);
        const firstArtifact = fixture.artifacts[0];
        if (firstArtifact !== undefined) {
          await input.onProgress({
            type: "artifact_captured",
            sourceId: firstArtifact.sourceId,
            artifact: firstArtifact,
          });
        }
        const firstClaim = fixture.prepared.snapshot.claims[0];
        if (firstClaim !== undefined) {
          await input.onProgress({
            type: "claim_verified",
            sourceId: firstClaim.sourceId,
            claim: firstClaim,
          });
        }
        options.afterPrepared?.();
        if (!options.tamperPrepared) return fixture.prepared;
        return {
          ...fixture.prepared,
          snapshot: { ...fixture.prepared.snapshot, hmac: "0".repeat(64) },
        };
      },
    },
    evidence: {
      seal: (sealed) => evidenceStore.seal(sealed),
      loadVerifiedBundle: (id) => evidenceStore.loadVerifiedBundle(id, KEY),
      replay: (id) => replayEvidenceByRules(
        { snapshotId: id, hmacKey: KEY },
        { store: evidenceStore },
      ),
    },
    dossiers: {
      publishWithEvidence: (input) => {
        const published = dossierStore.publishWithEvidence(input);
        options.afterPublish?.();
        return published;
      },
      findByPayload: (countryCode, schemaVersion, payloadHash) =>
        dossierStore.findByPayload(countryCode, schemaVersion, payloadHash),
    },
    integrity: (() => {
      const integrity = createEvidenceIntegrity(KEY);
      return {
        ...integrity,
        sign(value: string): string {
          const signature = integrity.sign(value);
          if (options.countryInstalled === false) {
            options.afterCountryNotInstalledEvidencePrepared?.();
          }
          return signature;
        },
      };
    })(),
    clock: () => new Date("2026-08-11T10:00:00.000Z"),
    nextRunId: () => `cold-run-${++runCounter}`,
  });
  return { application, db, evidenceStore, sourceIndexInputs, researchInputs };
}

describe("cold-start orchestration, reload and commit boundary", () => {
  test("adds the cold-start application to the existing composition root", () => {
    const composed = createConfirmedLifeComposition({
      database: database(),
      hmacKey: KEY,
    });

    expect(typeof composed.prepare).toBe("function");
    expect(typeof composed.run).toBe("function");
    expect(typeof composed.present).toBe("function");
    expect(typeof composed.startConfirmedLife).toBe("function");
  });

  test("fails closed before real Slovenia Research when the country is not installed", async () => {
    const db = database();
    const now = new Date();
    const requestStepCalls: unknown[] = [];
    const application = createColdStartComposition({
      database: db,
      hmacKey: KEY,
      countrySourceIndex: {
        lookup: () => ({
          ok: false as const,
          kind: "country_not_installed" as const,
          candidates: [] as const,
        }),
      },
      requestStep: async (request) => {
        requestStepCalls.push(request);
        throw new Error("country-not-installed must not capture");
      },
      clock: () => new Date(now),
      nextRunId: () => "not-installed-run",
    });
    const prepared = await application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    const events: ColdStartEvent[] = [];

    const result = await application.run(
      prepared,
      (event) => { events.push(event); },
      new AbortController().signal,
    );

    expect(requestStepCalls).toEqual([]);
    expect(events.map(({ type }) => type)).toEqual(["assessment_completed"]);
    expect(result).toMatchObject({
      runId: prepared.runId,
      country: prepared.country,
      evidenceSnapshotId: `${prepared.runId}:evidence`,
      coverage: { verified: 0, required: 9, claimKinds: [] },
      comparator: { marker: "yellow", personalFit: "research_incomplete" },
    });
    expect(result.dossier).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);
  });

  test("resolves the country before one profile write and reloads it without duplication", async () => {
    const harness = coldStartHarness();

    await expect(harness.application.prepare({
      countryInput: "France",
      profile: RELOCATION_DRAFT,
    })).rejects.toThrow("unsupported_country");
    expect(harness.db.prepare("SELECT COUNT(*) FROM profile_snapshots").pluck().get()).toBe(0);

    const first = await harness.application.prepare({
      countryInput: " Словения ",
      profile: RELOCATION_DRAFT,
    });
    const retry = await harness.application.prepare({
      countryInput: "SI",
      profileId: first.profileId,
    });

    expect(first).toEqual({
      runId: "cold-run-1",
      profileId: first.profileId,
      country: {
        code: "SI",
        englishName: "Slovenia",
        displayName: "Словения",
        flag: "🇸🇮",
        coordinate: { lat: 46.1512, lng: 14.9955 },
      },
      assessmentAt: "2026-08-11",
      deadlineAt: "2026-08-11T10:01:00.000Z",
    });
    expect(retry.runId).toBe("cold-run-2");
    expect(retry.profileId).toBe(first.profileId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(harness.db.prepare("SELECT COUNT(*) FROM profile_snapshots").pluck().get()).toBe(1);
  });

  test("commits, reloads and re-presents one privacy-safe ordered terminal result", async () => {
    const harness = coldStartHarness();
    const prepared = await harness.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    const events: ColdStartEvent[] = [];

    const result = await harness.application.run(
      prepared,
      async (event) => { events.push(event); },
      new AbortController().signal,
    );

    expect(harness.sourceIndexInputs).toEqual(["SI"]);
    expect(harness.researchInputs).toEqual([{
      runId: prepared.runId,
      assessmentDate: prepared.assessmentAt,
      deadlineAt: prepared.deadlineAt,
      contextHash: sha256Text(canonicalJson({
        runId: prepared.runId,
        profileId: prepared.profileId,
      })),
      candidates: INSTALLED_CANDIDATES,
    }]);
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_event, index) => index + 1),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "source_discovered", "authority_verified",
      "source_discovered", "authority_verified",
      "source_discovered", "authority_verified",
      "source_discovered", "authority_verified",
      "source_discovered", "authority_verified",
      "source_discovered", "authority_verified",
      "artifact_captured",
      "claim_verified",
      "dossier_published",
      "assessment_completed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "assessment_completed",
      payload: { readModel: result },
    });
    expect(events.filter(({ type }) => type === "assessment_completed")).toHaveLength(1);
    const artifactEvent = events.find(({ type }) => type === "artifact_captured");
    expect(artifactEvent).toMatchObject({
      payload: {
        sourceId: "si-digital-nomad-route",
        role: "gov-route-page",
        resolvedUrl: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
      },
    });
    expect(Object.keys(artifactEvent!.payload)).toEqual([
      "sourceId",
      "role",
      "resolvedUrl",
      "sha256",
    ]);
    const nonterminalJson = JSON.stringify(events.slice(0, -1));
    expect(nonterminalJson).not.toContain("210000");
    expect(nonterminalJson).not.toContain(prepared.profileId);
    expect(nonterminalJson).not.toContain("contextHash");
    expect(result.comparator.marker).toBe("red");
    expect(result.coverage).toEqual({
      verified: 9,
      required: 9,
      claimKinds: REQUIRED_CLAIM_KINDS,
    });
    expect(result.sourceNavigation.map(({ url }) => url)).toEqual([
      "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
      "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
      "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
      SOURCE_URLS["cbr-eur"],
    ]);
    const verifiedBundle = await harness.evidenceStore.loadVerifiedBundle(
      `${prepared.runId}:evidence`,
      KEY,
    );
    expect(verifiedBundle.entries.map(({ sourceId, navigationUrl, indexedSourceUrl }) => ({
      sourceId,
      navigationUrl,
      indexedSourceUrl,
    }))).toEqual([
      {
        sourceId: "si-digital-nomad-route",
        navigationUrl: INSTALLED_CANDIDATES[0]!.url,
        indexedSourceUrl: INSTALLED_CANDIDATES[1]!.url,
      },
      {
        sourceId: "si-income-threshold",
        navigationUrl: INSTALLED_CANDIDATES[2]!.url,
        indexedSourceUrl: INSTALLED_CANDIDATES[3]!.url,
      },
      {
        sourceId: "si-companion-employment",
        navigationUrl: INSTALLED_CANDIDATES[4]!.url,
        indexedSourceUrl: INSTALLED_CANDIDATES[5]!.url,
      },
      {
        sourceId: "cbr-eur",
        navigationUrl: SOURCE_URLS["cbr-eur"],
        indexedSourceUrl: undefined,
      },
    ]);

    const beforePresentCalls = {
      sourceIndex: harness.sourceIndexInputs.length,
      research: harness.researchInputs.length,
    };
    expect(await harness.application.present({
      runId: prepared.runId,
      profileId: prepared.profileId,
    })).toEqual(result);
    expect(harness.sourceIndexInputs).toHaveLength(beforePresentCalls.sourceIndex);
    expect(harness.researchInputs).toHaveLength(beforePresentCalls.research);

    const retry = await harness.application.prepare({
      countryInput: "Slovenia",
      profileId: prepared.profileId,
    });
    await harness.application.run(retry, () => undefined, new AbortController().signal);
    expect(harness.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(2);
    expect(harness.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(1);
    expect(harness.db.prepare("SELECT COUNT(*) FROM profile_snapshots").pluck().get()).toBe(1);

    const other = await harness.application.prepare({
      countryInput: "SI",
      profile: {
        ...RELOCATION_DRAFT,
        monthlyIncome: { amount: "300000", currency: "RUB", basis: "net" },
      },
    });
    await expect(harness.application.present({
      runId: prepared.runId,
      profileId: other.profileId,
    })).rejects.toThrow("integrity_mismatch");
  });

  test("returns terminal yellow without Research when the country is not installed", async () => {
    const harness = coldStartHarness({ countryInstalled: false });
    const prepared = await harness.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    const events: ColdStartEvent[] = [];

    const result = await harness.application.run(
      prepared,
      (event) => { events.push(event); },
      new AbortController().signal,
    );

    expect(result.comparator).toMatchObject({
      marker: "yellow",
      personalFit: "research_incomplete",
    });
    expect(result.dossier).toBeUndefined();
    expect(harness.researchInputs).toHaveLength(0);
    expect(events.map(({ type }) => type)).toEqual(["assessment_completed"]);
    expect(harness.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(harness.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);
    expect(await harness.application.present({
      runId: prepared.runId,
      profileId: prepared.profileId,
    })).toEqual(result);
  });

  test("does not present navigation for an uninstalled country without captures", async () => {
    const harness = coldStartHarness({ countryInstalled: false });
    const prepared = await harness.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });

    const result = await harness.application.run(
      prepared,
      () => undefined,
      new AbortController().signal,
    );

    expect(result.sourceNavigation).toEqual([]);
  });

  test("does not persist or emit after aborting before an uninstalled-country seal", async () => {
    const abort = new AbortController();
    const harness = coldStartHarness({
      countryInstalled: false,
      afterCountryNotInstalledEvidencePrepared: () => abort.abort(
        new Error("cancel-before-uninstalled-country-seal"),
      ),
    });
    const prepared = await harness.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    const events: ColdStartEvent[] = [];

    await expect(harness.application.run(
      prepared,
      (event) => { events.push(event); },
      abort.signal,
    )).rejects.toThrow("cancel-before-uninstalled-country-seal");

    expect(harness.sourceIndexInputs).toEqual(["SI"]);
    expect(harness.researchInputs).toEqual([]);
    expect(events).toEqual([]);
    expect(harness.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
    expect(harness.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);
  });

  test("rejects invalid prepared signatures and honors abort on both sides of commit", async () => {
    const preAborted = coldStartHarness();
    const preAbortedPrepared = await preAborted.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    const preAbortedSignal = new AbortController();
    preAbortedSignal.abort(new Error("cancel-before-source-index"));
    await expect(preAborted.application.run(
      preAbortedPrepared,
      () => undefined,
      preAbortedSignal.signal,
    )).rejects.toThrow("cancel-before-source-index");
    expect(preAborted.sourceIndexInputs).toHaveLength(0);
    expect(preAborted.researchInputs).toHaveLength(0);
    expect(preAborted.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
    expect(preAborted.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);

    const unexpectedSourceIndex = coldStartHarness({
      sourceIndexError: new Error("unexpected-source-index-error"),
    });
    const unexpectedPrepared = await unexpectedSourceIndex.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    await expect(unexpectedSourceIndex.application.run(
      unexpectedPrepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("unexpected-source-index-error");
    expect(unexpectedSourceIndex.researchInputs).toHaveLength(0);
    expect(unexpectedSourceIndex.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get())
      .toBe(0);
    expect(unexpectedSourceIndex.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get())
      .toBe(0);

    const tampered = coldStartHarness({ tamperPrepared: true });
    const tamperedPrepared = await tampered.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    await expect(tampered.application.run(
      tamperedPrepared,
      () => undefined,
      new AbortController().signal,
    )).rejects.toThrow("integrity_mismatch");
    expect(tampered.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);

    const beforeCommitAbort = new AbortController();
    const before = coldStartHarness({
      afterPrepared: () => beforeCommitAbort.abort(new Error("cancel-before-commit")),
    });
    const beforePrepared = await before.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    await expect(before.application.run(
      beforePrepared,
      () => undefined,
      beforeCommitAbort.signal,
    )).rejects.toThrow("cancel-before-commit");
    expect(before.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
    expect(before.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);
    expect(before.db.prepare("SELECT COUNT(*) FROM artifacts WHERE sealed = 0").pluck().get())
      .toBeGreaterThan(0);

    const afterCommitAbort = new AbortController();
    const after = coldStartHarness({
      afterPublish: () => afterCommitAbort.abort(new Error("cancel-after-commit")),
    });
    const afterPrepared = await after.application.prepare({
      countryInput: "SI",
      profile: RELOCATION_DRAFT,
    });
    await expect(after.application.run(
      afterPrepared,
      () => undefined,
      afterCommitAbort.signal,
    )).resolves.toMatchObject({ runId: afterPrepared.runId });
    expect(after.db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(after.db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(1);
  });
});

describe("immutable country dossier publication", () => {
  test("normalizes the nine verified country claims and publishes v1 without CBR", async () => {
    const db = database();
    const fixture = await preparedFixture();
    const payload = buildCountryDossier(fixture.prepared);

    expect(payload.claims.map(({ claimKind }) => claimKind)).toEqual(REQUIRED_CLAIM_KINDS);
    expect(JSON.stringify(payload)).not.toMatch(/artifactId|capturedAt|cbr-eur|profile|verdict/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({ count: 0 });

    await appendArtifacts(db, fixture.artifacts);
    const store = new SqliteDossierStore(db, KEY);
    const published = store.publishWithEvidence({
      preparedEvidence: fixture.prepared,
      publishedAt: PUBLISHED_AT,
    });

    expect(published).toMatchObject({ created: true, version: { ordinal: 1, payload } });
    expect(store.loadVerified(published.version.id)).toEqual(published.version);
    expect(store.loadHead("SI", "si-dossier@1")).toEqual(published.version);
  });

  test("copies closed claim values without freezing or aliasing prepared Evidence", async () => {
    const fixture = await preparedFixture();
    const inputClaim = fixture.prepared.snapshot.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "citizenship_applicability",
    ) as VerifiedCountryClaim<"citizenship_applicability">;

    const payload = buildCountryDossier(fixture.prepared);
    const outputClaim = payload.claims.find(
      (claim) => claim.claimKind === "citizenship_applicability",
    )! as typeof payload.claims[number] & {
      readonly value: ClaimValueByKind["citizenship_applicability"];
    };

    expect(Object.isFrozen(inputClaim.value)).toBe(false);
    expect(Object.isFrozen(inputClaim.value.explicitNationalityExclusions)).toBe(false);
    expect(Object.isFrozen(outputClaim.value)).toBe(true);
    expect(Object.isFrozen(outputClaim.value.explicitNationalityExclusions)).toBe(true);
    const mutableInput = inputClaim.value.explicitNationalityExclusions as string[];
    mutableInput.push("Test-only mutation");
    try {
      expect(outputClaim.value.explicitNationalityExclusions).toEqual(["EU", "EEA"]);
    } finally {
      mutableInput.pop();
    }
  });

  test.each([
    ["missing", { omitKind: "duration" as const }],
    ["duplicate", { duplicateKind: "route_basis" as const }],
    ["unknown rules", { rulesVersion: "vs2-unknown@1" }],
    ["unexpected claim identity", {
      mutateClaim: (claim: VerifiedCountryClaim) => claim.claimKind === "income"
        ? { ...claim, claimId: "hand-written-income" }
        : claim,
    }],
  ])("rejects %s coverage before writing evidence or a dossier", async (_name, options) => {
    const db = database();
    const fixture = await preparedFixture(options);
    await appendArtifacts(db, fixture.artifacts);
    const store = new SqliteDossierStore(db, KEY);

    expect(() => store.publishWithEvidence({
      preparedEvidence: fixture.prepared,
      publishedAt: PUBLISHED_AT,
    })).toThrow("publication_not_allowed");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({ count: 0 });
  });

  test.each([
    ["extra entry", (copy: PreparedCopy) => replaceEntries(copy, [
      ...copy.manifest.entries,
      copy.manifest.entries[0]!,
    ])],
    ["duplicate entry", (copy: PreparedCopy) => replaceEntries(copy, [
      copy.manifest.entries[0]!,
      copy.manifest.entries[0]!,
      ...copy.manifest.entries.slice(2),
    ])],
    ["missing entry", (copy: PreparedCopy) => replaceEntries(copy, copy.manifest.entries.slice(1))],
    ["reordered entry", (copy: PreparedCopy) => replaceEntries(copy, [
      copy.manifest.entries[1]!,
      copy.manifest.entries[0]!,
      ...copy.manifest.entries.slice(2),
    ])],
    ["artifact list mismatch", (copy: PreparedCopy) => {
      const first = copy.manifest.entries[0]!;
      replaceEntries(copy, [{ ...first, artifactIds: [] }, ...copy.manifest.entries.slice(1)]);
    }],
    ["verified CBR with a blocker", (copy: PreparedCopy) => {
      const coverage = {
        ...copy.snapshot.coverage,
        "cbr-eur": "verified" as const,
      };
      (copy.snapshot as unknown as { coverage: typeof coverage }).coverage = coverage;
      (copy.manifest.snapshot as unknown as { coverage: typeof coverage }).coverage =
        structuredClone(coverage);
    }],
  ] as const)("rejects correctly re-signed malformed Evidence with %s before commit", async (
    _name,
    mutate,
  ) => {
    const db = database();
    const fixture = await preparedFixture();
    const malformed = resignPrepared(fixture.prepared, mutate);
    await appendArtifacts(db, fixture.artifacts);

    expect(() => new SqliteDossierStore(db, KEY).publishWithEvidence({
      preparedEvidence: malformed,
      publishedAt: PUBLISHED_AT,
    })).toThrow("publication_not_allowed");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({ count: 0 });
  });

  test.each(["new", "same-payload"] as const)(
    "rejects a verified CBR source without a claim on the %s publication path",
    async (path) => {
      const db = database();
      const store = new SqliteDossierStore(db, KEY);
      if (path === "same-payload") {
        const first = await preparedFixture({
          snapshotId: "claim-owner-first:evidence",
          runId: "claim-owner-first",
        });
        await appendArtifacts(db, first.artifacts);
        store.publishWithEvidence({ preparedEvidence: first.prepared, publishedAt: PUBLISHED_AT });
      }
      const malformedFixture = await preparedFixture({
        snapshotId: `claim-owner-${path}:evidence`,
        runId: `claim-owner-${path}`,
        artifactIdSuffix: `:${path}`,
      });
      await appendArtifacts(db, malformedFixture.artifacts);
      const malformed = resignPrepared(malformedFixture.prepared, markCbrVerifiedWithoutClaim);
      const committedCount = path === "same-payload" ? 1 : 0;

      expect(() => store.publishWithEvidence({
        preparedEvidence: malformed,
        publishedAt: "2026-08-11T10:45:00.000Z",
      })).toThrow("publication_not_allowed");
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({
        count: committedCount,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({
        count: committedCount,
      });
    },
  );

  test.each(["different", "missing"] as const)(
    "rejects a country evidence ref whose anchor artifact is %s",
    async (kind) => {
      const db = database();
      const fixture = await preparedFixture();
      const malformed = resignPrepared(fixture.prepared, (copy) => {
        const claims = structuredClone(copy.snapshot.claims);
        const route = claims.find(
          (claim) => "claimKind" in claim && claim.claimKind === "route_basis",
        ) as VerifiedCountryClaim<"route_basis">;
        const reference = route.evidence[0]!;
        const evidence = [{
          ...reference,
          anchor: {
            ...reference.anchor,
            artifactId: kind === "different"
              ? fixture.artifacts.find(({ sourceId }) => sourceId === "si-income-threshold")!
                .artifactId
              : "missing-artifact",
          },
        }, structuredClone(reference)];
        replaceClaims(copy, claims.map((claim) => claim === route ? { ...route, evidence } : claim));
      });
      await appendArtifacts(db, fixture.artifacts);

      expect(() => new SqliteDossierStore(db, KEY).publishWithEvidence({
        preparedEvidence: malformed,
        publishedAt: PUBLISHED_AT,
      })).toThrow("publication_not_allowed");
      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({ count: 0 });
    },
  );

  test("rejects malformed same-payload Evidence before the idempotent branch persists it", async () => {
    const db = database();
    const store = new SqliteDossierStore(db, KEY);
    const firstFixture = await preparedFixture({ snapshotId: "shape-first:evidence", runId: "shape-first" });
    await appendArtifacts(db, firstFixture.artifacts);
    store.publishWithEvidence({ preparedEvidence: firstFixture.prepared, publishedAt: PUBLISHED_AT });
    const repeatedFixture = await preparedFixture({
      snapshotId: "shape-repeat:evidence",
      runId: "shape-repeat",
      artifactIdSuffix: ":shape-repeat",
    });
    await appendArtifacts(db, repeatedFixture.artifacts);
    const malformed = resignPrepared(repeatedFixture.prepared, (copy) => replaceEntries(copy, [
      copy.manifest.entries[1]!,
      copy.manifest.entries[0]!,
      ...copy.manifest.entries.slice(2),
    ]));

    expect(() => store.publishWithEvidence({
      preparedEvidence: malformed,
      publishedAt: "2026-08-11T10:40:00.000Z",
    })).toThrow("publication_not_allowed");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({ count: 1 });
  });

  test("applies the structural assertion on direct Evidence insert and verified load", async () => {
    const insertDb = database();
    const insertFixture = await preparedFixture({ snapshotId: "shape-insert:evidence", runId: "shape-insert" });
    await appendArtifacts(insertDb, insertFixture.artifacts);
    const malformedInsert = resignPrepared(insertFixture.prepared, (copy) => replaceEntries(copy, [
      copy.manifest.entries[1]!,
      copy.manifest.entries[0]!,
      ...copy.manifest.entries.slice(2),
    ]));
    const insertStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(insertDb);

    await expect(insertStore.seal(malformedInsert)).rejects.toThrow("integrity_mismatch");
    expect(insertDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(insertDb.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sealed = 1").get()).toEqual({ count: 0 });

    const loadDb = database();
    const loadFixture = await preparedFixture({ snapshotId: "shape-load:evidence", runId: "shape-load" });
    await appendArtifacts(loadDb, loadFixture.artifacts);
    const loadStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(loadDb);
    await loadStore.seal(loadFixture.prepared);
    const malformedLoad = resignPrepared(loadFixture.prepared, (copy) => replaceEntries(copy, [
      copy.manifest.entries[1]!,
      copy.manifest.entries[0]!,
      ...copy.manifest.entries.slice(2),
    ]));
    loadDb.exec("DROP TRIGGER evidence_snapshots_no_update");
    loadDb.prepare(`
      UPDATE evidence_snapshots
      SET snapshot_json = ?, manifest_json = ?, manifest_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      canonicalJson(malformedLoad.snapshot),
      malformedLoad.canonicalManifest,
      malformedLoad.snapshot.manifestHash,
      malformedLoad.snapshot.hmac,
      malformedLoad.snapshot.id,
    );

    await expect(loadStore.loadVerified(malformedLoad.snapshot.id, KEY)).rejects.toThrow(
      "integrity_mismatch",
    );
  });

  test("rejects a signed manifest snapshot artifact list that drifts before direct insert", async () => {
    const db = database();
    const fixture = await preparedFixture({ snapshotId: "shape-manifest:evidence", runId: "shape-manifest" });
    await appendArtifacts(db, fixture.artifacts);
    const malformed = resignPrepared(fixture.prepared, (copy) => {
      (copy.manifest.snapshot as unknown as { artifactIds: readonly string[] }).artifactIds =
        copy.manifest.snapshot.artifactIds.slice(1);
    });
    const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);

    await expect(store.seal(malformed)).rejects.toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sealed = 1").get()).toEqual({ count: 0 });
  });

  test.each(MALFORMED_STORED_SHAPES)(
    "loads stored Evidence with %s as integrity_mismatch without a native TypeError",
    async (_name, mutate) => {
      const db = database();
      const fixture = await preparedFixture({
        snapshotId: `outer-shape-${_name}:evidence`,
        runId: `outer-shape-${_name}`,
      });
      await appendArtifacts(db, fixture.artifacts);
      const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
      await store.seal(fixture.prepared);
      const row = db.prepare(`
        SELECT snapshot_json AS snapshotJson, manifest_json AS manifestJson
        FROM evidence_snapshots WHERE id = ?
      `).get(fixture.prepared.snapshot.id) as {
        readonly snapshotJson: string;
        readonly manifestJson: string;
      };
      const copy: StoredShapeCopy = {
        snapshot: JSON.parse(row.snapshotJson) as unknown,
        manifest: JSON.parse(row.manifestJson) as unknown,
      };
      mutate(copy);
      db.exec("DROP TRIGGER evidence_snapshots_no_update");
      db.prepare(`
        UPDATE evidence_snapshots SET snapshot_json = ?, manifest_json = ? WHERE id = ?
      `).run(JSON.stringify(copy.snapshot), JSON.stringify(copy.manifest), fixture.prepared.snapshot.id);

      let thrown: unknown;
      try {
        await store.loadVerified(fixture.prepared.snapshot.id, KEY);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect((thrown as Error).message).toBe("integrity_mismatch");
    },
  );

  test("reuses an identical normalized payload and appends only stable changes", async () => {
    const db = database();
    const store = new SqliteDossierStore(db, KEY);
    const firstFixture = await preparedFixture({ snapshotId: "first:evidence", runId: "first" });
    await appendArtifacts(db, firstFixture.artifacts);
    const first = store.publishWithEvidence({ preparedEvidence: firstFixture.prepared, publishedAt: PUBLISHED_AT });
    const firstBytes = JSON.stringify(first.version);

    const repeatedFixture = await preparedFixture({
      snapshotId: "repeat:evidence",
      runId: "repeat",
      capturedAt: "2026-08-11T10:20:00.000Z",
      contextHash: "a".repeat(64),
      artifactIdSuffix: ":recaptured",
    });
    await appendArtifacts(db, repeatedFixture.artifacts);
    const repeated = store.publishWithEvidence({
      preparedEvidence: repeatedFixture.prepared,
      publishedAt: "2026-08-11T10:40:00.000Z",
    });

    expect(repeated).toEqual({ version: first.version, created: false });
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 2 });

    const changedFixture = await preparedFixture({
      snapshotId: "changed:evidence",
      runId: "changed",
      mutateClaim: (claim) => claim.claimKind === "income"
        ? { ...claim, value: { ...claim.value as ClaimValueByKind["income"], thresholdEur: "3200.00" } }
        : claim,
    });
    await appendArtifacts(db, changedFixture.artifacts);
    const changed = store.publishWithEvidence({
      preparedEvidence: changedFixture.prepared,
      publishedAt: "2026-08-11T10:50:00.000Z",
    });

    expect(changed).toMatchObject({
      created: true,
      version: { ordinal: 2, predecessorId: first.version.id },
    });
    expect(JSON.stringify(store.loadVerified(first.version.id))).toBe(firstBytes);
    expect(store.findByPayload("SI", "si-dossier@1", changed.version.payloadHash)).toEqual(changed.version);
  });

  test.each([
    ["source URL", { incomeUrl: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950&view=current" }],
    ["source period", { incomePeriod: "2026M02" }],
    ["excerpt hash", { incomeExcerpt: "new exact verified income excerpt" }],
  ])("creates one successor when the stable %s changes", async (_name, mutation) => {
    const db = database();
    const store = new SqliteDossierStore(db, KEY);
    const firstFixture = await preparedFixture({ snapshotId: "stable-first:evidence", runId: "stable-first" });
    await appendArtifacts(db, firstFixture.artifacts);
    const first = store.publishWithEvidence({ preparedEvidence: firstFixture.prepared, publishedAt: PUBLISHED_AT });
    const firstBytes = JSON.stringify(first.version);
    const changedFixture = await preparedFixture({
      snapshotId: `stable-${_name}:evidence`,
      runId: `stable-${_name}`,
      ...mutation,
    });
    await appendArtifacts(db, changedFixture.artifacts);

    const changed = store.publishWithEvidence({
      preparedEvidence: changedFixture.prepared,
      publishedAt: "2026-08-11T10:50:00.000Z",
    });

    expect(changed.version).toMatchObject({ ordinal: 2, predecessorId: first.version.id });
    expect(changed.version.payloadHash).not.toBe(first.version.payloadHash);
    expect(JSON.stringify(store.loadVerified(first.version.id))).toBe(firstBytes);
  });

  test.each(["same", "different"] as const)(
    "serializes truly simultaneous %s-payload publications across two file connections",
    async (kind) => {
      const { database: db, path } = fileDatabase();
      db.pragma("busy_timeout = 3000");
      const firstFixture = await preparedFixture({
        snapshotId: `concurrent-${kind}-first:evidence`,
        runId: `concurrent-${kind}-first`,
      });
      const secondFixture = await preparedFixture({
        snapshotId: `concurrent-${kind}-second:evidence`,
        runId: `concurrent-${kind}-second`,
        artifactIdSuffix: ":second",
        ...(kind === "different"
          ? {
              mutateClaim: (claim: VerifiedCountryClaim) => claim.claimKind === "income"
                ? {
                    ...claim,
                    value: {
                      ...claim.value as ClaimValueByKind["income"],
                      thresholdEur: "3200.00",
                    },
                  }
                : claim,
            }
          : {}),
      });
      await appendArtifacts(db, firstFixture.artifacts);
      await appendArtifacts(db, secondFixture.artifacts);
      const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const workers = [
        publishWorker({
          path,
          preparedEvidence: firstFixture.prepared,
          publishedAt: "2026-08-11T11:00:00.000Z",
          start,
        }),
        publishWorker({
          path,
          preparedEvidence: secondFixture.prepared,
          publishedAt: "2026-08-11T11:00:01.000Z",
          start,
        }),
      ];
      await Promise.all(workers.map(({ ready }) => ready));
      const startSignal = new Int32Array(start);
      Atomics.store(startSignal, 0, 1);
      Atomics.notify(startSignal, 0, workers.length);

      const results = await Promise.all(workers.map(({ result }) => result));

      expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 2 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM dossier_versions").get()).toEqual({
        count: kind === "same" ? 1 : 2,
      });
      const head = new SqliteDossierStore(db, KEY).loadHead("SI", "si-dossier@1");
      expect(head?.ordinal).toBe(kind === "same" ? 1 : 2);
      expect(results.filter(({ created }) => created)).toHaveLength(kind === "same" ? 1 : 2);
      if (kind === "different") {
        expect(db.prepare(`
          SELECT predecessor_id AS predecessorId
          FROM dossier_versions ORDER BY predecessor_id IS NOT NULL, id
        `).all()).toEqual([
          { predecessorId: null },
          { predecessorId: head?.predecessorId },
        ]);
      }
    },
    10_000,
  );

  test("rolls back the Evidence seal when dossier insertion fails", async () => {
    const db = database();
    const fixture = await preparedFixture();
    await appendArtifacts(db, fixture.artifacts);
    db.exec(`
      CREATE TRIGGER test_dossier_insert_failure
      BEFORE INSERT ON dossier_versions
      BEGIN SELECT RAISE(ABORT, 'forced_dossier_failure'); END
    `);

    expect(() => new SqliteDossierStore(db, KEY).publishWithEvidence({
      preparedEvidence: fixture.prepared,
      publishedAt: PUBLISHED_AT,
    })).toThrow("forced_dossier_failure");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sealed = 1").get()).toEqual({ count: 0 });
  });

  test.each(["payload", "hmac", "raw bytes"] as const)(
    "rejects copied storage after %s tampering",
    async (mutation) => {
      const db = database();
      const fixture = await preparedFixture();
      await appendArtifacts(db, fixture.artifacts);
      const store = new SqliteDossierStore(db, KEY);
      const published = store.publishWithEvidence({
        preparedEvidence: fixture.prepared,
        publishedAt: PUBLISHED_AT,
      });
      if (mutation === "payload") {
        db.exec("DROP TRIGGER dossier_versions_no_update");
        db.prepare("UPDATE dossier_versions SET payload_json = ? WHERE id = ?").run("{}", published.version.id);
      } else if (mutation === "hmac") {
        db.exec("DROP TRIGGER dossier_versions_no_update");
        db.prepare("UPDATE dossier_versions SET hmac = ? WHERE id = ?").run("0".repeat(64), published.version.id);
      } else {
        db.exec("DROP TRIGGER artifacts_no_update");
        db.prepare("UPDATE artifacts SET bytes = ? WHERE source_id = ?").run(
          Uint8Array.of(9),
          "si-income-threshold",
        );
      }

      expect(() => store.loadVerified(published.version.id)).toThrow("integrity_mismatch");
    },
  );

  test("rejects SQL mutation of an immutable dossier row", async () => {
    const db = database();
    const fixture = await preparedFixture();
    await appendArtifacts(db, fixture.artifacts);
    const published = new SqliteDossierStore(db, KEY).publishWithEvidence({
      preparedEvidence: fixture.prepared,
      publishedAt: PUBLISHED_AT,
    });

    expect(() => db.prepare("UPDATE dossier_versions SET published_at = published_at WHERE id = ?")
      .run(published.version.id)).toThrow("dossier_version_is_immutable");
    expect(() => db.prepare("DELETE FROM dossier_versions WHERE id = ?")
      .run(published.version.id)).toThrow("dossier_version_is_immutable");
  });

  test("fails a cryptographically valid chain closed when its predecessor is missing", async () => {
    const db = database();
    const store = new SqliteDossierStore(db, KEY);
    const firstFixture = await preparedFixture({ snapshotId: "chain-first:evidence", runId: "chain-first" });
    await appendArtifacts(db, firstFixture.artifacts);
    store.publishWithEvidence({ preparedEvidence: firstFixture.prepared, publishedAt: PUBLISHED_AT });
    const secondFixture = await preparedFixture({
      snapshotId: "chain-second:evidence",
      runId: "chain-second",
      mutateClaim: (claim) => claim.claimKind === "income"
        ? { ...claim, value: { ...claim.value as ClaimValueByKind["income"], thresholdEur: "3200.00" } }
        : claim,
    });
    await appendArtifacts(db, secondFixture.artifacts);
    const second = store.publishWithEvidence({
      preparedEvidence: secondFixture.prepared,
      publishedAt: "2026-08-11T10:50:00.000Z",
    });
    const missingPredecessor = "f".repeat(64);
    const manifest = canonicalJson({
      countryCode: "SI",
      schemaVersion: "si-dossier@1",
      payloadHash: second.version.payloadHash,
      evidenceSnapshotId: second.version.evidenceSnapshotId,
      predecessorId: missingPredecessor,
      publishedAt: second.version.publishedAt,
    });
    const changedId = sha256Text(manifest);
    db.exec("DROP TRIGGER dossier_versions_no_update");
    db.pragma("foreign_keys = OFF");
    db.prepare(`
      UPDATE dossier_versions
      SET id = ?, predecessor_id = ?, manifest_hash = ?, hmac = ?
      WHERE id = ?
    `).run(changedId, missingPredecessor, changedId, hmacSha256(manifest, KEY), second.version.id);

    expect(() => store.loadVerified(changedId)).toThrow("integrity_mismatch");
  });
});

const SISTAT_API_URL = "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px";
const SISTAT_BODY_SHA256 = "c51587d0d30a096233aa690537714199d86670e355cbbabf58d5c1b45b2e5121";

interface ValidatorArtifactProvenance {
  readonly method?: "GET" | "POST";
  readonly requestUrl?: string;
  readonly responseUrl?: string;
  readonly bodySha256?: string;
}

function validatorArtifact(
  runId: string,
  sourceId: Exclude<SloveniaSourceId, "cbr-eur">,
  role: string,
  fixtureName: string,
  url: string,
  mediaType = "text/html",
  bytesOverride?: Uint8Array,
  provenance: ValidatorArtifactProvenance = {},
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = bytesOverride ?? new Uint8Array(readFileSync(
    new URL(`../sources/fixtures/slovenia/${fixtureName}`, import.meta.url),
  ));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const requestUrl = provenance.requestUrl ?? url;
  const responseUrl = provenance.responseUrl ?? url;
  const method = provenance.method ?? "GET";
  return {
    artifactId: `${sourceId}:${role}:${sha256}`,
    runId,
    sourceId,
    role,
    url: requestUrl,
    mediaType,
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:00.000Z",
    responseStatus: 200,
    responseUrl,
    request: method === "POST"
      ? {
          method,
          url: requestUrl,
          bodyMediaType: "application/json",
          bodySha256: provenance.bodySha256,
        }
      : { method, url: requestUrl },
  };
}

async function replayableFixture(options: {
  readonly rulesVersion?: string;
  readonly parserVersions?: Readonly<Record<SloveniaSourceId, string>>;
  readonly runId?: string;
  readonly contextHash?: string;
  readonly cbrRate?: string;
  readonly cbrEffectiveDate?: string;
  readonly mutateClaim?: (claim: VerifiedCountryClaim) => VerifiedCountryClaim;
} = {}): Promise<{
  readonly prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}> {
  const runId = options.runId ?? "offline-replay";
  const urls = {
    gov: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    routeRegistry: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761",
    routeDetails: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/298532110/details",
    salary: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
    salaryRegistry: "https://pisrs.si/api/rezultat/zbirka/sop/2026-01-1950",
    salaryDetails: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/613486752/details",
    sistat: SISTAT_API_URL,
    ess: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
    companionRegistry: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655",
    companionDetails: "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details",
    cbr: SOURCE_URLS["cbr-eur"],
  } as const;
  const countryArtifacts = [
    validatorArtifact(runId, "si-digital-nomad-route", "gov-route-page", "route-gov.html", urls.gov),
    validatorArtifact(runId, "si-digital-nomad-route", "ztuj2-registry", "ztuj2-registry.json", urls.routeRegistry, "application/json"),
    validatorArtifact(runId, "si-digital-nomad-route", "ztuj2-details", "ztuj2-details.json", urls.routeDetails, "application/json"),
    validatorArtifact(runId, "si-income-threshold", "salary-registry", "salary-registry.json", urls.salaryRegistry, "application/json"),
    validatorArtifact(runId, "si-income-threshold", "salary-details", "salary-details.json", urls.salaryDetails, "application/json"),
    validatorArtifact(runId, "si-income-threshold", "sistat-metadata", "sistat-metadata.json", urls.sistat, "application/json"),
    validatorArtifact(
      runId,
      "si-income-threshold",
      "sistat-series",
      "sistat-series.json",
      urls.sistat,
      "application/json",
      undefined,
      { method: "POST", bodySha256: SISTAT_BODY_SHA256 },
    ),
    validatorArtifact(runId, "si-companion-employment", "ess-companion-page", "companion-ess.html", urls.ess),
    validatorArtifact(runId, "si-companion-employment", "zzsdt-registry", "zzsdt-registry.json", urls.companionRegistry, "application/json"),
    validatorArtifact(runId, "si-companion-employment", "zzsdt-details", "zzsdt-details.json", urls.companionDetails, "application/json"),
  ];
  const cbrBytes = new TextEncoder().encode(
    `<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="${(
      options.cbrEffectiveDate ?? "2026-08-10"
    ).split("-").reverse().join(".")}"><Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><VunitRate>${options.cbrRate ?? "90"}</VunitRate></Valute></ValCurs>`,
  );
  const cbrArtifact: LiveCapturedArtifact<SloveniaSourceId> = {
    artifactId: `cbr-eur:official-document:${createHash("sha256").update(cbrBytes).digest("hex")}`,
    runId,
    sourceId: "cbr-eur",
    role: "official-document",
    url: urls.cbr,
    mediaType: "application/xml",
    sha256: createHash("sha256").update(cbrBytes).digest("hex"),
    bytes: cbrBytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:00.000Z",
    responseStatus: 200,
    responseUrl: urls.cbr,
    request: { method: "GET", url: urls.cbr },
  };
  const artifacts = [...countryArtifacts, cbrArtifact];
  const sourceNavigation: Readonly<Record<SloveniaSourceId, string>> = {
    "si-digital-nomad-route": urls.gov,
    "si-income-threshold": urls.salary,
    "si-companion-employment": urls.ess,
    "cbr-eur": urls.cbr,
  };
  const plan = createSloveniaPlan(sourceNavigation);
  const parserEntries = [
    {
      sourceId: "si-digital-nomad-route" as const,
      navigationUrl: urls.gov,
      indexedSourceUrl: INSTALLED_CANDIDATES[1]!.url,
      resolvedEvidenceUrl: urls.routeDetails,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-digital-nomad-route"),
    },
    {
      sourceId: "si-income-threshold" as const,
      navigationUrl: urls.salary,
      indexedSourceUrl: INSTALLED_CANDIDATES[3]!.url,
      resolvedEvidenceUrl: urls.sistat,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-income-threshold"),
    },
    {
      sourceId: "si-companion-employment" as const,
      navigationUrl: urls.ess,
      indexedSourceUrl: INSTALLED_CANDIDATES[5]!.url,
      resolvedEvidenceUrl: urls.companionDetails,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-companion-employment"),
    },
  ];
  const entries: TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [];
  for (const parserEntry of parserEntries) {
    const validated = await plan.validate(parserEntry, ASSESSMENT_DATE);
    if (!validated.ok) {
      throw new Error(`${parserEntry.sourceId} validator fixture must be current: ${validated.kind}`);
    }
    entries.push({
      sourceId: parserEntry.sourceId,
      parserEntry,
      coverage: "verified",
      claims: validated.claims,
    });
  }
  const cbrParserEntry = {
    sourceId: "cbr-eur" as const,
    navigationUrl: urls.cbr,
    resolvedEvidenceUrl: urls.cbr,
    artifacts: [cbrArtifact],
  };
  const validatedCbr = await plan.validate(cbrParserEntry, ASSESSMENT_DATE);
  if (!validatedCbr.ok) throw new Error("CBR validator fixture must be current");
  entries.push({
    sourceId: "cbr-eur",
    parserEntry: cbrParserEntry,
    coverage: "verified",
    claims: validatedCbr.claims,
  });
  const finalEntries = options.mutateClaim === undefined
    ? entries
    : entries.map((entry) => entry.coverage === "verified"
      ? {
          ...entry,
          claims: entry.claims.map((claim) =>
            "claimKind" in claim ? options.mutateClaim!(claim) : claim
          ),
        }
      : entry);
  const prepared = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: ASSESSMENT_DATE,
    entries: plan.applyRules(finalEntries, ASSESSMENT_DATE),
    sourceIds: SOURCE_IDS,
    parserVersions: options.parserVersions ?? PARSER_VERSIONS,
    rulesVersion: options.rulesVersion ?? "vs2-si-evidence@2",
    contextHash: options.contextHash ?? "b".repeat(64),
  }, createEvidenceIntegrity(KEY));
  return { prepared, artifacts };
}

describe("plan-aware offline evidence replay", () => {
  test("rejects the unreleased Slovenia v1 rules version", async () => {
    const fixture = await replayableFixture({ rulesVersion: "vs2-si-evidence@1" });
    const store = {
      loadVerifiedBundle: async () => ({
        snapshot: fixture.prepared.snapshot,
        entries: fixture.prepared.manifest.entries.map((entry) => ({
          sourceId: entry.sourceId,
          navigationUrl: entry.navigationUrl,
          resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
          artifacts: entry.artifactIds.map((artifactId) =>
            fixture.artifacts.find((artifact) => artifact.artifactId === artifactId)!
          ),
        })),
      }),
    };

    await expect(replayEvidenceByRules(
      { snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY },
      { store },
    )).rejects.toThrow("integrity_mismatch");
  });

  test("dispatches Slovenia rules twice from verified raw bytes without a network port", async () => {
    const db = database();
    const fixture = await replayableFixture();
    const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
    for (const sourceArtifact of fixture.artifacts) await store.appendArtifact(sourceArtifact);
    await store.seal(fixture.prepared);

    const first = await replayEvidenceByRules({ snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY }, { store });
    const second = await replayEvidenceByRules({ snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY }, { store });

    expect(fixture.artifacts).toHaveLength(11);
    expect(fixture.prepared.snapshot.claims.filter((claim) => "claimKind" in claim)).toHaveLength(9);
    expect(canonicalJson(first)).toBe(canonicalJson(fixture.prepared.snapshot));
    expect(canonicalJson(second)).toBe(canonicalJson(first));
  });

  test.each([
    ["rules", { rulesVersion: "vs2-unknown@1" }],
    ["parser", { parserVersions: { ...PARSER_VERSIONS, "si-income-threshold": "si-income@999" } }],
  ])("fails closed for an unknown %s version", async (_name, options) => {
    const db = database();
    const fixture = await replayableFixture(options);
    const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
    for (const sourceArtifact of fixture.artifacts) await store.appendArtifact(sourceArtifact);
    await store.seal(fixture.prepared);

    await expect(replayEvidenceByRules(
      { snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY },
      { store },
    )).rejects.toThrow("integrity_mismatch");
  });
});

describe("cold-start finite HTTP stream", () => {
  const prepared: ColdStartPrepared = {
    runId: "cold-route-run-1",
    profileId: "relocation-profile-1",
    country: {
      code: "SI",
      englishName: "Slovenia",
      displayName: "Словения",
      flag: "🇸🇮",
      coordinate: { lat: 46.1512, lng: 14.9955 },
    },
    assessmentAt: "2026-08-11",
    deadlineAt: "2026-08-11T10:01:00.000Z",
  };
  const readModel: ColdStartReadModel = {
    runId: prepared.runId,
    country: prepared.country,
    checkedAt: prepared.assessmentAt,
    evidenceSnapshotId: `${prepared.runId}:evidence`,
    assessmentRulesVersion: "cold-start-assessment@1",
    coverage: { verified: 0, required: 9, claimKinds: [] },
    comparator: {
      marker: "yellow",
      personalFit: "research_incomplete",
      cityScope: "not_checked",
      reasons: [{
        code: "country_evidence_incomplete",
        summary: "Официальные данные по стране подтверждены не полностью.",
        claimIds: [],
        officialUrls: [],
      }],
    },
    sourceNavigation: [],
  };

  const sourceDiscovered: ColdStartEvent = {
    runId: prepared.runId,
    sequence: 1,
    occurredAt: "2026-08-11T10:00:00.000Z",
    country: prepared.country,
    type: "source_discovered",
    payload: {
      candidateId: "si-gov",
      url: "https://www.gov.si/teme/vstop-in-prebivanje/",
      claimKinds: ["route_basis"],
    },
  };
  const completed: ColdStartEvent = {
    runId: prepared.runId,
    sequence: 2,
    occurredAt: "2026-08-11T10:00:01.000Z",
    country: prepared.country,
    type: "assessment_completed",
    payload: { readModel },
  };

  async function loadPost(application: ColdStartApplication) {
    vi.resetModules();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication: () => application,
    }));
    return (await import("../../src/app/api/cold-start/route")).POST;
  }

  function validRequest(signal?: AbortSignal): Request {
    return new Request("http://localhost/api/cold-start", {
      body: JSON.stringify({ countryInput: "Словения", profile: RELOCATION_DRAFT }),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
    });
  }

  afterEach(() => {
    vi.doUnmock("../../src/infrastructure/composition-root");
    vi.restoreAllMocks();
  });

  test("rejects a non-JSON request before composition or stream creation", async () => {
    const getConfirmedLifeApplication = vi.fn();
    vi.doMock("../../src/infrastructure/composition-root", () => ({
      getConfirmedLifeApplication,
    }));

    const { POST } = await import("../../src/app/api/cold-start/route");
    const response = await POST(new Request("http://localhost/api/cold-start", {
      body: "countryInput=Slovenia",
      headers: { "content-type": "text/plain" },
      method: "POST",
    }));

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
    expect(await response.json()).toEqual({
      code: "unsupported_media_type",
      status: 415,
      title: "Неподдерживаемый формат запроса",
    });
    expect(getConfirmedLifeApplication).not.toHaveBeenCalled();

    vi.doUnmock("../../src/infrastructure/composition-root");
  });

  test("rejects invalid JSON and unknown top-level fields before prepare", async () => {
    const application = {
      prepare: vi.fn(),
      run: vi.fn(),
      present: vi.fn(),
    } as unknown as ColdStartApplication;
    const POST = await loadPost(application);

    const invalidJson = await POST(new Request("http://localhost/api/cold-start", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({
      code: "invalid_json",
      status: 400,
      title: "Некорректный JSON",
    });

    const unknownField = await POST(new Request("http://localhost/api/cold-start", {
      body: JSON.stringify({ countryInput: "Словения", profileId: "profile-1", extra: true }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));
    expect(unknownField.status).toBe(400);
    expect((await unknownField.json()).code).toBe("invalid_input");
    expect(application.prepare).not.toHaveBeenCalled();
    expect(application.run).not.toHaveBeenCalled();
  });

  test("prepares before returning exact finite-stream headers and does not await run", async () => {
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolveGate) => { releaseRun = resolveGate; });
    const application: ColdStartApplication = {
      prepare: vi.fn(async () => prepared),
      run: vi.fn(async (_prepared, emit) => {
        await runGate;
        await emit(sourceDiscovered);
        await emit(completed);
        return readModel;
      }),
      present: vi.fn(),
    };
    const POST = await loadPost(application);

    const responseOrTimeout = await Promise.race([
      POST(validRequest()),
      new Promise<"timeout">((resolveTimeout) => {
        setTimeout(() => resolveTimeout("timeout"), 100);
      }),
    ]);
    expect(responseOrTimeout).not.toBe("timeout");
    const response = responseOrTimeout as Response;
    expect(application.prepare).toHaveBeenCalledWith({
      countryInput: "Словения",
      profile: RELOCATION_DRAFT,
    });
    expect(application.run).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-life-run-id")).toBe(prepared.runId);
    expect(response.headers.get("x-life-profile-id")).toBe(prepared.profileId);

    releaseRun?.();
    await expect(response.text()).resolves.toBe(
      `${JSON.stringify(sourceDiscovered)}\n${JSON.stringify(completed)}\n`,
    );
  });

  test("streams and reloads the real sealed yellow result when the country is not installed", async () => {
    const db = database();
    const now = new Date();
    const requestStepCalls: unknown[] = [];
    const application = createColdStartComposition({
      database: db,
      hmacKey: KEY,
      countrySourceIndex: {
        lookup: () => ({
          ok: false as const,
          kind: "country_not_installed" as const,
          candidates: [] as const,
        }),
      },
      requestStep: async (request) => {
        requestStepCalls.push(request);
        throw new Error("country-not-installed must not capture");
      },
      clock: () => new Date(now),
      nextRunId: () => "not-installed-stream-run",
    });
    const POST = await loadPost(application);

    const response = await POST(validRequest());
    const lines = (await response.text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    const terminal = coldStartEventSchema.parse(JSON.parse(lines[0]!));

    expect(requestStepCalls).toEqual([]);
    expect(terminal).toMatchObject({
      type: "assessment_completed",
      runId: "not-installed-stream-run",
      payload: {
        readModel: {
          evidenceSnapshotId: "not-installed-stream-run:evidence",
          comparator: { marker: "yellow", personalFit: "research_incomplete" },
        },
      },
    });
    if (terminal.type !== "assessment_completed") throw new Error("terminal event required");
    expect(await application.present({
      runId: terminal.runId,
      profileId: response.headers.get("x-life-profile-id")!,
    })).toEqual(terminal.payload.readModel);
    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(db.prepare("SELECT COUNT(*) FROM dossier_versions").pluck().get()).toBe(0);
  });

  test("errors a normally completed stream without one final terminal event", async () => {
    const application: ColdStartApplication = {
      prepare: async () => prepared,
      run: async (_prepared, emit) => {
        await emit(sourceDiscovered);
        return readModel;
      },
      present: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    await expect(response.text()).rejects.toThrow("missing_terminal_event");
  });

  test("errors the transport on invalid event order instead of inventing a verdict", async () => {
    const invalidTerminal = { ...completed, sequence: 1 } as ColdStartEvent;
    const eventAfterTerminal = { ...sourceDiscovered, sequence: 2 } as ColdStartEvent;
    const application: ColdStartApplication = {
      prepare: async () => prepared,
      run: async (_prepared, emit) => {
        await emit(invalidTerminal);
        await emit(eventAfterTerminal);
        return readModel;
      },
      present: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    await expect(response.text()).rejects.toThrow("event_after_terminal");
  });

  test("links request abort and response cancellation to the application signal", async () => {
    const observedSignals: AbortSignal[] = [];
    const application: ColdStartApplication = {
      prepare: async () => prepared,
      run: async (_prepared, _emit, signal) => {
        observedSignals.push(signal);
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      present: vi.fn(),
    };
    const POST = await loadPost(application);

    const requestController = new AbortController();
    const requestResponse = await POST(validRequest(requestController.signal));
    const requestReason = new Error("request_disconnected");
    requestController.abort(requestReason);
    await vi.waitFor(() => expect(observedSignals[0]?.aborted).toBe(true));
    expect(observedSignals[0]?.reason).toBe(requestReason);
    await expect(requestResponse.text()).rejects.toBe(requestReason);

    const cancelResponse = await POST(validRequest());
    const cancelReason = new Error("reader_cancelled");
    await cancelResponse.body?.cancel(cancelReason);
    await vi.waitFor(() => expect(observedSignals[1]?.aborted).toBe(true));
    expect(observedSignals[1]?.reason).toBe(cancelReason);
  });

  test("maps prepare failures to a generic problem before a stream exists", async () => {
    const application: ColdStartApplication = {
      prepare: vi.fn(async () => { throw new Error("unsupported_country"); }),
      run: vi.fn(),
      present: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "invalid_input",
      status: 400,
      title: "Запрос не прошёл проверку",
    });
    expect(application.run).not.toHaveBeenCalled();
  });

  test("keeps unexpected prepare failures server-side and returns a generic 500", async () => {
    const application: ColdStartApplication = {
      prepare: vi.fn(async () => { throw new Error("database is locked: secret-path"); }),
      run: vi.fn(),
      present: vi.fn(),
    };
    const POST = await loadPost(application);
    const response = await POST(validRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "internal_error",
      status: 500,
      title: "Не удалось запустить проверку",
    });
    expect(application.run).not.toHaveBeenCalled();
  });
});
