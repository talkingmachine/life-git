import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import { createEvidenceIntegrity, secureHexEqual } from "../../src/infrastructure/integrity";
import type { ReplayEvidenceStore } from "../../src/application/replay-evidence";
import type {
  Claim,
  EvidenceBlocker,
  LiveCapturedArtifact,
  SourceId,
} from "../../src/research/contracts";
import {
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  sealEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/run";
import type {
  VerifiedEvidenceBundle,
  VerifiedLoadExpectations,
} from "../../src/research/research-plan";

const KEY = "integration-test-key-at-least-32-bytes";
const INTEGRITY = createEvidenceIntegrity(KEY);
const ASSESSMENT_DATE = "2026-08-08";
const SOURCE_IDS = [
  "al-law-79",
  "al-decision-858",
  "cbr-eur",
  "boa-eur",
  "tirana-urban-lines",
] as const satisfies readonly SourceId[];

const databases: Database.Database[] = [];

test("accepts only exact 64-character SHA-256 hex values", () => {
  expect(secureHexEqual("a".repeat(64), "A".repeat(64))).toBe(true);
  expect(secureHexEqual("a".repeat(63), "a".repeat(63))).toBe(false);
  expect(secureHexEqual("a".repeat(65), "a".repeat(65))).toBe(false);
});

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(): Database.Database {
  const value = openEvidenceDatabase(":memory:");
  databases.push(value);
  return value;
}

function artifact(
  sourceId: SourceId,
  byte = 1,
  runId = "persistence-run",
  capturedAt = "2026-08-08T10:00:00.000Z",
): LiveCapturedArtifact {
  const bytes = Uint8Array.of(byte);
  const sha256 = byte === 1
    ? "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a"
    : "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986";
  return {
    artifactId: `${sourceId}:official-document:${sha256}`,
    runId,
    sourceId,
    role: "official-document",
    url: `https://official.example/${sourceId}`,
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt,
    responseStatus: 200,
    responseUrl: `https://official.example/${sourceId}`,
    request: {
      method: "GET",
      url: `https://official.example/${sourceId}`,
    },
  } as LiveCapturedArtifact;
}

function claim(sourceId: SourceId, sourceArtifact: LiveCapturedArtifact): Claim<unknown> {
  return {
    claimId: `${sourceId}-facts`,
    sourceId,
    value: { present: true },
    scope: "VS-1",
    sourcePeriod: ASSESSMENT_DATE,
    anchor: {
      artifactId: sourceArtifact.artifactId,
      locator: "fixture locator",
      excerptSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    status: "verified",
  };
}

function verifiedEntry(sourceId: SourceId, sourceArtifact = artifact(sourceId)): TerminalEvidenceEntry {
  return {
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl: sourceArtifact.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      artifacts: [sourceArtifact],
      versionHint: "fixture-v1",
    },
    coverage: "verified",
    claims: [claim(sourceId, sourceArtifact)],
  };
}

function unavailableEntry(
  sourceId: SourceId,
  sourceArtifact = artifact(sourceId),
): TerminalEvidenceEntry {
  const blocker: EvidenceBlocker = {
    sourceId,
    kind: "semantic_mismatch",
    navigationUrl: sourceArtifact.url,
    resolvedUrl: sourceArtifact.responseUrl,
    artifactIds: [sourceArtifact.artifactId],
  };
  return {
    sourceId,
    parserEntry: {
      sourceId,
      navigationUrl: sourceArtifact.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      artifacts: [sourceArtifact],
      versionHint: "fixture-v1",
    },
    coverage: "unavailable",
    blocker,
  };
}

function completeEntries(): readonly TerminalEvidenceEntry[] {
  return SOURCE_IDS.map((sourceId) => verifiedEntry(sourceId));
}

describe("append-only evidence persistence", () => {
  test("stores raw bytes before parsing and seals one snapshot only after all five entries are terminal", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();

    for (const entry of entries) {
      for (const sourceArtifact of entry.parserEntry.artifacts) {
        await store.appendArtifact(sourceArtifact as LiveCapturedArtifact);
      }
    }

    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({ count: 5 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 0 });
    await expect(
      sealEvidence(
        {
          id: "snapshot-incomplete",
          assessmentDate: ASSESSMENT_DATE,
          entries: entries.slice(0, 4),
          parserVersions: EVIDENCE_PARSER_VERSIONS,
          rulesVersion: EVIDENCE_RULES_VERSION,
        },
        INTEGRITY,
      ),
    ).rejects.toThrow("non_terminal_evidence");

    const sealed = await sealEvidence(
      {
        id: "snapshot-complete",
        assessmentDate: ASSESSMENT_DATE,
        entries,
        parserVersions: EVIDENCE_PARSER_VERSIONS,
        rulesVersion: EVIDENCE_RULES_VERSION,
      },
      INTEGRITY,
    );
    await store.seal(sealed);

    expect(db.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE sealed = 1").get()).toEqual({ count: 5 });
    await expect(store.loadVerified("snapshot-complete", KEY)).resolves.toEqual(sealed.snapshot);
    expect("knowledgeBaselineRevisionId" in sealed.snapshot).toBe(false);
  });

  test("requires exactly one typed blocker and no claim for each unavailable source", async () => {
    const sourceArtifact = artifact("cbr-eur");
    const unavailable = unavailableEntry("cbr-eur", sourceArtifact);
    const invalid = {
      ...unavailable,
      claims: [claim("cbr-eur", sourceArtifact)],
    } as unknown as TerminalEvidenceEntry;

    await expect(
      sealEvidence(
        {
          id: "snapshot-invalid-unavailable",
          assessmentDate: ASSESSMENT_DATE,
          entries: completeEntries().map((entry) =>
            entry.sourceId === "cbr-eur" ? invalid : entry,
          ),
          parserVersions: EVIDENCE_PARSER_VERSIONS,
          rulesVersion: EVIDENCE_RULES_VERSION,
        },
        INTEGRITY,
      ),
    ).rejects.toThrow("invalid_terminal_evidence");

    const sealed = await sealEvidence(
      {
        id: "snapshot-unavailable",
        assessmentDate: ASSESSMENT_DATE,
        entries: completeEntries().map((entry) =>
          entry.sourceId === "cbr-eur" ? unavailable : entry,
        ),
        parserVersions: EVIDENCE_PARSER_VERSIONS,
        rulesVersion: EVIDENCE_RULES_VERSION,
      },
      INTEGRITY,
    );

    expect(sealed.snapshot.coverage["cbr-eur"]).toBe("unavailable");
    expect(sealed.snapshot.blockers).toEqual([
      expect.objectContaining({ sourceId: "cbr-eur", kind: "semantic_mismatch" }),
    ]);
    expect(sealed.snapshot.claims.some((item) => item.sourceId === "cbr-eur")).toBe(false);
  });

  test("retains the two Task 3 tables and rejects update or delete after sealing", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    await store.seal(await sealEvidence({
      id: "snapshot-immutable",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY));

    const tableNames = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all();
    expect(tableNames).toEqual(expect.arrayContaining([
      { name: "artifacts" },
      { name: "evidence_snapshots" },
    ]));
    expect(() => db.prepare("UPDATE artifacts SET media_type = 'text/plain'").run()).toThrow();
    expect(() => db.prepare("DELETE FROM artifacts").run()).toThrow();
    expect(() => db.prepare("UPDATE evidence_snapshots SET rules_version = 'changed'").run()).toThrow();
    expect(() => db.prepare("DELETE FROM evidence_snapshots").run()).toThrow();
  });
});

describe("verified Evidence dependency boundary", () => {
  test("keeps every Application import pointed away from Infrastructure", () => {
    // Break caught: moving a SQLite/crypto helper into an Application use case instead of injecting an inward port.
    const applicationRoot = join(process.cwd(), "src/application");
    const files = readdirSync(applicationRoot)
      .map((name) => join(applicationRoot, name))
      .filter((path) => statSync(path).isFile() && /\.(?:ts|tsx)$/.test(path));
    const violations = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const imports = [...source.matchAll(
        /(?:import(?:\s+type)?[\s\S]*?from\s*|import\s*\()(["'])([^"']+)\1/g,
      )].map((match) => match[2]!);
      return imports
        .filter((specifier) => specifier.includes("/infrastructure/"))
        .map((specifier) => ({ path, specifier }));
    });
    expect(violations).toEqual([]);
  });

  test("SQLite structurally implements the inward replay store and returns fresh bundle bytes", async () => {
    // Break caught: exporting Infrastructure row types or leaking one mutable Buffer across verified reads.
    const db = database();
    const concrete = new SqliteEvidenceStore(db);
    const replayStore: ReplayEvidenceStore = concrete;
    const expectations: VerifiedLoadExpectations = {
      assessmentDate: ASSESSMENT_DATE,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    };
    const entries = completeEntries();
    for (const entry of entries) {
      await concrete.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    const sealed = await sealEvidence({
      id: "snapshot-inward-bundle",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY);
    await concrete.seal(sealed);

    const first: VerifiedEvidenceBundle = await replayStore.loadVerifiedBundle(
      sealed.snapshot.id,
      KEY,
      expectations,
    );
    const second = await replayStore.loadVerifiedBundle(sealed.snapshot.id, KEY, expectations);
    const original = second.entries[0]!.artifacts[0]!.bytes[0];
    first.entries[0]!.artifacts[0]!.bytes[0] = 255;

    expect(second.entries[0]!.artifacts[0]!.bytes[0]).toBe(original);
    expect(first.snapshot).toEqual(sealed.snapshot);
  });
});

describe("verified evidence load", () => {
  test("rejects unsigned extra own fields in stored snapshot JSON", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    await store.seal(await sealEvidence({
      id: "snapshot-extra-field",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY));

    db.exec("DROP TRIGGER evidence_snapshots_no_update");
    const row = db.prepare(
      "SELECT snapshot_json FROM evidence_snapshots WHERE id = ?",
    ).get("snapshot-extra-field") as { readonly snapshot_json: string };
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    snapshot.unsignedExtension = { accepted: true };
    db.prepare("UPDATE evidence_snapshots SET snapshot_json = ? WHERE id = ?").run(
      INTEGRITY.canonical(snapshot),
      "snapshot-extra-field",
    );

    await expect(store.loadVerified("snapshot-extra-field", KEY)).rejects.toThrow(
      "integrity_mismatch",
    );
  });

  test("round-trips an optional signed context binding and rejects snapshot-only tampering", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    const contextHash = "c".repeat(64);
    const sealed = await sealEvidence({
      id: "snapshot-context-bound",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
      contextHash,
    }, INTEGRITY);
    await store.seal(sealed);

    await expect(store.loadVerified("snapshot-context-bound", KEY)).resolves.toEqual(
      expect.objectContaining({ contextHash }),
    );

    db.exec("DROP TRIGGER evidence_snapshots_no_update");
    const row = db.prepare(
      "SELECT snapshot_json FROM evidence_snapshots WHERE id = ?",
    ).get("snapshot-context-bound") as { readonly snapshot_json: string };
    const changed = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    delete changed.contextHash;
    db.prepare("UPDATE evidence_snapshots SET snapshot_json = ? WHERE id = ?").run(
      JSON.stringify(changed),
      "snapshot-context-bound",
    );
    await expect(store.loadVerified("snapshot-context-bound", KEY)).rejects.toThrow(
      "integrity_mismatch",
    );
  });

  test("signs the optional Knowledge baseline in both canonical Evidence payloads", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    const knowledgeBaselineRevisionId = "country-knowledge:SI:baseline:evidence";
    const sealed = await sealEvidence({
      id: "snapshot-knowledge-bound",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
      knowledgeBaselineRevisionId,
    }, INTEGRITY);
    await store.seal(sealed);

    await expect(store.loadVerified("snapshot-knowledge-bound", KEY)).resolves.toEqual(
      expect.objectContaining({ knowledgeBaselineRevisionId }),
    );
    expect(sealed.manifest.snapshot).toEqual(
      expect.objectContaining({ knowledgeBaselineRevisionId }),
    );

    db.exec("DROP TRIGGER evidence_snapshots_no_update");
    const row = db.prepare(`
      SELECT snapshot_json AS snapshotJson, manifest_json AS manifestJson
      FROM evidence_snapshots WHERE id = ?
    `).get("snapshot-knowledge-bound") as {
      readonly snapshotJson: string;
      readonly manifestJson: string;
    };
    const snapshot = JSON.parse(row.snapshotJson) as Record<string, unknown>;
    const manifest = JSON.parse(row.manifestJson) as {
      readonly snapshot: Record<string, unknown>;
    };
    snapshot.knowledgeBaselineRevisionId = "country-knowledge:SI:other:evidence";
    manifest.snapshot.knowledgeBaselineRevisionId = "country-knowledge:SI:other:evidence";
    const canonicalManifest = INTEGRITY.canonical(manifest);
    snapshot.manifestHash = INTEGRITY.hash(canonicalManifest);
    db.prepare(`
      UPDATE evidence_snapshots
      SET snapshot_json = ?, manifest_json = ?, manifest_hash = ?
      WHERE id = ?
    `).run(
      INTEGRITY.canonical(snapshot),
      canonicalManifest,
      snapshot.manifestHash,
      "snapshot-knowledge-bound",
    );

    await expect(store.loadVerified("snapshot-knowledge-bound", KEY)).rejects.toThrow(
      "integrity_mismatch",
    );
  });

  test("rejects artifact tampering and date, parser, rules, or key mismatch", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    await store.seal(await sealEvidence({
      id: "snapshot-verified-load",
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY));

    await expect(store.loadVerified("snapshot-verified-load", "wrong-key")).rejects.toThrow("integrity_mismatch");
    await expect(store.loadVerified("snapshot-verified-load", KEY, {
      assessmentDate: "2026-08-07",
    })).rejects.toThrow("integrity_mismatch");
    await expect(store.loadVerified("snapshot-verified-load", KEY, {
      parserVersions: { ...EVIDENCE_PARSER_VERSIONS, "cbr-eur": "changed" },
    })).rejects.toThrow("integrity_mismatch");
    await expect(store.loadVerified("snapshot-verified-load", KEY, {
      rulesVersion: "changed",
    })).rejects.toThrow("integrity_mismatch");

    db.exec("DROP TRIGGER artifacts_no_update");
    db.prepare("UPDATE artifacts SET bytes = ? WHERE source_id = ?").run(Uint8Array.of(2), "cbr-eur");
    await expect(store.loadVerified("snapshot-verified-load", KEY)).rejects.toThrow("integrity_mismatch");
  });

  test("rejects a conflicting duplicate artifact inside one run", async () => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const first = artifact("cbr-eur", 1, "duplicate-run", "2026-08-08T10:00:01.000Z");

    await store.appendArtifact(first);
    await expect(store.appendArtifact({
      ...first,
      capturedAt: "2026-08-08T10:00:02.000Z",
    })).rejects.toThrow("integrity_mismatch");
  });

  test.each([
    ["identity", "run_id = 'tampered-run', source_id = 'boa-eur', role = 'tampered-role'"],
    ["request", "request_json = '{\"method\":\"POST\",\"url\":\"https://evil.example\"}'"],
    ["response", "url = 'https://evil.example', response_url = 'https://evil.example', response_status = 201"],
    ["media/time/length", "media_type = 'text/plain', captured_at = '2099-01-01T00:00:00.000Z', byte_length = 999"],
  ])("rejects sealed %s provenance tampering", async (className, mutation) => {
    const db = database();
    const store = new SqliteEvidenceStore(db);
    const entries = completeEntries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    const snapshotId = `snapshot-provenance-${className}`;
    await store.seal(await sealEvidence({
      id: snapshotId,
      assessmentDate: ASSESSMENT_DATE,
      entries,
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY));
    db.exec("DROP TRIGGER artifacts_no_update");
    db.prepare(`UPDATE artifacts SET ${mutation} WHERE source_id = 'cbr-eur'`).run();

    await expect(store.loadVerified(snapshotId, KEY)).rejects.toThrow("integrity_mismatch");
  });
});
