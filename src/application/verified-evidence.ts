import { z } from "zod";

import type { VerifiedBudgetFacts } from "./fork-housing";
import type {
  Claim,
  Evidence,
  EvidenceBlockerKind,
  EvidenceSnapshot,
  EvidenceStatus,
  SourceId,
} from "../research/contracts";
import { EVIDENCE_PARSER_VERSIONS } from "../research/run";

const law79FactsSchema = z.object({
  digitalWorker: z.object({
    requiresLawfulStay: z.literal(true),
    initialPermitMaxMonths: z.literal(12),
    contractTypes: z.tuple([z.literal("foreign_employment"), z.literal("foreign_service")]),
    accommodation: z.literal(true),
    insuranceMinMonths: z.literal(12),
    criminalRecords: z.literal("origin_and_residence"),
  }).strict(),
  family: z.object({
    spouseIsFamilyMember: z.literal(true),
    sponsorPermitMinMonths: z.literal(12),
    renewable: z.literal(true),
    familyNormallyOutside: z.literal(true),
    housingInsuranceStableIncome: z.literal(true),
  }).strict(),
}).strict();

const decision858FactsSchema = z.object({
  proof: z.literal("self_declaration"),
  availableAmount: z.literal("408000"),
  currency: z.literal("ALL"),
  scope: z.literal("self_and_dependants"),
  periodFormula: z.literal("not_stated"),
  headcountFormula: z.literal("not_stated"),
  generalRuleExceptionAnchored: z.literal(true),
}).strict();

const tiranaFactsSchema = z.object({
  municipalUrbanRoutesMapPublished: z.literal(true),
  applicationTitle: z.literal("Transporti"),
  layers: z.tuple([
    z.literal("Linjat Qytetase"),
    z.literal("Stacionet e Linjave Qytetase"),
  ]),
  checkedAt: z.iso.datetime(),
}).strict();

const cbrBudgetFactsSchema = z.object({
  base: z.literal("EUR"),
  quote: z.literal("RUB"),
  nominal: z.literal("1"),
  rate: z.string().regex(/^\d+(?:\.\d+)?$/),
  effectiveDate: z.iso.date(),
}).strict();

const boaBudgetFactsSchema = z.object({
  base: z.literal("EUR"),
  quote: z.literal("ALL"),
  rate: z.string().regex(/^\d+(?:\.\d+)?$/),
  effectiveDate: z.iso.date(),
}).strict();

const EXPECTED_CLAIM_LOCATORS = Object.freeze({
  "al-law-79": ["Art. 68", "Art. 3(1)", "Art. 41"],
  "al-decision-858": ["Decision 858, amount", "Decision 858, p.8"],
  "tirana-urban-lines": ["municipality page iframe", "visible WMS layers"],
} as const);

const SOURCE_IDS = Object.freeze([
  "al-law-79",
  "al-decision-858",
  "cbr-eur",
  "boa-eur",
  "tirana-urban-lines",
] as const satisfies readonly SourceId[]);

export interface ValidatedEvidence {
  readonly decisionEvidence: Evidence;
  readonly acceptedClaims: readonly Claim<unknown>[];
  readonly rejectedSources: readonly {
    readonly sourceId: SourceId;
    readonly blockerKind: "semantic_mismatch";
  }[];
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function statusFor(snapshot: EvidenceSnapshot, sourceId: SourceId): EvidenceStatus {
  if (snapshot.coverage[sourceId] === "verified") return "verified";
  const blocker = snapshot.blockers.find((item) => item.sourceId === sourceId);
  if (blocker?.kind === "stale") return "stale";
  if (blocker?.kind === "conflict") return "conflicting";
  if (blocker?.kind === "integrity_mismatch" || blocker?.kind === "semantic_mismatch") return "invalid";
  return "missing";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validSourcePeriod(sourceId: SourceId, value: string): boolean {
  if (sourceId === "al-law-79" || sourceId === "al-decision-858") {
    return value.startsWith("cons-") && validDate(value.slice("cons-".length));
  }
  return validDate(value);
}

function semanticStatus(
  snapshot: EvidenceSnapshot,
  sourceId: SourceId,
  schema: z.ZodType,
  expectedLocators: readonly string[],
): EvidenceStatus {
  const coverage = statusFor(snapshot, sourceId);
  if (coverage !== "verified") return coverage;
  if (snapshot.parserVersions[sourceId] !== EVIDENCE_PARSER_VERSIONS[sourceId]) return "invalid";
  const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
  const expectedClaimCount = expectedLocators.length;
  const expectedClaimIds = new Set(Array.from(
    { length: expectedClaimCount },
    (_, index) => `${sourceId}-facts-${index + 1}`,
  ));
  const periods = new Set(claims.map((claim) => claim.sourcePeriod));
  const artifactIds = new Set(snapshot.artifactIds);
  const facts = new Set(claims.map((claim) => canonicalJson(claim.value)));
  const anchorTuples = new Set(claims.map((claim) => canonicalJson({
    ...claim.anchor,
    excerptSha256: claim.anchor.excerptSha256.toLowerCase(),
  })));
  const excerptHashes = new Set(claims.map((claim) => claim.anchor.excerptSha256.toLowerCase()));
  const valid = claims.length === expectedClaimCount &&
    new Set(claims.map((claim) => claim.claimId)).size === expectedClaimCount &&
    claims.every((claim) =>
      expectedClaimIds.has(claim.claimId) &&
      claim.anchor.locator === expectedLocators[
        Number(claim.claimId.slice(claim.claimId.lastIndexOf("-") + 1)) - 1
      ] &&
      claim.status === "verified" &&
      claim.scope === "VS-1 confirmed-life" &&
      claim.sourcePeriod.length > 0 &&
      validSourcePeriod(sourceId, claim.sourcePeriod) &&
      artifactIds.has(claim.anchor.artifactId) &&
      claim.anchor.locator.trim().length > 0 &&
      /^[a-f\d]{64}$/i.test(claim.anchor.excerptSha256) &&
      schema.safeParse(claim.value).success &&
      (sourceId !== "tirana-urban-lines" || (() => {
        const parsed = tiranaFactsSchema.safeParse(claim.value);
        return parsed.success &&
          new Date(parsed.data.checkedAt).toISOString().slice(0, 10) === claim.sourcePeriod;
      })())
    ) &&
    periods.size === 1 &&
    facts.size === 1 &&
    anchorTuples.size === expectedClaimCount &&
    excerptHashes.size === expectedClaimCount;
  return valid ? "verified" : "invalid";
}

function rateStatus(
  snapshot: EvidenceSnapshot,
  sourceId: "cbr-eur" | "boa-eur",
  schema: z.ZodType<{ readonly effectiveDate: string }>,
): EvidenceStatus {
  const coverage = statusFor(snapshot, sourceId);
  if (coverage !== "verified") return coverage;
  const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
  const claim = claims[0];
  if (
    snapshot.parserVersions[sourceId] !== EVIDENCE_PARSER_VERSIONS[sourceId] ||
    claims.length !== 1 || claim === undefined || claim.claimId !== `${sourceId}-facts-1` ||
    claim.status !== "verified" || claim.scope !== "VS-1 confirmed-life" ||
    !snapshot.artifactIds.includes(claim.anchor.artifactId) || claim.anchor.locator.trim().length === 0 ||
    !/^[a-f\d]{64}$/i.test(claim.anchor.excerptSha256)
  ) return "invalid";
  const parsed = schema.safeParse(claim.value);
  return parsed.success && parsed.data.effectiveDate === claim.sourcePeriod ? "verified" : "invalid";
}

export function projectValidatedEvidence(snapshot: EvidenceSnapshot): ValidatedEvidence {
  const sourceStatuses: Readonly<Record<SourceId, EvidenceStatus>> = Object.freeze({
    "al-law-79": semanticStatus(
      snapshot,
      "al-law-79",
      law79FactsSchema,
      EXPECTED_CLAIM_LOCATORS["al-law-79"],
    ),
    "al-decision-858": semanticStatus(
      snapshot,
      "al-decision-858",
      decision858FactsSchema,
      EXPECTED_CLAIM_LOCATORS["al-decision-858"],
    ),
    "cbr-eur": rateStatus(snapshot, "cbr-eur", cbrBudgetFactsSchema),
    "boa-eur": rateStatus(snapshot, "boa-eur", boaBudgetFactsSchema),
    "tirana-urban-lines": semanticStatus(
      snapshot,
      "tirana-urban-lines",
      tiranaFactsSchema,
      EXPECTED_CLAIM_LOCATORS["tirana-urban-lines"],
    ),
  });
  const sourceBlockers: Partial<Record<SourceId, EvidenceBlockerKind>> = {};
  for (const sourceId of SOURCE_IDS) {
    const blocker = snapshot.blockers.find((item) => item.sourceId === sourceId);
    if (blocker !== undefined) sourceBlockers[sourceId] = blocker.kind;
    else if (sourceStatuses[sourceId] === "invalid") sourceBlockers[sourceId] = "semantic_mismatch";
  }
  const law = sourceStatuses["al-law-79"];
  const decisionEvidence: Evidence = Object.freeze({
    claims: Object.freeze({
      "al-law-79-art-68-contract": Object.freeze({ source: "official" as const, status: law }),
      "al-law-79-art-68-spouse": Object.freeze({ source: "official" as const, status: law }),
      "al-tirana-residence": Object.freeze({
        source: "official" as const,
        status: sourceStatuses["tirana-urban-lines"],
      }),
      "al-decision-858-facts-1": Object.freeze({
        source: "official" as const,
        status: sourceStatuses["al-decision-858"],
      }),
      "cbr-eur-facts-1": Object.freeze({
        source: "official" as const,
        status: sourceStatuses["cbr-eur"],
      }),
      "boa-eur-facts-1": Object.freeze({
        source: "official" as const,
        status: sourceStatuses["boa-eur"],
      }),
    }),
    foreignContractVerified: law,
    availableResourcesVerified: sourceStatuses["al-decision-858"],
    lawfulStayVerified: law,
    stagedFamilyPlanVerified: law,
    cbrRateVerified: sourceStatuses["cbr-eur"],
    boaRateVerified: sourceStatuses["boa-eur"],
    sourceBlockers: Object.freeze(sourceBlockers),
  });
  return Object.freeze({
    decisionEvidence,
    acceptedClaims: Object.freeze(snapshot.claims.filter((claim) =>
      sourceStatuses[claim.sourceId] === "verified"
    )),
    rejectedSources: Object.freeze(SOURCE_IDS.flatMap((sourceId) =>
      snapshot.coverage[sourceId] === "verified" && sourceStatuses[sourceId] !== "verified"
        ? [Object.freeze({ sourceId, blockerKind: "semantic_mismatch" as const })]
        : []
    )),
  });
}

export function projectDecisionEvidence(snapshot: EvidenceSnapshot): Evidence {
  return projectValidatedEvidence(snapshot).decisionEvidence;
}

export function projectVerifiedBudgetFacts(snapshot: EvidenceSnapshot): VerifiedBudgetFacts {
  const acceptedClaims = projectValidatedEvidence(snapshot).acceptedClaims;
  const cbrClaim = acceptedClaims.find((claim) => claim.sourceId === "cbr-eur");
  const boaClaim = acceptedClaims.find((claim) => claim.sourceId === "boa-eur");
  if (cbrClaim === undefined || boaClaim === undefined) throw new Error("integrity_mismatch");
  const cbr = cbrBudgetFactsSchema.safeParse(cbrClaim.value);
  const boa = boaBudgetFactsSchema.safeParse(boaClaim.value);
  if (!cbr.success || !boa.success) throw new Error("integrity_mismatch");
  return Object.freeze({
    cbrRate: Object.freeze({
      sourceId: "cbr-eur" as const,
      rate: cbr.data.rate,
      base: cbr.data.base,
      quote: cbr.data.quote,
      claimId: cbrClaim.claimId,
      sourcePeriod: cbrClaim.sourcePeriod,
      ref: `${cbrClaim.anchor.artifactId}#${cbrClaim.anchor.locator}#${cbrClaim.anchor.excerptSha256}`,
    }),
    boaRate: Object.freeze({
      sourceId: "boa-eur" as const,
      rate: boa.data.rate,
      base: boa.data.base,
      quote: boa.data.quote,
      claimId: boaClaim.claimId,
      sourcePeriod: boaClaim.sourcePeriod,
      ref: `${boaClaim.anchor.artifactId}#${boaClaim.anchor.locator}#${boaClaim.anchor.excerptSha256}`,
    }),
  });
}
