import { types } from "node:util";
import { canonicalHttpsUrl, OfficialSourceDiscoveryError, reconstructOfficialSourceDiscoveryRequest, type OfficialSourceDiscoveryPort, type OfficialSourceDiscoveryResult, type OfficialSourceDiscoveryRuntimeMetadata } from "./official-source-discovery";
import { reconstructCitySafetySourcePlan, reconstructOfficialAuthorityDirectory } from "../research/city-safety-source-plan";
import type { CitySafetyOfficialDiscoveryPort, CitySafetyOfficialDiscoveryResult } from "./city-safety-contracts";
import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CitySafetySourcePlan, OfficialAuthorityDirectory } from "../research/city-safety-source-plan";

const YELLOW = new Set(["codex_search_not_performed", "codex_timeout", "codex_rate_limited", "codex_provider_transient"]);
const RESULT = ["candidates", "metadata"] as const;
const CANDIDATE = ["url", "claimedPublisher", "expectedCoverage", "rationale"] as const;
const METADATA = ["invocationVersion", "protocolVersion", "compatibilityPolicy", "cliVersion", "model", "reasoningEffort", "toolPolicy", "templateVersion", "schemaVersion"] as const;
type Input = Readonly<{ runId: string; catalog: CityCatalogRevision; integrity: CityDecisionIntegrity; sourcePlan: CitySafetySourcePlan; authorityDirectory: OfficialAuthorityDirectory; cityId: string; failedUrl: string; reason: "unavailable" | "stale" | "empty" | "semantic_drift" | "not_covering_fact"; round: 1 | 2; signal: AbortSignal }>;
type YellowReason = Extract<CitySafetyOfficialDiscoveryResult, { kind: "yellow" }>["reason"];

function integrity(): never { throw new OfficialSourceDiscoveryError("official_source_discovery_integrity_failed"); }
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) integrity();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || !keys.every((key) => Object.hasOwn(descriptors, key))) integrity();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const d = descriptors[key]; if (d?.enumerable !== true || !("value" in d)) integrity(); copy[key] = d.value; }
  return copy;
}
function denseArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0) integrity();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) integrity();
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) { const d = descriptors[String(i)]; if (d?.enumerable !== true || !("value" in d)) integrity(); copy.push(d.value); }
  return copy;
}
function text(value: unknown): string { if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > 1_024) integrity(); return value; }
function reviewedResult(value: unknown): Readonly<{ urls: readonly string[]; metadata: OfficialSourceDiscoveryRuntimeMetadata }> {
  const result = exactObject(value, RESULT); const metadata = exactObject(result.metadata, METADATA);
  if (metadata.invocationVersion !== "codex-cli-invocation@2" || metadata.protocolVersion !== "codex-cli-protocol@2" || metadata.compatibilityPolicy !== "codex-cli-0.149.0-alpha.4-plus@2" || metadata.model !== "gpt-5.4" || metadata.reasoningEffort !== "medium" || metadata.toolPolicy !== "codex-tools-web-search@2" || metadata.templateVersion !== "official-source-discover@3" || metadata.schemaVersion !== "official-source-candidates@1") integrity();
  const frozenMetadata = Object.freeze({ invocationVersion: metadata.invocationVersion, protocolVersion: metadata.protocolVersion, compatibilityPolicy: metadata.compatibilityPolicy, cliVersion: text(metadata.cliVersion), model: metadata.model, reasoningEffort: metadata.reasoningEffort, toolPolicy: metadata.toolPolicy, templateVersion: metadata.templateVersion, schemaVersion: metadata.schemaVersion }) as OfficialSourceDiscoveryRuntimeMetadata;
  const urls = Object.freeze(denseArray(result.candidates, 5).map((candidate) => { const fields = exactObject(candidate, CANDIDATE); text(fields.claimedPublisher); text(fields.expectedCoverage); text(fields.rationale); return canonicalHttpsUrl(fields.url); }));
  return Object.freeze({ urls: Object.freeze([...new Set(urls)]), metadata: frozenMetadata });
}
function yellowRuntime(error: unknown): YellowReason | undefined {
  if (error === null || typeof error !== "object" || types.isProxy(error) || !types.isNativeError(error) || Object.getPrototypeOf(error) !== OfficialSourceDiscoveryError.prototype) return undefined;
  const code = Object.getOwnPropertyDescriptor(error, "code"); const runtime = Object.getOwnPropertyDescriptor(error, "runtimeCode");
  if (code?.enumerable !== true || !("value" in code) || code.value !== "official_source_discovery_runtime_failed" || runtime?.enumerable !== true || !("value" in runtime) || typeof runtime.value !== "string" || !YELLOW.has(runtime.value)) return undefined;
  return runtime.value as YellowReason;
}

export function createCitySafetyOfficialDiscoveryAdapter(port: OfficialSourceDiscoveryPort): CitySafetyOfficialDiscoveryPort {
  return Object.freeze({ async discover(input: Input): Promise<CitySafetyOfficialDiscoveryResult> {
    const directory = reconstructOfficialAuthorityDirectory(input.authorityDirectory, input.catalog, input.integrity);
    const plan = reconstructCitySafetySourcePlan(input.sourcePlan, input.catalog, directory, input.integrity);
    const city = plan.entries.find((entry) => entry.cityId === input.cityId); if (city === undefined) integrity();
    const authorityRoots = directory.publishers.map(({ publisherId, navigationUrl }) => ({ publisherName: publisherId, url: navigationUrl }));
    try {
      const result = reviewedResult(await port.discover(reconstructOfficialSourceDiscoveryRequest({ schemaVersion: "official-source-discovery-request@1", entity: { entityId: city.cityId, kind: "city", countryCode: "SI", displayName: city.officialCityNames[0]! }, fact: { factKey: "si-city-safety", definitionId: plan.definitionId, description: "Municipal police offences per 100000 residents" }, failedSource: { url: canonicalHttpsUrl(input.failedUrl), reason: input.reason }, authorityRoots, localeHints: ["sl", "en"], round: input.round, signal: input.signal })) as OfficialSourceDiscoveryResult);
      return Object.freeze({ kind: "candidates", urls: result.urls, metadata: result.metadata });
    } catch (error) { const reason = yellowRuntime(error); if (reason !== undefined) return Object.freeze({ kind: "yellow", reason }); throw error; }
  } });
}
