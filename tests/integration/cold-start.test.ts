import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
import { buildCountryDossier } from "../../src/research/dossier";
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

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
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
