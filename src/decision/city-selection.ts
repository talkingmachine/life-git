import { types } from "node:util";

import {
  reconstructCityFrontier,
  type CityFrontierProjection,
  type CityReviewedFactLinkProjection,
  type CityTerminalEntry,
  type ReconstructCityFrontierInput,
} from "./city-frontier-policy";

export interface CitySelectionRequestProjection {
  readonly cityId: string;
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

export interface ReconstructCitySelectionInput {
  readonly frontier: ReconstructCityFrontierInput;
  readonly request: CitySelectionRequestProjection;
}

export interface CitySelectionProjection {
  readonly entry: CityTerminalEntry;
  readonly reviewedSourceLinks: readonly CityReviewedFactLinkProjection[];
  readonly warningCopyVersion?: "city-unknown-risk@1";
}

type PlainRecord = Record<string, unknown>;

function mismatch(): never {
  throw new Error("integrity_mismatch");
}

function atBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error("integrity_mismatch");
  }
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownSnapshot<T>(borrowed: T): T {
  const active = new Set<object>();

  const visit = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") {
      if (types.isProxy(value)) mismatch();
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    active.add(value);
    try {
      if (Array.isArray(value)) return ownArray(value, visit);
      if (!isPlainRecord(value)) mismatch();
      const copy: PlainRecord = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "__proto__") mismatch();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
        copy[key] = visit(descriptor.value);
      }
      return copy;
    } finally {
      active.delete(value);
    }
  };

  return visit(borrowed) as T;
}

function ownArray(value: unknown[], visit: (item: unknown) => unknown): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) mismatch();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) ||
    length.value < 0 || Object.getOwnPropertyNames(value).length !== length.value + 1) mismatch();
  const copy: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) mismatch();
    copy.push(visit(descriptor.value));
  }
  return copy;
}

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (!isPlainRecord(value)) mismatch();
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) mismatch();
  return value;
}

function nonEmptyText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    /[\u0000-\u001f]/.test(value)) mismatch();
  return value;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function parseRequest(value: unknown): CitySelectionRequestProjection {
  if (!isPlainRecord(value)) mismatch();
  const hasWarning = Object.prototype.hasOwnProperty.call(value, "warningCopyVersion");
  const request = exactRecord(value, hasWarning ? ["cityId", "warningCopyVersion"] : ["cityId"]);
  if (hasWarning && request.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  return {
    cityId: nonEmptyText(request.cityId),
    ...(hasWarning ? { warningCopyVersion: "city-unknown-risk@1" as const } : {}),
  };
}

function requirePersistedTerminal(frontier: ReconstructCityFrontierInput): void {
  if (!isPlainRecord(frontier) || !Object.prototype.hasOwnProperty.call(frontier, "persisted") ||
    frontier.persisted === undefined || !isPlainRecord(frontier.persisted) ||
    frontier.persisted.kind !== "terminal") mismatch();
}

function copyEntry(entry: CityTerminalEntry): CityTerminalEntry {
  return {
    cityId: entry.cityId,
    rank: entry.rank,
    markerDigest: entry.markerDigest,
    knowledgeRevisionId: entry.knowledgeRevisionId,
    evidenceSnapshotId: entry.evidenceSnapshotId,
    unknownBasis: entry.unknownBasis.map((warning) => ({
      criterionId: warning.criterionId,
      definitionId: warning.definitionId,
      reason: warning.reason,
    })),
  };
}

function copyReviewedLink(link: CityReviewedFactLinkProjection): CityReviewedFactLinkProjection {
  const hasResolvedUrl = Object.prototype.hasOwnProperty.call(link, "resolvedEvidenceUrl");
  const hasReferenceYear = Object.prototype.hasOwnProperty.call(link, "referenceYear");
  const hasReason = Object.prototype.hasOwnProperty.call(link, "rejectionReason");
  return {
    sourceId: link.sourceId,
    disposition: "reviewed_rejected",
    navigationUrl: link.navigationUrl,
    ...(hasResolvedUrl ? { resolvedEvidenceUrl: link.resolvedEvidenceUrl } : {}),
    ...(hasReferenceYear ? { referenceYear: link.referenceYear } : {}),
    ...(hasReason ? { rejectionReason: link.rejectionReason } : {}),
  };
}

function selectFromTerminal(
  frontierInput: ReconstructCityFrontierInput,
  terminal: Extract<CityFrontierProjection, { kind: "terminal" }>,
  request: CitySelectionRequestProjection,
): CitySelectionProjection {
  const entry = terminal.entries.find((candidate) => candidate.cityId === request.cityId);
  if (entry === undefined) mismatch();
  const binding = frontierInput.markerBindings[entry.rank - 1];
  if (binding === undefined || binding.marker.cityId !== entry.cityId ||
    binding.markerDigest !== entry.markerDigest || binding.marker.status !== "selectable") mismatch();
  if (binding.marker.visualStatus === "green") {
    if (request.warningCopyVersion !== undefined) mismatch();
  } else if (binding.marker.visualStatus === "yellow") {
    if (request.warningCopyVersion !== "city-unknown-risk@1") mismatch();
  } else mismatch();
  const reviewedSourceLinks = binding.marker.facts.flatMap((fact) =>
    fact.manualCheckLinks.map(copyReviewedLink));
  return {
    entry: copyEntry(entry),
    reviewedSourceLinks,
    ...(request.warningCopyVersion === undefined
      ? {}
      : { warningCopyVersion: "city-unknown-risk@1" as const }),
  };
}

function reconstructOwnedSelection(input: ReconstructCitySelectionInput): CitySelectionProjection {
  const root = exactRecord(input, ["frontier", "request"]);
  const request = parseRequest(root.request);
  const frontierInput = root.frontier as ReconstructCityFrontierInput;
  requirePersistedTerminal(frontierInput);
  const frontier = reconstructCityFrontier(frontierInput);
  if (frontier.kind !== "terminal") mismatch();
  return deepFreeze(selectFromTerminal(frontierInput, frontier, request));
}

export function reconstructCitySelection(input: ReconstructCitySelectionInput): CitySelectionProjection {
  return atBoundary(() => reconstructOwnedSelection(ownSnapshot(input)));
}
