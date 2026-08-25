import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createConfirmedLife } from "../../src/application/confirmed-life";
import { createPresentRun } from "../../src/application/present-run";
import {
  projectDecisionEvidence,
  projectVerifiedBudgetFacts,
} from "../../src/application/verified-evidence";
import { assessRoute } from "../../src/decision/assessment";
import { confirmProfile } from "../../src/decision/profile";
import {
  createConfirmedLifeComposition,
} from "../../src/infrastructure/composition-root";
import { canonicalJson, createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";
import { SqliteRunStore } from "../../src/infrastructure/sqlite/run-store";
import type {
  CaptureResult,
  Claim,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParserEntry,
  EvidenceSnapshot,
  SourceId,
} from "../../src/research/contracts";
import type { VerifiedLoadExpectations } from "../../src/research/research-plan";
import {
  EVIDENCE_SOURCE_IDS,
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  runCurrentEvidence,
  sealEvidence,
  type EvidenceParsers,
  type TerminalEvidenceEntry,
} from "../../src/research/run";

const KEY = "confirmed-life-integration-key-at-least-32-bytes";
const NOW = new Date("2026-08-08T10:00:00.000Z");
const ASSESSMENT_DATE = "2026-08-08";
const DEADLINE_AT = "2026-08-08T10:00:45.000Z";

const databases: Database.Database[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
}

async function loadVerifiedDetails(
  store: SqliteEvidenceStore,
  id: string,
  expected?: VerifiedLoadExpectations,
) {
  const bundle = await store.loadVerifiedBundle(id, KEY, expected);
  return {
    snapshot: bundle.snapshot,
    sources: bundle.entries.map((entry) => ({
      sourceId: entry.sourceId,
      navigationUrl: entry.navigationUrl,
      resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
    })),
  };
}

function artifact(request: HttpStepRequest): LiveCapturedArtifact {
  const bytes = new TextEncoder().encode(`${request.sourceId}:${request.role}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${request.sourceId}:${request.role}:${sha256}`,
    runId: request.runId,
    sourceId: request.sourceId,
    role: request.role,
    url: request.url,
    mediaType: request.allowedMediaTypes[0]!,
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-08T10:00:01.000Z",
    responseStatus: 200,
    responseUrl: request.url,
    request: { method: request.method, url: request.url },
  };
}

function source(outageSource?: SourceId): OfficialSourcePort {
  return {
    async capture(request, requestStep): Promise<CaptureResult> {
      if (request.sourceId === outageSource) {
        return {
          ok: false,
          sourceId: request.sourceId,
          kind: "server_error",
          attempts: 1,
          partialArtifacts: [],
        };
      }
      const sourceArtifact = await requestStep({
        runId: request.runId,
        sourceId: request.sourceId,
        role: "official-document",
        method: "GET",
        url: `https://official.example/${request.sourceId}`,
        headers: { accept: "application/octet-stream" },
        allowedHosts: ["official.example"],
        allowedMediaTypes: ["application/octet-stream"],
      }, request.signal);
      return {
        ok: true,
        entry: {
          sourceId: request.sourceId,
          navigationUrl: `https://official.example/${request.sourceId}`,
          resolvedEvidenceUrl: sourceArtifact.responseUrl,
          artifacts: [sourceArtifact],
          versionHint: "integration-v1",
        },
      };
    },
  };
}

function parsers(unavailableSource?: SourceId): EvidenceParsers {
  return Object.fromEntries(EVIDENCE_SOURCE_IDS.map((sourceId) => [
    sourceId,
    async (entry: ParserEntry) => sourceId === unavailableSource
      ? { ok: false as const, kind: "semantic_mismatch" as const }
      : {
          ok: true as const,
          facts: { sourceId, accepted: true },
          sourcePeriod: ASSESSMENT_DATE,
          anchors: [{
            artifactId: entry.artifacts[0]!.artifactId,
            locator: `${sourceId} integration fixture`,
            excerptSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          }],
        },
  ])) as unknown as EvidenceParsers;
}

function typedFacts(sourceId: SourceId): unknown {
  switch (sourceId) {
    case "al-law-79":
      return {
        digitalWorker: {
          requiresLawfulStay: true,
          initialPermitMaxMonths: 12,
          contractTypes: ["foreign_employment", "foreign_service"],
          accommodation: true,
          insuranceMinMonths: 12,
          criminalRecords: "origin_and_residence",
        },
        family: {
          spouseIsFamilyMember: true,
          sponsorPermitMinMonths: 12,
          renewable: true,
          familyNormallyOutside: true,
          housingInsuranceStableIncome: true,
        },
      };
    case "al-decision-858":
      return {
        proof: "self_declaration",
        availableAmount: "408000",
        currency: "ALL",
        scope: "self_and_dependants",
        periodFormula: "not_stated",
        headcountFormula: "not_stated",
        generalRuleExceptionAnchored: true,
      };
    case "cbr-eur":
      return { base: "EUR", quote: "RUB", nominal: "1", rate: "93.1901", effectiveDate: ASSESSMENT_DATE };
    case "boa-eur":
      return { base: "EUR", quote: "ALL", rate: "93.13", effectiveDate: ASSESSMENT_DATE };
    case "tirana-urban-lines":
      return {
        municipalUrbanRoutesMapPublished: true,
        applicationTitle: "Transporti",
        layers: ["Linjat Qytetase", "Stacionet e Linjave Qytetase"],
        checkedAt: "2026-08-08T10:00:01.000Z",
      };
  }
}

function typedParsers(unavailableSource?: SourceId): EvidenceParsers {
  return Object.fromEntries(EVIDENCE_SOURCE_IDS.map((sourceId) => [
    sourceId,
    async (entry: ParserEntry) => sourceId === unavailableSource
      ? { ok: false as const, kind: "semantic_mismatch" as const }
      : ({
          ok: true as const,
          facts: typedFacts(sourceId),
          sourcePeriod: standardSourcePeriod(sourceId),
          anchors: Array.from({ length: expectedClaimCounts[sourceId] }, (_, index) => ({
            artifactId: entry.artifacts[0]!.artifactId,
            locator: standardLocator(sourceId, index),
            excerptSha256: String(index + 1).repeat(64),
          })),
        }),
  ])) as unknown as EvidenceParsers;
}

const expectedClaimCounts = {
  "al-law-79": 3,
  "al-decision-858": 2,
  "cbr-eur": 1,
  "boa-eur": 1,
  "tirana-urban-lines": 2,
} as const satisfies Record<SourceId, number>;

function standardSourcePeriod(sourceId: SourceId): string {
  return sourceId === "al-law-79" || sourceId === "al-decision-858"
    ? "cons-2026-08-01"
    : ASSESSMENT_DATE;
}

function standardLocator(sourceId: SourceId, index: number): string {
  const locators: Record<SourceId, readonly string[]> = {
    "al-law-79": ["Art. 68", "Art. 3(1)", "Art. 41"],
    "al-decision-858": ["Decision 858, amount", "Decision 858, p.8"],
    "cbr-eur": ["CBR rate"],
    "boa-eur": ["BoA rate"],
    "tirana-urban-lines": ["municipality page iframe", "visible WMS layers"],
  };
  return locators[sourceId][index]!;
}

type SealedClaimDefect =
  | "duplicate_law_anchor"
  | "case_variant_excerpt_hash"
  | "wrong_law_locator"
  | "tirana_period_mismatch"
  | "mixed_tirana_checked_at";

async function verifiedMixedSnapshot(
  mixedSource: SourceId,
  defect?: SealedClaimDefect,
): Promise<EvidenceSnapshot> {
  const db = database();
  const store = new SqliteEvidenceStore(db);
  const entries = EVIDENCE_SOURCE_IDS.map((sourceId): TerminalEvidenceEntry => {
    const sourceArtifact = artifact({
      runId: "projection-run",
      sourceId,
      role: "official-document",
      method: "GET",
      url: `https://official.example/${sourceId}`,
      headers: { accept: "application/octet-stream" },
      allowedHosts: ["official.example"],
      allowedMediaTypes: ["application/octet-stream"],
    });
    const count = expectedClaimCounts[sourceId];
    return {
      sourceId,
      parserEntry: {
        sourceId,
        navigationUrl: `https://official.example/${sourceId}`,
        resolvedEvidenceUrl: sourceArtifact.responseUrl,
        artifacts: [sourceArtifact],
      },
      coverage: "verified",
      claims: Array.from({ length: count }, (_, index) => {
        let anchor = {
          artifactId: sourceArtifact.artifactId,
          locator: standardLocator(sourceId, index),
          excerptSha256: String(index + 1).repeat(64),
        };
        if (sourceId === "al-law-79" && defect === "case_variant_excerpt_hash") {
          anchor = {
            ...anchor,
            excerptSha256:
              index === 0
                ? "a".repeat(64)
                : index === 1
                  ? "A".repeat(64)
                  : "b".repeat(64),
          };
        }
        if (sourceId === "al-law-79" && index === 2 && defect === "duplicate_law_anchor") {
          anchor = {
            artifactId: sourceArtifact.artifactId,
            locator: standardLocator(sourceId, 1),
            excerptSha256: String(2).repeat(64),
          };
        }
        if (sourceId === "al-law-79" && index === 2 && defect === "wrong_law_locator") {
          anchor = { ...anchor, locator: "Art. 42" };
        }
        const facts = typedFacts(sourceId);
        return {
          claimId: `${sourceId}-facts-${index + 1}`,
          sourceId,
          value: sourceId === mixedSource && index === count - 1
            ? { unexpected: true }
            : sourceId === "tirana-urban-lines" &&
                index === 1 &&
                defect === "mixed_tirana_checked_at"
              ? { ...(facts as Record<string, unknown>), checkedAt: "2026-08-08T11:00:01.000Z" }
              : facts,
          scope: "VS-1 confirmed-life",
          sourcePeriod: sourceId === "tirana-urban-lines" && defect === "tirana_period_mismatch"
            ? "2026-08-09"
            : standardSourcePeriod(sourceId),
          anchor,
          status: "verified" as const,
        };
      }),
    };
  });
  const sealed = await sealEvidence({
    id: "projection-run:evidence",
    assessmentDate: ASSESSMENT_DATE,
    entries,
    parserVersions: EVIDENCE_PARSER_VERSIONS,
    rulesVersion: EVIDENCE_RULES_VERSION,
  }, createEvidenceIntegrity(KEY));
  for (const entry of entries) {
    for (const sourceArtifact of entry.parserEntry.artifacts) {
      await store.appendArtifact(sourceArtifact as LiveCapturedArtifact);
    }
  }
  await store.seal(sealed);
  return store.loadVerified(sealed.snapshot.id, KEY);
}

type ClaimSetDefect =
  | "missing"
  | "extra"
  | "unexpected_id"
  | "mixed_value"
  | "mixed_scope"
  | "mixed_period"
  | "missing_artifact"
  | "empty_locator"
  | "bad_excerpt_hash";

function defectLawClaims(snapshot: EvidenceSnapshot, defect: ClaimSetDefect): EvidenceSnapshot {
  const lawClaims = snapshot.claims.filter((claim) => claim.sourceId === "al-law-79");
  const otherClaims = snapshot.claims.filter((claim) => claim.sourceId !== "al-law-79");
  if (defect === "missing") return { ...snapshot, claims: [...otherClaims, ...lawClaims.slice(0, -1)] };
  if (defect === "extra") {
    return {
      ...snapshot,
      claims: [...snapshot.claims, { ...lawClaims[0]!, claimId: "al-law-79-facts-4" }],
    };
  }
  const changed = lawClaims.map((claim, index): Claim<unknown> => {
    if (index !== lawClaims.length - 1) return claim;
    switch (defect) {
      case "unexpected_id":
        return { ...claim, claimId: "al-law-79-facts-99" };
      case "mixed_value":
        return { ...claim, value: { unexpected: true } };
      case "mixed_scope":
        return { ...claim, scope: "unexpected-scope" };
      case "mixed_period":
        return { ...claim, sourcePeriod: "cons-2026-08-02" };
      case "missing_artifact":
        return { ...claim, anchor: { ...claim.anchor, artifactId: "missing-artifact" } };
      case "empty_locator":
        return { ...claim, anchor: { ...claim.anchor, locator: "" } };
      case "bad_excerpt_hash":
        return { ...claim, anchor: { ...claim.anchor, excerptSha256: "not-a-hash" } };
    }
  });
  return { ...snapshot, claims: [...otherClaims, ...changed] };
}

const completeDraft = {
  availableResourcesAll: "408000.00",
  monthlyIncome: { amount: "210000", currency: "RUB" as const },
  incomeBasis: "foreign_contract" as const,
  companionBasis: "none" as const,
  relationship: "none" as const,
  conditions: {
    incomeContinues12Months: true,
    lawfulStayPrerequisiteAccepted: true,
    stagedSpouseRouteAccepted: false,
  },
};

function immutableRunRows(db: Database.Database, runId: string) {
  return {
    profile: db.prepare("SELECT * FROM profile_snapshots").all(),
    revision: db.prepare("SELECT * FROM run_revisions WHERE run_id = ?").all(runId),
    snapshot: db.prepare("SELECT * FROM evidence_snapshots WHERE id = ?").all(`${runId}:evidence`),
    artifacts: db.prepare(`
      SELECT run_id, artifact_id, source_id, role, url, media_type, sha256,
             hex(bytes) AS bytes_hex, byte_length, origin, captured_at,
             response_status, response_url, request_json, sealed
      FROM artifacts WHERE run_id = ? ORDER BY artifact_id
    `).all(runId),
  };
}

function testHarness(options: { readonly unavailableSource?: SourceId } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const db = database();
  const evidenceStore = new SqliteEvidenceStore(db);
  const profileStore = new SqliteProfileStore(db);
  const runStore = new SqliteRunStore(db, KEY);
  const ids = { run: 0, revision: 0, assessment: 0 };
  const state: {
    unavailableSource?: SourceId;
    historicalResult?: EvidenceSnapshot;
    researchCalls: number;
    assessmentCalls: number;
  } = {
    ...(options.unavailableSource === undefined ? {} : { unavailableSource: options.unavailableSource }),
    researchCalls: 0,
    assessmentCalls: 0,
  };
  const application = createConfirmedLife({
    profileStore,
    runStore,
    evidence: {
      loadVerified: (id, expected) => evidenceStore.loadVerified(id, KEY, expected),
      loadVerifiedDetails: (id, expected) => loadVerifiedDetails(evidenceStore, id, expected),
    },
    research: {
      runCurrentEvidence: async (input) => {
        state.researchCalls += 1;
        if (state.historicalResult !== undefined) return state.historicalResult;
        return runCurrentEvidence(input, {
          source: source(),
          requestStep: (request: HttpStepRequest) => Promise.resolve(artifact(request)),
          store: evidenceStore,
          integrity: createEvidenceIntegrity(KEY),
          parsers: typedParsers(state.unavailableSource),
        });
      },
    },
    assess: (profile, evidence, conditions) => {
      state.assessmentCalls += 1;
      return assessRoute(profile, evidence, conditions);
    },
    clock: () => NOW,
    nextId: (kind) => `${kind}-${++ids[kind]}`,
    deadlineAt: (now) => new Date(now.getTime() + 45_000),
  });
  return { application, db, evidenceStore, profileStore, runStore, state };
}

describe("confirmed-life orchestration", () => {
  test("production composition exposes the verified resolved-country City guard", () => {
    const application = createConfirmedLifeComposition({
      database: database(),
      hmacKey: KEY,
    });

    expect(application.requireResolvedCountryShortlistForCity).toBeTypeOf("function");
  });

  test("appends a confirmed profile, seals one current evidence run, assesses once, and appends one bound revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = database();
    const evidenceStore = new SqliteEvidenceStore(db);
    const realProfileStore = new SqliteProfileStore(db);
    const realRunStore = new SqliteRunStore(db, KEY);
    const events: string[] = [];
    const researchInputs: { runId: string; assessmentDate: string; deadlineAt: string }[] = [];
    let assessmentCalls = 0;

    const application = createConfirmedLife({
      profileStore: {
        append: async (snapshot) => {
          await realProfileStore.append(snapshot);
          events.push("profile-appended");
        },
        loadVerified: realProfileStore.loadVerified.bind(realProfileStore),
      },
      runStore: {
        appendAssessment: async (input) => {
          events.push("revision-appended");
          return realRunStore.appendAssessment(input);
        },
        loadAssessmentByRunId: realRunStore.loadAssessmentByRunId.bind(realRunStore),
      },
      evidence: {
        loadVerified: async (id, expected) => {
          const snapshot = await evidenceStore.loadVerified(id, KEY, expected);
          events.push("evidence-verified");
          return snapshot;
        },
        loadVerifiedDetails: (id, expected) => loadVerifiedDetails(evidenceStore, id, expected),
      },
      research: {
        runCurrentEvidence: async (input) => {
          researchInputs.push(input);
          const snapshot = await runCurrentEvidence(input, {
            source: source(),
            requestStep: (request: HttpStepRequest) => Promise.resolve(artifact(request)),
            store: evidenceStore,
            integrity: createEvidenceIntegrity(KEY),
            parsers: typedParsers(),
          });
          events.push("evidence-sealed");
          return snapshot;
        },
      },
      assess: (profile, evidence, conditions) => {
        assessmentCalls += 1;
        events.push("assessed");
        expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
        expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sealed = 1").get()).toEqual({ count: 5 });
        return assessRoute(profile, evidence, conditions);
      },
      clock: () => NOW,
      nextId: (kind) => `${kind}-1`,
      deadlineAt: (now) => new Date(now.getTime() + 45_000),
    });

    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000.00" },
    );

    expect(events).toEqual([
      "profile-appended",
      "evidence-sealed",
      "evidence-verified",
      "assessed",
      "revision-appended",
    ]);
    expect(researchInputs).toEqual([{
      runId: "run-1",
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: DEADLINE_AT,
    }]);
    expect(assessmentCalls).toBe(1);
    expect(result).toMatchObject({
      runId: "run-1",
      runRevisionId: "revision-1",
      assessmentDate: ASSESSMENT_DATE,
      evidenceSnapshotId: "run-1:evidence",
      assessment: { marker: "green" },
      mode: "current",
    });
    const profileRow = db.prepare("SELECT snapshot_json, snapshot_hash FROM profile_snapshots").get() as {
      snapshot_json: string;
      snapshot_hash: string;
    };
    expect(profileRow.snapshot_hash).toBe(createHash("sha256").update(profileRow.snapshot_json).digest("hex"));
    const record = await realRunStore.loadAssessmentByRunId("run-1");
    expect(record.revision).toMatchObject({
      id: "revision-1",
      runId: "run-1",
      stage: "assessment",
      assessmentDate: ASSESSMENT_DATE,
      initialHousing: { currency: "ALL", initialHousingAll: "70000" },
      profileId: result.profileId,
      evidenceSnapshotId: result.evidenceSnapshotId,
      assessmentId: result.assessmentId,
      rulesVersion: "vs1-assessment@2",
    });
    expect(record.assessment).toEqual(result.assessment);
  });

  test("returns terminal yellow and manual retry creates a new immutable live run while reusing exact profile and housing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = database();
    const evidenceStore = new SqliteEvidenceStore(db);
    const profileStore = new SqliteProfileStore(db);
    const runStore = new SqliteRunStore(db, KEY);
    let researchCalls = 0;
    let unavailableSource: SourceId | undefined = "al-law-79";
    const ids = { run: 0, revision: 0, assessment: 0 };
    const application = createConfirmedLife({
      profileStore,
      runStore,
      evidence: {
        loadVerified: (id, expected) => evidenceStore.loadVerified(id, KEY, expected),
        loadVerifiedDetails: (id, expected) => loadVerifiedDetails(evidenceStore, id, expected),
      },
      research: {
        runCurrentEvidence: async (input) => {
          researchCalls += 1;
          return runCurrentEvidence(input, {
            source: source(),
            requestStep: (request: HttpStepRequest) => Promise.resolve(artifact(request)),
            store: evidenceStore,
            integrity: createEvidenceIntegrity(KEY),
            parsers: typedParsers(unavailableSource),
          });
        },
      },
      assess: assessRoute,
      clock: () => NOW,
      nextId: (kind) => `${kind}-${++ids[kind]}`,
      deadlineAt: (now) => new Date(now.getTime() + 45_000),
    });

    const first = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );
    expect(first.assessment.marker).toBe("yellow");
    const firstRows = immutableRunRows(db, first.runId);

    unavailableSource = undefined;
    const second = await application.retryConfirmedLife(first.runId);

    expect(second).toMatchObject({
      runId: "run-2",
      evidenceSnapshotId: "run-2:evidence",
      profileId: first.profileId,
      assessment: { marker: "green" },
      mode: "current",
    });
    expect(researchCalls).toBe(2);
    expect(immutableRunRows(db, first.runId)).toEqual(firstRows);
    expect(db.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get()).toEqual({ count: 2 });
    expect((await runStore.loadAssessmentByRunId(second.runId)).revision.initialHousing).toEqual({
      currency: "ALL",
      initialHousingAll: "70000",
    });
    expect(db.prepare("SELECT DISTINCT run_id FROM artifacts ORDER BY run_id").all()).toEqual([
      { run_id: "run-1" },
      { run_id: "run-2" },
    ]);
  });

  test("strictly rejects untrusted profile and housing shapes before any append or Research call", async () => {
    const { application, db, state } = testHarness();
    const rejectedInputs: readonly [unknown, unknown][] = [
      [{ ...completeDraft, name: "Synthetic Person" }, { currency: "ALL", initialHousingAll: "70000" }],
      [{ ...completeDraft, id: "client-profile", confirmedAt: NOW.toISOString() }, { currency: "ALL", initialHousingAll: "70000" }],
      [completeDraft, { currency: "ALL" }],
      [completeDraft, { currency: "ALL", initialHousingAll: "0" }],
      [completeDraft, { currency: "ALL", initialHousingAll: "70000", snapshotId: "client-value" }],
    ];

    for (const [draft, housing] of rejectedInputs) {
      await expect(application.startConfirmedLife(draft, housing)).rejects.toThrow();
    }

    expect(state.researchCalls).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM profile_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get()).toEqual({ count: 0 });
  });

  test("does not let a historical sealed snapshot satisfy a retry's new current run", async () => {
    const { application, db, evidenceStore, state } = testHarness();
    const first = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );
    state.historicalResult = await evidenceStore.loadVerified(first.evidenceSnapshotId, KEY);

    await expect(application.retryConfirmedLife(first.runId)).rejects.toThrow("integrity_mismatch");

    expect(state.researchCalls).toBe(2);
    expect(state.assessmentCalls).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get()).toEqual({ count: 1 });
  });

  test.each([
    ["assessment date", "assessment_date", "2026-08-09"],
    ["housing", "initial_housing_json", canonicalJson({ currency: "ALL", initialHousingAll: "90000" })],
    ["profile reference", "profile_id", "tampered-profile"],
    ["evidence reference", "evidence_snapshot_id", "tampered-evidence"],
    ["assessment identifier", "assessment_id", "tampered-assessment"],
    ["rules version", "rules_version", "tampered-rules"],
  ] as const)("rejects %s tampering even when stored representation is changed with it", async (_label, column, changed) => {
    const { application, db, runStore } = testHarness();
    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );
    const row = db.prepare("SELECT revision_json FROM run_revisions WHERE run_id = ?").get(result.runId) as {
      revision_json: string;
    };
    const revision = JSON.parse(row.revision_json) as Record<string, unknown>;
    const property = {
      assessment_date: "assessmentDate",
      initial_housing_json: "initialHousing",
      profile_id: "profileId",
      evidence_snapshot_id: "evidenceSnapshotId",
      assessment_id: "assessmentId",
      rules_version: "rulesVersion",
    }[column];
    revision[property] = column === "initial_housing_json" ? JSON.parse(changed) : changed;
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.pragma("foreign_keys = OFF");
    db.prepare(`UPDATE run_revisions SET ${column} = ?, revision_json = ? WHERE run_id = ?`).run(
      changed,
      canonicalJson(revision),
      result.runId,
    );

    await expect(runStore.loadAssessmentByRunId(result.runId)).rejects.toThrow("integrity_mismatch");
  });

  test("rejects HMAC tampering and SQL update/delete of sealed profiles and revisions", async () => {
    const { application, db, runStore } = testHarness();
    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );

    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all()).toEqual([
      { name: "artifacts" },
      { name: "branch_commits" },
      { name: "city_branch_commits" },
      { name: "city_catalog_revisions" },
      { name: "city_criteria_snapshots" },
      { name: "city_evidence_snapshots" },
      { name: "city_frontier_revisions" },
      { name: "city_knowledge_revisions" },
      { name: "city_ranking_snapshots" },
      { name: "city_selection_snapshots" },
      { name: "country_knowledge_revisions" },
      { name: "country_resolution_revisions" },
      { name: "dossier_versions" },
      { name: "dossier_versions_v2" },
      { name: "evidence_snapshots" },
      { name: "installed_city_package_heads" },
      { name: "installed_city_package_manifests" },
      { name: "onboarding_confirmations" },
      { name: "place_frontier_snapshots" },
      { name: "profile_snapshots" },
      { name: "run_revisions" },
    ]);

    expect(() => db.prepare("UPDATE profile_snapshots SET confirmed_at = confirmed_at WHERE id = ?").run(result.profileId)).toThrow("profile_snapshot_is_immutable");
    expect(() => db.prepare("DELETE FROM profile_snapshots WHERE id = ?").run(result.profileId)).toThrow("profile_snapshot_is_immutable");
    expect(() => db.prepare("UPDATE run_revisions SET hmac = hmac WHERE run_id = ?").run(result.runId)).toThrow("run_revision_is_immutable");
    expect(() => db.prepare("DELETE FROM run_revisions WHERE run_id = ?").run(result.runId)).toThrow("run_revision_is_immutable");

    db.exec("DROP TRIGGER run_revisions_no_update");
    db.prepare("UPDATE run_revisions SET hmac = ? WHERE run_id = ?").run("0".repeat(64), result.runId);
    await expect(runStore.loadAssessmentByRunId(result.runId)).rejects.toThrow("integrity_mismatch");
  });

  test("binds the complete stored assessment representation through the revision HMAC", async () => {
    const { application, db, runStore } = testHarness();
    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.prepare("UPDATE run_revisions SET assessment_json = ? WHERE run_id = ?").run(
      canonicalJson({ marker: "yellow", reasons: [] }),
      result.runId,
    );

    await expect(runStore.loadAssessmentByRunId(result.runId)).rejects.toThrow("integrity_mismatch");
  });

  test("rejects a second assessment-stage revision for the same run at write time", async () => {
    const { application, runStore } = testHarness();
    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );
    const first = await runStore.loadAssessmentByRunId(result.runId);

    await expect(runStore.appendAssessment({
      id: "revision-duplicate",
      runId: first.revision.runId,
      stage: "assessment",
      assessmentDate: first.revision.assessmentDate,
      initialHousing: first.revision.initialHousing,
      profileId: first.revision.profileId,
      evidenceSnapshotId: first.revision.evidenceSnapshotId,
      assessmentId: "assessment-duplicate",
      rulesVersion: first.revision.rulesVersion,
      assessment: first.assessment,
    })).rejects.toThrow(/UNIQUE constraint failed/);
  });

  test("loads only redacted profile, verified fact lineage, and blocker official links", async () => {
    const { application } = testHarness({ unavailableSource: "al-law-79" });
    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );

    const details = await application.loadRunDetailsCore(result.runId);

    expect(details.run).toEqual(result);
    expect(details.profile).toMatchObject({
      id: result.profileId,
      profile: { ...completeDraft, availableResourcesAll: "408000" },
    });
    expect(details.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "official_fact",
        integrity: "verified",
        sourcePeriod: ASSESSMENT_DATE,
        resolvedUrl: expect.stringMatching(/^https:\/\/official\.example\//),
      }),
      expect.objectContaining({
        class: "unknown",
        provenance: "source_unavailable",
        sourceId: "al-law-79",
        blockerKind: "semantic_mismatch",
        navigationUrl: "https://official.example/al-law-79",
      }),
      expect.objectContaining({ class: "assumption", displayValue: "70000 ALL" }),
      expect.objectContaining({
        class: "user_fact",
        label: "Income continues 12 months",
        displayValue: "confirmed",
      }),
      expect.objectContaining({
        class: "assumption",
        label: "Lawful-stay prerequisite accepted",
        displayValue: "accepted",
      }),
    ]));
    expect(JSON.stringify(details)).not.toContain(KEY);
    expect(JSON.stringify(details)).not.toMatch(/"(?:bytes|hmac)"/);
    expect(JSON.stringify(details)).not.toMatch(/name|passport/i);
    expect(details.evidenceItems.some((item) => item.class === "projection")).toBe(false);
  });

  test("keeps sealed but semantically rejected claims out of Passport and deterministic narrative", async () => {
    const snapshot = await verifiedMixedSnapshot("al-law-79");
    const profile = confirmProfile(completeDraft, () => NOW);
    const revision = Object.freeze({
      id: "projection-revision",
      runId: "projection-run",
      stage: "assessment" as const,
      assessmentDate: ASSESSMENT_DATE,
      initialHousing: Object.freeze({ currency: "ALL" as const, initialHousingAll: "70000" }),
      profileId: profile.id,
      evidenceSnapshotId: snapshot.id,
      assessmentId: "projection-assessment",
      rulesVersion: "vs1-assessment@1",
      hmac: "trusted-port-fixture",
    });
    const application = createConfirmedLife({
      profileStore: {
        append: async () => undefined,
        loadVerified: async () => profile,
      },
      runStore: {
        appendAssessment: async () => ({
          revision,
          assessment: { marker: "yellow" as const, reasons: [] },
        }),
        loadAssessmentByRunId: async () => ({
          revision,
          assessment: { marker: "yellow" as const, reasons: [] },
        }),
      },
      evidence: {
        loadVerified: async () => snapshot,
        loadVerifiedDetails: async () => ({
          snapshot,
          sources: EVIDENCE_SOURCE_IDS.map((sourceId) => ({
            sourceId,
            navigationUrl: `https://official.example/${sourceId}`,
            resolvedEvidenceUrl: `https://official.example/${sourceId}`,
          })),
        }),
      },
      research: { runCurrentEvidence: async () => snapshot },
      assess: () => ({ marker: "yellow", reasons: [] }),
      clock: () => NOW,
      nextId: (kind) => `${kind}-unused`,
      deadlineAt: (now) => new Date(now.getTime() + 45_000),
    });

    const core = await application.loadRunDetailsCore("projection-run");
    const details = await createPresentRun({ loadRunDetailsCore: async () => core })("projection-run");

    expect(core.evidenceItems.some((item) =>
      item.class === "official_fact" && item.sourceId === "al-law-79"
    )).toBe(false);
    expect(core.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "unknown",
        provenance: "source_unavailable",
        sourceId: "al-law-79",
        blockerKind: "semantic_mismatch",
      }),
    ]));
    expect(details.narrative).toEqual({
      headline: "Маршрут показан в границах официальных источников",
      bullets: [
        "Официальные факты отделены от пользовательских данных и допущений.",
        "Неизвестные условия остаются отмеченными в паспорте доказательств.",
      ],
    });
  });

  test("adds a staged companion projection only for a confirmed spouse route", async () => {
    const { application } = testHarness();
    const result = await application.startConfirmedLife(
      {
        ...completeDraft,
        companionBasis: "family",
        relationship: "spouse",
        conditions: { ...completeDraft.conditions, stagedSpouseRouteAccepted: true },
      },
      { currency: "ALL", initialHousingAll: "70000" },
    );

    const details = await application.loadRunDetailsCore(result.runId);

    expect(details.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        class: "projection",
        label: "Staged companion route",
        displayValue: "family:spouse:accepted",
        provenance: "scenario",
      }),
    ]));
  });

  test("composition does not promote covered but semantically wrong source claims into a verdict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = database();
    let sourceCaptures = 0;
    const composedSource: OfficialSourcePort = {
      async capture(request, requestStep) {
        sourceCaptures += 1;
        return source().capture(request, requestStep);
      },
    };
    const application = createConfirmedLifeComposition({
      database: db,
      hmacKey: KEY,
      source: composedSource,
      requestStep: (request) => Promise.resolve(artifact(request)),
      parsers: parsers(),
      clock: () => NOW,
      nextId: (kind) => `${kind}-composed`,
      deadlineAt: (now) => new Date(now.getTime() + 45_000),
    });

    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );

    expect(result.assessment.marker).toBe("yellow");
    expect(sourceCaptures).toBe(5);
    expect(db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get()).toEqual({ count: 1 });
  });

  test.each(["cbr-eur", "boa-eur"] as const)(
    "keeps a critical %s source outage terminal yellow and refuses C0",
    async (sourceId) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const ids = { run: 0, revision: 0, assessment: 0 };
      const application = createConfirmedLifeComposition({
        database: database(),
        hmacKey: KEY,
        source: source(sourceId),
        requestStep: (request) => Promise.resolve(artifact(request)),
        parsers: typedParsers(),
        clock: () => NOW,
        nextId: (kind) => `${kind}-${sourceId}-${++ids[kind]}`,
        deadlineAt: (now) => new Date(now.getTime() + 45_000),
      });

      const result = await application.startConfirmedLife(
        completeDraft,
        { currency: "ALL", initialHousingAll: "70000" },
      );

      expect(result.assessment).toMatchObject({
        marker: "yellow",
        reasons: [{ sourceId, blockerKind: "server_error" }],
      });
      await expect(application.saveInitialHousingBranch(result.runId))
        .rejects.toThrow("branch_requires_green_assessment");
    },
  );

  test("binds declined scenario conditions into a yellow run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const application = testHarness().application;
    const result = await application.startConfirmedLife({
      ...completeDraft,
      conditions: { ...completeDraft.conditions, incomeContinues12Months: false },
    }, { currency: "ALL", initialHousingAll: "70000" });

    expect(result.assessment).toMatchObject({
      marker: "yellow",
      reasons: [{ code: "income_continuation_not_confirmed" }],
    });
    expect(result.assessment.reasons[0]).not.toHaveProperty("sourceId");
  });

  test("composition saves and fully replays exact typed sealed assessment and budget offline without appends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const db = database();
    let sourceCaptures = 0;
    const composedSource: OfficialSourcePort = {
      async capture(request, requestStep) {
        sourceCaptures += 1;
        return source().capture(request, requestStep);
      },
    };
    const ids = { run: 0, revision: 0, assessment: 0 };
    const application = createConfirmedLifeComposition({
      database: db,
      hmacKey: KEY,
      source: composedSource,
      requestStep: (request) => Promise.resolve(artifact(request)),
      parsers: typedParsers(),
      clock: () => NOW,
      nextId: (kind) => `${kind}-typed-${++ids[kind]}`,
      deadlineAt: (now) => new Date(now.getTime() + 45_000),
    });

    const result = await application.startConfirmedLife(
      completeDraft,
      { currency: "ALL", initialHousingAll: "70000" },
    );

    expect(result).toMatchObject({
      assessmentId: "assessment-typed-1",
      assessment: { marker: "green" },
    });
    const branch = await application.saveInitialHousingBranch(result.runId);
    const presented = await application.presentRun(result.runId);
    expect(presented.evidenceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ class: "unknown", provenance: "unmodelled", label: "Налоги" }),
      expect.objectContaining({ class: "unknown", provenance: "unmodelled", label: "Стоимость жизни" }),
    ]));
    const beforeReplay = {
      artifacts: db.prepare("SELECT COUNT(*) AS count FROM artifacts").get(),
      snapshots: db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get(),
      revisions: db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get(),
      commits: db.prepare("SELECT COUNT(*) AS count FROM branch_commits").get(),
    };

    const historical = await application.replayRun(result.runId);

    expect(historical).toMatchObject({
      runId: result.runId,
      runRevisionId: branch.revision.id,
      branchCommitId: branch.commit.id,
      assessment: { marker: "green" },
      budget: { incomeAll: "209864.57", housingAll: "70000.00", knownResidualAll: "139864.57" },
      mode: "historical",
    });
    expect(sourceCaptures).toBe(5);
    expect({
      artifacts: db.prepare("SELECT COUNT(*) AS count FROM artifacts").get(),
      snapshots: db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get(),
      revisions: db.prepare("SELECT COUNT(*) AS count FROM run_revisions").get(),
      commits: db.prepare("SELECT COUNT(*) AS count FROM branch_commits").get(),
    }).toEqual(beforeReplay);

    db.exec("DROP TRIGGER artifacts_no_update");
    db.prepare("UPDATE artifacts SET bytes = ? WHERE source_id = 'cbr-eur'").run(Uint8Array.of(0));
    await expect(application.replayRun(result.runId)).rejects.toThrow("integrity_mismatch");
    expect(sourceCaptures).toBe(5);
  });

  test.each([
    ["al-law-79", "foreignContractVerified"],
    ["al-decision-858", "availableResourcesVerified"],
    ["tirana-urban-lines", "tirana"],
  ] as const)("rejects a sealed mixed %s claim set", async (sourceId, field) => {
    const snapshot = await verifiedMixedSnapshot(sourceId);
    const projected = projectDecisionEvidence(snapshot);

    const status = field === "tirana"
      ? projected.claims["al-tirana-residence"]?.status
      : projected[field];
    expect(status).toBe("invalid");

    if (sourceId === "al-law-79") {
      const hardMismatchProfile = confirmProfile(
        { ...completeDraft, incomeBasis: "albanian_employer_only" },
        () => NOW,
      );
      expect(assessRoute(hardMismatchProfile, projected, { housingProvided: true }).marker).toBe("yellow");
    }
  });

  test("rejects a sealed CBR/BoA projection unless exact typed rate claims are present", async () => {
    const mixedCbr = await verifiedMixedSnapshot("cbr-eur");
    const mixedBoa = await verifiedMixedSnapshot("boa-eur");

    expect(() => projectVerifiedBudgetFacts(mixedCbr)).toThrow("integrity_mismatch");
    expect(() => projectVerifiedBudgetFacts(mixedBoa)).toThrow("integrity_mismatch");
  });

  test.each([
    "missing",
    "extra",
    "unexpected_id",
    "mixed_value",
    "mixed_scope",
    "mixed_period",
    "missing_artifact",
    "empty_locator",
    "bad_excerpt_hash",
  ] as const)("rejects a %s claim-set defect defensively", async (defect) => {
    const verified = await verifiedMixedSnapshot("cbr-eur");

    expect(projectDecisionEvidence(defectLawClaims(verified, defect)).foreignContractVerified).toBe("invalid");
  });

  test.each([
    ["duplicate_law_anchor", "foreignContractVerified"],
    ["case_variant_excerpt_hash", "foreignContractVerified"],
    ["wrong_law_locator", "foreignContractVerified"],
    ["tirana_period_mismatch", "tirana"],
    ["mixed_tirana_checked_at", "tirana"],
  ] as const)("rejects a sealed %s defect", async (defect, field) => {
    const snapshot = await verifiedMixedSnapshot("cbr-eur", defect);
    const projected = projectDecisionEvidence(snapshot);
    const status = field === "tirana"
      ? projected.claims["al-tirana-residence"]?.status
      : projected.foreignContractVerified;

    expect(status).toBe("invalid");
    expect(assessRoute(
      confirmProfile(completeDraft, () => NOW),
      projected,
      { housingProvided: true },
    ).marker).toBe("yellow");
  });
});
