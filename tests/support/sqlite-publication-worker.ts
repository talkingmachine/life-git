import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

export interface SqlitePublicationWorkerHandle<T> {
  readonly ready: Promise<void>;
  readonly result: Promise<T>;
}

export function sqlitePublicationWorker<T>(input: {
  readonly path: string;
  readonly key: string;
  readonly start: SharedArrayBuffer;
  readonly storeModulePath: string;
  readonly storeExportName: string;
  readonly methodName: string;
  readonly args: readonly unknown[];
}): SqlitePublicationWorkerHandle<T> {
  const source = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      let database;
      try {
        const { tsImport } = await import("tsx/esm/api");
        const storeModule = await tsImport(workerData.storeModule, workerData.parentModule);
        const Store = storeModule[workerData.storeExportName];
        const Database = (await import("better-sqlite3")).default;
        database = new Database(workerData.path);
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 3000");
        parentPort.postMessage({ type: "ready" });
        const start = new Int32Array(workerData.start);
        Atomics.wait(start, 0, 0);
        const store = new Store(database, workerData.key);
        const value = store[workerData.methodName](...workerData.args);
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
      storeModule: pathToFileURL(resolve(input.storeModulePath)).href,
      parentModule: pathToFileURL(resolve("tests/support/sqlite-publication-worker.ts")).href,
    },
  });
  let readyResolve!: () => void;
  let resultResolve!: (value: T) => void;
  let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolveReady) => { readyResolve = resolveReady; });
  const result = new Promise<T>((resolveResult, rejectResult) => {
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
    readonly value?: T;
    readonly message?: string;
  }) => {
    if (message.type === "ready") readyResolve();
    if (message.type === "result") resultResolve(message.value!);
    if (message.type === "error") reject(new Error(message.message ?? "worker_failed"));
  });
  worker.on("error", reject);
  return { ready, result };
}
