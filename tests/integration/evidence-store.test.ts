import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import {
  SqliteAdministrativeEvidenceStore,
  insertSealedEvidence,
  loadVerifiedCountryEvidence,
  loadVerifiedCountryEvidenceV2,
  SqliteEvidenceStore,
  verifySealedEvidenceForInsert,
} from "../../src/infrastructure/sqlite/evidence-store";
import { createEvidenceIntegrity, secureHexEqual } from "../../src/infrastructure/integrity";
import type { ReplayEvidenceStore } from "../../src/application/replay-evidence";
import type {
  AdministrativeCapturedArtifact,
  Claim,
  EvidenceBlocker,
  LiveCapturedArtifact,
  SourceId,
} from "../../src/research/contracts";
import type { SloveniaSourceId } from "../../src/research/cold-start-contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
} from "../../src/research/cold-start-contracts-v2";
import {
  EVIDENCE_PARSER_VERSIONS,
  EVIDENCE_RULES_VERSION,
  sealEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/run";
import type {
  AdministrativeTerminalEvidenceEntry,
  SealedEvidence,
  TerminalEvidenceEntry as GenericTerminalEvidenceEntry,
  VerifiedEvidenceBundle,
  VerifiedLoadExpectations,
} from "../../src/research/research-plan";
import { sealEvidencePlan } from "../../src/research/research-plan";

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
const temporaryDirectories: string[] = [];

test("accepts only exact 64-character SHA-256 hex values", () => {
  expect(secureHexEqual("a".repeat(64), "A".repeat(64))).toBe(true);
  expect(secureHexEqual("a".repeat(63), "a".repeat(63))).toBe(false);
  expect(secureHexEqual("a".repeat(65), "a".repeat(65))).toBe(false);
});

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
  const directory = mkdtempSync(join(tmpdir(), "administrative-evidence-race-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const value = openEvidenceDatabase(path);
  databases.push(value);
  return { database: value, path };
}

function databasePair(): readonly [Database.Database, Database.Database] {
  const directory = mkdtempSync(join(tmpdir(), "administrative-evidence-retry-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const first = openEvidenceDatabase(path);
  const second = openEvidenceDatabase(path);
  databases.push(first, second);
  return [first, second];
}

interface AdministrativeWorkerOutcome {
  readonly ok: boolean;
  readonly message?: string;
  readonly code?: string;
}

function administrativeWorker(input: {
  readonly path: string;
  readonly method: "appendArtifact" | "seal";
  readonly args: readonly unknown[];
  readonly start: SharedArrayBuffer;
}): { readonly ready: Promise<void>; readonly result: Promise<AdministrativeWorkerOutcome> } {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const storeModule = await tsImport(workerData.storeModule, workerData.parentModule);
        const integrityModule = await tsImport(workerData.integrityModule, workerData.parentModule);
        const Database = (await import("better-sqlite3")).default;
        database = new Database(workerData.path);
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 3000");
        const store = new storeModule.SqliteAdministrativeEvidenceStore(
          database,
          integrityModule.createEvidenceIntegrity(workerData.key),
        );
        parentPort.postMessage({ type: "ready" });
        const signal = new Int32Array(workerData.start);
        Atomics.wait(signal, 0, 0);
        await store[workerData.method](...workerData.args);
        parentPort.postMessage({ type: "result", outcome: { ok: true } });
      } catch (error) {
        parentPort.postMessage({
          type: "result",
          outcome: {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            code: error && typeof error === "object" && "code" in error ? error.code : undefined,
          },
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
      storeModule: pathToFileURL(join(
        process.cwd(),
        "src/infrastructure/sqlite/evidence-store.ts",
      )).href,
      integrityModule: pathToFileURL(join(
        process.cwd(),
        "src/infrastructure/integrity.ts",
      )).href,
      parentModule: pathToFileURL(join(
        process.cwd(),
        "tests/integration/evidence-store.test.ts",
      )).href,
    },
  });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let resultResolve!: (outcome: AdministrativeWorkerOutcome) => void;
  let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise<AdministrativeWorkerOutcome>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  void result.catch(() => undefined);
  const reject = (error: Error): void => {
    readyReject(error);
    resultReject(error);
  };
  worker.on("error", reject);
  worker.on("message", (message: {
    readonly type: "ready" | "result";
    readonly outcome?: AdministrativeWorkerOutcome;
  }) => {
    if (message.type === "ready") readyResolve();
    if (message.type === "result") {
      readyResolve();
      resultResolve(message.outcome!);
    }
  });
  return { ready, result };
}

async function raceAdministrativeMethod(input: {
  readonly path: string;
  readonly method: "appendArtifact" | "seal";
  readonly args: readonly unknown[];
}): Promise<readonly AdministrativeWorkerOutcome[]> {
  const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workers = Array.from({ length: 2 }, () => administrativeWorker({ ...input, start }));
  await Promise.all(workers.map(({ ready }) => ready));
  const signal = new Int32Array(start);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0, workers.length);
  return Promise.all(workers.map(({ result }) => result));
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

type V3Claim = Claim<{ readonly present: true }, SloveniaSourceId>;

function v3Artifact(
  sourceId: SloveniaSourceId,
  index: number,
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = Uint8Array.of(index + 10);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const url = `https://official.example/${sourceId}`;
  return {
    artifactId: `${sourceId}:official-document:${sha256}`,
    runId: "v3-persistence-run",
    sourceId,
    role: "official-document",
    url,
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt: "2026-08-22T10:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

function v3Entries(): readonly GenericTerminalEvidenceEntry<SloveniaSourceId, V3Claim>[] {
  return SLOVENIA_V2_SOURCE_ORDER.map((sourceId, index) => {
    const sourceArtifact = v3Artifact(sourceId, index);
    return {
      sourceId,
      parserEntry: {
        sourceId,
        navigationUrl: sourceArtifact.url,
        resolvedEvidenceUrl: sourceArtifact.responseUrl,
        artifacts: [sourceArtifact],
      },
      coverage: "verified",
      claims: [{
        claimId: `${sourceId}-v3-facts`,
        sourceId,
        value: { present: true },
        scope: SLOVENIA_V2_RESEARCH_SCOPE,
        sourcePeriod: "2026-08-22",
        anchor: {
          artifactId: sourceArtifact.artifactId,
          locator: "V3 fixture locator",
          excerptSha256: "a".repeat(64),
        },
        status: "verified",
      }],
    };
  });
}

async function sealedV3(
  sourceIds: readonly SloveniaSourceId[] = SLOVENIA_V2_SOURCE_ORDER,
  parserVersions: Readonly<Record<SloveniaSourceId, string>> = SLOVENIA_V2_PARSER_VERSIONS,
): Promise<SealedEvidence<SloveniaSourceId, V3Claim>> {
  return sealEvidencePlan({
    id: `v3-${sourceIds.join("-")}`,
    assessmentDate: "2026-08-22",
    entries: v3Entries(),
    sourceIds,
    parserVersions,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  }, createEvidenceIntegrity(KEY));
}

type AdministrativeSourceId = "administrative-test";
type AdministrativeClaim = Claim<{ readonly present: boolean }, AdministrativeSourceId>;

function administrativeArtifact(
  byte = 21,
  overrides: Partial<AdministrativeCapturedArtifact<AdministrativeSourceId>> = {},
): AdministrativeCapturedArtifact<AdministrativeSourceId> {
  const bytes = Uint8Array.of(byte);
  return {
    artifactId: "administrative-test:package-material",
    runId: "administrative-run",
    sourceId: "administrative-test",
    role: "package-material",
    mediaType: "application/json",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    origin: "administrative",
    producer: "install-city-package@1",
    createdAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

function administrativeEntry(
  sourceArtifact = administrativeArtifact(),
): AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim> {
  return {
    sourceId: "administrative-test",
    origin: "administrative",
    artifacts: [sourceArtifact],
    coverage: "verified",
    claims: [{
      claimId: "administrative-package-material",
      sourceId: "administrative-test",
      value: { present: true },
      scope: "administrative-test",
      sourcePeriod: "2026-08-24",
      anchor: {
        artifactId: sourceArtifact.artifactId,
        locator: "urn:administrative-test:package-material",
        excerptSha256: "a".repeat(64),
      },
      status: "verified",
    }],
  };
}

function administrativeSealInput(
  entry = administrativeEntry(),
) {
  return {
    id: "administrative-run:evidence",
    assessmentDate: "2026-08-24",
    entries: [entry],
    sourceIds: ["administrative-test"],
    parserVersions: { "administrative-test": "administrative-json@1" },
    rulesVersion: "administrative-evidence@1",
  } as const;
}

async function sealedAdministrative(
  entry = administrativeEntry(),
): Promise<SealedEvidence<AdministrativeSourceId, AdministrativeClaim, "administrative">> {
  return sealEvidencePlan<AdministrativeSourceId, AdministrativeClaim, "administrative">(
    administrativeSealInput(entry),
    INTEGRITY,
  );
}

function resignEvidence<
  S extends string,
  C extends Claim<unknown, S>,
  O extends "live" | "administrative",
>(sealed: SealedEvidence<S, C, O>): void {
  (sealed as { canonicalManifest: string }).canonicalManifest =
    INTEGRITY.canonical(sealed.manifest);
  (sealed.snapshot as { manifestHash: string }).manifestHash =
    INTEGRITY.hash(sealed.canonicalManifest);
  (sealed.snapshot as { hmac: string }).hmac = INTEGRITY.sign(sealed.canonicalManifest);
}

describe("administrative Evidence origin", () => {
  test("seals the exact URL-free shape without retaining or freezing borrowed values", async () => {
    // Break caught: widening administrative provenance with HTTP fields or retaining caller objects.
    const borrowedArtifact = administrativeArtifact();
    const borrowedEntry = administrativeEntry(borrowedArtifact);
    const borrowedClaim = borrowedEntry.claims[0]!;

    const sealed = await sealedAdministrative(borrowedEntry);

    expect(Object.keys(sealed.manifest.entries[0]!).sort()).toEqual([
      "artifactIds", "origin", "sourceId",
    ]);
    expect(Object.keys(sealed.manifest.artifacts[0]!).sort()).toEqual([
      "artifactId", "byteLength", "createdAt", "mediaType", "origin", "producer",
      "role", "runId", "sha256", "sourceId",
    ]);
    expect(sealed.manifest.entries[0]).toEqual({
      sourceId: "administrative-test",
      origin: "administrative",
      artifactIds: [borrowedArtifact.artifactId],
    });
    expect(sealed.manifest.artifacts[0]).not.toHaveProperty("url");
    expect(sealed.manifest.artifacts[0]).not.toHaveProperty("request");
    expect(sealed.snapshot.coverage).toEqual({ "administrative-test": "verified" });
    expect(sealed.snapshot.blockers).toEqual([]);
    expect(sealed.snapshot.claims[0]).not.toBe(borrowedClaim);
    expect(Object.isFrozen(borrowedEntry)).toBe(false);
    expect(Object.isFrozen(borrowedArtifact)).toBe(false);
    expect(Object.isFrozen(borrowedArtifact.bytes)).toBe(false);

    (borrowedClaim.value as { present: boolean }).present = false;
    expect(sealed.snapshot.claims[0]!.value).toEqual({ present: true });
  });

  test("rejects accessors without invoking them", async () => {
    // Break caught: reading an accessor while trying to snapshot untrusted administrative input.
    let getterCalls = 0;
    const sourceArtifact = administrativeArtifact();
    Object.defineProperty(sourceArtifact, "producer", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "install-city-package@1";
      },
    });

    await expect(sealedAdministrative(administrativeEntry(sourceArtifact)))
      .rejects.toThrow("invalid_terminal_evidence");
    expect(getterCalls).toBe(0);
  });

  test.each(["root", "claim", "anchor"] as const)(
    "rejects an accessor at the administrative %s before integrity callbacks",
    async (level) => {
      // Break caught: snapshotting only artifacts while borrowed metadata remains executable.
      let getterCalls = 0;
      let integrityCalls = 0;
      const trap = (): never => {
        getterCalls += 1;
        throw new Error("getter must not run");
      };
      const input = administrativeSealInput();
      if (level === "root") {
        Object.defineProperty(input, "id", { enumerable: true, get: trap });
      } else if (level === "claim") {
        Object.defineProperty(input.entries[0]!.claims[0]!, "scope", {
          enumerable: true,
          get: trap,
        });
      } else {
        Object.defineProperty(input.entries[0]!.claims[0]!.anchor, "locator", {
          enumerable: true,
          get: trap,
        });
      }
      const countedIntegrity = {
        canonical: (): string => {
          integrityCalls += 1;
          return "canonical";
        },
        hash: (): string => {
          integrityCalls += 1;
          return "hash";
        },
        sign: (): string => {
          integrityCalls += 1;
          return "signature";
        },
      };

      await expect(sealEvidencePlan<AdministrativeSourceId, AdministrativeClaim, "administrative">(
        input,
        countedIntegrity,
      )).rejects.toThrow("invalid_terminal_evidence");
      expect(getterCalls).toBe(0);
      expect(integrityCalls).toBe(0);
    },
  );

  test.each(["proxy", "revoked proxy"] as const)(
    "rejects an administrative %s without executing traps or integrity callbacks",
    async (kind) => {
      // Break caught: reflective cloning of Proxy-controlled evidence before brand rejection.
      let traps = 0;
      let integrityCalls = 0;
      const trap = (): never => {
        traps += 1;
        throw new Error("proxy trap must not run");
      };
      const input = administrativeSealInput();
      let hostile: typeof input;
      if (kind === "proxy") {
        hostile = new Proxy(input, {
          get: trap,
          getOwnPropertyDescriptor: trap,
          getPrototypeOf: trap,
          ownKeys: trap,
        });
      } else {
        const revoked = Proxy.revocable(input, {});
        revoked.revoke();
        hostile = revoked.proxy;
      }
      const countedIntegrity = {
        canonical: (): string => {
          integrityCalls += 1;
          return "canonical";
        },
        hash: (): string => {
          integrityCalls += 1;
          return "hash";
        },
        sign: (): string => {
          integrityCalls += 1;
          return "signature";
        },
      };

      await expect(sealEvidencePlan<AdministrativeSourceId, AdministrativeClaim, "administrative">(
        hostile,
        countedIntegrity,
      )).rejects.toThrow("invalid_terminal_evidence");
      expect(traps).toBe(0);
      expect(integrityCalls).toBe(0);
    },
  );

  test.each([
    ["symbol key", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      (entry.artifacts[0] as unknown as Record<symbol, unknown>)[Symbol("hidden")] = true;
    }],
    ["sparse artifact array", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      (entry as unknown as {
        artifacts: AdministrativeCapturedArtifact<AdministrativeSourceId>[];
      }).artifacts =
        new Array<AdministrativeCapturedArtifact<AdministrativeSourceId>>(1);
    }],
    ["custom artifact prototype", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      Object.setPrototypeOf(entry.artifacts[0]!, { inherited: true });
    }],
    ["live-only key", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      (entry.artifacts[0] as unknown as { url?: undefined }).url = undefined;
    }],
    ["live origin", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      (entry.artifacts[0] as { origin: string }).origin = "live";
    }],
    ["missing producer", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      delete (entry.artifacts[0] as unknown as { producer?: string }).producer;
    }],
    ["missing created time", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      delete (entry.artifacts[0] as unknown as { createdAt?: string }).createdAt;
    }],
    ["noncanonical created time", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      (entry.artifacts[0] as { createdAt: string }).createdAt = "2026-08-24T10:00:00Z";
    }],
    ["missing required claim value", (entry: AdministrativeTerminalEvidenceEntry<AdministrativeSourceId, AdministrativeClaim>) => {
      delete (entry.claims[0] as unknown as { value?: unknown }).value;
    }],
  ] as const)("rejects a hostile administrative %s", async (_name, mutate) => {
    // Break caught: accepting non-plain, sparse, mixed-origin, or noncanonical provenance.
    const entry = administrativeEntry();
    mutate(entry);

    await expect(sealedAdministrative(entry)).rejects.toThrow("invalid_terminal_evidence");
  });

  test.each(["request accessor", "administrative key"] as const)(
    "keeps the live seal branch closed against a %s",
    async (hostileKind) => {
      // Break caught: origin genericization weakening the established live artifact shape.
      const entries = v3Entries();
      const sourceArtifact = entries[0]!.parserEntry.artifacts[0] as
        LiveCapturedArtifact<SloveniaSourceId>;
      let getterCalls = 0;
      if (hostileKind === "request accessor") {
        Object.defineProperty(sourceArtifact.request, "url", {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return "https://official.example/source";
          },
        });
      } else {
        (sourceArtifact as unknown as { producer?: undefined }).producer = undefined;
      }

      await expect(sealEvidencePlan({
        id: "hostile-live:evidence",
        assessmentDate: "2026-08-22",
        entries,
        sourceIds: SLOVENIA_V2_SOURCE_ORDER,
        parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
        rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
      }, INTEGRITY)).rejects.toThrow("invalid_terminal_evidence");
      expect(getterCalls).toBe(0);
    },
  );

  test("uses one verifier for live and administrative canonical manifest, snapshot, and HMAC checks", async () => {
    // Break caught: an origin-specific verifier omitting one signed equality check.
    const live = await sealedV3();
    const administrative = await sealedAdministrative();

    expect(() => verifySealedEvidenceForInsert(live, INTEGRITY)).not.toThrow();
    expect(() => verifySealedEvidenceForInsert(administrative, INTEGRITY)).not.toThrow();
    const expectVerifierDrifts = <
      S extends string,
      C extends Claim<unknown, S>,
      O extends "live" | "administrative",
    >(original: SealedEvidence<S, C, O>): void => {
      const canonicalDrift = structuredClone(original);
      (canonicalDrift as { canonicalManifest: string }).canonicalManifest = "{}";
      expect(() => verifySealedEvidenceForInsert(canonicalDrift, INTEGRITY))
        .toThrow("integrity_mismatch");

      const hmacDrift = structuredClone(original);
      (hmacDrift.snapshot as { hmac: string }).hmac = "0".repeat(64);
      expect(() => verifySealedEvidenceForInsert(hmacDrift, INTEGRITY))
        .toThrow("integrity_mismatch");

      const hashDrift = structuredClone(original);
      (hashDrift.snapshot as { manifestHash: string }).manifestHash = "0".repeat(64);
      expect(() => verifySealedEvidenceForInsert(hashDrift, INTEGRITY))
        .toThrow("integrity_mismatch");

      const snapshotDrift = structuredClone(original);
      (snapshotDrift.snapshot as { assessmentDate: string }).assessmentDate = "2026-08-23";
      expect(() => verifySealedEvidenceForInsert(snapshotDrift, INTEGRITY))
        .toThrow("integrity_mismatch");

      const signedExtraManifestKey = structuredClone(original);
      (signedExtraManifestKey.manifest as unknown as { unsignedExtension?: boolean })
        .unsignedExtension = true;
      (signedExtraManifestKey as { canonicalManifest: string }).canonicalManifest =
        INTEGRITY.canonical(signedExtraManifestKey.manifest);
      (signedExtraManifestKey.snapshot as { manifestHash: string }).manifestHash =
        INTEGRITY.hash(signedExtraManifestKey.canonicalManifest);
      (signedExtraManifestKey.snapshot as { hmac: string }).hmac =
        INTEGRITY.sign(signedExtraManifestKey.canonicalManifest);
      expect(() => verifySealedEvidenceForInsert(signedExtraManifestKey, INTEGRITY))
        .toThrow("integrity_mismatch");

      const extraSealedRootKey = structuredClone(original);
      (extraSealedRootKey as unknown as { extra?: boolean }).extra = true;
      expect(() => verifySealedEvidenceForInsert(extraSealedRootKey, INTEGRITY))
        .toThrow("integrity_mismatch");

      const missingRequiredClaimValue = structuredClone(original);
      delete (missingRequiredClaimValue.snapshot.claims[0] as unknown as { value?: unknown }).value;
      delete (missingRequiredClaimValue.manifest.snapshot.claims[0] as unknown as {
        value?: unknown;
      }).value;
      (missingRequiredClaimValue as { canonicalManifest: string }).canonicalManifest =
        INTEGRITY.canonical(missingRequiredClaimValue.manifest);
      (missingRequiredClaimValue.snapshot as { manifestHash: string }).manifestHash =
        INTEGRITY.hash(missingRequiredClaimValue.canonicalManifest);
      (missingRequiredClaimValue.snapshot as { hmac: string }).hmac =
        INTEGRITY.sign(missingRequiredClaimValue.canonicalManifest);
      expect(() => verifySealedEvidenceForInsert(missingRequiredClaimValue, INTEGRITY))
        .toThrow("integrity_mismatch");
    };
    expectVerifierDrifts(live);
    expectVerifierDrifts(administrative);

    const splitRun = structuredClone(live);
    (splitRun.manifest.artifacts[1] as { runId: string }).runId = "other-live-run";
    (splitRun as { canonicalManifest: string }).canonicalManifest =
      INTEGRITY.canonical(splitRun.manifest);
    (splitRun.snapshot as { manifestHash: string }).manifestHash =
      INTEGRITY.hash(splitRun.canonicalManifest);
    (splitRun.snapshot as { hmac: string }).hmac = INTEGRITY.sign(splitRun.canonicalManifest);
    expect(() => verifySealedEvidenceForInsert(splitRun, INTEGRITY))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["missing required key", (blocker: Record<string, unknown>) => {
      delete blocker.navigationUrl;
    }],
    ["extra key", (blocker: Record<string, unknown>) => {
      blocker.extra = true;
    }],
    ["unknown kind", (blocker: Record<string, unknown>) => {
      blocker.kind = "unexpected_failure";
    }],
    ["empty navigation URL", (blocker: Record<string, unknown>) => {
      blocker.navigationUrl = "";
    }],
    ["empty resolved URL", (blocker: Record<string, unknown>) => {
      blocker.resolvedUrl = "";
    }],
    ["duplicate artifact IDs", (blocker: Record<string, unknown>) => {
      const artifactIds = blocker.artifactIds as readonly string[];
      blocker.artifactIds = [artifactIds[0], artifactIds[0]];
    }],
  ] as const)("rejects a fully signed live blocker with a %s", async (_name, mutate) => {
    // Break caught: treating a signed but malformed blocker as a closed live Evidence branch.
    const sourceArtifact = artifact("cbr-eur");
    const unavailable = unavailableEntry("cbr-eur", sourceArtifact);
    const sealed = await sealEvidence({
      id: `malformed-blocker-${_name}`,
      assessmentDate: ASSESSMENT_DATE,
      entries: completeEntries().map((entry) =>
        entry.sourceId === "cbr-eur" ? unavailable : entry,
      ),
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY);
    const hostile = structuredClone(sealed);
    mutate(hostile.snapshot.blockers[0] as unknown as Record<string, unknown>);
    mutate(hostile.manifest.snapshot.blockers[0] as unknown as Record<string, unknown>);
    resignEvidence(hostile);

    expect(() => verifySealedEvidenceForInsert(hostile, INTEGRITY))
      .toThrow("integrity_mismatch");
  });

  test("rejects proxied sealed bundles before traps or integrity callbacks", async () => {
    // Break caught: the shared verifier reading a borrowed Proxy before taking ownership.
    let traps = 0;
    let integrityCalls = 0;
    const trap = (): never => {
      traps += 1;
      throw new Error("proxy trap must not run");
    };
    const borrowed = await sealedAdministrative();
    const hostile = new Proxy(borrowed, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const countedIntegrity = {
      canonical: (): string => {
        integrityCalls += 1;
        return "canonical";
      },
      hash: (): string => {
        integrityCalls += 1;
        return "hash";
      },
      sign: (): string => {
        integrityCalls += 1;
        return "signature";
      },
    };

    expect(() => verifySealedEvidenceForInsert(hostile, countedIntegrity))
      .toThrow("integrity_mismatch");
    expect(traps).toBe(0);
    expect(integrityCalls).toBe(0);
  });

  test("keeps both SQLite adapters runtime-closed to their selected origin", async () => {
    // Break caught: a cast bypassing the compile-time origin specialization at a persistence edge.
    const liveDb = database();
    const liveStore = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(liveDb);
    const administrativeOnLiveDb = new SqliteAdministrativeEvidenceStore<
      SloveniaSourceId,
      V3Claim
    >(liveDb, INTEGRITY);
    for (const entry of v3Entries()) {
      await liveStore.appendArtifact(
        entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>,
      );
    }
    const live = await sealedV3();
    await expect(administrativeOnLiveDb.seal(
      live as unknown as SealedEvidence<SloveniaSourceId, V3Claim, "administrative">,
    )).rejects.toThrow("integrity_mismatch");

    const administrativeDb = database();
    const administrativeStore = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(administrativeDb, INTEGRITY);
    const liveOnAdministrativeDb = new SqliteEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(administrativeDb);
    const sourceArtifact = administrativeArtifact();
    await administrativeStore.appendArtifact(sourceArtifact);
    const administrative = await sealedAdministrative(administrativeEntry(sourceArtifact));
    await expect(liveOnAdministrativeDb.seal(
      administrative as unknown as SealedEvidence<AdministrativeSourceId, AdministrativeClaim>,
    )).rejects.toThrow("integrity_mismatch");
  });

  test("keeps forged administrative HMACs out of every exported insert path", async () => {
    // Break caught: bypassing the shared signature verifier through the origin-generic SQL writer.
    const db = database();
    const store = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(db, INTEGRITY);
    const sourceArtifact = administrativeArtifact();
    await store.appendArtifact(sourceArtifact);
    const forged = structuredClone(
      await sealedAdministrative(administrativeEntry(sourceArtifact)),
    );
    (forged.snapshot as { hmac: string }).hmac = "0".repeat(64);
    const exposedAdministrativeInsert = insertSealedEvidence as unknown as (
      database: Database.Database,
      sealed: SealedEvidence<AdministrativeSourceId, AdministrativeClaim, "administrative">,
      integrity: typeof INTEGRITY,
      expectedOrigin: "administrative",
    ) => void;

    const error = await Promise.resolve().then(() =>
      exposedAdministrativeInsert(db, forged, INTEGRITY, "administrative")
    ).then(() => undefined, (caught: unknown) => caught);

    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
    expect(db.prepare("SELECT sealed FROM artifacts").pluck().get()).toBe(0);
    expect(error).toMatchObject({ message: "integrity_mismatch" });
  });

  test.each(["store", "exported insert"] as const)(
    "rejects an extra live sealed root key through the %s before writes",
    async (pathKind) => {
      // Break caught: exact-closing only the shared admin verifier while live persistence stays open.
      const db = database();
      const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
      for (const entry of v3Entries()) {
        await store.appendArtifact(
          entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>,
        );
      }
      const hostile = structuredClone(await sealedV3());
      (hostile as unknown as { extra?: boolean }).extra = true;

      const error = pathKind === "store"
        ? await store.seal(hostile).then(() => undefined, (caught: unknown) => caught)
        : await Promise.resolve().then(() => insertSealedEvidence(db, hostile))
            .then(() => undefined, (caught: unknown) => caught);

      expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(0);
      expect(db.prepare("SELECT COUNT(*) FROM artifacts WHERE sealed = 1").pluck().get()).toBe(0);
      expect(error).toMatchObject({ message: "integrity_mismatch" });
    },
  );

  test("converges an exact administrative seal retry across two stores and connections", async () => {
    // Break caught: surfacing a raw snapshot primary-key constraint for an exact retry.
    const [firstDb, secondDb] = databasePair();
    const firstStore = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(firstDb, INTEGRITY);
    const secondStore = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(secondDb, INTEGRITY);
    const sourceArtifact = administrativeArtifact();
    await firstStore.appendArtifact(sourceArtifact);
    await secondStore.appendArtifact(structuredClone(sourceArtifact));
    const sealed = await sealedAdministrative(administrativeEntry(sourceArtifact));

    await firstStore.seal(sealed);
    await expect(secondStore.seal(structuredClone(sealed))).resolves.toBeUndefined();

    expect(secondDb.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(secondDb.prepare("SELECT COUNT(*) FROM artifacts WHERE sealed = 1").pluck().get()).toBe(1);
  });

  test("linearizes simultaneous administrative append and seal commands without a lost race", async () => {
    // Break caught: deferred/no transaction readers racing into SQLITE_BUSY or a uniqueness error.
    const { database: db, path } = fileDatabase();
    const sourceArtifact = administrativeArtifact();
    const appendOutcomes = await raceAdministrativeMethod({
      path,
      method: "appendArtifact",
      args: [sourceArtifact],
    });

    expect.soft(appendOutcomes).toEqual([{ ok: true }, { ok: true }]);
    expect.soft(db.prepare("SELECT COUNT(*) FROM artifacts").pluck().get()).toBe(1);
    expect.soft(db.prepare("SELECT sealed FROM artifacts").pluck().get()).toBe(0);

    const sealed = await sealedAdministrative(administrativeEntry(sourceArtifact));
    const sealOutcomes = await raceAdministrativeMethod({
      path,
      method: "seal",
      args: [sealed],
    });

    expect.soft(sealOutcomes).toEqual([{ ok: true }, { ok: true }]);
    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(db.prepare("SELECT sealed FROM artifacts").pluck().get()).toBe(1);
  }, 15_000);

  test.each([
    ["content", (sealed: SealedEvidence<AdministrativeSourceId, AdministrativeClaim, "administrative">) => {
      (sealed.snapshot.claims[0]!.value as { present: boolean }).present = false;
      (sealed.manifest.snapshot.claims[0]!.value as { present: boolean }).present = false;
      resignEvidence(sealed);
    }],
    ["provenance", (sealed: SealedEvidence<AdministrativeSourceId, AdministrativeClaim, "administrative">) => {
      (sealed.manifest.artifacts[0] as { producer: string }).producer = "other-producer@1";
      resignEvidence(sealed);
    }],
    ["HMAC", (sealed: SealedEvidence<AdministrativeSourceId, AdministrativeClaim, "administrative">) => {
      (sealed.snapshot as { hmac: string }).hmac = "0".repeat(64);
    }],
  ] as const)("maps a same-ID administrative %s collision to integrity_mismatch", async (
    _name,
    mutate,
  ) => {
    // Break caught: leaking raw SQLite constraints or overwriting a sealed snapshot on collision.
    const db = database();
    const store = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(db, INTEGRITY);
    const sourceArtifact = administrativeArtifact();
    await store.appendArtifact(sourceArtifact);
    const sealed = await sealedAdministrative(administrativeEntry(sourceArtifact));
    await store.seal(sealed);
    const storedSnapshot = db.prepare(
      "SELECT snapshot_json FROM evidence_snapshots WHERE id = ?",
    ).pluck().get(sealed.snapshot.id);
    const collision = structuredClone(sealed);
    mutate(collision);

    await expect(store.seal(collision)).rejects.toThrow("integrity_mismatch");
    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(db.prepare(
      "SELECT snapshot_json FROM evidence_snapshots WHERE id = ?",
    ).pluck().get(sealed.snapshot.id)).toBe(storedSnapshot);
  });

  test("rolls back a same-ID administrative artifact-set collision before sealing new rows", async () => {
    // Break caught: marking replacement artifacts sealed before discovering a snapshot collision.
    const db = database();
    const store = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(db, INTEGRITY);
    const originalArtifact = administrativeArtifact();
    await store.appendArtifact(originalArtifact);
    await store.seal(await sealedAdministrative(administrativeEntry(originalArtifact)));
    const replacement = administrativeArtifact(22, {
      artifactId: "administrative-test:replacement-material",
    });
    await store.appendArtifact(replacement);

    const error = await store.seal(
      await sealedAdministrative(administrativeEntry(replacement)),
    ).then(() => undefined, (caught: unknown) => caught);

    expect(db.prepare(
      "SELECT sealed FROM artifacts WHERE artifact_id = ?",
    ).pluck().get(replacement.artifactId)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
    expect(error).toMatchObject({ message: "integrity_mismatch" });
  });

  test("copies administrative bytes and rejects staged provenance or byte drift", async () => {
    // Break caught: retaining caller bytes or sealing a manifest that disagrees with staged content.
    const db = database();
    const store = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(db, INTEGRITY);
    const sourceArtifact = administrativeArtifact();
    const sealed = await sealedAdministrative(administrativeEntry(sourceArtifact));

    await store.appendArtifact(sourceArtifact);
    await store.appendArtifact(administrativeArtifact());
    expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts").get()).toEqual({ count: 1 });
    sourceArtifact.bytes[0] = 255;
    expect(Object.isFrozen(sourceArtifact)).toBe(false);
    expect(Object.isFrozen(sourceArtifact.bytes)).toBe(false);
    expect(db.prepare("SELECT bytes FROM artifacts WHERE artifact_id = ?").pluck().get(
      sourceArtifact.artifactId,
    )).toEqual(Buffer.from([21]));
    await store.seal(sealed);
    expect(db.prepare(`
      SELECT origin, url, captured_at, response_status, response_url, request_json,
             producer, created_at, sealed
      FROM artifacts WHERE artifact_id = ?
    `).get(sourceArtifact.artifactId)).toEqual({
      origin: "administrative",
      url: null,
      captured_at: null,
      response_status: null,
      response_url: null,
      request_json: null,
      producer: "install-city-package@1",
      created_at: "2026-08-24T10:00:00.000Z",
      sealed: 1,
    });

    const provenanceDb = database();
    const provenanceStore = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(provenanceDb, INTEGRITY);
    const persisted = administrativeArtifact();
    await provenanceStore.appendArtifact(persisted);
    await expect(provenanceStore.appendArtifact(administrativeArtifact(22, {
      artifactId: persisted.artifactId,
    }))).rejects.toThrow("integrity_mismatch");
    const driftedProvenance = administrativeArtifact(21, { producer: "other-producer@1" });
    await expect(provenanceStore.seal(
      await sealedAdministrative(administrativeEntry(driftedProvenance)),
    )).rejects.toThrow("integrity_mismatch");

    const driftedBytes = administrativeArtifact(22, {
      artifactId: persisted.artifactId,
    });
    await expect(provenanceStore.seal(
      await sealedAdministrative(administrativeEntry(driftedBytes)),
    )).rejects.toThrow("integrity_mismatch");
    expect(provenanceDb.prepare(
      "SELECT sealed FROM artifacts WHERE artifact_id = ?",
    ).pluck().get(persisted.artifactId)).toBe(0);
    expect(provenanceDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });

    await expect(provenanceStore.appendArtifact(administrativeArtifact(21, {
      sha256: "0".repeat(64),
    }))).rejects.toThrow("integrity_mismatch");
    await expect(provenanceStore.appendArtifact(administrativeArtifact(21, {
      artifactId: "administrative-test:noncanonical-time",
      createdAt: "2026-08-24T10:00:00Z",
    }))).rejects.toThrow("integrity_mismatch");

    const missingDb = database();
    const missingStore = new SqliteAdministrativeEvidenceStore<
      AdministrativeSourceId,
      AdministrativeClaim
    >(missingDb, INTEGRITY);
    await expect(missingStore.seal(await sealedAdministrative()))
      .rejects.toThrow("integrity_mismatch");
    expect(missingDb.prepare("SELECT COUNT(*) AS count FROM evidence_snapshots").get())
      .toEqual({ count: 0 });
  });
});

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

describe("Country Assessment V2 evidence persistence", () => {
  test("uses the exact @3 structural source order while retaining generic storage", async () => {
    const db = database();
    const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    const entries = v3Entries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>);
    }
    const sealed = await sealedV3();

    await store.seal(sealed);

    await expect(store.loadVerified(sealed.snapshot.id, KEY, {
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    })).resolves.toEqual(sealed.snapshot);
    const reversed = await sealedV3([...SLOVENIA_V2_SOURCE_ORDER].reverse());
    await expect(store.seal(reversed)).rejects.toThrow("integrity_mismatch");
  });

  test("rejects hostile borrowed inputs on append, seal, and expected-load without Proxy traps", async () => {
    const db = database();
    const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    const entries = v3Entries();
    let traps = 0;
    const trap = (): never => {
      traps += 1;
      throw new Error("proxy trap must not run");
    };
    const proxiedArtifact = new Proxy(
      entries[0]!.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>,
      { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap },
    );
    const revokedArtifact = Proxy.revocable(
      structuredClone(entries[0]!.parserEntry.artifacts[0]) as LiveCapturedArtifact<SloveniaSourceId>,
      {},
    );
    revokedArtifact.revoke();

    await expect(store.appendArtifact(proxiedArtifact)).rejects.toThrow("integrity_mismatch");
    await expect(store.appendArtifact(revokedArtifact.proxy)).rejects.toThrow("integrity_mismatch");
    expect(traps).toBe(0);

    const polluted = structuredClone(
      entries[0]!.parserEntry.artifacts[0],
    ) as LiveCapturedArtifact<SloveniaSourceId>;
    Object.defineProperty(polluted, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    await expect(store.appendArtifact(polluted)).rejects.toThrow("integrity_mismatch");

    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>);
    }
    const sealed = await sealedV3();
    const proxiedSealed = new Proxy(sealed, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    await expect(store.seal(proxiedSealed)).rejects.toThrow("integrity_mismatch");
    expect(traps).toBe(0);
    await store.seal(sealed);

    const expected = new Proxy({
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    await expect(store.loadVerified(sealed.snapshot.id, KEY, expected)).rejects.toThrow(
      "integrity_mismatch",
    );
    expect(traps).toBe(0);
  });

  test("rejects hostile Uint8Array internals on append, seal, and expected-load without traps", async () => {
    const db = database();
    const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    const entries = v3Entries();
    let traps = 0;
    const trap = (): never => {
      traps += 1;
      throw new Error("typed-array trap must not run");
    };
    const poisonedBytes = (
      poison: "proxy prototype" | "buffer getter" | "byteLength getter",
    ): Uint8Array => {
      const bytes = Uint8Array.of(1, 2, 3);
      if (poison === "proxy prototype") {
        Object.setPrototypeOf(bytes, new Proxy(Uint8Array.prototype, { getPrototypeOf: trap }));
      } else {
        Object.defineProperty(bytes, poison === "buffer getter" ? "buffer" : "byteLength", {
          configurable: true,
          get: trap,
        });
      }
      return bytes;
    };

    const append = structuredClone(
      entries[0]!.parserEntry.artifacts[0],
    ) as LiveCapturedArtifact<SloveniaSourceId>;
    (append as { bytes: Uint8Array }).bytes = poisonedBytes("proxy prototype");
    await expect(store.appendArtifact(append)).rejects.toThrow("integrity_mismatch");
    expect(traps).toBe(0);

    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>);
    }
    const sealed = await sealedV3();
    const sealInput = structuredClone(sealed) as SealedEvidence<SloveniaSourceId, V3Claim>;
    Object.defineProperty(sealInput, "typedArrayPoison", {
      enumerable: true,
      value: poisonedBytes("buffer getter"),
    });
    await expect(store.seal(sealInput)).rejects.toThrow("integrity_mismatch");
    expect(traps).toBe(0);
    await store.seal(sealed);

    const expected = {
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    };
    Object.defineProperty(expected, "typedArrayPoison", {
      enumerable: true,
      value: poisonedBytes("byteLength getter"),
    });
    await expect(store.loadVerified(sealed.snapshot.id, KEY, expected)).rejects.toThrow(
      "integrity_mismatch",
    );
    expect(traps).toBe(0);
  });

  test("projects only exact V3 Evidence into the V2 Knowledge input", async () => {
    const db = database();
    const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    const entries = v3Entries();
    for (const entry of entries) {
      await store.appendArtifact(entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>);
    }
    const sealed = await sealedV3();
    await store.seal(sealed);

    const projected = loadVerifiedCountryEvidenceV2(db, sealed.snapshot.id, KEY);

    expect(projected.snapshot).toEqual(sealed.snapshot);
    expect(projected.entries.map(({ sourceId }) => sourceId)).toEqual([...SLOVENIA_V2_SOURCE_ORDER]);
    expect(projected.artifacts).toHaveLength(entries.length);
    expect(projected.artifacts.every((artifact) => !("bytes" in artifact))).toBe(true);
    expect(() => loadVerifiedCountryEvidence(db, sealed.snapshot.id, KEY))
      .toThrow("integrity_mismatch");
  });

  test("keeps the V1 Knowledge projection closed to V3 and the V2 projection closed to V1", async () => {
    const db = database();
    const v3Store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    for (const entry of v3Entries()) {
      await v3Store.appendArtifact(entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>);
    }
    const v3 = await sealedV3();
    await v3Store.seal(v3);

    const v1Store = new SqliteEvidenceStore(db);
    for (const entry of completeEntries()) {
      await v1Store.appendArtifact(entry.parserEntry.artifacts[0]! as LiveCapturedArtifact);
    }
    const v1 = await sealEvidence({
      id: "v1-knowledge-boundary",
      assessmentDate: ASSESSMENT_DATE,
      entries: completeEntries(),
      parserVersions: EVIDENCE_PARSER_VERSIONS,
      rulesVersion: EVIDENCE_RULES_VERSION,
    }, INTEGRITY);
    await v1Store.seal(v1);

    expect(() => loadVerifiedCountryEvidenceV2(db, v1.snapshot.id, KEY))
      .toThrow("integrity_mismatch");
    expect(() => loadVerifiedCountryEvidence(db, v3.snapshot.id, KEY))
      .toThrow("integrity_mismatch");
  });

  test("rejects @3 Evidence when one parser version drifts", async () => {
    const db = database();
    const store = new SqliteEvidenceStore<SloveniaSourceId, V3Claim>(db);
    for (const entry of v3Entries()) {
      await store.appendArtifact(
        entry.parserEntry.artifacts[0] as LiveCapturedArtifact<SloveniaSourceId>,
      );
    }
    const drifted = await sealedV3(SLOVENIA_V2_SOURCE_ORDER, {
      ...SLOVENIA_V2_PARSER_VERSIONS,
      "si-income-threshold": "si-income@999",
    });
    await store.seal(drifted);

    expect(() => loadVerifiedCountryEvidenceV2(db, drifted.snapshot.id, KEY))
      .toThrow("integrity_mismatch");
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
