import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export interface CitySelectionPublicationWorkerHandle<T> {
  readonly ready: Promise<void>;
  readonly result: Promise<T>;
  terminate(): Promise<number>;
}

export function citySelectionPublicationWorker<T>(input: {
  readonly databasePath: string;
  readonly integrityKey: string;
  readonly gate: SharedArrayBuffer;
  readonly publication: unknown;
  readonly catalogBundle: unknown;
  readonly terminal: unknown;
  readonly ranking: unknown;
  readonly preCityBranch: unknown;
}): CitySelectionPublicationWorkerHandle<T> {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const Database = (await import("better-sqlite3")).default;
        const [writerModule, integrityModule] = await Promise.all([
          tsImport(workerData.writerModule, workerData.parentModule),
          tsImport(workerData.integrityModule, workerData.parentModule),
        ]);
        database = new Database(workerData.databasePath);
        database.pragma("foreign_keys = OFF");
        database.pragma("busy_timeout = 5000");
        const integrity = integrityModule.createEvidenceIntegrity(workerData.integrityKey);
        const catalogs = {
          loadVerified(id) {
            if (id !== workerData.catalogBundle.catalog.id) {
              throw new Error("city_catalog_not_found");
            }
            return structuredClone(workerData.catalogBundle);
          },
        };
        const branches = {
          loadPreCityBranchVerified(id) {
            if (id !== workerData.preCityBranch.id) {
              throw new Error("pre_city_branch_not_found");
            }
            return structuredClone(workerData.preCityBranch);
          },
        };
        const rankings = {
          loadRankingVerified(id) {
            if (id !== workerData.ranking.id) throw new Error("city_ranking_not_found");
            return structuredClone(workerData.ranking);
          },
        };
        const frontier = {
          loadRevisionVerified(id) {
            if (id !== workerData.terminal.id) throw new Error("city_frontier_not_found");
            return structuredClone(workerData.terminal);
          },
        };
        const writer = new writerModule.SqliteCitySelectionWriter(database, integrity, {
          catalogs,
          branches,
          rankings,
          frontier,
        });
        parentPort.postMessage({ type: "ready" });
        const gate = new Int32Array(workerData.gate);
        Atomics.add(gate, 0, 1);
        Atomics.notify(gate, 0);
        Atomics.wait(gate, 1, 0);
        const value = await writer.publishSelection(workerData.publication);
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
  const moduleUrl = (path: string) => pathToFileURL(resolve(path)).href;
  const worker = new Worker(source, {
    eval: true,
    workerData: {
      ...input,
      parentModule: moduleUrl("tests/support/city-selection-publication-worker.ts"),
      writerModule: moduleUrl("src/infrastructure/sqlite/city-selection-writer.ts"),
      integrityModule: moduleUrl("src/infrastructure/integrity.ts"),
    },
  });
  let resolveReady!: () => void;
  let resolveResult!: (value: T) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolvePromise) => { resolveReady = resolvePromise; });
  const result = new Promise<T>((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise;
    rejectResult = rejectPromise;
  });
  void result.catch(() => undefined);
  const reject = (error: Error): void => {
    resolveReady();
    rejectResult(error);
  };
  worker.on("message", (message: {
    readonly type: "ready" | "result" | "error";
    readonly value?: T;
    readonly message?: string;
  }) => {
    if (message.type === "ready") resolveReady();
    if (message.type === "result") resolveResult(message.value!);
    if (message.type === "error") reject(new Error(message.message ?? "worker_failed"));
  });
  worker.on("error", reject);
  return { ready, result, terminate: () => worker.terminate() };
}
