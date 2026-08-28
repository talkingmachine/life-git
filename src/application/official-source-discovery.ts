import { types } from "node:util";

import type { CodexInvocationMetadata } from "../infrastructure/codex-cli/contracts";

export interface OfficialSourceDiscoveryPort {
  discover(input: OfficialSourceDiscoveryRequest): Promise<OfficialSourceDiscoveryResult>;
}

export type OfficialSourceDiscoveryRequest = Readonly<{
  schemaVersion: "official-source-discovery-request@1";
  entity: Readonly<{ entityId: string; kind: "country" | "city"; countryCode: string; displayName: string }>;
  fact: Readonly<{ factKey: string; definitionId: string; description: string }>;
  failedSource: Readonly<{ url: string; reason: "unavailable" | "stale" | "empty" | "semantic_drift" | "not_covering_fact" }>;
  authorityRoots: readonly Readonly<{ publisherName: string; url: string }>[];
  localeHints: readonly string[];
  round: 1 | 2;
  signal: AbortSignal;
}>;

export type OfficialSourceCandidate = Readonly<{
  url: string;
  claimedPublisher: string;
  expectedCoverage: string;
  rationale: string;
}>;

export type OfficialSourceDiscoveryResult = Readonly<{
  candidates: readonly OfficialSourceCandidate[];
  metadata: CodexInvocationMetadata;
}>;

export type OfficialSourceDiscoveryErrorCode =
  | "official_source_discovery_aborted"
  | "official_source_discovery_integrity_failed"
  | "official_source_discovery_invalid"
  | "official_source_discovery_runtime_failed";

export class OfficialSourceDiscoveryError extends Error {
  readonly name = "OfficialSourceDiscoveryError";

  constructor(readonly code: OfficialSourceDiscoveryErrorCode, readonly runtimeCode?: string) {
    super(code);
  }
}

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_TEXT_BYTES = 1_024;

export function reconstructOfficialSourceDiscoveryRequest(value: unknown): OfficialSourceDiscoveryRequest {
  try {
    const input = readExactObject(value, [
      "schemaVersion", "entity", "fact", "failedSource", "authorityRoots", "localeHints", "round", "signal",
    ]);
    if (input.schemaVersion !== "official-source-discovery-request@1") invalid();
    const entity = readExactObject(input.entity, ["entityId", "kind", "countryCode", "displayName"]);
    if (entity.kind !== "country" && entity.kind !== "city") invalid();
    const fact = readExactObject(input.fact, ["factKey", "definitionId", "description"]);
    const failedSource = readExactObject(input.failedSource, ["url", "reason"]);
    if (!isFailureReason(failedSource.reason)) invalid();
    const authorityRoots = readArray(input.authorityRoots, 8).map((root) => {
      const fields = readExactObject(root, ["publisherName", "url"]);
      return Object.freeze({
        publisherName: requiredText(fields.publisherName, MAX_IDENTIFIER_BYTES),
        url: canonicalHttpsUrl(fields.url),
      });
    });
    const localeHints = readArray(input.localeHints, 8).map((hint) => requiredText(hint, MAX_IDENTIFIER_BYTES));
    if (input.round !== 1 && input.round !== 2) invalid();
    const signal = nativeSignal(input.signal);
    return Object.freeze({
      schemaVersion: "official-source-discovery-request@1" as const,
      entity: Object.freeze({
        entityId: requiredText(entity.entityId, MAX_IDENTIFIER_BYTES),
        kind: entity.kind,
        countryCode: requiredText(entity.countryCode, MAX_IDENTIFIER_BYTES),
        displayName: requiredText(entity.displayName, MAX_IDENTIFIER_BYTES),
      }),
      fact: Object.freeze({
        factKey: requiredText(fact.factKey, MAX_IDENTIFIER_BYTES),
        definitionId: requiredText(fact.definitionId, MAX_IDENTIFIER_BYTES),
        description: requiredText(fact.description, MAX_TEXT_BYTES),
      }),
      failedSource: Object.freeze({ url: canonicalHttpsUrl(failedSource.url), reason: failedSource.reason }),
      authorityRoots: Object.freeze(authorityRoots),
      localeHints: Object.freeze(localeHints),
      round: input.round,
      signal,
    });
  } catch (error) {
    if (error instanceof OfficialSourceDiscoveryError) throw error;
    invalid();
  }
}

export function canonicalHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || utf8Bytes(value) > MAX_TEXT_BYTES) invalid();
  let parsed: URL;
  try { parsed = new URL(value); } catch { invalid(); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" ||
    isPrivateHostname(parsed.hostname) || parsed.href !== value) invalid();
  return parsed.href;
}

function readExactObject(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
  if (Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) invalid();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function readArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1 || Object.getOwnPropertySymbols(value).length !== 0) invalid();
  const copy: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) invalid();
    copy.push(descriptor.value);
  }
  return copy;
}

function requiredText(value: unknown, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || utf8Bytes(value) > maximumBytes) invalid();
  return value;
}

function nativeSignal(value: unknown): AbortSignal {
  if (value === null || typeof value !== "object" || types.isProxy(value) || NATIVE_ABORTED_GETTER === undefined) invalid();
  try { NATIVE_ABORTED_GETTER.call(value); } catch { invalid(); }
  return value as AbortSignal;
}

function isFailureReason(value: unknown): value is OfficialSourceDiscoveryRequest["failedSource"]["reason"] {
  return value === "unavailable" || value === "stale" || value === "empty" || value === "semantic_drift" || value === "not_covering_fact";
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 === null) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }

function invalid(): never { throw new OfficialSourceDiscoveryError("official_source_discovery_invalid"); }
