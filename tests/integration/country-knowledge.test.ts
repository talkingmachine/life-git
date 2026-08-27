import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";

import {
  sqlitePublicationWorker,
  type SqlitePublicationWorkerHandle,
} from "../support/sqlite-publication-worker";

import {
  buildSloveniaKnowledgeRevision,
  buildSloveniaKnowledgeRevisionV2,
  type SloveniaCountryKnowledgeRevision,
  type VerifiedCountryEvidenceInput,
  type VerifiedCountryEvidenceInputV2,
} from "../../src/research/country-knowledge";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../../src/research/cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type VerifiedCountryClaimV2,
} from "../../src/research/cold-start-contracts-v2";
import type { LiveCapturedArtifact } from "../../src/research/contracts";
import {
  evidenceArtifactProvenance,
  sealEvidencePlan,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";
import {
  canonicalJson,
  createEvidenceIntegrity,
  hmacSha256,
  sha256Text,
} from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteCountryKnowledgeStore } from "../../src/infrastructure/sqlite/country-knowledge-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";

const KEY = "country-knowledge-test-key-at-least-32-bytes";
const CREATED_AT = "2026-08-12T12:00:00.000Z";
const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];
const ROUTE_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "qualification",
  "companion_entry",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];
const PARSER_VERSIONS = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
  "cbr-eur": "cbr-eur@1",
} as const;
const URLS = {
  "si-digital-nomad-route": "https://www.gov.si/en/news/digital-nomads/",
  "si-income-threshold": "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
  "si-companion-employment": "https://www.ess.gov.si/conditional-employment/",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
} as const;
const VALUES: ClaimValueByKind = {
  route_basis: {
    route: "temporary_residence_digital_nomad",
    legalBasis: "ZTuj-2 Article 51a",
    effectiveFrom: "2025-11-21",
  },
  citizenship_applicability: {
    eligibleCategory: "third_country_national",
    explicitNationalityExclusions: ["EU", "EEA"],
  },
  remote_work_relations: {
    allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
    slovenianLabourMarketWorkIncluded: false,
  },
  income: {
    metric: "latest_official_average_monthly_net_salary",
    multiplier: "2",
    thresholdEur: "3112.00-SECRET-VALUE",
    period: "2026M01",
  },
  qualification: { rule: "not_listed_in_authoritative_requirements" },
  companion_entry: { rule: "immediate_family_reunification_without_waiting_period" },
  companion_local_work_access: {
    access: "conditional",
    labourMarketCheck: true,
    informationSheet: true,
  },
  duration: { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6 },
  general_statutory_prerequisites: {
    passportBeyondPermitMonths: 3,
    healthInsurance: true,
    article55GroundsApply: true,
  },
};

type CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;
type SourceState =
  | { readonly kind: "verified"; readonly claimKinds: readonly ClaimKind[] }
  | {
      readonly kind: "semantic_mismatch" | "conflict" | "stale" | "timeout" | "deadline";
      readonly withArtifact: boolean;
    };

interface KnowledgeFixture {
  readonly evidence: VerifiedCountryEvidenceInput;
  readonly sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly liveArtifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}

const databases: Database.Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function sourceFor(kind: ClaimKind): CountrySourceId {
  if (kind === "income") return "si-income-threshold";
  if (kind === "companion_local_work_access") return "si-companion-employment";
  return "si-digital-nomad-route";
}

function artifact(
  sourceId: CountrySourceId,
  runId: string,
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new TextEncoder().encode(`RAW-BYTES-MUST-NOT-ENTER-KNOWLEDGE:${runId}:${sourceId}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `${runId}:${sourceId}:artifact`,
    runId,
    sourceId,
    role: "official-document",
    url: URLS[sourceId],
    mediaType: "application/octet-stream",
    sha256,
    bytes,
    origin: "live",
    capturedAt: CREATED_AT,
    responseStatus: 200,
    responseUrl: URLS[sourceId],
    request: { method: "GET", url: URLS[sourceId] },
  };
}

function claim(
  kind: ClaimKind,
  sourceArtifact: LiveCapturedArtifact<SloveniaSourceId>,
  incomeThreshold = VALUES.income.thresholdEur,
): VerifiedCountryClaim {
  const sourceId = sourceFor(kind);
  const validatorVersion = PARSER_VERSIONS[sourceId];
  const sourcePeriod = kind === "income" ? "2026M01" : "2025-11-21";
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${kind}:literal-locator`,
    excerptSha256: sha256Text(`${kind}:literal-excerpt`),
  };
  return {
    claimId: `${sourceId}:${kind}:${validatorVersion}`,
    claimKind: kind,
    sourceId,
    value: kind === "income" ? { ...VALUES.income, thresholdEur: incomeThreshold } : VALUES[kind],
    scope: "VS-2 Slovenia cold start",
    sourcePeriod,
    anchor,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: URLS[sourceId],
      resolvedEvidenceUrl: URLS[sourceId],
      sourcePeriod,
      anchor,
    }],
    validatorVersion,
    status: "verified",
  } as VerifiedCountryClaim;
}

async function evidenceFixture(input: {
  readonly runId: string;
  readonly route: SourceState;
  readonly income: SourceState;
  readonly companion: SourceState;
  readonly incomeThreshold?: string;
  readonly knowledgeBaselineRevisionId?: string;
}): Promise<KnowledgeFixture> {
  const states: Readonly<Record<CountrySourceId, SourceState>> = {
    "si-digital-nomad-route": input.route,
    "si-income-threshold": input.income,
    "si-companion-employment": input.companion,
  };
  const liveArtifacts: LiveCapturedArtifact<SloveniaSourceId>[] = [];
  const entries: TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [];
  for (const sourceId of SOURCE_IDS.slice(0, 3) as readonly CountrySourceId[]) {
    const state = states[sourceId];
    const needsArtifact = state.kind === "verified" || state.withArtifact;
    const sourceArtifact = needsArtifact ? artifact(sourceId, input.runId) : undefined;
    if (sourceArtifact !== undefined) liveArtifacts.push(sourceArtifact);
    const parserEntry = {
      sourceId,
      navigationUrl: URLS[sourceId],
      resolvedEvidenceUrl: URLS[sourceId],
      artifacts: sourceArtifact === undefined ? [] : [sourceArtifact],
    };
    if (state.kind === "verified") {
      entries.push({
        sourceId,
        parserEntry,
        coverage: "verified",
        claims: state.claimKinds.map((kind) => claim(
          kind,
          sourceArtifact!,
          input.incomeThreshold,
        )),
      });
    } else {
      entries.push({
        sourceId,
        parserEntry,
        coverage: "unavailable",
        blocker: {
          sourceId,
          kind: state.kind,
          navigationUrl: URLS[sourceId],
          resolvedUrl: URLS[sourceId],
          artifactIds: sourceArtifact === undefined ? [] : [sourceArtifact.artifactId],
        },
      });
    }
  }
  entries.push({
    sourceId: "cbr-eur",
    parserEntry: {
      sourceId: "cbr-eur",
      navigationUrl: URLS["cbr-eur"],
      resolvedEvidenceUrl: URLS["cbr-eur"],
      artifacts: [],
    },
    coverage: "unavailable",
    blocker: {
      sourceId: "cbr-eur",
      kind: "semantic_mismatch",
      navigationUrl: URLS["cbr-eur"],
      artifactIds: [],
    },
  });
  const sealed = await sealEvidencePlan({
    id: `${input.runId}:evidence`,
    assessmentDate: "2026-08-12",
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: PARSER_VERSIONS,
    rulesVersion: "vs2-si-evidence@2",
    ...(input.knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId: input.knowledgeBaselineRevisionId }),
  }, createEvidenceIntegrity(KEY));
  return {
    sealed,
    liveArtifacts,
    evidence: {
      snapshot: sealed.snapshot,
      entries: sealed.manifest.entries,
      artifacts: liveArtifacts.map(evidenceArtifactProvenance),
    },
  };
}

function fullEvidence(runId = "full-run"): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId,
    route: { kind: "verified", claimKinds: ROUTE_KINDS },
    income: { kind: "verified", claimKinds: ["income"] },
    companion: { kind: "verified", claimKinds: ["companion_local_work_access"] },
  });
}

function partialEvidence(runId = "partial-run"): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId,
    route: { kind: "semantic_mismatch", withArtifact: true },
    income: { kind: "verified", claimKinds: ["income"] },
    companion: { kind: "semantic_mismatch", withArtifact: false },
  });
}

type V2CountrySourceId = Exclude<SloveniaSourceId, "cbr-eur">;

const V2_CLAIM_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "qualification",
  "companion_entry",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];

function v2SourceFor(kind: ClaimKind): V2CountrySourceId {
  if (kind === "income") return "si-income-threshold";
  if (kind === "companion_local_work_access") return "si-companion-employment";
  return "si-digital-nomad-route";
}

function v2SourcePeriod(kind: ClaimKind): string {
  return kind === "income" ? "2026M01" : "2025-11-21";
}

function v2Claim(
  kind: ClaimKind,
  sourceArtifact: LiveCapturedArtifact<SloveniaSourceId>,
  scope: "applicant" | "companion-spouse" = "applicant",
  citizenshipCountryCode = "RU",
): VerifiedCountryClaimV2 {
  const sourceId = v2SourceFor(kind);
  const sourcePeriod = v2SourcePeriod(kind);
  const requirementScope = scope === "applicant"
    ? { kind: "applicant" as const }
    : { kind: "companion" as const, relationship: "spouse" as const };
  let value: ClaimValueByKindV2[ClaimKind];
  if (kind === "route_basis") {
    value = {
      route: "temporary_residence_digital_nomad",
      legalBasis: "ZTuj-2 Article 51a",
      effectiveFrom: "2025-11-21",
    };
  } else if (kind === "citizenship_applicability") {
    value = { classifications: [{ countryCode: citizenshipCountryCode, status: "eligible" }] };
  } else if (kind === "remote_work_relations") {
    value = {
      allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
      slovenianLabourMarketWorkIncluded: false,
    };
  } else if (kind === "income") {
    value = {
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "3112.00",
      currency: "EUR",
      basis: "net",
      appliesTo: "applicant",
      period: "2026M01",
    };
  } else if (kind === "qualification") {
    value = { rule: "not_listed_in_authoritative_requirements" };
  } else if (kind === "companion_entry") {
    value = { relationshipClassifications: [{ relationship: "spouse", status: "eligible" }] };
  } else if (kind === "companion_local_work_access") {
    value = { access: "conditional", labourMarketCheck: true, informationSheet: true };
  } else if (kind === "duration") {
    value = { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6, scope: requirementScope };
  } else {
    value = {
      passportBeyondPermitMonths: 3,
      healthInsurance: true,
      article55GroundsApply: true,
      scope: requirementScope,
    };
  }
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${kind}:v3-locator`,
    excerptSha256: sha256Text(`${kind}:v3-excerpt`),
  };
  return {
    claimId: sloveniaV2ClaimId(kind, value),
    sourceId,
    value,
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod,
    anchor,
    status: "verified",
    claimKind: kind,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: sourceArtifact.request.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      sourcePeriod,
      anchor,
    }],
    validatorVersion: SLOVENIA_V2_CLAIM_VALIDATOR[kind],
  } as VerifiedCountryClaimV2;
}

interface KnowledgeV2Fixture {
  readonly evidence: VerifiedCountryEvidenceInputV2;
  readonly sealed: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly liveArtifacts: readonly LiveCapturedArtifact<SloveniaSourceId>[];
}

async function fullEvidenceV2(
  runId = "v2-full-run",
  citizenshipCountryCode = "RU",
): Promise<KnowledgeV2Fixture> {
  const sourceArtifacts: Readonly<Record<V2CountrySourceId, LiveCapturedArtifact<SloveniaSourceId>>> = {
    "si-digital-nomad-route": artifact("si-digital-nomad-route", runId),
    "si-income-threshold": artifact("si-income-threshold", runId),
    "si-companion-employment": artifact("si-companion-employment", runId),
  };
  const routeClaims: readonly VerifiedCountryClaimV2[] = [
    ...V2_CLAIM_KINDS.map((kind) => v2Claim(
        kind,
        sourceArtifacts[v2SourceFor(kind)],
        "applicant",
        citizenshipCountryCode,
      )),
    v2Claim("duration", sourceArtifacts["si-digital-nomad-route"], "companion-spouse"),
    v2Claim(
      "general_statutory_prerequisites",
      sourceArtifacts["si-digital-nomad-route"],
      "companion-spouse",
    ),
  ];
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] = [
    {
      sourceId: "si-digital-nomad-route",
      parserEntry: {
        sourceId: "si-digital-nomad-route",
        navigationUrl: URLS["si-digital-nomad-route"],
        resolvedEvidenceUrl: URLS["si-digital-nomad-route"],
        artifacts: [sourceArtifacts["si-digital-nomad-route"]],
      },
      coverage: "verified",
      claims: routeClaims,
    },
    {
      sourceId: "si-income-threshold",
      parserEntry: {
        sourceId: "si-income-threshold",
        navigationUrl: URLS["si-income-threshold"],
        resolvedEvidenceUrl: URLS["si-income-threshold"],
        artifacts: [sourceArtifacts["si-income-threshold"]],
      },
      coverage: "verified",
      claims: [v2Claim("income", sourceArtifacts["si-income-threshold"])],
    },
    {
      sourceId: "si-companion-employment",
      parserEntry: {
        sourceId: "si-companion-employment",
        navigationUrl: URLS["si-companion-employment"],
        resolvedEvidenceUrl: URLS["si-companion-employment"],
        artifacts: [sourceArtifacts["si-companion-employment"]],
      },
      coverage: "verified",
      claims: [v2Claim(
        "companion_local_work_access",
        sourceArtifacts["si-companion-employment"],
      )],
    },
    {
      sourceId: "cbr-eur",
      parserEntry: {
        sourceId: "cbr-eur",
        navigationUrl: URLS["cbr-eur"],
        resolvedEvidenceUrl: URLS["cbr-eur"],
        artifacts: [],
      },
      coverage: "unavailable",
      blocker: {
        sourceId: "cbr-eur",
        kind: "semantic_mismatch",
        navigationUrl: URLS["cbr-eur"],
        artifactIds: [],
      },
    },
  ];
  const sealed = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: "2026-08-22",
    entries,
    sourceIds: SLOVENIA_V2_SOURCE_ORDER,
    parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  }, createEvidenceIntegrity(KEY));
  const liveArtifacts = Object.values(sourceArtifacts);
  return {
    sealed,
    liveArtifacts,
    evidence: {
      snapshot: sealed.snapshot,
      entries: sealed.manifest.entries,
      artifacts: liveArtifacts.map(evidenceArtifactProvenance),
    },
  };
}

async function scopedOnlyEvidenceV2(
  runId: string,
  incomeBlockerKind: "semantic_mismatch" | "timeout" = "semantic_mismatch",
  knowledgeBaselineRevisionId?: string,
): Promise<KnowledgeV2Fixture> {
  const routeArtifact = artifact("si-digital-nomad-route", runId);
  const claims = (["duration", "general_statutory_prerequisites"] as const).flatMap((kind) => [
    v2Claim(kind, routeArtifact),
    v2Claim(kind, routeArtifact, "companion-spouse"),
  ]);
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] = [
    {
      sourceId: "si-digital-nomad-route",
      parserEntry: {
        sourceId: "si-digital-nomad-route",
        navigationUrl: URLS["si-digital-nomad-route"],
        resolvedEvidenceUrl: URLS["si-digital-nomad-route"],
        artifacts: [routeArtifact],
      },
      coverage: "verified",
      claims,
    },
    ...(["si-income-threshold", "si-companion-employment", "cbr-eur"] as const).map(
      (sourceId): TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2> => ({
        sourceId,
        parserEntry: {
          sourceId,
          navigationUrl: URLS[sourceId],
          resolvedEvidenceUrl: URLS[sourceId],
          artifacts: [],
        },
        coverage: "unavailable",
        blocker: {
          sourceId,
          kind: sourceId === "si-income-threshold"
            ? incomeBlockerKind
            : "semantic_mismatch",
          navigationUrl: URLS[sourceId],
          artifactIds: [],
        },
      }),
    ),
  ];
  const sealed = await sealEvidencePlan({
    id: `${runId}:evidence`,
    assessmentDate: "2026-08-22",
    entries,
    sourceIds: SLOVENIA_V2_SOURCE_ORDER,
    parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    ...(knowledgeBaselineRevisionId === undefined
      ? {}
      : { knowledgeBaselineRevisionId }),
  }, createEvidenceIntegrity(KEY));
  return {
    sealed,
    liveArtifacts: [routeArtifact],
    evidence: {
      snapshot: sealed.snapshot,
      entries: sealed.manifest.entries,
      artifacts: [evidenceArtifactProvenance(routeArtifact)],
    },
  };
}

function unavailableEvidence(
  kind: "timeout" | "deadline",
): Promise<KnowledgeFixture> {
  return evidenceFixture({
    runId: `${kind}-run`,
    route: { kind, withArtifact: false },
    income: { kind: "semantic_mismatch", withArtifact: false },
    companion: { kind: "semantic_mismatch", withArtifact: false },
  });
}

function memoryDatabase(): Database.Database {
  const database = openEvidenceDatabase(":memory:");
  databases.push(database);
  return database;
}

function fileDatabase(): { readonly database: Database.Database; readonly path: string } {
  const directory = mkdtempSync(join(tmpdir(), "country-knowledge-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "evidence.sqlite");
  const database = openEvidenceDatabase(path);
  databases.push(database);
  return { database, path };
}

async function persistFixture(database: Database.Database, fixture: KnowledgeFixture): Promise<void> {
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaim>(database);
  for (const sourceArtifact of fixture.liveArtifacts) {
    await evidenceStore.appendArtifact(sourceArtifact);
  }
  await evidenceStore.seal(fixture.sealed);
}

async function persistFixtureV2(
  database: Database.Database,
  fixture: KnowledgeV2Fixture,
): Promise<void> {
  const evidenceStore = new SqliteEvidenceStore<SloveniaSourceId, ColdStartEvidenceClaimV2>(database);
  for (const sourceArtifact of fixture.liveArtifacts) {
    await evidenceStore.appendArtifact(sourceArtifact);
  }
  await evidenceStore.seal(fixture.sealed);
}

function build(
  fixture: KnowledgeFixture,
  predecessor?: SloveniaCountryKnowledgeRevision,
): SloveniaCountryKnowledgeRevision | undefined {
  return buildSloveniaKnowledgeRevision({
    evidence: fixture.evidence,
    ...(predecessor === undefined ? {} : { predecessor }),
    createdAt: CREATED_AT,
  });
}

describe("append-only country knowledge", () => {
  test.each([
    ["full verified", () => fullEvidence(), true],
    ["partial verified plus artifact-backed semantic mismatch", () => partialEvidence(), true],
    ["timeout without artifacts", () => unavailableEvidence("timeout"), false],
    ["deadline without artifacts", () => unavailableEvidence("deadline"), false],
  ] as const)("%s", async (_label, makeEvidence, publishes) => {
    const fixture = await makeEvidence();

    const revision = build(fixture);

    expect(revision !== undefined).toBe(publishes);
  });

  test("publishes compact formal references without copied claim values or artifact bytes", async () => {
    const fixture = await fullEvidence();

    const revision = build(fixture)!;

    expect(revision).toEqual({
      schemaVersion: "country-knowledge@1",
      packageId: "SI",
      observationSchemaVersion: "si-knowledge@1",
      id: "country-knowledge:SI:full-run:evidence",
      countryCode: "SI",
      triggerEvidenceSnapshotId: "full-run:evidence",
      formalClaimRefs: [
        {
          claimId: "si-digital-nomad-route:route_basis:si-route@2",
          claimKind: "route_basis",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:citizenship_applicability:si-route@2",
          claimKind: "citizenship_applicability",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:remote_work_relations:si-route@2",
          claimKind: "remote_work_relations",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-income-threshold:income:si-income@2",
          claimKind: "income",
          definitionId: "si-income@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:qualification:si-route@2",
          claimKind: "qualification",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:companion_entry:si-route@2",
          claimKind: "companion_entry",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-companion-employment:companion_local_work_access:si-companion@2",
          claimKind: "companion_local_work_access",
          definitionId: "si-companion@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:duration:si-route@2",
          claimKind: "duration",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
        {
          claimId: "si-digital-nomad-route:general_statutory_prerequisites:si-route@2",
          claimKind: "general_statutory_prerequisites",
          definitionId: "si-route@2",
          evidenceSnapshotId: "full-run:evidence",
        },
      ],
      statusObservations: [],
      createdAt: CREATED_AT,
    });
    expect(JSON.stringify(revision)).not.toMatch(/3112\.00-SECRET-VALUE|RAW-BYTES|value|bytes/i);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision.formalClaimRefs)).toBe(true);
  });

  test("revalidates repeated claims, replaces one changed ref and carries unaffected refs", async () => {
    const root = build(await fullEvidence("root-run"))!;
    const revalidated = build(await fullEvidence("revalidated-run"), root)!;
    const changedFixture = await evidenceFixture({
      runId: "changed-run",
      route: { kind: "semantic_mismatch", withArtifact: false },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "semantic_mismatch", withArtifact: false },
      incomeThreshold: "3400.00-CHANGED-SECRET",
    });
    const changed = build(changedFixture, root)!;

    expect(revalidated.predecessorId).toBe(root.id);
    expect(revalidated.formalClaimRefs.every(
      ({ evidenceSnapshotId }) => evidenceSnapshotId === "revalidated-run:evidence",
    )).toBe(true);
    expect(changed.formalClaimRefs.find(({ claimKind }) => claimKind === "income")).toEqual({
      claimId: "si-income-threshold:income:si-income@2",
      claimKind: "income",
      definitionId: "si-income@2",
      evidenceSnapshotId: "changed-run:evidence",
    });
    expect(changed.formalClaimRefs.filter(({ claimKind }) => claimKind !== "income")).toEqual(
      root.formalClaimRefs.filter(({ claimKind }) => claimKind !== "income"),
    );
    expect(JSON.stringify(changed)).not.toContain("3400.00-CHANGED-SECRET");
  });

  test.each([
    ["semantic_mismatch", "unresolved"],
    ["conflict", "unresolved"],
    ["stale", "expired"],
  ] as const)("an artifact-backed %s mask replaces only affected refs", async (kind, status) => {
    const root = build(await fullEvidence("status-root"))!;
    const fixture = await evidenceFixture({
      runId: `status-${kind}`,
      route: { kind, withArtifact: true },
      income: { kind: "semantic_mismatch", withArtifact: false },
      companion: { kind: "semantic_mismatch", withArtifact: false },
    });

    const successor = build(fixture, root)!;

    expect(successor.formalClaimRefs.map(({ claimKind }) => claimKind)).toEqual([
      "income",
      "companion_local_work_access",
    ]);
    expect(successor.formalClaimRefs).toEqual(root.formalClaimRefs.filter(
      ({ claimKind }) => claimKind === "income" || claimKind === "companion_local_work_access",
    ));
    expect(successor.statusObservations).toEqual([{
      kind: "source_status",
      observationId: `status-${kind}:evidence:si-digital-nomad-route:${status}`,
      sourceId: "si-digital-nomad-route",
      status,
      affectedClaimKinds: ROUTE_KINDS,
      evidenceSnapshotId: `status-${kind}:evidence`,
      artifactIds: [`status-${kind}:si-digital-nomad-route:artifact`],
      definitionId: "si-route@2",
      capturedAt: CREATED_AT,
      verifiedAt: "2026-08-12",
    }]);
  });

  test("persists one deterministic head and rejects update or delete", async () => {
    const database = memoryDatabase();
    const fixture = await fullEvidence("stored-root");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = build(fixture)!;

    expect(store.publish(revision)).toEqual(revision);
    expect(store.publish(revision)).toEqual(revision);
    expect(store.latest("SI")).toEqual(revision);
    expect(store.loadVerified(revision.id)).toEqual(revision);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(1);
    expect(() => database.prepare(
      "UPDATE country_knowledge_revisions SET created_at = ? WHERE id = ?",
    ).run("2026-08-12T12:01:00.000Z", revision.id)).toThrow(
      "country_knowledge_revision_is_immutable",
    );
    expect(() => database.prepare(
      "DELETE FROM country_knowledge_revisions WHERE id = ?",
    ).run(revision.id)).toThrow("country_knowledge_revision_is_immutable");
  });

  test("stores a full successor and verifies its exact predecessor and Evidence references", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("chain-root");
    const successorFixture = await evidenceFixture({
      runId: "chain-successor",
      route: { kind: "semantic_mismatch", withArtifact: false },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "semantic_mismatch", withArtifact: false },
      incomeThreshold: "3500.00",
    });
    await persistFixture(database, rootFixture);
    await persistFixture(database, successorFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const root = store.publish(build(rootFixture)!);
    const successor = store.publish(build(successorFixture, root)!);

    expect(successor.predecessorId).toBe(root.id);
    expect(store.latest("SI")).toEqual(successor);
    expect(store.loadVerified(successor.id)).toEqual(successor);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(2);
  });

  test("resolves only a verified signed baseline and keeps legacy omission unbound", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("bound-root");
    await persistFixture(database, rootFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const root = store.publish(build(rootFixture)!);
    const boundFixture = await evidenceFixture({
      runId: "bound-attempt",
      route: { kind: "verified", claimKinds: ROUTE_KINDS },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "verified", claimKinds: ["companion_local_work_access"] },
      knowledgeBaselineRevisionId: root.id,
    });
    const missingFixture = await evidenceFixture({
      runId: "missing-bound-attempt",
      route: { kind: "verified", claimKinds: ROUTE_KINDS },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "verified", claimKinds: ["companion_local_work_access"] },
      knowledgeBaselineRevisionId: "country-knowledge:SI:missing:evidence",
    });
    const legacyFixture = await fullEvidence("legacy-unbound-attempt");
    await persistFixture(database, boundFixture);
    await persistFixture(database, missingFixture);
    await persistFixture(database, legacyFixture);

    expect(store.resolveForEvidence(boundFixture.sealed.snapshot.id)).toEqual({
      currentRevision: root,
    });
    expect(() => store.resolveForEvidence(missingFixture.sealed.snapshot.id)).toThrow(
      "integrity_mismatch",
    );
    expect(store.resolveForEvidence(legacyFixture.sealed.snapshot.id)).toEqual({});
  });

  test("resolves a verified trigger before an irrelevant missing signed baseline", async () => {
    const database = memoryDatabase();
    const fixture = await evidenceFixture({
      runId: "trigger-before-baseline",
      route: { kind: "verified", claimKinds: ROUTE_KINDS },
      income: { kind: "verified", claimKinds: ["income"] },
      companion: { kind: "verified", claimKinds: ["companion_local_work_access"] },
      knowledgeBaselineRevisionId: "country-knowledge:SI:missing:evidence",
    });
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const triggered = store.publish(build(fixture)!);

    expect(store.resolveForEvidence(fixture.sealed.snapshot.id)).toEqual({
      publishedRevision: triggered,
      currentRevision: triggered,
    });
  });

  test.each([
    ["payload", "payload_json", "null"],
    ["hash", "payload_hash", "0000000000000000000000000000000000000000000000000000000000000000"],
    ["HMAC", "hmac", "0000000000000000000000000000000000000000000000000000000000000000"],
  ] as const)("normalizes stored %s tampering to integrity_mismatch", async (
    _label,
    column,
    value,
  ) => {
    const database = memoryDatabase();
    const fixture = await fullEvidence(`tamper-${column}`);
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    database.prepare(
      `UPDATE country_knowledge_revisions SET ${column} = ? WHERE id = ?`,
    ).run(value, revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("rejects a resigned ref to another valid Evidence claim or snapshot", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("ref-root");
    const otherFixture = await fullEvidence("ref-other");
    await persistFixture(database, rootFixture);
    await persistFixture(database, otherFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(rootFixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const row = database.prepare(
      "SELECT payload_json FROM country_knowledge_revisions WHERE id = ?",
    ).get(revision.id) as { readonly payload_json: string };
    const payload = JSON.parse(row.payload_json) as SloveniaCountryKnowledgeRevision;
    const refs = payload.formalClaimRefs.map((reference, index) => index === 0
      ? {
          ...reference,
          claimId: "si-digital-nomad-route:duration:si-route@2",
          evidenceSnapshotId: "ref-other:evidence",
        }
      : reference);
    const tampered = { ...payload, formalClaimRefs: refs };
    const canonical = canonicalJson(tampered);
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(canonical, sha256Text(canonical), hmacSha256(canonical, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("rejects a resigned status mask that borrows another valid artifact", async () => {
    const database = memoryDatabase();
    const fixture = await partialEvidence("mask-tamper");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const row = database.prepare(
      "SELECT payload_json FROM country_knowledge_revisions WHERE id = ?",
    ).get(revision.id) as { readonly payload_json: string };
    const payload = JSON.parse(row.payload_json) as SloveniaCountryKnowledgeRevision;
    const tampered = {
      ...payload,
      statusObservations: payload.statusObservations.map((observation) => ({
        ...observation,
        artifactIds: ["mask-tamper:si-income-threshold:artifact"],
      })),
    };
    const canonical = canonicalJson(tampered);
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(canonical, sha256Text(canonical), hmacSha256(canonical, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrow("integrity_mismatch");
  });

  test("normalizes malformed decoded arrays instead of leaking native TypeError", async () => {
    const database = memoryDatabase();
    const fixture = await fullEvidence("malformed-root");
    await persistFixture(database, fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const revision = store.publish(build(fixture)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    const malformed = canonicalJson({ ...revision, formalClaimRefs: null });
    database.prepare(`
      UPDATE country_knowledge_revisions
      SET payload_json = ?, payload_hash = ?, hmac = ? WHERE id = ?
    `).run(malformed, sha256Text(malformed), hmacSha256(malformed, KEY), revision.id);

    expect(() => store.loadVerified(revision.id)).toThrowError(new Error("integrity_mismatch"));
  });

  test("rejects a tampered successor predecessor even when the row stays parseable", async () => {
    const database = memoryDatabase();
    const rootFixture = await fullEvidence("predecessor-root");
    const successorFixture = await fullEvidence("predecessor-successor");
    await persistFixture(database, rootFixture);
    await persistFixture(database, successorFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const root = store.publish(build(rootFixture)!);
    const successor = store.publish(build(successorFixture, root)!);
    database.exec("DROP TRIGGER country_knowledge_revisions_no_update");
    database.exec("DROP INDEX country_knowledge_one_root");
    database.prepare(
      "UPDATE country_knowledge_revisions SET predecessor_id = NULL WHERE id = ?",
    ).run(successor.id);

    expect(() => store.loadVerified(successor.id)).toThrow("integrity_mismatch");
  });

  test("linearizes concurrent publication with an immediate transaction", async () => {
    const { database, path } = fileDatabase();
    const fixture = await fullEvidence("concurrent-root");
    await persistFixture(database, fixture);
    const revision = build(fixture)!;
    const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const first = publishWorker({ path, revision, start });
    const second = publishWorker({ path, revision, start });
    await Promise.all([first.ready, second.ready]);
    Atomics.store(new Int32Array(start), 0, 1);
    Atomics.notify(new Int32Array(start), 0, 2);

    const results = await Promise.all([first.result, second.result]);

    expect(results).toEqual([revision, revision]);
    expect(new SqliteCountryKnowledgeStore(database, KEY).latest("SI")).toEqual(revision);
    expect(database.prepare("SELECT COUNT(*) FROM country_knowledge_revisions").pluck().get()).toBe(1);
  });

  test("rebases distinct Evidence publications inside one immediate transaction", async () => {
    const { database, path } = fileDatabase();
    const firstFixture = await fullEvidence("concurrent-distinct-first");
    const secondFixture = await fullEvidence("concurrent-distinct-second");
    await persistFixture(database, firstFixture);
    await persistFixture(database, secondFixture);
    const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const workers = [firstFixture, secondFixture].map((fixture) => publishWorker({
      path,
      evidenceSnapshotId: fixture.sealed.snapshot.id,
      start,
    }));
    await Promise.all(workers.map(({ ready }) => ready));
    const startSignal = new Int32Array(start);
    Atomics.store(startSignal, 0, 1);
    Atomics.notify(startSignal, 0, workers.length);

    const results = await Promise.all(workers.map(({ result }) => result));

    expect(results.map(({ publishedRevision }) => publishedRevision?.id).sort()).toEqual([
      "country-knowledge:SI:concurrent-distinct-first:evidence",
      "country-knowledge:SI:concurrent-distinct-second:evidence",
    ]);
    expect(results.every(({ publishedRevision, currentRevision }) =>
      publishedRevision?.id === currentRevision?.id
    )).toBe(true);
    const rows = database.prepare(`
      SELECT id, predecessor_id AS predecessorId
      FROM country_knowledge_revisions ORDER BY predecessor_id IS NOT NULL, id
    `).all() as { readonly id: string; readonly predecessorId: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.filter(({ predecessorId }) => predecessorId === null)).toHaveLength(1);
    expect(rows.filter(({ predecessorId }) => predecessorId !== null)).toHaveLength(1);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const head = store.latest("SI")!;
    expect(head.predecessorId).toBe(rows.find(({ predecessorId }) => predecessorId === null)!.id);
    expect(results.map(({ publishedRevision }) =>
      store.loadVerified(publishedRevision!.id).id
    ).sort()).toEqual(results.map(({ publishedRevision }) => publishedRevision!.id).sort());
  });
});

describe("Country Knowledge V2 dispatch", () => {
  test("validates every V3 claim and emits only compact unscoped references", async () => {
    const fixture = await fullEvidenceV2();
    const revision = buildSloveniaKnowledgeRevisionV2({
      evidence: fixture.evidence,
      createdAt: CREATED_AT,
    });

    expect(revision).toBeDefined();
    expect(revision!.formalClaimRefs.map(({ claimKind }) => claimKind)).toEqual([
      "route_basis",
      "citizenship_applicability",
      "remote_work_relations",
      "income",
      "qualification",
      "companion_entry",
      "companion_local_work_access",
    ]);
    expect(revision!.formalClaimRefs.every(({ evidenceSnapshotId, definitionId }) =>
      evidenceSnapshotId === fixture.evidence.snapshot.id &&
      (
        definitionId === SLOVENIA_V2_CLAIM_VALIDATOR.route_basis ||
        definitionId === SLOVENIA_V2_CLAIM_VALIDATOR.income ||
        definitionId === SLOVENIA_V2_CLAIM_VALIDATOR.companion_local_work_access
      )
    )).toBe(true);
    expect(JSON.stringify(revision)).not.toMatch(/scope|3112\.00|RAW-BYTES|bytes/);
    expect(Object.isFrozen(revision)).toBe(true);
  });

  test("rejects V1 Evidence at the V2 domain boundary", async () => {
    const fixture = await fullEvidence();
    expect(() => buildSloveniaKnowledgeRevisionV2({
      evidence: fixture.evidence as unknown as VerifiedCountryEvidenceInputV2,
      createdAt: CREATED_AT,
    })).toThrow("integrity_mismatch");
  });

  test("retires scoped predecessor references without last-write-wins", async () => {
    const predecessorFixture = await fullEvidence("v1-scoped-reference-root");
    const predecessor = build(predecessorFixture)!;
    expect(predecessor.formalClaimRefs.map(({ claimKind }) => claimKind)).toEqual(
      expect.arrayContaining(["duration", "general_statutory_prerequisites"]),
    );
    const fixture = await fullEvidenceV2("v2-scoped-reference-successor");
    const successor = buildSloveniaKnowledgeRevisionV2({
      evidence: fixture.evidence,
      predecessor,
      createdAt: CREATED_AT,
    })!;

    expect(successor.predecessorId).toBe(predecessor.id);
    expect(successor.formalClaimRefs.map(({ claimKind }) => claimKind)).not.toContain("duration");
    expect(successor.formalClaimRefs.map(({ claimKind }) => claimKind))
      .not.toContain("general_statutory_prerequisites");
  });

  test("retires scoped predecessor status kinds without deleting unrelated status", async () => {
    const predecessorFixture = await partialEvidence("v1-scoped-status-root");
    const predecessor = build(predecessorFixture)!;
    expect(predecessor.statusObservations.some(({ affectedClaimKinds }) =>
      affectedClaimKinds.includes("duration") ||
      affectedClaimKinds.includes("general_statutory_prerequisites")
    )).toBe(true);
    const fixture = await scopedOnlyEvidenceV2("v2-scoped-status-successor");
    const successor = buildSloveniaKnowledgeRevisionV2({
      evidence: fixture.evidence,
      predecessor,
      createdAt: CREATED_AT,
    })!;

    expect(successor.statusObservations).toEqual([
      expect.objectContaining({
        sourceId: "si-digital-nomad-route",
        affectedClaimKinds: [
          "route_basis",
          "citizenship_applicability",
          "remote_work_relations",
          "qualification",
          "companion_entry",
        ],
      }),
    ]);
  });

  test("keeps the predecessor untouched when a transient source blocks V3 publication", async () => {
    const predecessor = structuredClone(build(await fullEvidence("v1-transient-root"))!);
    const predecessorBytes = canonicalJson(predecessor);
    const fixture = await scopedOnlyEvidenceV2("v2-transient-successor", "timeout");

    expect(buildSloveniaKnowledgeRevisionV2({
      evidence: fixture.evidence,
      predecessor,
      createdAt: CREATED_AT,
    })).toBeUndefined();
    expect(canonicalJson(predecessor)).toBe(predecessorBytes);
    expect(Object.isFrozen(predecessor)).toBe(false);
  });

  test.each([
    ["applicant duration claim ID", "duration", "applicant", "claimId"],
    [
      "companion statutory validator",
      "general_statutory_prerequisites",
      "companion",
      "validatorVersion",
    ],
  ] as const)("rejects a malformed scoped V3 %s before omitting it", async (
    _name,
    kind,
    scopeKind,
    field,
  ) => {
    const fixture = await fullEvidenceV2(`malformed-scoped-${field}`);
    const claims = fixture.evidence.snapshot.claims.map((claim) => {
      if (!("claimKind" in claim) || claim.claimKind !== kind) return claim;
      const value = claim.value as ClaimValueByKindV2["duration"];
      if (value.scope.kind !== scopeKind) return claim;
      return { ...claim, [field]: `malformed-${field}` };
    });
    const malformed: VerifiedCountryEvidenceInputV2 = {
      ...fixture.evidence,
      snapshot: { ...fixture.evidence.snapshot, claims },
    };

    expect(() => buildSloveniaKnowledgeRevisionV2({
      evidence: malformed,
      createdAt: CREATED_AT,
    })).toThrow("integrity_mismatch");
  });

  test("dispatches V1 and V3 Evidence exactly and preserves the V1 row bytes", async () => {
    const database = memoryDatabase();
    const v1Fixture = await fullEvidence("dispatch-v1");
    const v2Fixture = await fullEvidenceV2("dispatch-v2");
    await persistFixture(database, v1Fixture);
    await persistFixtureV2(database, v2Fixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const v1 = store.publish(build(v1Fixture)!);
    const v1Payload = database.prepare(
      "SELECT payload_json, payload_hash, hmac FROM country_knowledge_revisions WHERE id = ?",
    ).get(v1.id) as { readonly payload_json: string; readonly payload_hash: string; readonly hmac: string };
    expect(v1Payload).toEqual({
      payload_json:
        "{\"countryCode\":\"SI\",\"createdAt\":\"2026-08-12T12:00:00.000Z\"," +
        "\"formalClaimRefs\":[{\"claimId\":\"si-digital-nomad-route:route_basis:si-route@2\"," +
        "\"claimKind\":\"route_basis\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:citizenship_applicability:si-route@2\"," +
        "\"claimKind\":\"citizenship_applicability\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:remote_work_relations:si-route@2\"," +
        "\"claimKind\":\"remote_work_relations\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-income-threshold:income:si-income@2\",\"claimKind\":\"income\"," +
        "\"definitionId\":\"si-income@2\",\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:qualification:si-route@2\"," +
        "\"claimKind\":\"qualification\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:companion_entry:si-route@2\"," +
        "\"claimKind\":\"companion_entry\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-companion-employment:companion_local_work_access:si-companion@2\"," +
        "\"claimKind\":\"companion_local_work_access\",\"definitionId\":\"si-companion@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:duration:si-route@2\"," +
        "\"claimKind\":\"duration\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}," +
        "{\"claimId\":\"si-digital-nomad-route:general_statutory_prerequisites:si-route@2\"," +
        "\"claimKind\":\"general_statutory_prerequisites\",\"definitionId\":\"si-route@2\"," +
        "\"evidenceSnapshotId\":\"dispatch-v1:evidence\"}]," +
        "\"id\":\"country-knowledge:SI:dispatch-v1:evidence\"," +
        "\"observationSchemaVersion\":\"si-knowledge@1\",\"packageId\":\"SI\"," +
        "\"schemaVersion\":\"country-knowledge@1\",\"statusObservations\":[]," +
        "\"triggerEvidenceSnapshotId\":\"dispatch-v1:evidence\"}",
      payload_hash: "e7c1a842dc77da0d455425943bd571629463dfbc699d009b811af3330991c3af",
      hmac: "8f96d07b09b30622030f25e7353c65b405f21fce4ff24f087cb5410c288adb8b",
    });

    const v2Publication = store.publishCurrentFromEvidence(v2Fixture.sealed.snapshot.id);
    expect(v2Publication.publishedRevision?.predecessorId).toBe(v1.id);
    expect(store.resolveForEvidence(v2Fixture.sealed.snapshot.id)).toEqual(v2Publication);
    expect(database.prepare(
      "SELECT payload_json, payload_hash, hmac FROM country_knowledge_revisions WHERE id = ?",
    ).get(v1.id)).toEqual(v1Payload);
  });

  test("keeps baseline-less transient V3 publish and resolve empty without changing the head", async () => {
    const database = memoryDatabase();
    const predecessorFixture = await fullEvidence("dispatch-transient-v1");
    const transientFixture = await scopedOnlyEvidenceV2(
      "dispatch-transient-v2",
      "timeout",
    );
    await persistFixture(database, predecessorFixture);
    await persistFixtureV2(database, transientFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const predecessor = store.publish(build(predecessorFixture)!);

    const publication = store.publishCurrentFromEvidence(
      transientFixture.sealed.snapshot.id,
    );

    expect(publication).toEqual({});
    expect(store.resolveForEvidence(transientFixture.sealed.snapshot.id)).toEqual(publication);
    expect(store.latest("SI")).toEqual(predecessor);
    expect(database.prepare(
      "SELECT COUNT(*) FROM country_knowledge_revisions",
    ).pluck().get()).toBe(1);
  });

  test("returns a transient V3 Evidence baseline after a concurrent successor becomes head", async () => {
    const database = memoryDatabase();
    const baselineFixture = await fullEvidence("dispatch-transient-race-a");
    await persistFixture(database, baselineFixture);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    const baseline = store.publish(build(baselineFixture)!);
    const transientFixture = await scopedOnlyEvidenceV2(
      "dispatch-transient-race-pending",
      "timeout",
      baseline.id,
    );
    await persistFixtureV2(database, transientFixture);
    const successorFixture = await fullEvidenceV2("dispatch-transient-race-b");
    await persistFixtureV2(database, successorFixture);
    const successor = store.publishCurrentFromEvidence(successorFixture.sealed.snapshot.id);
    expect(successor.publishedRevision?.predecessorId).toBe(baseline.id);
    const expected = store.resolveForEvidence(transientFixture.sealed.snapshot.id);

    const publication = store.publishCurrentFromEvidence(
      transientFixture.sealed.snapshot.id,
    );

    expect(publication).toEqual(expected);
    expect(publication).toEqual({ currentRevision: baseline });
    expect(store.latest("SI")).toEqual(successor.publishedRevision);
    expect(database.prepare(
      "SELECT COUNT(*) FROM country_knowledge_revisions",
    ).pluck().get()).toBe(2);
  });

  test("fails closed for unknown stored Evidence rules", async () => {
    const database = memoryDatabase();
    const fixture = await fullEvidenceV2("dispatch-unknown");
    await persistFixtureV2(database, fixture);
    database.exec("DROP TRIGGER evidence_snapshots_no_update");
    database.prepare(
      "UPDATE evidence_snapshots SET rules_version = ? WHERE id = ?",
    ).run("vs2-si-evidence@unknown", fixture.sealed.snapshot.id);
    const store = new SqliteCountryKnowledgeStore(database, KEY);
    expect(() => store.resolveForEvidence(fixture.sealed.snapshot.id)).toThrow("integrity_mismatch");
  });
});

interface EvidencePublicationResult {
  readonly publishedRevision?: SloveniaCountryKnowledgeRevision;
  readonly currentRevision?: SloveniaCountryKnowledgeRevision;
}

function publishWorker(input: {
  readonly path: string;
  readonly revision: SloveniaCountryKnowledgeRevision;
  readonly start: SharedArrayBuffer;
}): SqlitePublicationWorkerHandle<SloveniaCountryKnowledgeRevision>;
function publishWorker(input: {
  readonly path: string;
  readonly evidenceSnapshotId: string;
  readonly start: SharedArrayBuffer;
}): SqlitePublicationWorkerHandle<EvidencePublicationResult>;
function publishWorker(input: {
  readonly path: string;
  readonly revision?: SloveniaCountryKnowledgeRevision;
  readonly evidenceSnapshotId?: string;
  readonly start: SharedArrayBuffer;
}): SqlitePublicationWorkerHandle<
  SloveniaCountryKnowledgeRevision | EvidencePublicationResult
> {
  const publishesEvidence = input.evidenceSnapshotId !== undefined;
  return sqlitePublicationWorker({
    path: input.path,
    key: KEY,
    start: input.start,
    storeModulePath: "src/infrastructure/sqlite/country-knowledge-store.ts",
    storeExportName: "SqliteCountryKnowledgeStore",
    methodName: publishesEvidence ? "publishCurrentFromEvidence" : "publish",
    args: [publishesEvidence ? input.evidenceSnapshotId : input.revision],
  });
}
