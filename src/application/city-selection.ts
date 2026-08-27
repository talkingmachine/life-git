import { types } from "node:util";

import type {
  CityFrontierSelectionAuthorityPort,
} from "./city-frontier";
import {
  createCitySelectionWithBranch,
  reconstructCitySelectionWithBranch,
  type CityFrontierReadModel,
  type CitySelectionSnapshot,
  type CitySelectionWriterPort,
} from "./city-frontier-contracts";
import {
  replayPreCityBranchCommit,
  type CityBranchCommit,
} from "../branch/city";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import { reconstructCitySelection } from "../decision/city-selection";

export interface SelectCityInput {
  readonly terminalCityShortlistSnapshotId: string;
  readonly cityId: string;
  readonly commandId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export interface CitySelectionApplication {
  selectCity(input: SelectCityInput): Promise<{
    readonly selection: CitySelectionSnapshot;
    readonly commit: CityBranchCommit;
    readonly readModel: CityFrontierReadModel;
  }>;
}

export interface CitySelectionApplicationPorts {
  readonly frontier: CityFrontierSelectionAuthorityPort;
  readonly writer: CitySelectionWriterPort;
  readonly integrity: CityDecisionIntegrity;
  readonly clock: () => Date;
}

type PlainRecord = Record<string, unknown>;

const PORT_KEYS = ["frontier", "writer", "integrity", "clock"] as const;
const INPUT_REQUIRED_KEYS = [
  "terminalCityShortlistSnapshotId", "cityId", "commandId",
] as const;
const INPUT_OPTIONAL_KEYS = ["warningCopyVersion"] as const;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0;
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  if (!isPlainRecord(value)) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!required.every((key) => keys.includes(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))) mismatch();
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function callable(value: unknown): (...args: never[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value)) mismatch();
  return value as (...args: never[]) => unknown;
}

function methods(value: unknown, keys: readonly string[]): Readonly<PlainRecord> {
  const record = exactRecord(value, keys);
  return Object.freeze(Object.fromEntries(keys.map((key) => {
    const method = callable(record[key]);
    return [key, (...args: never[]) => Reflect.apply(method, record, args)];
  })));
}

function writerMethods(value: unknown): Readonly<PlainRecord> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    types.isProxy(value) || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return methods(value, [
      "publishSelection",
      "loadSelectionWithBranchVerified",
      "listSelectionsWithBranchesVerified",
    ]);
  }
  const captured = Object.fromEntries([
    "publishSelection",
    "loadSelectionWithBranchVerified",
    "listSelectionsWithBranchesVerified",
  ].map((key) => {
    const method = inheritedWriterMethod(value, key);
    return [key, (...args: never[]) => Reflect.apply(method, value, args)];
  }));
  return Object.freeze(captured);
}

function inheritedWriterMethod(value: object, key: string): (...args: never[]) => unknown {
  let prototype = Object.getPrototypeOf(value) as object | null;
  for (let depth = 0; depth < 3 && prototype !== null &&
    prototype !== Object.prototype; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function" ||
        types.isProxy(descriptor.value)) mismatch();
      return descriptor.value as (...args: never[]) => unknown;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  mismatch();
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) mismatch();
  return value;
}

function captureInput(value: SelectCityInput): Readonly<SelectCityInput> {
  const record = exactRecord(value, INPUT_REQUIRED_KEYS, INPUT_OPTIONAL_KEYS);
  const hasWarning = Object.prototype.hasOwnProperty.call(record, "warningCopyVersion");
  if (hasWarning && record.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  return Object.freeze({
    terminalCityShortlistSnapshotId: identifier(record.terminalCityShortlistSnapshotId),
    cityId: identifier(record.cityId),
    commandId: identifier(record.commandId),
    ...(hasWarning ? { warningCopyVersion: "city-unknown-risk@1" as const } : {}),
  });
}

function capturePorts(value: CitySelectionApplicationPorts): Readonly<CitySelectionApplicationPorts> {
  const root = exactRecord(value, PORT_KEYS);
  const frontier = methods(root.frontier, ["loadCurrentTerminalSelectionAuthority"]);
  const writer = writerMethods(root.writer);
  const integrity = methods(root.integrity, ["canonical", "hash"]);
  const clock = callable(root.clock) as () => Date;
  return Object.freeze({
    frontier: frontier as unknown as CityFrontierSelectionAuthorityPort,
    writer: writer as unknown as CitySelectionWriterPort,
    integrity: integrity as unknown as CityDecisionIntegrity,
    clock: () => Reflect.apply(clock, Object.freeze({ capability: "clock" }), []),
  });
}

function serverInstant(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) mismatch();
  return value.toISOString();
}

function sameValue(left: unknown, right: unknown, integrity: CityDecisionIntegrity): boolean {
  try {
    return integrity.canonical(left) === integrity.canonical(right);
  } catch {
    mismatch();
  }
}

function requestOf(input: Readonly<SelectCityInput>): Readonly<{
  readonly cityId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}> {
  return Object.freeze({
    cityId: input.cityId,
    ...(input.warningCopyVersion === undefined
      ? {}
      : { warningCopyVersion: input.warningCopyVersion }),
  });
}

async function selectCity(
  input: Readonly<SelectCityInput>,
  ports: Readonly<CitySelectionApplicationPorts>,
): Promise<Awaited<ReturnType<CitySelectionApplication["selectCity"]>>> {
  const authority = await ports.frontier.loadCurrentTerminalSelectionAuthority(
    input.terminalCityShortlistSnapshotId,
  );
  const preCityBranch = replayPreCityBranchCommit(
    authority.preCityBranch,
    authority.preCitySource,
    ports.integrity,
  );
  const selection = reconstructCitySelection({
    frontier: authority.frontier,
    request: requestOf(input),
  });
  const pair = createCitySelectionWithBranch({
    terminal: authority.terminal,
    ranking: authority.ranking,
    preCityBranch,
    commandId: input.commandId,
    selection,
    createdAt: serverInstant(ports.clock),
  }, ports.integrity);
  const published = await ports.writer.publishSelection(Object.freeze({
    commandId: input.commandId,
    intent: Object.freeze({
      terminalCityShortlistSnapshotId: input.terminalCityShortlistSnapshotId,
      cityId: input.cityId,
      ...(input.warningCopyVersion === undefined
        ? {}
        : { warningCopyVersion: input.warningCopyVersion }),
    }),
    pair,
  }));

  const reloaded = await ports.frontier.loadCurrentTerminalSelectionAuthority(
    input.terminalCityShortlistSnapshotId,
  );
  const reloadedPreCity = replayPreCityBranchCommit(
    reloaded.preCityBranch,
    reloaded.preCitySource,
    ports.integrity,
  );
  reconstructCitySelection({ frontier: reloaded.frontier, request: requestOf(input) });
  const verified = reconstructCitySelectionWithBranch(published, {
    terminal: reloaded.terminal,
    ranking: reloaded.ranking,
    preCityBranch: reloadedPreCity,
  }, ports.integrity);
  const matching = reloaded.readModel.selections.filter((candidate) =>
    candidate.selection.id === verified.selection.id &&
    candidate.commit.id === verified.commit.id &&
    sameValue(candidate, verified, ports.integrity));
  if (matching.length !== 1) mismatch();
  return Object.freeze({
    selection: verified.selection,
    commit: verified.commit,
    readModel: reloaded.readModel,
  });
}

export function createCitySelectionApplication(
  ports: CitySelectionApplicationPorts,
): Readonly<CitySelectionApplication> {
  const captured = capturePorts(ports);
  return Object.freeze({
    selectCity: async (input: SelectCityInput) => selectCity(captureInput(input), captured),
  });
}
