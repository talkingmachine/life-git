import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import {
  sqlitePublicationWorker,
  type SqlitePublicationWorkerHandle,
} from "../support/sqlite-publication-worker";

import type {
  ClaimKind,
  SloveniaSourceId,
} from "../../src/research/cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type VerifiedCountryClaimV2,
} from "../../src/research/cold-start-contracts-v2";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import type { DossierPublishResultV2 } from "../../src/research/dossier-v2";
import {
  sealEvidencePlan,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";
import {
  canonicalJson,
  createEvidenceIntegrity,
  hmacSha256,
  sha256Text,
} from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteDossierStore } from "../../src/infrastructure/sqlite/dossier-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";

const KEY = "dossier-v2-test-key-at-least-32-bytes";
const CAPTURED_AT = "2026-08-22T11:00:00.000Z";
const URLS = {
  "si-digital-nomad-route": "https://www.gov.si/en/news/digital-nomads/",
  "si-income-threshold": "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
  "si-companion-employment": "https://www.ess.gov.si/conditional-employment/",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
} as const;
const ROUTE_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "qualification",
  "companion_entry",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];

type CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;

interface DossierFixture {
  readonly sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly artifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function sourceFor(kind: ClaimKind): CountrySourceId {
  return SLOVENIA_V2_CLAIM_SOURCE[kind];
}

function sourcePeriod(kind: ClaimKind): string {
  return kind === "income" ? "2026M01" : "2025-11-21";
}

function artifact(
  sourceId: CountrySourceId,
  runId: string,
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new TextEncoder().encode(`DOSSIER-V2:${runId}:${sourceId}`);
  return {
    artifactId: `${runId}:${sourceId}:artifact`,
    runId,
    sourceId,
    role: "official-document",
    url: URLS[sourceId],
    mediaType: "application/octet-stream",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    origin: "live",
    capturedAt: CAPTURED_AT,
    responseStatus: 200,
    responseUrl: URLS[sourceId],
    request: { method: "GET", url: URLS[sourceId] },
  };
}

function claimValue(
  kind: ClaimKind,
  scope: "applicant" | "companion",
  citizenshipCountryCode: string,
): ClaimValueByKindV2[ClaimKind] {
  const requirementScope = scope === "applicant"
    ? { kind: "applicant" as const }
    : { kind: "companion" as const, relationship: "spouse" as const };
  switch (kind) {
    case "route_basis":
      return {
        route: "temporary_residence_digital_nomad",
        legalBasis: "ZTuj-2 Article 51a",
        effectiveFrom: "2025-11-21",
      };
    case "citizenship_applicability":
      return {
        classifications: [{ countryCode: citizenshipCountryCode, status: "eligible" }],
      };
    case "remote_work_relations":
      return {
        allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
        slovenianLabourMarketWorkIncluded: false,
      };
    case "income":
      return {
        metric: "latest_official_average_monthly_net_salary",
        multiplier: "2",
        thresholdEur: "3112.00",
        currency: "EUR",
        basis: "net",
        appliesTo: "applicant",
        period: "2026M01",
      };
    case "qualification":
      return { rule: "not_listed_in_authoritative_requirements" };
    case "companion_entry":
      return {
        relationshipClassifications: [{ relationship: "spouse", status: "eligible" }],
      };
    case "companion_local_work_access":
      return { access: "conditional", labourMarketCheck: true, informationSheet: true };
    case "duration":
      return {
        maximumMonths: 12,
        extendable: false,
        reapplyAfterMonths: 6,
        scope: requirementScope,
      };
    case "general_statutory_prerequisites":
      return {
        passportBeyondPermitMonths: 3,
        healthInsurance: true,
        article55GroundsApply: true,
        scope: requirementScope,
      };
  }
}

function claim(
  kind: ClaimKind,
  sourceArtifact: LiveCapturedArtifact<SloveniaSourceId>,
  citizenshipCountryCode: string,
  scope: "applicant" | "companion" = "applicant",
): VerifiedCountryClaimV2 {
  const sourceId = sourceFor(kind);
  const value = claimValue(kind, scope, citizenshipCountryCode);
  const period = sourcePeriod(kind);
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${kind}:v3-locator`,
    excerptSha256: sha256Text(`${kind}:v3-excerpt`),
  };
  return {
    claimId: sloveniaV2ClaimId(kind, value),
    sourceId,
    value,
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod: period,
    anchor,
    status: "verified",
    claimKind: kind,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: sourceArtifact.request.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      sourcePeriod: period,
      anchor,
    }],
    validatorVersion: SLOVENIA_V2_CLAIM_VALIDATOR[kind],
  } as VerifiedCountryClaimV2;
}

async function fixture(
  runId: string,
  citizenshipCountryCode = "RU",
  evidenceSnapshotId = `${runId}:evidence`,
): Promise<DossierFixture> {
  const artifacts: Readonly<Record<CountrySourceId, LiveCapturedArtifact<SloveniaSourceId>>> = {
    "si-digital-nomad-route": artifact("si-digital-nomad-route", runId),
    "si-income-threshold": artifact("si-income-threshold", runId),
    "si-companion-employment": artifact("si-companion-employment", runId),
  };
  const routeClaims = [
    ...ROUTE_KINDS.map((kind) =>
      claim(kind, artifacts[sourceFor(kind)], citizenshipCountryCode)
    ),
    claim("duration", artifacts["si-digital-nomad-route"], citizenshipCountryCode, "companion"),
    claim(
      "general_statutory_prerequisites",
      artifacts["si-digital-nomad-route"],
      citizenshipCountryCode,
      "companion",
    ),
  ];
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] = [
    {
      sourceId: "si-digital-nomad-route",
      parserEntry: {
        sourceId: "si-digital-nomad-route",
        navigationUrl: URLS["si-digital-nomad-route"],
        resolvedEvidenceUrl: URLS["si-digital-nomad-route"],
        artifacts: [artifacts["si-digital-nomad-route"]],
      },
      coverage: "verified",
      claims: routeClaims,
    },
    {
      sourceId: "si-income-threshold",
      parserEntry: {
        sourceId: "si-income-threshold",
        navigationUrl: URLS["si-income-threshold"],
        resolvedEvidenceUrl: URLS["si-income-threshold"],
        artifacts: [artifacts["si-income-threshold"]],
      },
      coverage: "verified",
      claims: [claim("income", artifacts["si-income-threshold"], citizenshipCountryCode)],
    },
    {
      sourceId: "si-companion-employment",
      parserEntry: {
        sourceId: "si-companion-employment",
        navigationUrl: URLS["si-companion-employment"],
        resolvedEvidenceUrl: URLS["si-companion-employment"],
        artifacts: [artifacts["si-companion-employment"]],
      },
      coverage: "verified",
      claims: [claim(
        "companion_local_work_access",
        artifacts["si-companion-employment"],
        citizenshipCountryCode,
      )],
    },
    {
      sourceId: "cbr-eur",
      parserEntry: {
        sourceId: "cbr-eur",
        navigationUrl: URLS["cbr-eur"],
        resolvedEvidenceUrl: URLS["cbr-eur"],
        artifacts: [],
      },
      coverage: "unavailable",
      blocker: {
        sourceId: "cbr-eur",
        kind: "semantic_mismatch",
        navigationUrl: URLS["cbr-eur"],
        artifactIds: [],
      },
    },
  ];
  const sealed = await sealEvidencePlan({
    id: evidenceSnapshotId,
    assessmentDate: "2026-08-22",
    entries,
    sourceIds: SLOVENIA_V2_SOURCE_ORDER,
    parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  }, createEvidenceIntegrity(KEY));
  return { sealed, artifacts: Object.values(artifacts) };
}

function memoryDatabase(): Database.Database {
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  return database;
}

function fileDatabase(): { readonly database: Database.Database; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "dossier-v2-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const database = openEvidenceDatabase(path);
  databases.push(database);
  return { database, path };
}

async function appendArtifacts(
  database: Database.Database,
  input: DossierFixture,
): Promise<void> {
  const store = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaimV2>(database);
  for (const sourceArtifact of input.artifacts) await store.appendArtifact(sourceArtifact);
}

function publishWorker(input: {
  readonly path: string;
  readonly preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly publishedAt: string;
  readonly start: SharedArrayBuffer;
}): SqlitePublicationWorkerHandle<DossierPublishResultV2> {
  return sqlitePublicationWorker({
    path: input.path,
    key: KEY,
    start: input.start,
    storeModulePath: "src/infrastructure/sqlite/dossier-store.ts",
    storeExportName: "SqliteDossierStore",
    methodName: "publishWithEvidenceV2",
    args: [{
      preparedEvidence: input.preparedEvidence,
      publishedAt: input.publishedAt,
    }],
  });
}

function seedV1Root(
  database: Database.Database,
  evidenceSnapshotId: string,
): string {
  const id = "1".repeat(64);
  database.prepare(`
    INSERT INTO dossier_versions (
      id, country_code, predecessor_id, evidence_snapshot_id, schema_version,
      payload_json, payload_hash, manifest_hash, hmac, published_at
    ) VALUES (?, 'SI', NULL, ?, 'si-dossier@1', '{}', ?, ?, ?, ?)
  `).run(
    id,
    evidenceSnapshotId,
    "2".repeat(64),
    id,
    "3".repeat(64),
    "2026-08-22T12:00:00.000Z",
  );
  return id;
}

describe("immutable country dossier V2 persistence", () => {
  test("isolates V2 roots, exact loaders, payload lookup, and predecessors from V1", async () => {
    const database = memoryDatabase();
    const firstFixture = await fixture("dossier-v2-isolated-first");
    await appendArtifacts(database, firstFixture);
    const store = new SqliteDossierStore(database, KEY);
    const first = store.publishWithEvidenceV2({
      preparedEvidence: firstFixture.sealed,
      publishedAt: "2026-08-22T12:00:01.000Z",
    });
    const v1RootId = seedV1Root(database, first.version.evidenceSnapshotId);
    const v1RowBefore = database.prepare(
      "SELECT * FROM dossier_versions WHERE id = ?",
    ).get(v1RootId);

    const secondFixture = await fixture("dossier-v2-isolated-second", "UA");
    await appendArtifacts(database, secondFixture);
    const second = store.publishWithEvidenceV2({
      preparedEvidence: secondFixture.sealed,
      publishedAt: "2026-08-22T12:00:02.000Z",
    });

    expect(first.version).toMatchObject({ schemaVersion: "si-dossier@2", ordinal: 1 });
    expect(second.version).toMatchObject({
      schemaVersion: "si-dossier@2",
      ordinal: 2,
      predecessorId: first.version.id,
    });
    expect(store.loadV2Verified(first.version.id)).toEqual(first.version);
    expect(store.loadV2Head("SI")).toEqual(second.version);
    expect(store.findV2ByPayload(
      "SI",
      first.version.payloadHash,
      first.version.evidenceSnapshotId,
    )).toEqual(first.version);
    expect(() => store.loadV2Verified(v1RootId)).toThrow("integrity_mismatch");
    expect(() => store.loadVerified(first.version.id)).toThrow("dossier_not_found");
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM dossier_versions
    `).get()).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT * FROM dossier_versions WHERE id = ?",
    ).get(v1RootId)).toEqual(v1RowBefore);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM dossier_versions_v2
    `).get()).toEqual({ count: 2 });
  });

  test("reuses only the exact Evidence snapshot and appends identical payloads from new snapshots", async () => {
    const database = memoryDatabase();
    const store = new SqliteDossierStore(database, KEY);
    const firstFixture = await fixture("dossier-v2-first");
    await appendArtifacts(database, firstFixture);
    const first = store.publishWithEvidenceV2({
      preparedEvidence: firstFixture.sealed,
      publishedAt: "2026-08-22T12:10:00.000Z",
    });

    const malformed = structuredClone(firstFixture.sealed);
    (malformed.snapshot as { hmac: string }).hmac = "0".repeat(64);
    expect(() => store.publishWithEvidenceV2({
      preparedEvidence: malformed,
      publishedAt: "2026-08-22T12:10:01.000Z",
    })).toThrow("integrity_mismatch");
    expect(database.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);

    const exactRetry = store.publishWithEvidenceV2({
      preparedEvidence: firstFixture.sealed,
      publishedAt: "2026-08-22T12:10:02.000Z",
    });
    expect(exactRetry).toEqual({ version: first.version, created: false });

    const repeatedPayloadFixture = await fixture("dossier-v2-repeated-payload");
    await appendArtifacts(database, repeatedPayloadFixture);
    const repeatedPayload = store.publishWithEvidenceV2({
      preparedEvidence: repeatedPayloadFixture.sealed,
      publishedAt: "2026-08-22T12:10:03.000Z",
    });
    expect(repeatedPayload).toMatchObject({
      created: true,
      version: {
        ordinal: 2,
        predecessorId: first.version.id,
        evidenceSnapshotId: repeatedPayloadFixture.sealed.snapshot.id,
        payloadHash: first.version.payloadHash,
      },
    });

    const changedFixture = await fixture("dossier-v2-changed", "UA");
    await appendArtifacts(database, changedFixture);
    const changed = store.publishWithEvidenceV2({
      preparedEvidence: changedFixture.sealed,
      publishedAt: "2026-08-22T12:10:04.000Z",
    });
    expect(changed).toMatchObject({
      created: true,
      version: { ordinal: 3, predecessorId: repeatedPayload.version.id },
    });
    expect(database.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(3);
    expect(database.prepare(
      "SELECT COUNT(*) FROM dossier_versions_v2",
    ).pluck().get()).toBe(3);
  });

  test("returns a fresh deeply frozen V2 version on every verified load", async () => {
    const database = memoryDatabase();
    const input = await fixture("dossier-v2-fresh-load");
    await appendArtifacts(database, input);
    const store = new SqliteDossierStore(database, KEY);
    const published = store.publishWithEvidenceV2({
      preparedEvidence: input.sealed,
      publishedAt: "2026-08-22T12:15:00.000Z",
    });

    const first = store.loadV2Verified(published.version.id);
    const second = store.loadV2Verified(published.version.id);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.payload).not.toBe(second.payload);
    expect(first.payload.claims).not.toBe(second.payload.claims);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.payload)).toBe(true);
    expect(Object.isFrozen(first.payload.claims[0]!.evidence)).toBe(true);
    expect(() => {
      (first.payload.claims as unknown as { claimId: string }[])[0]!.claimId = "mutated";
    }).toThrow(TypeError);
    expect(store.loadV2Verified(published.version.id)).toEqual(second);
    expect(() => database.prepare(
      "UPDATE dossier_versions_v2 SET published_at = published_at WHERE id = ?",
    ).run(published.version.id)).toThrow("dossier_version_v2_is_immutable");
    expect(() => database.prepare(
      "DELETE FROM dossier_versions_v2 WHERE id = ?",
    ).run(published.version.id)).toThrow("dossier_version_v2_is_immutable");
  });

  test("rejects different signed Evidence content that reuses an existing snapshot ID", async () => {
    const database = memoryDatabase();
    const firstFixture = await fixture("dossier-v2-same-id-first");
    await appendArtifacts(database, firstFixture);
    const store = new SqliteDossierStore(database, KEY);
    const first = store.publishWithEvidenceV2({
      preparedEvidence: firstFixture.sealed,
      publishedAt: "2026-08-22T12:16:00.000Z",
    });
    const conflictingFixture = await fixture(
      "dossier-v2-same-id-conflict",
      "UA",
      first.version.evidenceSnapshotId,
    );
    await appendArtifacts(database, conflictingFixture);

    expect(() => store.publishWithEvidenceV2({
      preparedEvidence: conflictingFixture.sealed,
      publishedAt: "2026-08-22T12:16:01.000Z",
    })).toThrow("integrity_mismatch");
    expect(database.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(database.prepare("SELECT COUNT(*) FROM dossier_versions_v2").pluck().get()).toBe(1);
  });

  test("rolls the V3 Evidence seal back when V2 dossier insertion fails", async () => {
    const database = memoryDatabase();
    const input = await fixture("dossier-v2-rollback");
    await appendArtifacts(database, input);
    database.exec(`
      CREATE TRIGGER test_v2_dossier_failure
      BEFORE INSERT ON dossier_versions_v2
      BEGIN SELECT RAISE(ABORT, 'forced_v2_dossier_failure'); END
    `);

    expect(() => new SqliteDossierStore(database, KEY).publishWithEvidenceV2({
      preparedEvidence: input.sealed,
      publishedAt: "2026-08-22T12:20:00.000Z",
    })).toThrow("forced_v2_dossier_failure");
    expect(database.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
    expect(database.prepare("SELECT COUNT(*) FROM dossier_versions_v2").pluck().get()).toBe(0);
    expect(database.prepare("SELECT COUNT(*) FROM artifacts WHERE sealed = 1").pluck().get()).toBe(0);
  });

  test("rejects a re-signed V2 predecessor that crosses into the V1 chain", async () => {
    const database = memoryDatabase();
    const input = await fixture("dossier-v2-cross-schema");
    await appendArtifacts(database, input);
    const store = new SqliteDossierStore(database, KEY);
    const published = store.publishWithEvidenceV2({
      preparedEvidence: input.sealed,
      publishedAt: "2026-08-22T12:30:01.000Z",
    });
    const v1RootId = seedV1Root(database, published.version.evidenceSnapshotId);
    const manifest = canonicalJson({
      countryCode: "SI",
      schemaVersion: "si-dossier@2",
      payloadHash: published.version.payloadHash,
      evidenceSnapshotId: published.version.evidenceSnapshotId,
      predecessorId: v1RootId,
      publishedAt: published.version.publishedAt,
    });
    const changedId = sha256Text(manifest);
    database.pragma("foreign_keys = OFF");
    database.exec("DROP TRIGGER dossier_versions_v2_no_update");
    database.prepare(`
      UPDATE dossier_versions_v2
      SET id = ?, predecessor_id = ?, manifest_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      changedId,
      v1RootId,
      changedId,
      hmacSha256(manifest, KEY),
      published.version.id,
    );

    expect(() => store.loadV2Verified(changedId)).toThrow("integrity_mismatch");
    expect(() => store.loadV2Head("SI")).toThrow("integrity_mismatch");
  });

  test("rejects a re-signed payload bound to a different valid V3 Evidence snapshot", async () => {
    const database = memoryDatabase();
    const firstFixture = await fixture("dossier-v2-binding-first");
    const otherFixture = await fixture("dossier-v2-binding-other", "UA");
    await appendArtifacts(database, firstFixture);
    await appendArtifacts(database, otherFixture);
    const store = new SqliteDossierStore(database, KEY);
    const published = store.publishWithEvidenceV2({
      preparedEvidence: firstFixture.sealed,
      publishedAt: "2026-08-22T12:35:00.000Z",
    });
    await new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaimV2>(database)
      .seal(otherFixture.sealed);
    const manifest = canonicalJson({
      countryCode: "SI",
      schemaVersion: "si-dossier@2",
      payloadHash: published.version.payloadHash,
      evidenceSnapshotId: otherFixture.sealed.snapshot.id,
      publishedAt: published.version.publishedAt,
    });
    const changedId = sha256Text(manifest);
    database.exec("DROP TRIGGER dossier_versions_v2_no_update");
    database.prepare(`
      UPDATE dossier_versions_v2
      SET id = ?, evidence_snapshot_id = ?, manifest_hash = ?, hmac = ?
      WHERE id = ?
    `).run(
      changedId,
      otherFixture.sealed.snapshot.id,
      changedId,
      hmacSha256(manifest, KEY),
      published.version.id,
    );

    expect(() => store.loadV2Verified(changedId)).toThrow("integrity_mismatch");
  });

  test.each([
    ["payload_json", "{}"],
    ["payload_hash", "0".repeat(64)],
    ["manifest_hash", "0".repeat(64)],
    ["hmac", "0".repeat(64)],
    ["published_at", "2026-08-22T12:36:00Z"],
    ["schema_version", "si-dossier@1"],
  ] as const)("rejects V2 row tampering in %s", async (column, value) => {
    const database = memoryDatabase();
    const input = await fixture(`dossier-v2-tamper-${column}`);
    await appendArtifacts(database, input);
    const store = new SqliteDossierStore(database, KEY);
    const published = store.publishWithEvidenceV2({
      preparedEvidence: input.sealed,
      publishedAt: "2026-08-22T12:36:00.000Z",
    });
    database.exec("DROP TRIGGER dossier_versions_v2_no_update");
    if (column === "schema_version") database.pragma("ignore_check_constraints = ON");
    database.prepare(`UPDATE dossier_versions_v2 SET ${column} = ? WHERE id = ?`)
      .run(value, published.version.id);

    expect(() => store.loadV2Verified(published.version.id)).toThrow("integrity_mismatch");
  });

  test.each(["same_snapshot", "same_payload", "different_payload"] as const)(
    "linearizes simultaneous V2 %s publication without a lost race",
    async (kind) => {
      const { database, path } = fileDatabase();
      database.pragma("busy_timeout = 3000");
      const first = await fixture(`dossier-race-${kind}-first`);
      const second = kind === "same_snapshot"
        ? first
        : await fixture(
            `dossier-race-${kind}-second`,
            kind === "same_payload" ? "RU" : "UA",
          );
      await appendArtifacts(database, first);
      await appendArtifacts(database, second);
      const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const workers = [first, second].map((input, index) => publishWorker({
        path,
        preparedEvidence: input.sealed,
        publishedAt: `2026-08-22T12:40:0${index}.000Z`,
        start,
      }));
      await Promise.all(workers.map(({ ready }) => ready));
      const signal = new Int32Array(start);
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0, workers.length);

      const results = await Promise.all(workers.map(({ result }) => result));

      const expectedCount = kind === "same_snapshot" ? 1 : 2;
      expect(results.filter(({ created }) => created)).toHaveLength(expectedCount);
      expect(database.prepare(
        "SELECT COUNT(*) FROM dossier_versions_v2",
      ).pluck().get()).toBe(expectedCount);
      expect(database.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get())
        .toBe(expectedCount);
      expect(new SqliteDossierStore(database, KEY).loadV2Head("SI")?.ordinal)
        .toBe(expectedCount);
    },
    10_000,
  );
});
