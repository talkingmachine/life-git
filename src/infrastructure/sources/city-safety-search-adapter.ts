import type {
  CitySafetySearchPort,
  CitySafetySearchResponse,
} from "../../application/city-safety-contracts";
import { canonicalizeCitySafetyCandidateUrl } from "../../research/city-safety-discovery";
import type { CitySafetySearchStep } from "./http-city-safety-search-step";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

function completedResponse(
  value: unknown,
  providerId: string,
  resultLimit: number,
): CitySafetySearchResponse {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "urls" ||
    !Array.isArray(value.urls) || value.urls.length > resultLimit ||
    !value.urls.every((url) => typeof url === "string")) {
    throw new Error("invalid_city_safety_search_protocol");
  }
  for (const url of value.urls) canonicalizeCitySafetyCandidateUrl(url);
  return { kind: "completed", providerId, urls: [...value.urls] as string[] };
}

export function createCitySafetySearchPort(input: {
  readonly step: CitySafetySearchStep;
  readonly providerId: string;
}): CitySafetySearchPort {
  if (!isRecord(input) || Object.keys(input).sort().join(",") !== "providerId,step" ||
    typeof input.step !== "function" || !validProviderId(input.providerId)) {
    throw new Error("invalid_city_safety_search_config");
  }
  return {
    async search(request): Promise<CitySafetySearchResponse> {
      if (!Number.isSafeInteger(request.resultLimit) || request.resultLimit < 1 ||
        request.resultLimit > 10) throw new Error("invalid_city_safety_search_protocol");
      const result = await input.step({ query: request.query, resultLimit: request.resultLimit }, request.signal);
      if (!isRecord(result) || (result.kind !== "completed" && result.kind !== "unavailable")) {
        throw new Error("invalid_city_safety_search_protocol");
      }
      if (result.kind === "completed") {
        if (Object.keys(result).sort().join(",") !== "kind,payload") {
          throw new Error("invalid_city_safety_search_protocol");
        }
        return completedResponse(result.payload, input.providerId, request.resultLimit);
      }
      if (Object.keys(result).sort().join(",") !== "kind,reason" ||
        result.reason !== "provider_unavailable") throw new Error("invalid_city_safety_search_protocol");
      return { kind: "unavailable", providerId: input.providerId, reason: result.reason };
    },
  };
}

export function createUnconfiguredCitySafetySearchPort(): CitySafetySearchPort {
  return {
    async search() {
      return {
        kind: "unavailable",
        providerId: "search-provider-unconfigured",
        reason: "search_provider_unconfigured",
      };
    },
  };
}
