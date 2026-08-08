import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { z } from "zod";

import { createConfirmedLife } from "../application/confirmed-life";
import { createHousingBranchApplication, type VerifiedBudgetFacts } from "../application/fork-housing";
import { createReplayApplication } from "../application/replay";
import { replayEvidence as replayVerifiedEvidence } from "../application/replay-evidence";
import { assessRoute } from "../decision/assessment";
import type {
  Evidence,
  EvidenceSnapshot,
  EvidenceStatus,
  OfficialSourcePort,
  RequestStep,
  SourceId,
} from "../research/contracts";
import {
  EVIDENCE_PARSER_VERSIONS,
  runCurrentEvidence,
  type EvidenceParsers,
} from "../research/run";
import { canonicalJson, createEvidenceIntegrity } from "./integrity";
import { captureHttpOnce } from "./sources/gateway";
import { OfficialSourceAdapter } from "./sources/official-source-adapter";
import { openEvidenceDatabase } from "./sqlite/db";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
import { SqliteBranchStore } from "./sqlite/branch-store";
import { SqliteHousingBranchWriter } from "./sqlite/housing-branch-writer";
import { SqliteProfileStore } from "./sqlite/profile-store";
import { SqliteRunStore } from "./sqlite/run-store";

export interface ConfirmedLifeCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly source?: OfficialSourcePort;
  readonly requestStep?: RequestStep;
  readonly parsers?: EvidenceParsers;
  readonly clock?: () => Date;
  readonly nextId?: (kind: "run" | "revision" | "assessment") => string;
  readonly deadlineAt?: (now: Date) => Date;
}

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
  const excerptHashes = new Set(
    claims.map((claim) => claim.anchor.excerptSha256.toLowerCase()),
  );
  return claims.length === expectedClaimCount &&
    new Set(claims.map((claim) => claim.claimId)).size === expectedClaimCount &&
    claims.every((claim) =>
      expectedClaimIds.has(claim.claimId) &&
      claim.anchor.locator === expectedLocators[Number(claim.claimId.slice(claim.claimId.lastIndexOf("-") + 1)) - 1] &&
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
    excerptHashes.size === expectedClaimCount
    ? "verified"
    : "invalid";
}

export function projectDecisionEvidence(snapshot: EvidenceSnapshot): Evidence {
  const law = semanticStatus(
    snapshot,
    "al-law-79",
    law79FactsSchema,
    EXPECTED_CLAIM_LOCATORS["al-law-79"],
  );
  return {
    claims: {
      "al-law-79-art-68-contract": { source: "official", status: law },
      "al-law-79-art-68-spouse": { source: "official", status: law },
      "al-tirana-residence": {
        source: "official",
        status: semanticStatus(
          snapshot,
          "tirana-urban-lines",
          tiranaFactsSchema,
          EXPECTED_CLAIM_LOCATORS["tirana-urban-lines"],
        ),
      },
    },
    foreignContractVerified: law,
    availableResourcesVerified: semanticStatus(
      snapshot,
      "al-decision-858",
      decision858FactsSchema,
      EXPECTED_CLAIM_LOCATORS["al-decision-858"],
    ),
    lawfulStayVerified: law,
    stagedFamilyPlanVerified: law,
  };
}

function exactBudgetClaim(
  snapshot: EvidenceSnapshot,
  sourceId: "cbr-eur" | "boa-eur",
) {
  const claims = snapshot.claims.filter((claim) => claim.sourceId === sourceId);
  const claim = claims[0];
  if (
    snapshot.coverage[sourceId] !== "verified" ||
    snapshot.parserVersions[sourceId] !== EVIDENCE_PARSER_VERSIONS[sourceId] ||
    claims.length !== 1 || claim === undefined || claim.claimId !== `${sourceId}-facts-1` ||
    claim.status !== "verified" || claim.scope !== "VS-1 confirmed-life" ||
    !snapshot.artifactIds.includes(claim.anchor.artifactId) || claim.anchor.locator.length === 0 ||
    !/^[a-f\d]{64}$/i.test(claim.anchor.excerptSha256)
  ) throw new Error("integrity_mismatch");
  return claim;
}

export function projectVerifiedBudgetFacts(snapshot: EvidenceSnapshot): VerifiedBudgetFacts {
  const cbrClaim = exactBudgetClaim(snapshot, "cbr-eur");
  const boaClaim = exactBudgetClaim(snapshot, "boa-eur");
  const cbr = cbrBudgetFactsSchema.safeParse(cbrClaim.value);
  const boa = boaBudgetFactsSchema.safeParse(boaClaim.value);
  if (
    !cbr.success || !boa.success || cbr.data.effectiveDate !== cbrClaim.sourcePeriod ||
    boa.data.effectiveDate !== boaClaim.sourcePeriod
  ) throw new Error("integrity_mismatch");
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

export function createConfirmedLifeComposition(options: ConfirmedLifeCompositionOptions) {
  const evidenceStore = new SqliteEvidenceStore(options.database);
  const branchStore = new SqliteBranchStore(options.database, options.hmacKey);
  const profileStore = new SqliteProfileStore(options.database);
  const runStore = new SqliteRunStore(options.database, options.hmacKey);
  const housingBranchAppend = new SqliteHousingBranchWriter(options.database, branchStore, runStore);
  const source = options.source ?? new OfficialSourceAdapter();
  const requestStep = options.requestStep ?? captureHttpOnce;
  const integrity = createEvidenceIntegrity(options.hmacKey);

  const confirmedLife = createConfirmedLife({
    profileStore,
    runStore,
    evidence: {
      loadVerified: (id, expected) => evidenceStore.loadVerified(id, options.hmacKey, expected),
      loadVerifiedDetails: async (id, expected) => {
        const bundle = await evidenceStore.loadVerifiedBundle(id, options.hmacKey, expected);
        return {
          snapshot: bundle.snapshot,
          sources: bundle.entries.map((entry) => ({
            sourceId: entry.sourceId,
            navigationUrl: entry.navigationUrl,
            resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
          })),
        };
      },
    },
    research: {
      runCurrentEvidence: (input) => runCurrentEvidence(input, {
        source,
        requestStep,
        store: evidenceStore,
        integrity,
        ...(options.parsers === undefined ? {} : { parsers: options.parsers }),
      }),
    },
    assess: (profile, snapshot, conditions) => assessRoute(
      profile,
      projectDecisionEvidence(snapshot),
      conditions,
    ),
    clock: options.clock ?? (() => new Date()),
    nextId: options.nextId ?? ((kind) => `${kind}-${randomUUID()}`),
    deadlineAt: options.deadlineAt ?? ((now) => new Date(now.getTime() + 45_000)),
  });
  const nextId = options.nextId ?? ((kind: "run" | "revision" | "assessment") => `${kind}-${randomUUID()}`);
  const housingBranch = createHousingBranchApplication({
    profileStore,
    runStore,
    branchStore,
    housingBranchAppend,
    budgetFacts: {
      loadVerifiedBudgetFacts: async (id, expected) => projectVerifiedBudgetFacts(
        await evidenceStore.loadVerified(id, options.hmacKey, expected),
      ),
    },
    nextRevisionId: () => nextId("revision"),
  });
  const replay = createReplayApplication({
    profileStore,
    runStore,
    branchStore,
    replayEvidence: (snapshotId) => replayVerifiedEvidence(
      { snapshotId, hmacKey: options.hmacKey },
      {
        store: evidenceStore,
        ...(options.parsers === undefined ? {} : { parsers: options.parsers }),
      },
    ),
    projectDecisionEvidence,
    projectBudgetFacts: projectVerifiedBudgetFacts,
  });
  return Object.freeze({ ...confirmedLife, ...housingBranch, ...replay });
}

let application: ReturnType<typeof createConfirmedLifeComposition> | undefined;

export function getConfirmedLifeApplication(): ReturnType<typeof createConfirmedLifeComposition> {
  if (application !== undefined) return application;
  const databasePath = process.env.DATABASE_PATH;
  const hmacKey = process.env.EVIDENCE_HMAC_KEY;
  if (databasePath === undefined || databasePath.length === 0) throw new Error("database_path_missing");
  if (hmacKey === undefined || hmacKey.length === 0) throw new Error("integrity_key_missing");
  application = createConfirmedLifeComposition({
    database: openEvidenceDatabase(databasePath),
    hmacKey,
  });
  return application;
}
