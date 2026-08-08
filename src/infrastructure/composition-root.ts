import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import { z } from "zod";

import { createConfirmedLife } from "../application/confirmed-life";
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
  runCurrentEvidence,
  type EvidenceParsers,
} from "../research/run";
import { createEvidenceIntegrity } from "./integrity";
import { captureHttpOnce } from "./sources/gateway";
import { OfficialSourceAdapter } from "./sources/official-source-adapter";
import { openEvidenceDatabase } from "./sqlite/db";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
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

function statusFor(snapshot: EvidenceSnapshot, sourceId: SourceId): EvidenceStatus {
  if (snapshot.coverage[sourceId] === "verified") return "verified";
  const blocker = snapshot.blockers.find((item) => item.sourceId === sourceId);
  if (blocker?.kind === "stale") return "stale";
  if (blocker?.kind === "conflict") return "conflicting";
  if (blocker?.kind === "integrity_mismatch" || blocker?.kind === "semantic_mismatch") return "invalid";
  return "missing";
}

function semanticStatus(
  snapshot: EvidenceSnapshot,
  sourceId: SourceId,
  schema: z.ZodType,
): EvidenceStatus {
  const coverage = statusFor(snapshot, sourceId);
  if (coverage !== "verified") return coverage;
  const claimId = new RegExp(`^${sourceId}-facts-\\d+$`);
  return snapshot.claims.some((claim) =>
    claim.sourceId === sourceId &&
    claim.status === "verified" &&
    claimId.test(claim.claimId) &&
    schema.safeParse(claim.value).success
  ) ? "verified" : "invalid";
}

function decisionEvidence(snapshot: EvidenceSnapshot): Evidence {
  const law = semanticStatus(snapshot, "al-law-79", law79FactsSchema);
  return {
    claims: {
      "al-law-79-art-68-contract": { source: "official", status: law },
      "al-law-79-art-68-spouse": { source: "official", status: law },
      "al-tirana-residence": {
        source: "official",
        status: semanticStatus(snapshot, "tirana-urban-lines", tiranaFactsSchema),
      },
    },
    foreignContractVerified: law,
    availableResourcesVerified: semanticStatus(
      snapshot,
      "al-decision-858",
      decision858FactsSchema,
    ),
    lawfulStayVerified: law,
    stagedFamilyPlanVerified: law,
  };
}

export function createConfirmedLifeComposition(options: ConfirmedLifeCompositionOptions) {
  const evidenceStore = new SqliteEvidenceStore(options.database);
  const profileStore = new SqliteProfileStore(options.database);
  const runStore = new SqliteRunStore(options.database, options.hmacKey);
  const source = options.source ?? new OfficialSourceAdapter();
  const requestStep = options.requestStep ?? captureHttpOnce;
  const integrity = createEvidenceIntegrity(options.hmacKey);

  return createConfirmedLife({
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
      decisionEvidence(snapshot),
      conditions,
    ),
    clock: options.clock ?? (() => new Date()),
    nextId: options.nextId ?? ((kind) => `${kind}-${randomUUID()}`),
    deadlineAt: options.deadlineAt ?? ((now) => new Date(now.getTime() + 45_000)),
  });
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
