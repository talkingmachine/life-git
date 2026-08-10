import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { createHousingBranchApplication } from "../../src/application/fork-housing";
import { createReplayApplication } from "../../src/application/replay";
import { confirmHousingDecision } from "../../src/branch/housing";
import { createCommit, diffCommits, forkHousingCommit, rewindTo } from "../../src/branch/life-git";
import { confirmProfile } from "../../src/decision/profile";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { canonicalJson, hmacSha256 } from "../../src/infrastructure/integrity";
import { SqliteBranchStore } from "../../src/infrastructure/sqlite/branch-store";
import { SqliteHousingBranchWriter } from "../../src/infrastructure/sqlite/housing-branch-writer";
import { SqliteProfileStore } from "../../src/infrastructure/sqlite/profile-store";
import { SqliteRunStore } from "../../src/infrastructure/sqlite/run-store";
import type { Assessment, Evidence, EvidenceSnapshot } from "../../src/research/contracts";

const KEY = "branch-test-hmac-key";
const databases: Database.Database[] = [];
const malformedBranchHashes = [
  ["formulaHash", "a".repeat(63)],
  ["formulaHash", "a".repeat(65)],
  ["formulaHash", `${"a".repeat(63)}g`],
  ["outputHash", "b".repeat(63)],
  ["outputHash", "b".repeat(65)],
  ["outputHash", `${"b".repeat(63)}g`],
] as const;

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const db = openEvidenceDatabase(":memory:");
  databases.push(db);
  db.prepare(`
    INSERT INTO evidence_snapshots (
      id, assessment_date, snapshot_json, manifest_json, manifest_hash, hmac,
      parser_versions_json, rules_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("evidence-1", "2026-08-07", "{}", "{}", "0".repeat(64), "0".repeat(64), "{}", "evidence-rules@1");
  return db;
}

function draft(monthlyIncome = "210000") {
  return {
    availableResourcesAll: "408000",
    monthlyIncome: { amount: monthlyIncome, currency: "RUB" as const },
    incomeBasis: "foreign_contract" as const,
    companionBasis: "none" as const,
    relationship: "none" as const,
    conditions: {
      incomeContinues12Months: true,
      lawfulStayPrerequisiteAccepted: true,
      stagedSpouseRouteAccepted: false,
    },
  };
}

const budgetFacts = {
  loadVerifiedBudgetFacts: async () => ({
    cbrRate: {
      sourceId: "cbr-eur" as const,
      rate: "93.1901",
      base: "EUR" as const,
      quote: "RUB" as const,
      claimId: "cbr-eur-facts-1",
      sourcePeriod: "2026-08-06",
      ref: "cbr-artifact#rate",
    },
    boaRate: {
      sourceId: "boa-eur" as const,
      rate: "93.13",
      base: "EUR" as const,
      quote: "ALL" as const,
      claimId: "boa-eur-facts-1",
      sourcePeriod: "2026-08-05",
      ref: "boa-artifact#rate",
    },
  }),
};

async function setup(
  marker: Assessment["marker"] = "green",
  monthlyIncome = "210000",
  revisionIds?: readonly string[],
  rulesVersion = "vs1-assessment@1",
) {
  const db = database();
  const profileStore = new SqliteProfileStore(db);
  const runStore = new SqliteRunStore(db, KEY);
  const branchStore = new SqliteBranchStore(db, KEY);
  const housingBranchAppend = new SqliteHousingBranchWriter(db, branchStore, runStore);
  const profile = confirmProfile(draft(monthlyIncome), () => new Date("2026-08-07T10:00:00.000Z"));
  await profileStore.append(profile);
  const assessment: Assessment = { marker, reasons: [] };
  const record = await runStore.appendAssessment({
    id: "assessment-revision-1",
    runId: "run-1",
    stage: "assessment",
    assessmentDate: "2026-08-07",
    initialHousing: confirmHousingDecision({ currency: "ALL", initialHousingAll: "70000" }),
    profileId: profile.id,
    evidenceSnapshotId: "evidence-1",
    assessmentId: "assessment-1",
    rulesVersion,
    assessment,
  });
  let revisionSequence = 0;
  const application = createHousingBranchApplication({
    profileStore,
    runStore,
    branchStore,
    housingBranchAppend,
    budgetFacts,
    nextRevisionId: () => revisionIds === undefined
      ? `branch-revision-${++revisionSequence}`
      : revisionIds[revisionSequence++]!,
  });
  return { db, profile, assessmentRevision: record.revision, profileStore, runStore, branchStore, application };
}

function historicalEvidence(): EvidenceSnapshot {
  return {
    id: "evidence-1",
    assessmentDate: "2026-08-07",
    artifactIds: [],
    claims: [],
    blockers: [],
    coverage: {
      "al-law-79": "verified",
      "al-decision-858": "verified",
      "cbr-eur": "verified",
      "boa-eur": "verified",
      "tirana-urban-lines": "verified",
    },
    parserVersions: {
      "al-law-79": "law@1",
      "al-decision-858": "decision@1",
      "cbr-eur": "cbr@1",
      "boa-eur": "boa@1",
      "tirana-urban-lines": "tirana@1",
    },
    rulesVersion: "evidence-rules@1",
    manifestHash: "a".repeat(64),
    hmac: "b".repeat(64),
  };
}

const verifiedDecisionEvidence: Evidence = {
  claims: {
    "al-law-79-art-68-contract": { source: "official", status: "verified" },
    "al-law-79-art-68-spouse": { source: "official", status: "verified" },
    "al-tirana-residence": { source: "official", status: "verified" },
  },
  foreignContractVerified: "verified",
  availableResourcesVerified: "verified",
  lawfulStayVerified: "verified",
  stagedFamilyPlanVerified: "verified",
  cbrRateVerified: "verified",
  boaRateVerified: "verified",
  sourceBlockers: {},
};

function writeCounts(db: Database.Database) {
  return {
    commits: (db.prepare("SELECT COUNT(*) AS count FROM branch_commits").get() as { count: number }).count,
    revisions: (db.prepare("SELECT COUNT(*) AS count FROM run_revisions WHERE stage = 'branch'").get() as { count: number }).count,
  };
}

describe("Life Git housing branch", () => {
  test("rolls back C0 when its branch revision ID conflicts and permits an exact retry", async () => {
    const { application, db } = await setup(
      "green",
      "210000",
      ["assessment-revision-1", "branch-revision-retry"],
    );

    await expect(application.saveInitialHousingBranch("run-1")).rejects.toThrow(/UNIQUE constraint failed/);
    expect(writeCounts(db)).toEqual({ commits: 0, revisions: 0 });

    const retried = await application.saveInitialHousingBranch("run-1");
    expect(retried.revision.id).toBe("branch-revision-retry");
    expect(writeCounts(db)).toEqual({ commits: 1, revisions: 1 });
  });

  test("rolls back C1 when its branch revision ID conflicts and permits an exact retry", async () => {
    const { application, db } = await setup(
      "green",
      "210000",
      ["branch-revision-initial", "branch-revision-initial", "branch-revision-retry"],
    );
    const initial = await application.saveInitialHousingBranch("run-1");
    const cursor = rewindTo(initial.commit);

    await expect(application.forkHousing(
      cursor,
      { currency: "ALL", initialHousingAll: "90000" },
    )).rejects.toThrow(/UNIQUE constraint failed/);
    expect(writeCounts(db)).toEqual({ commits: 1, revisions: 1 });

    const retried = await application.forkHousing(
      cursor,
      { currency: "ALL", initialHousingAll: "90000" },
    );
    expect(retried.revision.id).toBe("branch-revision-retry");
    expect(writeCounts(db)).toEqual({ commits: 2, revisions: 2 });
  });

  test("C0 uses HMAC-verified assessment housing and stored profile RUB income", async () => {
    const { application, profile, assessmentRevision } = await setup("green", "310000");

    const result = await application.saveInitialHousingBranch("run-1");

    expect(result.commit.decision.initialHousingAll).toBe("70000");
    expect(result.commit.calculation.incomeAll).toBe("309800.08");
    expect(result.commit.calculation.inputs[0]).toEqual({
      binding: "income_RUB",
      value: "310000",
      unit: "RUB/month",
      provenance: "profile",
      ref: profile.id,
    });
    expect(result.revision).toMatchObject({
      stage: "branch",
      parentRevisionId: assessmentRevision.id,
      branchCommitId: result.commit.id,
      formulaHash: result.commit.formulaHash,
      outputHash: result.commit.outputHash,
    });
  });

  test.each(["yellow", "red"] as const)("rejects a %s assessment with zero branch writes", async (marker) => {
    const { application, db } = await setup(marker);

    await expect(application.saveInitialHousingBranch("run-1")).rejects.toThrow("branch_requires_green_assessment");
    expect(writeCounts(db)).toEqual({ commits: 0, revisions: 0 });
  });

  test("rewind preserves C0 and a 90000 fork creates immutable C1 with a housing-only causal diff", async () => {
    const { application, branchStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const cursor = rewindTo(initial.commit);

    const forked = await application.forkHousing(cursor, { currency: "ALL", initialHousingAll: "90000" });

    expect(cursor).toEqual({ commitId: initial.commit.id });
    expect(forked.commit).toMatchObject({ parentId: initial.commit.id, forkedFrom: initial.commit.id });
    expect(await branchStore.loadVerified(initial.commit.id)).toEqual(initial.commit);
    expect(diffCommits(initial.commit, forked.commit)).toEqual({
      housing: { before: "70000.00", after: "90000.00", delta: "20000.00" },
      knownResidual: { before: "139864.57", after: "119864.57", delta: "-20000.00", cause: "housing" },
      reused: ["profile", "evidence", "rules"],
    });
    expect(forked.revision.parentRevisionId).toBe(initial.revision.id);
    expect(writeCounts(db)).toEqual({ commits: 2, revisions: 2 });
    expect(() => db.prepare("UPDATE branch_commits SET commit_json = commit_json WHERE id = ?").run(initial.commit.id)).toThrow("branch_commit_is_immutable");
    expect(() => db.prepare("DELETE FROM branch_commits WHERE id = ?").run(initial.commit.id)).toThrow("branch_commit_is_immutable");
  });

  test("deep-freezes nested calculation state for both created and verified loaded commits", async () => {
    const { application, branchStore } = await setup();
    const created = (await application.saveInitialHousingBranch("run-1")).commit;
    const loaded = await branchStore.loadVerified(created.id);

    for (const commit of [created, loaded]) {
      expect(Object.isFrozen(commit)).toBe(true);
      expect(Object.isFrozen(commit.calculationInput)).toBe(true);
      expect(Object.isFrozen(commit.calculationInput.cbrRate)).toBe(true);
      expect(Object.isFrozen(commit.calculation.inputs[0])).toBe(true);
      expect(() => {
        (commit.calculationInput.cbrRate as { rate: string }).rate = "1";
      }).toThrow();
      expect(commit.calculationInput.cbrRate.rate).toBe("93.1901");
    }
  });

  test.each(["root", "nested"] as const)("rejects an extra %s BudgetInput field before it can fake a housing-only diff", async (location) => {
    const { application } = await setup();
    const initial = (await application.saveInitialHousingBranch("run-1")).commit;
    const decision = { currency: "ALL" as const, initialHousingAll: "90000" };
    const calculationInput = location === "root"
      ? { ...initial.calculationInput, housing: decision, shadowRate: "1" }
      : {
          ...initial.calculationInput,
          housing: decision,
          cbrRate: { ...initial.calculationInput.cbrRate, shadowRate: "1" },
        };

    expect(() => createCommit({
      parentId: initial.id,
      forkedFrom: initial.id,
      profileId: initial.profileId,
      evidenceSnapshotId: initial.evidenceSnapshotId,
      assessmentId: initial.assessmentId,
      rulesVersion: initial.rulesVersion,
      decision,
      calculationInput,
    })).toThrow("invalid_budget_input");
  });

  test("rejects forged cursors and commit tampering before a fork", async () => {
    const { application, branchStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    await expect(application.forkHousing({ commitId: "forged" }, { currency: "ALL", initialHousingAll: "90000" })).rejects.toThrow("branch_commit_not_found");

    db.exec("DROP TRIGGER branch_commits_no_update");
    db.prepare("UPDATE branch_commits SET commit_hash = ? WHERE id = ?").run("0".repeat(64), initial.commit.id);
    await expect(branchStore.loadVerified(initial.commit.id)).rejects.toThrow("integrity_mismatch");
    await expect(application.forkHousing({ commitId: initial.commit.id }, { currency: "ALL", initialHousingAll: "90000" })).rejects.toThrow("integrity_mismatch");
    expect(writeCounts(db)).toEqual({ commits: 1, revisions: 1 });
  });

  test("rejects a branch HMAC with a 65th alias nibble", async () => {
    const { application, branchStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const row = db.prepare("SELECT hmac FROM branch_commits WHERE id = ?").get(initial.commit.id) as {
      hmac: string;
    };
    db.exec("DROP TRIGGER branch_commits_no_update");
    db.prepare("UPDATE branch_commits SET hmac = ? WHERE id = ?").run(
      `${row.hmac}f`,
      initial.commit.id,
    );

    await expect(branchStore.loadVerified(initial.commit.id)).rejects.toThrow("integrity_mismatch");
  });

  test.each(["rate", "ref", "period"] as const)("refuses to label evidence reused when a %s changes behind the same IDs", async (changed) => {
    const { application } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const cbrRate = {
      ...initial.commit.calculationInput.cbrRate,
      ...(changed === "rate" ? { rate: "94.1901" } : {}),
      ...(changed === "ref" ? { ref: "different-artifact#rate" } : {}),
      ...(changed === "period" ? { sourcePeriod: "2026-08-04" } : {}),
    };
    const forged = createCommit({
      parentId: initial.commit.id,
      forkedFrom: initial.commit.id,
      profileId: initial.commit.profileId,
      evidenceSnapshotId: initial.commit.evidenceSnapshotId,
      assessmentId: initial.commit.assessmentId,
      rulesVersion: initial.commit.rulesVersion,
      decision: { currency: "ALL", initialHousingAll: "90000" },
      calculationInput: {
        ...initial.commit.calculationInput,
        cbrRate,
        housing: { currency: "ALL", initialHousingAll: "90000" },
      },
    });

    expect(() => diffCommits(initial.commit, forged)).toThrow("invalid_housing_fork");
  });

  test("schema contains exactly the five VS-1 append-only tables", () => {
    const db = database();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all();

    expect(tables).toEqual([
      { name: "artifacts" },
      { name: "branch_commits" },
      { name: "evidence_snapshots" },
      { name: "profile_snapshots" },
      { name: "run_revisions" },
    ]);
  });

  test("schema rejects mixed assessment/branch shapes and orphan branch commit references", async () => {
    const { application, runStore, db } = await setup();
    db.exec("DROP TRIGGER run_revisions_no_update");
    expect(() => db.prepare(`
      UPDATE run_revisions SET formula_hash = ? WHERE stage = 'assessment'
    `).run("0".repeat(64))).toThrow(/CHECK constraint failed/);

    const initial = await application.saveInitialHousingBranch("run-1");
    expect(() => db.prepare(`
      UPDATE run_revisions SET formula_hash = NULL WHERE id = ?
    `).run(initial.revision.id)).toThrow(/CHECK constraint failed/);

    expect(() => runStore.appendBranch({
      id: "orphan-branch-revision",
      runId: "run-1",
      stage: "branch",
      assessmentDate: "2026-08-07",
      parentRevisionId: "assessment-revision-1",
      profileId: initial.commit.profileId,
      evidenceSnapshotId: initial.commit.evidenceSnapshotId,
      assessmentId: initial.commit.assessmentId,
      rulesVersion: initial.commit.rulesVersion,
      branchCommitId: "missing-branch-commit",
      formulaHash: initial.commit.formulaHash,
      outputHash: initial.commit.outputHash,
    })).toThrow(/FOREIGN KEY constraint failed/);
  });

  test.each(malformedBranchHashes)("appendBranch rejects malformed %s value %s", async (property, malformed) => {
    const { application, branchStore, runStore } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const pendingCommit = forkHousingCommit(
      initial.commit,
      { currency: "ALL", initialHousingAll: "90000" },
    );
    branchStore.append(pendingCommit);

    expect(() => runStore.appendBranch({
      id: `malformed-${property}-${malformed.length}`,
      runId: "run-1",
      stage: "branch",
      assessmentDate: "2026-08-07",
      parentRevisionId: initial.revision.id,
      profileId: pendingCommit.profileId,
      evidenceSnapshotId: pendingCommit.evidenceSnapshotId,
      assessmentId: pendingCommit.assessmentId,
      rulesVersion: pendingCommit.rulesVersion,
      branchCommitId: pendingCommit.id,
      formulaHash: pendingCommit.formulaHash,
      outputHash: pendingCommit.outputHash,
      [property]: malformed,
    })).toThrow("integrity_mismatch");
  });

  test.each(malformedBranchHashes)("branch loader rejects HMAC-valid malformed %s value %s", async (property, malformed) => {
    const { application, runStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const row = db.prepare("SELECT revision_json FROM run_revisions WHERE id = ?").get(
      initial.revision.id,
    ) as { revision_json: string };
    const changed = JSON.parse(row.revision_json) as Record<string, unknown>;
    changed[property] = malformed;
    const unsigned = { ...changed };
    delete unsigned.hmac;
    changed.hmac = hmacSha256(canonicalJson(unsigned), KEY);
    const column = property === "formulaHash" ? "formula_hash" : "output_hash";
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.pragma("ignore_check_constraints = ON");
    db.prepare(`
      UPDATE run_revisions SET ${column} = ?, revision_json = ?, hmac = ? WHERE id = ?
    `).run(malformed, canonicalJson(changed), changed.hmac, initial.revision.id);

    await expect(runStore.loadBranchByCommitId(initial.commit.id)).rejects.toThrow("integrity_mismatch");
  });

  test.each(malformedBranchHashes)("schema rejects malformed branch %s value %s", async (property, malformed) => {
    const { application, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const column = property === "formulaHash" ? "formula_hash" : "output_hash";
    const row = db.prepare("SELECT revision_json FROM run_revisions WHERE id = ?").get(
      initial.revision.id,
    ) as { revision_json: string };
    const changed = JSON.parse(row.revision_json) as Record<string, unknown>;
    changed[property] = malformed;
    const unsigned = { ...changed };
    delete unsigned.hmac;
    changed.hmac = hmacSha256(canonicalJson(unsigned), KEY);
    db.exec("DROP TRIGGER run_revisions_no_update");

    expect(() => db.prepare(`
      UPDATE run_revisions SET ${column} = ?, revision_json = ?, hmac = ? WHERE id = ?
    `).run(
      malformed,
      canonicalJson(changed),
      changed.hmac,
      initial.revision.id,
    )).toThrow(/CHECK constraint failed/);
  });

  test.each([
    ["parent_revision_id", "assessment-revision-1"],
    ["branch_commit_id", "tampered-commit"],
    ["formula_hash", "0".repeat(64)],
    ["output_hash", "0".repeat(64)],
  ] as const)("assessment loader rejects non-NULL %s even if SQL constraints are bypassed", async (column, value) => {
    const { runStore, db } = await setup();
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.pragma("foreign_keys = OFF");
    db.pragma("ignore_check_constraints = ON");
    db.prepare(`UPDATE run_revisions SET ${column} = ? WHERE stage = 'assessment'`).run(value);

    await expect(runStore.loadAssessmentByRunId("run-1")).rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["parent_revision_id", "parentRevisionId"],
    ["formula_hash", "formulaHash"],
    ["output_hash", "outputHash"],
  ] as const)("branch loader rejects NULL %s even with a matching HMAC", async (column, property) => {
    const { application, runStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const row = db.prepare("SELECT revision_json FROM run_revisions WHERE id = ?").get(
      initial.revision.id,
    ) as { revision_json: string };
    const changed = JSON.parse(row.revision_json) as Record<string, unknown>;
    changed[property] = null;
    const unsigned = { ...changed };
    delete unsigned.hmac;
    changed.hmac = hmacSha256(canonicalJson(unsigned), KEY);
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.pragma("foreign_keys = OFF");
    db.pragma("ignore_check_constraints = ON");
    db.prepare(`
      UPDATE run_revisions SET ${column} = NULL, revision_json = ?, hmac = ? WHERE id = ?
    `).run(canonicalJson(changed), changed.hmac, initial.revision.id);

    await expect(runStore.loadBranchByCommitId(initial.commit.id)).rejects.toThrow("integrity_mismatch");
  });

  test("full replay reruns assessment and budget historically with no network or append", async () => {
    const { application, profileStore, runStore, branchStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const before = writeCounts(db);
    const replay = createReplayApplication({
      profileStore,
      runStore,
      branchStore,
      replayEvidence: async () => historicalEvidence(),
      projectDecisionEvidence: () => verifiedDecisionEvidence,
      projectBudgetFacts: () => budgetFacts.loadVerifiedBudgetFacts(),
    });

    const historical = await replay.replayRun("run-1");

    expect(historical).toMatchObject({
      runId: "run-1",
      runRevisionId: initial.revision.id,
      branchCommitId: initial.commit.id,
      assessment: { marker: "green" },
      budget: { incomeAll: "209864.57", knownResidualAll: "139864.57" },
      mode: "historical",
    });
    expect(writeCounts(db)).toEqual(before);
  });

  test("rejects an HMAC-valid unsupported assessment rules version before Decision replay", async () => {
    const { application, profileStore, runStore, branchStore } = await setup(
      "green",
      "210000",
      undefined,
      "vs1-assessment@unsupported",
    );
    await application.saveInitialHousingBranch("run-1");
    const replay = createReplayApplication({
      profileStore,
      runStore,
      branchStore,
      replayEvidence: async () => historicalEvidence(),
      projectDecisionEvidence: () => {
        throw new Error("decision_was_called");
      },
      projectBudgetFacts: () => budgetFacts.loadVerifiedBudgetFacts(),
    });

    await expect(replay.replayRun("run-1")).rejects.toThrow("integrity_mismatch");
  });

  test("rejects an HMAC-valid branch revision whose assessment date diverges", async () => {
    const { application, profileStore, runStore, branchStore, db } = await setup();
    const initial = await application.saveInitialHousingBranch("run-1");
    const row = db.prepare("SELECT revision_json FROM run_revisions WHERE id = ?").get(
      initial.revision.id,
    ) as { revision_json: string };
    const changed = JSON.parse(row.revision_json) as Record<string, unknown>;
    changed.assessmentDate = "2026-08-06";
    const unsigned = { ...changed };
    delete unsigned.hmac;
    changed.hmac = hmacSha256(canonicalJson(unsigned), KEY);
    db.exec("DROP TRIGGER run_revisions_no_update");
    db.prepare(`
      UPDATE run_revisions SET assessment_date = ?, revision_json = ?, hmac = ? WHERE id = ?
    `).run("2026-08-06", canonicalJson(changed), changed.hmac, initial.revision.id);
    const replay = createReplayApplication({
      profileStore,
      runStore,
      branchStore,
      replayEvidence: async () => historicalEvidence(),
      projectDecisionEvidence: () => verifiedDecisionEvidence,
      projectBudgetFacts: () => budgetFacts.loadVerifiedBudgetFacts(),
    });

    await expect(replay.replayRun("run-1")).rejects.toThrow("integrity_mismatch");
  });
});
