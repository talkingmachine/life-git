import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import {
  buildSloveniaKnowledgeRevision,
  type SloveniaCountryKnowledgeRevision,
  type VerifiedCountryEvidenceInput,
} from "../../src/research/country-knowledge";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../../src/research/cold-start-contracts";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  evidenceArtifactProvenance,
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
import { SqliteCountryKnowledgeStore } from "../../src/infrastructure/sqlite/country-knowledge-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";

const KEY = "country-knowledge-test-key-at-least-32-bytes";
const CREATED_AT = "2026-08-12T12:00:00.000Z";
const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];
const ROUTE_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "qualification",
  "companion_entry",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];
const PARSER_VERSIONS = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
} as const;
const URLS = {
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
    thresholdEur: "3112.00-SECRET-VALUE",
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

type CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;
type SourceState =
  | { readonly kind: "verified"; readonly claimKinds: readonly ClaimKind[] }
  | {
      readonly kind: "semantic_mismatch" | "conflict" | "stale" | "timeout" | "deadline";
      readonly withArtifact: boolean;
    };

interface KnowledgeFixture {
  readonly evidence: VerifiedCountryEvidenceInput;
  readonly sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly liveArtifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
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
  if (kind === "income") return "si-income-threshold";
  if (kind === "companion_local_work_access") return "si-companion-employment";
  return "si-digital-nomad-route";
}

function artifact(
  sourceId: CountrySourceId,
  runId: string,
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new TextEncoder().encode(`RAW-BYTES-MUST-NOT-ENTER-KNOWLEDGE:${runId}:${sourceId}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${runId}:${sourceId}:artifact`,
    runId,
    sourceId,
    role: "official-document",
    url: URLS[sourceId],
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt: CREATED_AT,
    responseStatus: 200,
    responseUrl: URLS[sourceId],
    request: { method: "GET", url: URLS[sourceId] },
  };
}

function claim(
  kind: ClaimKind,
  sourceArtifact: LiveCapturedArtifact<SloveniaSourceId>,
  incomeThreshold = VALUES.income.thresholdEur,
): VerifiedCountryClaim {
  const sourceId = sourceFor(kind);
  const validatorVersion = PARSER_VERSIONS[sourceId];
  const sourcePeriod = kind === "income" ? "2026M01" : "2025-11-21";
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${kind}:literal-locator`,
    excerptSha256: sha256Text(`${kind}:literal-excerpt`),
  };
  return {
    claimId: `${sourceId}:${kind}:${validatorVersion}`,
    claimKind: kind,
    sourceId,
    value: kind === "income" ? { ...VALUES.income, thresholdEur: incomeThreshold } : VALUES[kind],
    scope: "VS-2 Slovenia cold start",
    sourcePeriod,
    anchor,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: URLS[sourceId],
      resolvedEvidenceUrl: URLS[sourceId],
      sourcePeriod,
      anchor,
    }],
    validatorVersion,
    status: "verified",
  } as VerifiedCountryClaim;
}

async function evidenceFixture(input: {
  readonly runId: string;
  readonly route: SourceState;
  readonly income: SourceState;
  readonly companion: SourceState;
  readonly incomeThreshold?: string;
}): Promise<KnowledgeFixture> {
  const states: Readonly<Record<CountrySourceId, SourceState>> = {
    "si-digital-nomad-route": input.route,
    "si-income-threshold": input.income,
    "si-companion-employment": input.companion,
  };
  const liveArtifacts: LiveCapturedArtifact<SloveniaSourceId>[] = [];
  const entries: TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [];
  for (const sourceId of SOURCE_IDS.slice(0, 3) as readonly CountrySourceId[]) {
    const state = states[sourceId];
    const needsArtifact = state.kind === "verified" || state.withArtifact;
    const sourceArtifact = needsArtifact ? artifact(sourceId, input.runId) : undefined;
    if (sourceArtifact !== undefined) liveArtifacts.push(sourceArtifact);
    const parserEntry = {
      sourceId,
      navigationUrl: URLS[sourceId],
      resolvedEvidenceUrl: URLS[sourceId],
      artifacts: sourceArtifact === undefined ? [] : [sourceArtifact],
    };
    if (state.kind === "verified") {
      entries.push({
        sourceId,
        parserEntry,
        coverage: "verified",
        claims: state.claimKinds.map((kind) => claim(
          kind,
          sourceArtifact!,
          input.incomeThreshold,
        )),
      });
    } else {
      entries.push({
        sourceId,
        parserEntry,
        coverage: "unavailable",
        blocker: {
          sourceId,
          kind: state.kind,
          navigationUrl: URLS[sourceId],
          resolvedUrl: URLS[sourceId],
          artifactIds: sourceArtifact === undefined ? [] : [sourceArtifact.artifactId],
        },
      });
    }
  }
  entries.push({
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
  });
  const sealed = await sealEvidencePlan({
    id: `${input.runId}:evidence`,
    assessmentDate: "2026-08-12",
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: PARSER_VERSIONS,
    rulesVersion: "vs2-si-evidence@2",
  }, createEvidenceIntegrity(KEY));
  return {
    sealed,
    liveArtifacts,
    evidence: {
      snapshot: sealed.snapshot,
      entries: sealed.manifest.entries,
      artifacts: liveArtifacts.map(evidenceArtifactProvenance),
    },
  };
}

function fullEvidence(runId = "full-run"): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId,
    route: { kind: "verified", claimKinds: ROUTE_KINDS },
    income: { kind: "verified", claimKinds: ["income"] },
    companion: { kind: "verified", claimKinds: ["companion_local_work_access"] },
  });
}

function partialEvidence(runId = "partial-run"): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId,
    route: { kind: "semantic_mismatch", withArtifact: true },
    income: { kind: "verified", claimKinds: ["income"] },
    companion: { kind: "semantic_mismatch", withArtifact: false },
  });
}

function unavailableEvidence(
  kind: "timeout" | "deadline",
): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId: `${kind}-run`,
    route: { kind, withArtifact: false },
    income: { kind: "semantic_mismatch", withArtifact: false },
    companion: { kind: "semantic_mismatch", withArtifact: false },
  });
}

function memoryDatabase(): Database.Database {
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  return database;
}

function fileDatabase(): { readonly database: Database.Database; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "country-knowledge-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const database = openEvidenceDatabase(path);
  databases.push(database);
  return { database, path };
}

async function persistFixture(database: Database.Database, fixture: KnowledgeFixture): Promise<void> {
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(database);
  for (const sourceArtifact of fixture.liveArtifacts) {
    await evidenceStore.appendArtifact(sourceArtifact);
  }
  await evidenceStore.seal(fixture.sealed);
}

function build(
  fixture: KnowledgeFixture,
  predecessor?: SloveniaCountryKnowledgeRevision,
): SloveniaCountryKnowledgeRevision | undefined {
  return buildSloveniaKnowledgeRevision({
    evidence: fixture.evidence,
    ...(predecessor === undefined ? {} : { predecessor }),
    createdAt: CREATED_AT,
  });
}

describe("append-only country knowledge", () => {
  test.each([
    ["full verified", () => fullEvidence(), true],
    ["partial verified plus artifact-backed semantic mismatch", () => partialEvidence(), true],
    ["timeout without artifacts", () => unavailableEvidence("timeout"), false],
    ["deadline without artifacts", () => unavailableEvidence("deadline"), false],
  ] as const)("%s", async (_label, makeEvidence, publishes) => {
    const fixture = await makeEvidence();

    const revision = build(fixture);

    expect(revision !== undefined).toBe(publishes);
  });

  test("publishes compact formal references without copied claim values or artifact bytes", async () => {
    const fixture = await fullEvidence();

    const revision = build(fixture)!;

    expect(revision).toEqual({
      schemaVersion: "country-knowledge@1",
      packageId: "SI",
      observationSchemaVersion: "si-knowledge@1",
      id: "country-knowledge:SI:full-run:evidence",
      countryCode: "SI",
      triggerEvidenceSnapshotId: "full-run:evidence",
      formalClaimRefs: [
        {
          claimId: "si-digital-nomad-route:route_basis:si-route@2",
          claimKind: "route_basis",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:citizenship_applicability:si-route@2",
          claimKind: "citizenship_applicability",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:remote_work_relations:si-route@2",
          claimKind: "remote_work_relations",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-income-threshold:income:si-income@2",
          claimKind: "income",
          definitionId: "si-income@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:qualification:si-route@2",
          claimKind: "qualification",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:companion_entry:si-route@2",
          claimKind: "companion_entry",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-companion-employment:companion_local_work_access:si-companion@2",
          claimKind: "companion_local_work_access",
          definitionId: "si-companion@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:duration:si-route@2",
          claimKind: "duration",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:general_statutory_prerequisites:si-route@2",
          claimKind: "general_statutory_prerequisites",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
      ],
      statusObservations: [],
      createdAt: CREATED_AT,
    });
    expect(JSON.stringify(revision)).not.toMatch(/3112\.00-SECRET-VALUE|RAW-BYTES|value|bytes/i);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.formalClaimRefs)).toBe(true);
  });

  test("revalidates repeated claims, replaces one changed ref and carries unaffected refs", async () => {
    const root = build(await fullEvidence("root-run"))!;
    const revalidated = build(await fullEvidence("revalidated-run"), root)!;
    const changedFixture = await evidenceFixture({
      runId: "changed-run",
      route: { kind: "semantic_mismatch", withArtifact: false },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "semantic_mismatch", withArtifact: false },
      incomeThreshold: "3400.00-CHANGED-SECRET",
    });
    const changed = build(changedFixture, root)!;

    expect(revalidated.predecessorId).toBe(root.id);
    expect(revalidated.formalClaimRefs.every(
      ({ evidenceSnapshotId }) => evidenceSnapshotId === "revalidated-run:evidence",
    )).toBe(true);
    expect(changed.formalClaimRefs.find(({ claimKind }) => claimKind === "income")).toEqual({
      claimId: "si-income-threshold:income:si-income@2",
      claimKind: "income",
      definitionId: "si-income@2",
      evidenceSnapshotId: "changed-run:evidence",
    });
    expect(changed.formalClaimRefs.filter(({ claimKind }) => claimKind !== "income")).toEqual(
      root.formalClaimRefs.filter(({ claimKind }) => claimKind !== "income"),
    );
    expect(JSON.stringify(changed)).not.toContain("3400.00-CHANGED-SECRET");
  });

  test.each([
    ["semantic_mismatch", "unresolved"],
    ["conflict", "unresolved"],
    ["stale", "expired"],
  ] as const)("an artifact-backed %s mask replaces only affected refs", async (kind, status) => {
    const root = build(await fullEvidence("status-root"))!;
    const fixture = await evidenceFixture({
      runId: `status-${kind}`,
      route: { kind, withArtifact: true },
      income: { kind: "semantic_mismatch", withArtifact: false },
      companion: { kind: "semantic_mismatch", withArtifact: false },
    });

    const successor = build(fixture, root)!;

    expect(successor.formalClaimRefs.map(({ claimKind }) => claimKind)).toEqual([
      "income",
      "companion_local_work_access",
    ]);
    expect(successor.formalClaimRefs).toEqual(root.formalClaimRefs.filter(
      ({ claimKind }) => claimKind === "income" || claimKind === "companion_local_work_access",
    ));
    expect(successor.statusObservations).toEqual([{
      kind: "source_status",
      observationId: `status-${kind}:evidence:si-digital-nomad-route:${status}`,
      sourceId: "si-digital-nomad-route",
      status,
      affectedClaimKinds: ROUTE_KINDS,
      evidenceSnapshotId: `status-${kind}:evidence`,
      artifactIds: [`status-${kind}:si-digital-nomad-route:artifact`],
      definitionId: "si-route@2",
      capturedAt: CREATED_AT,
      verifiedAt: "2026-08-12",
    }]);
  });

  test("persists one deterministic head and rejects update or delete", async () => {
    const database = memoryDatabase();
    const fixture = await fullEvidence("stored-root");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = build(fixture)!;

    expect(store.publish(revision)).toEqual(revision);
    expect(store.publish(revision)).toEqual(revision);
    expect(store.latest("SI")).toEqual(revision);
    expect(store.loadVerified(revision.id)).toEqual(revision);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(1);
    expect(() => database.prepare(
      "UPDATE country_knowledge_revisions SET created_at = ? WHERE id = ?",
    ).run("2026-08-12T12:01:00.000Z", revision.id)).toThrow(
      "country_knowledge_revision_is_immutable",
    );
    expect(() => database.prepare(
      "DELETE FROM country_knowledge_revisions WHERE id = ?",
    ).run(revision.id)).toThrow("country_knowledge_revision_is_immutable");
  });

  test("stores a full successor and verifies its exact predecessor and Evidence references", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("chain-root");
    const successorFixture = await evidenceFixture({
      runId: "chain-successor",
      route: { kind: "semantic_mismatch", withArtifact: false },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "semantic_mismatch", withArtifact: false },
      incomeThreshold: "3500.00",
    });
    await persistFixture(database, rootFixture);
    await persistFixture(database, successorFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const root = store.publish(build(rootFixture)!);
    const successor = store.publish(build(successorFixture, root)!);

    expect(successor.predecessorId).toBe(root.id);
    expect(store.latest("SI")).toEqual(successor);
    expect(store.loadVerified(successor.id)).toEqual(successor);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(2);
  });

  test.each([
    ["payload", "payload_json", "null"],
    ["hash", "payload_hash", "0000000000000000000000000000000000000000000000000000000000000000"],
    ["HMAC", "hmac", "0000000000000000000000000000000000000000000000000000000000000000"],
  ] as const)("normalizes stored %s tampering to integrity_mismatch", async (
    _label,
    column,
    value,
  ) => {
    const database = memoryDatabase();
    const fixture = await fullEvidence(`tamper-${column}`);
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    database.prepare(
      `UPDATE country_knowledge_revisions SET ${column} = ? WHERE id = ?`,
    ).run(value, revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("rejects a resigned ref to another valid Evidence claim or snapshot", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("ref-root");
    const otherFixture = await fullEvidence("ref-other");
    await persistFixture(database, rootFixture);
    await persistFixture(database, otherFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(rootFixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const row = database.prepare(
      "SELECT payload_json FROM country_knowledge_revisions WHERE id = ?",
    ).get(revision.id) as { readonly payload_json: string };
    const payload = JSON.parse(row.payload_json) as SloveniaCountryKnowledgeRevision;
    const refs = payload.formalClaimRefs.map((reference, index) => index === 0
      ? {
          ...reference,
          claimId: "si-digital-nomad-route:duration:si-route@2",
          evidenceSnapshotId: "ref-other:evidence",
        }
      : reference);
    const tampered = { ...payload, formalClaimRefs: refs };
    const canonical = canonicalJson(tampered);
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(canonical, sha256Text(canonical), hmacSha256(canonical, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("rejects a resigned status mask that borrows another valid artifact", async () => {
    const database = memoryDatabase();
    const fixture = await partialEvidence("mask-tamper");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const row = database.prepare(
      "SELECT payload_json FROM country_knowledge_revisions WHERE id = ?",
    ).get(revision.id) as { readonly payload_json: string };
    const payload = JSON.parse(row.payload_json) as SloveniaCountryKnowledgeRevision;
    const tampered = {
      ...payload,
      statusObservations: payload.statusObservations.map((observation) => ({
        ...observation,
        artifactIds: ["mask-tamper:si-income-threshold:artifact"],
      })),
    };
    const canonical = canonicalJson(tampered);
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(canonical, sha256Text(canonical), hmacSha256(canonical, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("normalizes malformed decoded arrays instead of leaking native TypeError", async () => {
    const database = memoryDatabase();
    const fixture = await fullEvidence("malformed-root");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const malformed = canonicalJson({ ...revision, formalClaimRefs: null });
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(malformed, sha256Text(malformed), hmacSha256(malformed, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrowError(new Error("integrity_mismatch"));
  });

  test("rejects a tampered successor predecessor even when the row stays parseable", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("predecessor-root");
    const successorFixture = await fullEvidence("predecessor-successor");
    await persistFixture(database, rootFixture);
    await persistFixture(database, successorFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const root = store.publish(build(rootFixture)!);
    const successor = store.publish(build(successorFixture, root)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    database.exec("DROP INDEX country_knowledge_one_root");
    database.prepare(
      "UPDATE country_knowledge_revisions SET predecessor_id = NULL WHERE id = ?",
    ).run(successor.id);

    expect(() => store.loadVerified(successor.id)).toThrow("integrity_mismatch");
  });

  test("linearizes concurrent publication with an immediate transaction", async () => {
    const { database, path } = fileDatabase();
    const fixture = await fullEvidence("concurrent-root");
    await persistFixture(database, fixture);
    const revision = build(fixture)!;
    const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = publishWorker({ path, revision, start });
    const second = publishWorker({ path, revision, start });
    await Promise.all([first.ready, second.ready]);
    Atomics.store(new Int32Array(start), 0, 1);
    Atomics.notify(new Int32Array(start), 0, 2);

    const results = await Promise.all([first.result, second.result]);

    expect(results).toEqual([revision, revision]);
    expect(new SqliteCountryKnowledgeStore(database, KEY).latest("SI")).toEqual(revision);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(1);
  });
});

interface PublishWorkerHandle {
  readonly ready: Promise<void>;
  readonly result: Promise<SloveniaCountryKnowledgeRevision>;
}

function publishWorker(input: {
  readonly path: string;
  readonly revision: SloveniaCountryKnowledgeRevision;
  readonly start: SharedArrayBuffer;
}): PublishWorkerHandle {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const { SqliteCountryKnowledgeStore } = await tsImport(
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
        const value = new SqliteCountryKnowledgeStore(database, workerData.key).publish(
          workerData.revision,
        );
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
      storeModule: pathToFileURL(resolve(
        "src/infrastructure/sqlite/country-knowledge-store.ts",
      )).href,
      parentModule: pathToFileURL(resolve(
        "tests/integration/country-knowledge.test.ts",
      )).href,
    },
  });
  let readyResolve!: () => void;
  let resultResolve!: (value: SloveniaCountryKnowledgeRevision) => void;
  let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolveReady) => { readyResolve = resolveReady; });
  const result = new Promise<SloveniaCountryKnowledgeRevision>((resolveResult, rejectResult) => {
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
    readonly value?: SloveniaCountryKnowledgeRevision;
    readonly message?: string;
  }) => {
    if (message.type === "ready") readyResolve();
    if (message.type === "result") resultResolve(message.value!);
    if (message.type === "error") reject(new Error(message.message ?? "worker_failed"));
  });
  worker.on("error", reject);
  return { ready, result };
}
