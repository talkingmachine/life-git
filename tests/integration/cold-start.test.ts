import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteDossierStore } from "../../src/infrastructure/sqlite/dossier-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import {
  canonicalJson,
  createEvidenceIntegrity,
  hmacSha256,
  sha256Text,
} from "../../src/infrastructure/integrity";
import { replayEvidenceByRules } from "../../src/application/replay-evidence";
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
const COUNTRY_SOURCE_IDS = SOURCE_IDS.slice(0, 3) as readonly Exclude<
  SloveniaSourceId,
  "cbr-eur"
>[];
const PARSER_VERSIONS = {
  "si-digital-nomad-route": "si-route@1",
  "si-income-threshold": "si-income@1",
  "si-companion-employment": "si-companion@1",
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
    explicitNationalityExclusions: ["EU", "EEA", "Switzerland"],
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
  if (sourceId === "si-income-threshold") return "si-income@1";
  if (sourceId === "si-companion-employment") return "si-companion@1";
  return "si-route@1";
}

function artifact(
  sourceId: Exclude<SloveniaSourceId, "cbr-eur">,
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
        sourceId === "si-companion-employment" ? "2026-01-01" : "2025-11-21";
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
    assessmentDate: ASSESSMENT_DATE,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: PARSER_VERSIONS,
    rulesVersion: options.rulesVersion ?? "vs2-si-evidence@1",
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
      expect(outputClaim.value.explicitNationalityExclusions).toEqual(["EU", "EEA", "Switzerland"]);
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

function validatorArtifact(
  runId: string,
  sourceId: Exclude<SloveniaSourceId, "cbr-eur">,
  role: string,
  fixtureName: string,
  url: string,
  mediaType = "text/html",
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new Uint8Array(readFileSync(
    new URL(`../sources/fixtures/slovenia/${fixtureName}`, import.meta.url),
  ));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${sourceId}:${role}:${sha256}`,
    runId,
    sourceId,
    role,
    url,
    mediaType,
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-11T10:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

async function replayableFixture(options: {
  readonly rulesVersion?: string;
  readonly parserVersions?: Readonly<Record<SloveniaSourceId, string>>;
} = {}): Promise<{
  readonly prepared: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}> {
  const runId = "offline-replay";
  const urls = {
    gov: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    routeLaw: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
    salary: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
    sistat: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
    ess: "https://www.ess.gov.si/conditional-employment/",
    companionLaw: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
    cbr: SOURCE_URLS["cbr-eur"],
  } as const;
  const artifacts = [
    validatorArtifact(runId, "si-digital-nomad-route", "gov-route-page", "route-gov.html", urls.gov),
    validatorArtifact(runId, "si-digital-nomad-route", "ztuj2-consolidated", "ztuj2.html", urls.routeLaw),
    validatorArtifact(runId, "si-income-threshold", "salary-publication", "salary-publication.html", urls.salary),
    validatorArtifact(runId, "si-income-threshold", "sistat-metadata", "sistat-metadata.json", urls.sistat, "application/json"),
    validatorArtifact(runId, "si-income-threshold", "sistat-series", "sistat-series.json", urls.sistat, "application/json"),
    validatorArtifact(runId, "si-companion-employment", "ess-companion-page", "companion-ess.html", urls.ess),
    validatorArtifact(runId, "si-companion-employment", "zzsdt-consolidated", "zzsdt.html", urls.companionLaw),
  ];
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
      resolvedEvidenceUrl: urls.routeLaw,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-digital-nomad-route"),
    },
    {
      sourceId: "si-income-threshold" as const,
      navigationUrl: urls.salary,
      resolvedEvidenceUrl: urls.sistat,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-income-threshold"),
    },
    {
      sourceId: "si-companion-employment" as const,
      navigationUrl: urls.ess,
      resolvedEvidenceUrl: urls.companionLaw,
      artifacts: artifacts.filter(({ sourceId }) => sourceId === "si-companion-employment"),
    },
  ];
  const entries: TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [];
  for (const parserEntry of parserEntries) {
    const validated = await plan.validate(parserEntry, ASSESSMENT_DATE);
    if (!validated.ok) throw new Error("validator fixture must be current");
    entries.push({
      sourceId: parserEntry.sourceId,
      parserEntry,
      coverage: "verified",
      claims: validated.claims,
    });
  }
  entries.push({
    sourceId: "cbr-eur",
    parserEntry: {
      sourceId: "cbr-eur",
      navigationUrl: urls.cbr,
      resolvedEvidenceUrl: urls.cbr,
      artifacts: [],
    },
    coverage: "unavailable",
    blocker: {
      sourceId: "cbr-eur",
      kind: "navigation_mismatch",
      navigationUrl: urls.cbr,
      resolvedUrl: urls.cbr,
      artifactIds: [],
    },
  });
  const prepared = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: ASSESSMENT_DATE,
    entries: plan.applyRules(entries, ASSESSMENT_DATE),
    sourceIds: SOURCE_IDS,
    parserVersions: options.parserVersions ?? PARSER_VERSIONS,
    rulesVersion: options.rulesVersion ?? "vs2-si-evidence@1",
    contextHash: "b".repeat(64),
  }, createEvidenceIntegrity(KEY));
  return { prepared, artifacts };
}

describe("plan-aware offline evidence replay", () => {
  test("dispatches Slovenia rules twice from verified raw bytes without a network port", async () => {
    const db = database();
    const fixture = await replayableFixture();
    const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(db);
    for (const sourceArtifact of fixture.artifacts) await store.appendArtifact(sourceArtifact);
    await store.seal(fixture.prepared);

    const first = await replayEvidenceByRules({ snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY }, { store });
    const second = await replayEvidenceByRules({ snapshotId: fixture.prepared.snapshot.id, hmacKey: KEY }, { store });

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
