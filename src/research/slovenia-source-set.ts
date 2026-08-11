import type { ClaimKind, SourceCandidate } from "./cold-start-contracts";
import { REQUIRED_CLAIM_KINDS } from "./country-registry";

export interface SloveniaCandidateSlots {
  readonly routeGov?: SourceCandidate;
  readonly routeLaw?: SourceCandidate;
  readonly salary?: SourceCandidate;
  readonly sistat?: SourceCandidate;
  readonly companionEss?: SourceCandidate;
  readonly companionLaw?: SourceCandidate;
}

interface CandidateRole {
  readonly authorityRoot: string;
  readonly claimKinds: readonly ClaimKind[];
  readonly host: string;
}

const ROUTE_CLAIM_KINDS = REQUIRED_CLAIM_KINDS.filter(
  (kind) => kind !== "income" && kind !== "companion_local_work_access",
);

const ROLES = Object.freeze({
  routeGov: {
    host: "www.gov.si",
    authorityRoot: "https://www.gov.si",
    claimKinds: ROUTE_CLAIM_KINDS,
  },
  routeLaw: {
    host: "pisrs.si",
    authorityRoot: "https://pisrs.si",
    claimKinds: ROUTE_CLAIM_KINDS,
  },
  salary: {
    host: "pisrs.si",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["income"],
  },
  sistat: {
    host: "pxweb.stat.si",
    authorityRoot: "https://pxweb.stat.si",
    claimKinds: ["income"],
  },
  companionEss: {
    host: "www.ess.gov.si",
    authorityRoot: "https://www.ess.gov.si",
    claimKinds: ["companion_local_work_access"],
  },
  companionLaw: {
    host: "pisrs.si",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["companion_local_work_access"],
  },
} as const satisfies Readonly<Record<keyof SloveniaCandidateSlots, CandidateRole>>);

function sameClaimKinds(actual: readonly ClaimKind[], expected: readonly ClaimKind[]): boolean {
  const actualKinds = new Set(actual);
  return actualKinds.size === actual.length &&
    actualKinds.size === expected.length &&
    expected.every((kind) => actualKinds.has(kind));
}

function matchesRole(candidate: SourceCandidate, role: CandidateRole): boolean {
  try {
    const url = new URL(candidate.url);
    return candidate.discoveredFrom === "registry" &&
      url.protocol === "https:" &&
      url.host.toLowerCase() === role.host &&
      candidate.authorityRoot === role.authorityRoot &&
      sameClaimKinds(candidate.claimKinds, role.claimKinds);
  } catch {
    return false;
  }
}

function uniqueCandidate(
  candidates: readonly SourceCandidate[],
  role: CandidateRole,
): SourceCandidate | undefined {
  const matches = candidates.filter((candidate) => matchesRole(candidate, role));
  return matches.length === 1 ? matches[0] : undefined;
}

export function selectSloveniaCandidateSlots(
  candidates: readonly SourceCandidate[],
): SloveniaCandidateSlots {
  return Object.freeze(Object.fromEntries(
    Object.entries(ROLES).map(([name, role]) => [name, uniqueCandidate(candidates, role)]),
  ));
}

export function isCompleteSloveniaSourceSet(
  candidates: readonly SourceCandidate[],
): boolean {
  if (
    candidates.length !== Object.keys(ROLES).length ||
    new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length ||
    new Set(candidates.map(({ url }) => url)).size !== candidates.length
  ) return false;
  return Object.values(selectSloveniaCandidateSlots(candidates)).every(
    (candidate) => candidate !== undefined,
  );
}
