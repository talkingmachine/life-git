import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import Database from "better-sqlite3";

import type { EvidenceReadItem, RunDetailsCore, RunResult } from "../src/application/contracts";
import { createConfirmedLifeComposition } from "../src/infrastructure/composition-root";
import { captureHttpOnce, SourceCaptureError } from "../src/infrastructure/sources/gateway";
import { openEvidenceDatabase } from "../src/infrastructure/sqlite/db";
import type { EvidenceSnapshot, RequestStep, SourceId } from "../src/research/contracts";
import {
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  EVIDENCE_SOURCE_IDS,
} from "../src/research/run";
import { resetDemo } from "../scripts/reset-demo";

type Mode = "clean" | "outage";

interface CliOptions {
  readonly mode: Mode;
  readonly databasePath: string;
  readonly artifactPath?: string;
}

const DEMO_ROOT = resolve("data/evals");
const DEFAULT_DATABASE = resolve(DEMO_ROOT, "current-run/vs1.sqlite");
const SYNTHETIC_PROFILE = Object.freeze({
  availableResourcesAll: "500000",
  monthlyIncome: Object.freeze({ amount: "210000", currency: "RUB" as const }),
  incomeBasis: "foreign_contract" as const,
  companionBasis: "none" as const,
  relationship: "none" as const,
  conditions: Object.freeze({
    incomeContinues12Months: true,
    lawfulStayPrerequisiteAccepted: true,
    stagedSpouseRouteAccepted: false,
  }),
});
const INITIAL_HOUSING = Object.freeze({ currency: "ALL" as const, initialHousingAll: "70000" });
const EXPECTED_LOCATORS = Object.freeze({
  "al-law-79": ["Art. 68", "Art. 3(1)", "Art. 41"],
  "al-decision-858": ["Decision 858, amount", "Decision 858, p.8"],
  "cbr-eur": ["Valute[CharCode=EUR]"],
  "boa-eur": ["table row EUR"],
  "tirana-urban-lines": ["municipality page iframe", "visible WMS layers"],
} as const satisfies Record<SourceId, readonly string[]>);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`live_eval_failed:${message}`);
}

function parseCli(argv: readonly string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let mode: Mode = "clean";
  let databasePath = DEFAULT_DATABASE;
  let artifactPath: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing_value:${flag ?? "argument"}`);
    if (flag === "--mode" && (value === "clean" || value === "outage")) mode = value;
    else if (flag === "--database") databasePath = resolve(value);
    else if (flag === "--artifact") artifactPath = resolve(value);
    else throw new Error(`invalid_argument:${flag ?? "argument"}`);
  }
  return { mode, databasePath, ...(artifactPath === undefined ? {} : { artifactPath }) };
}

function isStrictDescendant(path: string, parent: string): boolean {
  const fromParent = relative(parent, path);
  return fromParent !== "" && fromParent !== ".." &&
    !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent);
}

function emptyAttempts(): Record<SourceId, number> {
  return Object.fromEntries(EVIDENCE_SOURCE_IDS.map((sourceId) => [sourceId, 0])) as Record<SourceId, number>;
}

function copyAttempts(value: Readonly<Record<SourceId, number>>): Record<SourceId, number> {
  return Object.fromEntries(EVIDENCE_SOURCE_IDS.map((sourceId) => [sourceId, value[sourceId]])) as Record<SourceId, number>;
}

function subtractAttempts(
  after: Readonly<Record<SourceId, number>>,
  before: Readonly<Record<SourceId, number>>,
): Record<SourceId, number> {
  return Object.fromEntries(
    EVIDENCE_SOURCE_IDS.map((sourceId) => [sourceId, after[sourceId] - before[sourceId]]),
  ) as Record<SourceId, number>;
}

function sourceEvidence(details: RunDetailsCore) {
  return EVIDENCE_SOURCE_IDS.map((sourceId) => {
    const claims = details.evidenceItems.filter(
      (item): item is Extract<EvidenceReadItem, { readonly class: "official_fact" }> =>
        item.class === "official_fact" && item.sourceId === sourceId,
    );
    const blocker = details.evidenceItems.find(
      (item) => item.class === "unknown" &&
        item.provenance === "source_unavailable" && item.sourceId === sourceId,
    );
    return {
      sourceId,
      status: claims.length > 0 ? "verified" as const : "unavailable" as const,
      claimIds: claims.map((claim) => claim.label),
      sourcePeriods: [...new Set(claims.map((claim) => claim.sourcePeriod))],
      anchors: claims.map((claim) => claim.anchor),
      officialUrls: [...new Set(claims.map((claim) => claim.resolvedUrl))],
      ...(blocker?.class === "unknown" && blocker.provenance === "source_unavailable"
        ? { blockerKind: blocker.blockerKind, officialUrl: blocker.resolvedUrl ?? blocker.navigationUrl }
        : {}),
    };
  });
}

function artifactCounts(database: Database.Database, runId: string) {
  return database.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN sealed = 1 THEN 1 ELSE 0 END) AS sealed,
           COUNT(DISTINCT source_id) AS sources
    FROM artifacts WHERE run_id = ?
  `).get(runId) as { readonly total: number; readonly sealed: number; readonly sources: number };
}

function sealedEvidenceAudit(
  database: Database.Database,
  snapshotId: string,
  runId: string,
) {
  const row = database.prepare(`
    SELECT snapshot_json, manifest_hash, parser_versions_json, rules_version
    FROM evidence_snapshots WHERE id = ?
  `).get(snapshotId) as {
    readonly snapshot_json: string;
    readonly manifest_hash: string;
    readonly parser_versions_json: string;
    readonly rules_version: string;
  } | undefined;
  invariant(row !== undefined, "sealed_snapshot_missing");
  const snapshot = JSON.parse(row.snapshot_json) as EvidenceSnapshot;
  const storedParserVersions = JSON.parse(row.parser_versions_json) as Record<SourceId, string>;
  invariant(snapshot.id === snapshotId && snapshot.manifestHash === row.manifest_hash, "snapshot_binding_mismatch");
  invariant(
    /^[a-f\d]{64}$/.test(row.manifest_hash) &&
      snapshot.rulesVersion === row.rules_version && row.rules_version === EVIDENCE_RULES_VERSION &&
      EVIDENCE_SOURCE_IDS.every((sourceId) =>
        snapshot.parserVersions[sourceId] === EVIDENCE_PARSER_VERSIONS[sourceId] &&
        storedParserVersions[sourceId] === EVIDENCE_PARSER_VERSIONS[sourceId]
      ),
    "snapshot_versions_mismatch",
  );

  for (const sourceId of EVIDENCE_SOURCE_IDS) {
    const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
    if (snapshot.coverage[sourceId] === "verified") {
      invariant(
        JSON.stringify(claims.map((claim) => claim.anchor.locator)) ===
          JSON.stringify(EXPECTED_LOCATORS[sourceId]),
        `unexpected_locator_set_${sourceId}`,
      );
    } else {
      invariant(
        claims.length === 0 && snapshot.blockers.some((blocker) => blocker.sourceId === sourceId),
        `unavailable_source_without_blocker_${sourceId}`,
      );
    }
  }

  const artifacts = database.prepare(`
    SELECT artifact_id AS artifactId, source_id AS sourceId, role,
           response_url AS responseUrl, captured_at AS capturedAt,
           response_status AS responseStatus, media_type AS mediaType,
           byte_length AS byteLength, sha256, sealed
    FROM artifacts WHERE run_id = ? ORDER BY source_id, role, artifact_id
  `).all(runId) as readonly {
    readonly artifactId: string;
    readonly sourceId: SourceId;
    readonly role: string;
    readonly responseUrl: string;
    readonly capturedAt: string;
    readonly responseStatus: number;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly sha256: string;
    readonly sealed: number;
  }[];
  invariant(
    artifacts.length === snapshot.artifactIds.length && artifacts.every((artifact) =>
      snapshot.artifactIds.includes(artifact.artifactId) && artifact.responseStatus === 200 &&
      artifact.byteLength > 0 && /^[a-f\d]{64}$/.test(artifact.sha256) && artifact.sealed === 1 &&
      !Number.isNaN(Date.parse(artifact.capturedAt))
    ),
    "artifact_manifest_mismatch",
  );
  return {
    snapshotId,
    manifestHash: row.manifest_hash,
    parserVersions: storedParserVersions,
    rulesVersion: row.rules_version,
    coverage: snapshot.coverage,
    claims: snapshot.claims,
    blockers: snapshot.blockers,
    artifacts: artifacts.map(({ sealed, ...artifact }) => ({ ...artifact, sealed: sealed === 1 })),
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function proveReplayAndTamper(
  database: Database.Database,
  hmacKey: string,
  runId: string,
  networkAttempts: Readonly<Record<SourceId, number>>,
) {
  const application = createConfirmedLifeComposition({
    database,
    hmacKey,
    requestStep: async () => {
      throw new Error("network_called_during_replay");
    },
  });
  const beforeReplay = copyAttempts(networkAttempts);
  const first = await application.replayRun(runId);
  const second = await application.replayRun(runId);
  invariant(JSON.stringify(first) === JSON.stringify(second), "offline_replays_diverged");
  invariant(
    EVIDENCE_SOURCE_IDS.every((sourceId) => networkAttempts[sourceId] === beforeReplay[sourceId]),
    "replay_used_network",
  );

  const copiedDatabase = new Database(database.serialize());
  try {
    copiedDatabase.exec("DROP TRIGGER artifacts_no_update");
    const row = copiedDatabase.prepare(`
      SELECT run_id, artifact_id, bytes FROM artifacts WHERE run_id = ? ORDER BY artifact_id LIMIT 1
    `).get(runId) as { readonly run_id: string; readonly artifact_id: string; readonly bytes: Buffer } | undefined;
    invariant(row !== undefined && row.bytes.length > 0, "tamper_target_missing");
    const changed = Buffer.from(row.bytes);
    changed[0] = changed[0]! ^ 1;
    copiedDatabase.prepare("UPDATE artifacts SET bytes = ? WHERE run_id = ? AND artifact_id = ?")
      .run(changed, row.run_id, row.artifact_id);
    const copiedApplication = createConfirmedLifeComposition({
      database: copiedDatabase,
      hmacKey,
      requestStep: async () => {
        throw new Error("network_called_during_tamper_replay");
      },
    });
    let rejected = false;
    try {
      await copiedApplication.replayRun(runId);
    } catch (error) {
      rejected = error instanceof Error && error.message === "integrity_mismatch";
    }
    invariant(rejected, "tampered_artifact_was_accepted");
  } finally {
    copiedDatabase.close();
  }

  return { equal: true as const, digest: digest(first), tamperRejected: true as const };
}

async function verifyGreenRun(
  database: Database.Database,
  hmacKey: string,
  application: ReturnType<typeof createConfirmedLifeComposition>,
  result: RunResult,
  networkAttempts: Readonly<Record<SourceId, number>>,
) {
  invariant(result.assessment.marker === "green", "expected_green");
  const details = await application.loadRunDetailsCore(result.runId);
  const sources = sourceEvidence(details);
  invariant(sources.every((source) => source.status === "verified"), "not_all_sources_verified");
  invariant(sources.reduce((count, source) => count + source.claimIds.length, 0) === 9, "claim_count_not_nine");
  invariant(sources.every((source) => source.sourcePeriods.length > 0 && source.anchors.length > 0), "lineage_missing");
  const c0 = await application.saveInitialHousingBranch(result.runId);
  const beforeReplay = copyAttempts(networkAttempts);
  const replay = await proveReplayAndTamper(database, hmacKey, result.runId, networkAttempts);
  invariant(
    EVIDENCE_SOURCE_IDS.every((sourceId) => networkAttempts[sourceId] === beforeReplay[sourceId]),
    "offline_gate_changed_attempts",
  );
  const stored = artifactCounts(database, result.runId);
  invariant(stored.total > 0 && stored.total === stored.sealed && stored.sources === 5, "raw_capture_not_sealed");
  const sealedEvidence = sealedEvidenceAudit(
    database,
    result.evidenceSnapshotId,
    result.runId,
  );
  return {
    runId: result.runId,
    evidenceSnapshotId: result.evidenceSnapshotId,
    marker: result.assessment.marker,
    assessmentDate: result.assessmentDate,
    sourceEvidence: sources,
    officialClaimCount: 9,
    storedArtifacts: stored,
    sealedEvidence,
    c0CommitId: c0.commit.id,
    replay,
  };
}

function assertRedacted(value: unknown, hmacKey: string, databasePath: string): string {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const forbiddenKeys = /"(?:bytes|hmac|profile|databasePath|hmacKey|secret|raw)"\s*:/i;
  invariant(!forbiddenKeys.test(json), "artifact_contains_forbidden_key");
  invariant(!json.includes(hmacKey) && !json.includes(databasePath), "artifact_contains_runtime_secret");
  return json;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  invariant(isStrictDescendant(dirname(options.databasePath), DEMO_ROOT), "database_outside_demo_root");
  await mkdir(DEMO_ROOT, { recursive: true });
  await mkdir(dirname(options.databasePath), { recursive: true });
  await resetDemo(options.databasePath, DEMO_ROOT);

  const hmacKey = randomBytes(32).toString("hex");
  const database = openEvidenceDatabase(options.databasePath);
  const attempts = emptyAttempts();
  let injectCbrOutage = options.mode === "outage";
  const requestStep: RequestStep = async (request, signal) => {
    attempts[request.sourceId] += 1;
    if (injectCbrOutage && request.sourceId === "cbr-eur") {
      throw new SourceCaptureError("server_error", "Injected CBR outage");
    }
    return captureHttpOnce(request, signal);
  };
  const application = createConfirmedLifeComposition({ database, hmacKey, requestStep });

  try {
    const startedAt = performance.now();
    const initial = await application.startConfirmedLife(SYNTHETIC_PROFILE, INITIAL_HOUSING);
    const initialLatencyMs = Math.round(performance.now() - startedAt);
    invariant(initialLatencyMs <= 90_000, "initial_run_exceeded_90_seconds");
    const initialAttempts = copyAttempts(attempts);

    let primary = initial;
    let primaryLatencyMs = initialLatencyMs;
    let outage: Record<string, unknown> | undefined;
    if (options.mode === "outage") {
      invariant(initial.assessment.marker === "yellow", "outage_did_not_fail_closed");
      invariant(initialAttempts["cbr-eur"] === 2, "cbr_retry_count_not_two");
      const details = await application.loadRunDetailsCore(initial.runId);
      const cbr = sourceEvidence(details).find((source) => source.sourceId === "cbr-eur");
      invariant(cbr?.status === "unavailable" && cbr.blockerKind === "server_error", "cbr_blocker_missing");
      injectCbrOutage = false;
      const recoveryStartedAt = performance.now();
      primary = await application.retryConfirmedLife(initial.runId);
      const recoveryLatencyMs = Math.round(performance.now() - recoveryStartedAt);
      primaryLatencyMs = recoveryLatencyMs;
      invariant(recoveryLatencyMs <= 90_000, "recovery_run_exceeded_90_seconds");
      invariant(primary.runId !== initial.runId, "recovery_reused_run");
      invariant(primary.evidenceSnapshotId !== initial.evidenceSnapshotId, "recovery_reused_snapshot");
      const sealedEvidence = sealedEvidenceAudit(
        database,
        initial.evidenceSnapshotId,
        initial.runId,
      );
      outage = {
        runId: initial.runId,
        evidenceSnapshotId: initial.evidenceSnapshotId,
        marker: initial.assessment.marker,
        blockerKind: cbr.blockerKind,
        requestAttempts: initialAttempts,
        latencyMs: initialLatencyMs,
        recoveryLatencyMs,
        sealedEvidence,
      };
    }

    const attemptsBeforePrimary = options.mode === "outage" ? initialAttempts : emptyAttempts();
    const primaryAttempts = subtractAttempts(attempts, attemptsBeforePrimary);
    const verified = await verifyGreenRun(database, hmacKey, application, primary, attempts);
    const artifact = {
      schemaVersion: "vs1-live-eval@1",
      generatedAt: new Date().toISOString(),
      mode: options.mode,
      readiness: ["source-verified", "replay-verified", ...(outage === undefined ? [] : ["fail-closed-verified", "recovery-verified"])],
      cleanRun: { ...verified, requestAttempts: primaryAttempts, latencyMs: primaryLatencyMs },
      ...(outage === undefined ? {} : { outage }),
      observed: {
        totalNetworkRequests: Object.values(attempts).reduce((sum, count) => sum + count, 0),
        sourceFees: "not_metered",
        demoVerified: false,
      },
    };
    const artifactPath = options.artifactPath ?? resolve("artifacts/evals/vs1", `${primary.runId}.json`);
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, assertRedacted(artifact, hmacKey, options.databasePath), { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ artifactPath, marker: primary.assessment.marker, runId: primary.runId })}\n`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown_live_eval_error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
