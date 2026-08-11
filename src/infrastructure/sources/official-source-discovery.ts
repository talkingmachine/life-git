import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type {
  ClaimKind,
  OfficialSourceDiscoveryInput,
  OfficialSourceDiscoveryPort,
  OfficialSourceDiscoveryResult,
  SourceCandidate,
} from "../../research/cold-start-contracts";
import { REQUIRED_CLAIM_KINDS, SI_AUTHORITY_ROOTS } from "../../research/country-registry";

const INSTALLED_HOSTS = ["www.gov.si", "pisrs.si", "pxweb.stat.si", "www.ess.gov.si"] as const;
const MODEL = "gpt-5.6" as const;

const candidateSchema = z.object({
  candidateId: z.string().trim().min(1),
  url: z.string().trim().min(1),
  authorityRoot: z.string().trim().min(1),
  claimKinds: z.array(z.enum(REQUIRED_CLAIM_KINDS)).min(1),
}).strict();

const discoverySchema = z.object({
  candidates: z.array(candidateSchema).max(6),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsRefusal(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.output)) return false;
  return value.output.some((item) =>
    isRecord(item) &&
    item.type === "message" &&
    Array.isArray(item.content) &&
    item.content.some((content) => isRecord(content) && content.type === "refusal")
  );
}

function parsedOutput(value: unknown): unknown {
  return isRecord(value) ? value.output_parsed : undefined;
}

function invalidOutput(): OfficialSourceDiscoveryResult {
  return { ok: false, kind: "invalid_output", candidates: [] };
}

function validatedCandidates(
  value: unknown,
  input: OfficialSourceDiscoveryInput,
): readonly SourceCandidate[] | null {
  const parsed = discoverySchema.safeParse(value);
  if (!parsed.success) return null;
  const requested = new Set<ClaimKind>(input.requiredClaimKinds);
  const candidates: SourceCandidate[] = [];
  for (const candidate of parsed.data.candidates) {
    let url: URL;
    try {
      url = new URL(candidate.url);
    } catch {
      return null;
    }
    const uniqueKinds = new Set(candidate.claimKinds);
    const rootIndex = SI_AUTHORITY_ROOTS.indexOf(
      candidate.authorityRoot as (typeof SI_AUTHORITY_ROOTS)[number],
    );
    if (
      url.protocol !== "https:" ||
      !INSTALLED_HOSTS.includes(url.host.toLowerCase() as (typeof INSTALLED_HOSTS)[number]) ||
      rootIndex < 0 ||
      INSTALLED_HOSTS[rootIndex] !== url.host.toLowerCase() ||
      uniqueKinds.size !== candidate.claimKinds.length ||
      candidate.claimKinds.some((kind) => !requested.has(kind))
    ) {
      return null;
    }
    candidates.push(Object.freeze({
      ...candidate,
      claimKinds: Object.freeze([...candidate.claimKinds]),
      discoveredFrom: "registry" as const,
    }));
  }
  return Object.freeze(candidates);
}

function timedOut(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`);
}

function canonicalDiscoveryInput(
  input: OfficialSourceDiscoveryInput,
): OfficialSourceDiscoveryInput | null {
  const country = input.country;
  const rootsMatch = input.authorityRoots.length === SI_AUTHORITY_ROOTS.length &&
    input.authorityRoots.every((root, index) => root === SI_AUTHORITY_ROOTS[index]);
  const requested = new Set(input.requiredClaimKinds);
  if (
    country.code !== "SI" ||
    country.englishName !== "Slovenia" ||
    country.displayName !== "Словения" ||
    country.flag !== "🇸🇮" ||
    country.coordinate.lat !== 46.1512 ||
    country.coordinate.lng !== 14.9955 ||
    !rootsMatch ||
    requested.size === 0 ||
    requested.size !== input.requiredClaimKinds.length ||
    input.requiredClaimKinds.some((kind) => !REQUIRED_CLAIM_KINDS.includes(kind))
  ) {
    return null;
  }
  return {
    country: {
      code: "SI",
      englishName: "Slovenia",
      displayName: "Словения",
      flag: "🇸🇮",
      coordinate: { lat: 46.1512, lng: 14.9955 },
    },
    authorityRoots: [...SI_AUTHORITY_ROOTS],
    requiredClaimKinds: [...input.requiredClaimKinds],
  };
}

export function createOfficialSourceDiscovery(client: OpenAI): OfficialSourceDiscoveryPort {
  return Object.freeze({
    async discover(input: OfficialSourceDiscoveryInput): Promise<OfficialSourceDiscoveryResult> {
      const canonicalInput = canonicalDiscoveryInput(input);
      if (canonicalInput === null) return invalidOutput();
      const body = {
        model: MODEL,
        instructions: [
          "Propose only current official Slovenia source URLs inside the installed authority hosts.",
          "Return identifiers, exact URLs, authority roots and only requested claim kinds.",
          "The result is untrusted navigation input and must not contain facts or conclusions.",
        ].join(" "),
        input: JSON.stringify({
          country: canonicalInput.country,
          authorityRoots: canonicalInput.authorityRoots,
          requiredClaimKinds: canonicalInput.requiredClaimKinds,
        }),
        text: { format: zodTextFormat(discoverySchema, "slovenia_official_source_candidates") },
        store: false as const,
        tools: [{
          type: "web_search" as const,
          search_context_size: "low" as const,
          filters: { allowed_domains: [...INSTALLED_HOSTS] },
        }],
      };
      try {
        const response = await client.responses.parse(body, { timeout: 12_000, maxRetries: 0 });
        if (containsRefusal(response)) {
          return { ok: false, kind: "refused", candidates: [] };
        }
        const candidates = validatedCandidates(parsedOutput(response), canonicalInput);
        return candidates === null ? invalidOutput() : { ok: true, candidates };
      } catch (error) {
        return {
          ok: false,
          kind: timedOut(error) ? "timeout" : "model_error",
          candidates: [],
        };
      }
    },
  });
}
