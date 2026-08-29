import { canonicalHttpsUrl, OfficialSourceDiscoveryError, reconstructOfficialSourceDiscoveryRequest, type OfficialSourceDiscoveryPort } from "./official-source-discovery";
import { reconstructCitySafetySourcePlan, reconstructOfficialAuthorityDirectory } from "../research/city-safety-source-plan";
import type { CitySafetyOfficialDiscoveryPort, CitySafetyOfficialDiscoveryResult } from "./city-safety-contracts";
import type { CityCatalogRevision } from "../decision/city-catalog";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CitySafetySourcePlan, OfficialAuthorityDirectory } from "../research/city-safety-source-plan";

const UNAVAILABLE = new Set(["codex_search_not_performed", "codex_timeout", "codex_rate_limited", "codex_provider_transient"]);
const bad = (): never => { throw new Error("integrity_mismatch"); };
type Input = Readonly<{ runId: string; catalog: CityCatalogRevision; integrity: CityDecisionIntegrity; sourcePlan: CitySafetySourcePlan; authorityDirectory: OfficialAuthorityDirectory; cityId: string; failedUrl: string; reason: "unavailable" | "stale" | "empty" | "semantic_drift" | "not_covering_fact"; signal: AbortSignal }>;
export function createCitySafetyOfficialDiscoveryAdapter(port: OfficialSourceDiscoveryPort): CitySafetyOfficialDiscoveryPort {
  return Object.freeze({ async discover(input: Input): Promise<CitySafetyOfficialDiscoveryResult> {
    const directory = reconstructOfficialAuthorityDirectory(input.authorityDirectory, input.catalog, input.integrity);
    const plan = reconstructCitySafetySourcePlan(input.sourcePlan, input.catalog, directory, input.integrity);
    const city = plan.entries.find((entry) => entry.cityId === input.cityId);
    if (city === undefined) return bad();
    const roots = directory.publishers.map(({ publisherId, navigationUrl }) => ({ publisherName: publisherId, url: navigationUrl }));
    for (const round of [1, 2] as const) try {
      const value = await port.discover(reconstructOfficialSourceDiscoveryRequest({ schemaVersion: "official-source-discovery-request@1", entity: { entityId: city.cityId, kind: "city", countryCode: "SI", displayName: city.officialCityNames[0]! }, fact: { factKey: "si-city-safety", definitionId: plan.definitionId, description: "Municipal police offences per 100000 residents" }, failedSource: { url: canonicalHttpsUrl(input.failedUrl), reason: input.reason }, authorityRoots: roots, localeHints: ["sl", "en"], round, signal: input.signal }));
      if (value === null || typeof value !== "object" || Array.isArray(value)) bad();
      const result = value as { candidates?: unknown };
      if (!Array.isArray(result.candidates) || result.candidates.length > 5) bad();
      const candidates = result.candidates as unknown[];
      const urls: readonly string[] = Object.freeze([...new Set(candidates.map((candidate: unknown): string => {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) || typeof (candidate as { url?: unknown }).url !== "string") bad();
        return canonicalHttpsUrl((candidate as { url: string }).url);
      }))]);
      if (urls.length > 0) return Object.freeze({ kind: "candidates", urls });
    } catch (error) {
      if (error instanceof OfficialSourceDiscoveryError && error.runtimeCode !== undefined && UNAVAILABLE.has(error.runtimeCode)) return Object.freeze({ kind: "yellow", reason: error.runtimeCode as "codex_search_not_performed" | "codex_timeout" | "codex_rate_limited" | "codex_provider_transient" });
      throw error;
    }
    return Object.freeze({ kind: "candidates", urls: Object.freeze([]) });
  } });
}
