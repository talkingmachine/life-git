import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export interface CityFrontierWorkerHandle<T> {
  readonly ready: Promise<void>;
  readonly result: Promise<T>;
  terminate(): Promise<number>;
}

export function cityFrontierPublicationWorker<T>(input: {
  readonly databasePath: string;
  readonly integrityKey: string;
  readonly gate: SharedArrayBuffer;
  readonly catalogBundle: unknown;
  readonly countryLocator: unknown;
  readonly action:
    | { readonly kind: "publishStart"; readonly publication: unknown }
    | { readonly kind: "appendRevision"; readonly revision: unknown };
}): CityFrontierWorkerHandle<T> {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const Database = (await import("better-sqlite3")).default;
        const [{ SqliteCityCriteriaStore }, { SqliteCityBranchStore },
          { SqliteCityFrontierStore }, { createEvidenceIntegrity }] = await Promise.all([
          tsImport(workerData.criteriaModule, workerData.parentModule),
          tsImport(workerData.branchModule, workerData.parentModule),
          tsImport(workerData.frontierModule, workerData.parentModule),
          tsImport(workerData.integrityModule, workerData.parentModule),
        ]);
        database = new Database(workerData.databasePath);
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 5000");
        const integrity = createEvidenceIntegrity(workerData.integrityKey);
        const criteria = new SqliteCityCriteriaStore(database, integrity);
        const countries = {
          locateChainVerified(input) {
            const locator = workerData.countryLocator;
            const head = locator.revisions.at(-1);
            const matches = "revisionId" in input
              ? input.revisionId === head?.id
              : input.resolutionRunId === locator.resolutionRunId;
            if (!matches) throw new Error("country_resolution_not_found");
            return structuredClone(locator);
          },
        };
        const branches = new SqliteCityBranchStore(database, integrity, countries);
        const catalogs = {
          appendVerified() { throw new Error("unexpected_catalog_append"); },
          loadVerified(id) {
            if (id !== workerData.catalogBundle.catalog.id) {
              throw new Error("city_catalog_not_found");
            }
            return structuredClone(workerData.catalogBundle);
          },
        };
        const frontier = new SqliteCityFrontierStore(database, integrity, {
          criteria,
          branches,
          catalogs,
        });
        parentPort.postMessage({ type: "ready" });
        const gate = new Int32Array(workerData.gate);
        Atomics.add(gate, 0, 1);
        Atomics.notify(gate, 0);
        Atomics.wait(gate, 1, 0);
        const action = workerData.action;
        const value = action.kind === "publishStart"
          ? frontier.publishStart(action.publication)
          : frontier.appendRevision({ revision: action.revision });
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
      parentModule: moduleUrl("tests/support/city-frontier-publication-worker.ts"),
      criteriaModule: moduleUrl("src/infrastructure/sqlite/city-criteria-store.ts"),
      branchModule: moduleUrl("src/infrastructure/sqlite/city-branch-store.ts"),
      frontierModule: moduleUrl("src/infrastructure/sqlite/city-frontier-store.ts"),
      integrityModule: moduleUrl("src/infrastructure/integrity.ts"),
    },
  });
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (value: T) => void;
  let rejectResult!: (error: Error) => void;
  let readySettled = false;
  let resultSettled = false;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = () => {
      readySettled = true;
      resolvePromise();
    };
    rejectReady = (error) => {
      readySettled = true;
      rejectPromise(error);
    };
  });
  const result = new Promise<T>((resolvePromise, rejectPromise) => {
    resolveResult = (value) => {
      resultSettled = true;
      resolvePromise(value);
    };
    rejectResult = (error) => {
      resultSettled = true;
      rejectPromise(error);
    };
  });
  void ready.catch(() => undefined);
  void result.catch(() => undefined);
  const reject = (error: Error): void => {
    const gate = new Int32Array(input.gate);
    Atomics.store(gate, 1, 1);
    Atomics.notify(gate, 1);
    if (!readySettled) rejectReady(error);
    if (!resultSettled) rejectResult(error);
  };
  worker.on("message", (message: {
    readonly type: "ready" | "result" | "error";
    readonly value?: T;
    readonly message?: string;
  }) => {
    if (message.type === "ready") resolveReady();
    else if (message.type === "result") resolveResult(message.value!);
    else reject(new Error(message.message ?? "city_frontier_worker_failed"));
  });
  worker.on("error", reject);
  worker.on("exit", (code) => {
    if (code !== 0 || !resultSettled) {
      reject(new Error(`city_frontier_worker_exit_${code}`));
    }
  });
  return { ready, result, terminate: () => worker.terminate() };
}
