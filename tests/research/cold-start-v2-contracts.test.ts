import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteDossierStore } from "../../src/infrastructure/sqlite/dossier-store";
import { SqliteEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../../src/research/cold-start-contracts";
import type {
  CbrEurFacts,
  Claim,
  LiveCapturedArtifact,
} from "../../src/research/contracts";
import type {
  ClaimValueByKindV2,
  ColdStartEvidenceClaimV2,
  ParticipantRequirementScopeV2,
  VerifiedCountryClaimV2,
} from "../../src/research/cold-start-contracts-v2";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  sloveniaV2ClaimIdentity,
  sloveniaV2ClaimScopeToken,
  sloveniaV2ParticipantScopeToken,
} from "../../src/research/cold-start-contracts-v2";
import { buildCountryDossier } from "../../src/research/dossier";
import {
  buildCountryDossierV2,
  reconstructCountryDossierPayloadV2,
  type DossierClaimV2,
  type CountryDossierPayloadV2,
} from "../../src/research/dossier-v2";
import {
  sealEvidencePlan,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";

const INTEGRITY_KEY = "country-v2-task-1-test-key-at-least-32-bytes";
const ASSESSMENT_DATE = "2026-08-22";
const RUN_ID = "country-v2-contracts";
const SOURCE_IDS = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
  "cbr-eur",
] as const satisfies readonly SloveniaSourceId[];
const COUNTRY_SOURCE_IDS = SOURCE_IDS.slice(0, 3) as readonly Exclude<
  SloveniaSourceId,
  "cbr-eur"
>[];
const SOURCE_URLS = {
  "si-digital-nomad-route": "https://www.gov.si/en/digital-nomad-v2",
  "si-income-threshold": "https://pxweb.stat.si/income-v2",
  "si-companion-employment": "https://www.ess.gov.si/companion-v2",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
} as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceFor(kind: ClaimKind): Exclude<SloveniaSourceId, "cbr-eur"> {
  if (kind === "income") return "si-income-threshold";
  if (kind === "companion_local_work_access") return "si-companion-employment";
  return "si-digital-nomad-route";
}

function artifact(sourceId: SloveniaSourceId): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = new TextEncoder().encode(`official:${sourceId}`);
  const digest = sha256(bytes);
  const url = SOURCE_URLS[sourceId];
  return {
    artifactId: `${sourceId}:official:${digest}`,
    runId: RUN_ID,
    sourceId,
    role: "official-document",
    url,
    mediaType: "application/octet-stream",
    sha256: digest,
    bytes,
    origin: "live",
    capturedAt: "2026-08-22T10:00:00.000Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
  };
}

const V1_VALUES: ClaimValueByKind = {
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
    thresholdEur: "3361.60",
    period: "2026M05",
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

const V1_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];

function v1Validator(sourceId: Exclude<SloveniaSourceId, "cbr-eur">): string {
  if (sourceId === "si-income-threshold") return "si-income@2";
  if (sourceId === "si-companion-employment") return "si-companion@2";
  return "si-route@2";
}

function v1Claim(kind: ClaimKind): VerifiedCountryClaim {
  const sourceId = sourceFor(kind);
  const sourceArtifact = artifact(sourceId);
  const validatorVersion = v1Validator(sourceId);
  const sourcePeriod = kind === "income"
    ? "2026M05"
    : sourceId === "si-companion-employment" ? "ZAKO6655:NPB 8" : "2025-11-21";
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${kind} exact locator`,
    excerptSha256: sha256(`${kind} exact excerpt`),
  };
  return {
    claimId: `${sourceId}:${kind}:${validatorVersion}`,
    claimKind: kind,
    sourceId,
    value: V1_VALUES[kind],
    scope: "VS-2 Slovenia cold start",
    sourcePeriod,
    anchor,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: sourceArtifact.request.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      sourcePeriod,
      anchor,
    }],
    validatorVersion,
    status: "verified",
  } as VerifiedCountryClaim;
}

async function sealedV1(): Promise<
  SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>
> {
  const claims = V1_KINDS.map(v1Claim);
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[] = [
    ...COUNTRY_SOURCE_IDS.map((sourceId) => ({
      sourceId,
      parserEntry: {
        sourceId,
        navigationUrl: SOURCE_URLS[sourceId],
        resolvedEvidenceUrl: SOURCE_URLS[sourceId],
        artifacts: [artifact(sourceId)],
      },
      coverage: "verified" as const,
      claims: claims.filter((claim) => claim.sourceId === sourceId),
    })),
    {
      sourceId: "cbr-eur",
      parserEntry: {
        sourceId: "cbr-eur",
        navigationUrl: SOURCE_URLS["cbr-eur"],
        resolvedEvidenceUrl: SOURCE_URLS["cbr-eur"],
        artifacts: [],
      },
      coverage: "unavailable",
      blocker: {
        sourceId: "cbr-eur",
        kind: "semantic_mismatch",
        navigationUrl: SOURCE_URLS["cbr-eur"],
        artifactIds: [],
      },
    },
  ];
  return sealEvidencePlan({
    id: `${RUN_ID}:v1:evidence`,
    assessmentDate: ASSESSMENT_DATE,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: {
      "si-digital-nomad-route": "si-route@2",
      "si-income-threshold": "si-income@2",
      "si-companion-employment": "si-companion@2",
      "cbr-eur": "cbr-eur@1",
    },
    rulesVersion: "vs2-si-evidence@2",
  }, createEvidenceIntegrity(INTEGRITY_KEY));
}

const V2_UNSCOPED_KINDS = [
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
] as const satisfies readonly ClaimKind[];
const V2_SCOPED_KINDS = [
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[];
const V2_KINDS = [
  ...V2_UNSCOPED_KINDS,
  ...V2_SCOPED_KINDS,
] as const satisfies readonly ClaimKind[];
const REQUIREMENT_SCOPES = [
  { kind: "applicant" },
  { kind: "companion", relationship: "spouse" },
  { kind: "companion", relationship: "minor_child" },
  { kind: "companion", relationship: "other_family" },
] as const satisfies readonly ParticipantRequirementScopeV2[];

type V2SealedEvidence = SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;
type DossierClaimArray = DossierClaimV2[];

function v2Validator(sourceId: Exclude<SloveniaSourceId, "cbr-eur">): string {
  if (sourceId === "si-income-threshold") return "si-income@3";
  if (sourceId === "si-companion-employment") return "si-companion@3";
  return "si-route@3";
}

function isScopedKind(kind: ClaimKind): kind is typeof V2_SCOPED_KINDS[number] {
  return kind === "duration" || kind === "general_statutory_prerequisites";
}

function requirementScopeKey(scope: ParticipantRequirementScopeV2): string {
  return scope.kind === "applicant" ? "applicant" : `companion-${scope.relationship}`;
}

function v2Value(
  kind: ClaimKind,
  requirementScope?: ParticipantRequirementScopeV2,
): ClaimValueByKindV2[ClaimKind] {
  switch (kind) {
    case "route_basis":
      return {
        route: "temporary_residence_digital_nomad",
        legalBasis: "ZTuj-2 Article 51a",
        effectiveFrom: "2025-11-21",
      };
    case "citizenship_applicability":
      return {
        classifications: [
          { countryCode: "RU", status: "eligible" },
          { countryCode: "DE", status: "excluded" },
        ],
      };
    case "remote_work_relations":
      return {
        allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
        slovenianLabourMarketWorkIncluded: false,
      };
    case "income":
      return {
        metric: "latest_official_average_monthly_net_salary",
        multiplier: "2",
        thresholdEur: "3361.60",
        currency: "EUR",
        basis: "net",
        appliesTo: "applicant",
        period: "2026M05",
      };
    case "qualification":
      return { rule: "not_listed_in_authoritative_requirements" };
    case "companion_entry":
      return {
        relationshipClassifications: [
          { relationship: "spouse", status: "eligible" },
          { relationship: "minor_child", status: "eligible" },
          { relationship: "other_family", status: "excluded" },
        ],
      };
    case "companion_local_work_access":
      return { access: "conditional", labourMarketCheck: true, informationSheet: true };
    case "duration":
      if (requirementScope === undefined) throw new Error("duration fixture needs value.scope");
      return {
        maximumMonths: 12,
        extendable: false,
        reapplyAfterMonths: 6,
        scope: structuredClone(requirementScope),
      };
    case "general_statutory_prerequisites":
      if (requirementScope === undefined) throw new Error("statutory fixture needs value.scope");
      return {
        passportBeyondPermitMonths: 3,
        healthInsurance: true,
        article55GroundsApply: true,
        scope: structuredClone(requirementScope),
      };
  }
}

function v2Claim(
  kind: ClaimKind,
  requirementScope?: ParticipantRequirementScopeV2,
): VerifiedCountryClaimV2 {
  if (isScopedKind(kind) !== (requirementScope !== undefined)) {
    throw new Error("fixture kind/value.scope mismatch");
  }
  const sourceId = sourceFor(kind);
  const sourceArtifact = artifact(sourceId);
  const validatorVersion = v2Validator(sourceId);
  const sourcePeriod = kind === "income"
    ? "2026M05"
    : sourceId === "si-companion-employment" ? "ZAKO6655:NPB 8" : "2025-11-21";
  const scopedSuffix = requirementScope === undefined
    ? ""
    : `:${requirementScopeKey(requirementScope)}`;
  const locatorSuffix = requirementScope === undefined
    ? kind
    : `${kind}:${requirementScopeKey(requirementScope)}`;
  const anchor = {
    artifactId: sourceArtifact.artifactId,
    locator: `${locatorSuffix} exact locator`,
    excerptSha256: sha256(`${locatorSuffix} exact excerpt`),
  };
  return {
    claimId: `${sourceId}:${kind}${scopedSuffix}:${validatorVersion}`,
    claimKind: kind,
    sourceId,
    value: v2Value(kind, requirementScope),
    scope: "VS-2 Slovenia cold start",
    sourcePeriod,
    anchor,
    evidence: [{
      sourceId,
      artifactId: sourceArtifact.artifactId,
      navigationUrl: sourceArtifact.request.url,
      resolvedEvidenceUrl: sourceArtifact.responseUrl,
      sourcePeriod,
      anchor,
    }],
    validatorVersion,
    status: "verified",
  } as VerifiedCountryClaimV2;
}

function cbrClaim(): Claim<CbrEurFacts, "cbr-eur"> {
  const sourceArtifact = artifact("cbr-eur");
  return {
    claimId: "cbr-eur-facts-1",
    sourceId: "cbr-eur",
    value: {
      base: "EUR",
      quote: "RUB",
      nominal: "1",
      rate: "93.1234" as CbrEurFacts["rate"],
      effectiveDate: "2026-08-21",
    },
    scope: "VS-2 Slovenia cold start",
    sourcePeriod: "2026-08-21",
    anchor: {
      artifactId: sourceArtifact.artifactId,
      locator: "CBR EUR row",
      excerptSha256: sha256("CBR EUR exact excerpt"),
    },
    status: "verified",
  };
}

function everyV2ClaimShape(): readonly ColdStartEvidenceClaimV2[] {
  return [
    ...V2_UNSCOPED_KINDS.map((kind) => v2Claim(kind)),
    v2Claim("duration", { kind: "applicant" }),
    v2Claim("general_statutory_prerequisites", { kind: "applicant" }),
    cbrClaim(),
  ];
}

function everyScopedRequirement(): readonly VerifiedCountryClaimV2[] {
  return V2_SCOPED_KINDS.flatMap((kind) =>
    REQUIREMENT_SCOPES.map((scope) => v2Claim(kind, scope))
  );
}

async function sealedV2(
  claims: readonly ColdStartEvidenceClaimV2[],
  rulesVersion = "vs2-si-evidence@3",
): Promise<V2SealedEvidence> {
  const entries: readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[] =
    SOURCE_IDS.map((sourceId) => {
      const sourceClaims = claims.filter((claim) => claim.sourceId === sourceId);
      if (sourceClaims.length > 0) {
        return {
          sourceId,
          parserEntry: {
            sourceId,
            navigationUrl: SOURCE_URLS[sourceId],
            resolvedEvidenceUrl: SOURCE_URLS[sourceId],
            artifacts: [artifact(sourceId)],
          },
          coverage: "verified" as const,
          claims: sourceClaims,
        };
      }
      return {
        sourceId,
        parserEntry: {
          sourceId,
          navigationUrl: SOURCE_URLS[sourceId],
          resolvedEvidenceUrl: SOURCE_URLS[sourceId],
          artifacts: [],
        },
        coverage: "unavailable" as const,
        blocker: {
          sourceId,
          kind: "semantic_mismatch" as const,
          navigationUrl: SOURCE_URLS[sourceId],
          artifactIds: [],
        },
      };
    });
  return sealEvidencePlan<SloveniaSourceId, ColdStartEvidenceClaimV2>({
    id: `${RUN_ID}:v2:evidence`,
    assessmentDate: ASSESSMENT_DATE,
    entries,
    sourceIds: SOURCE_IDS,
    parserVersions: {
      "si-digital-nomad-route": "si-route@3",
      "si-income-threshold": "si-income@3",
      "si-companion-employment": "si-companion@3",
      "cbr-eur": "cbr-eur@1",
    },
    rulesVersion,
  }, createEvidenceIntegrity(INTEGRITY_KEY));
}

function replaceSealedV2Claims(
  sealed: V2SealedEvidence,
  claims: readonly ColdStartEvidenceClaimV2[],
): void {
  (sealed.snapshot as unknown as { claims: readonly ColdStartEvidenceClaimV2[] }).claims = claims;
  (sealed.manifest.snapshot as unknown as {
    claims: readonly ColdStartEvidenceClaimV2[];
  }).claims = structuredClone(claims);
}

function rewriteV2Claim(
  prepared: V2SealedEvidence,
  matches: (claim: VerifiedCountryClaimV2) => boolean,
  rewrite: (claim: VerifiedCountryClaimV2) => VerifiedCountryClaimV2,
): V2SealedEvidence {
  const borrowed = structuredClone(prepared);
  const claims = borrowed.snapshot.claims.map((claim) =>
    "claimKind" in claim && matches(claim) ? rewrite(claim) : claim
  );
  replaceSealedV2Claims(borrowed, claims);
  return borrowed;
}

function requirementScopeOf(
  claim: VerifiedCountryClaimV2,
): ParticipantRequirementScopeV2 | undefined {
  if (!isScopedKind(claim.claimKind)) return undefined;
  return (claim.value as ClaimValueByKindV2[typeof V2_SCOPED_KINDS[number]]).scope;
}

function mutablePayload(payload: CountryDossierPayloadV2): CountryDossierPayloadV2 {
  return structuredClone(payload);
}

function trappingProxy<T extends object>(target: T, onTrap: () => void): T {
  const trap = (): never => {
    onTrap();
    throw new Error("proxy_trap_invoked");
  };
  return new Proxy(target, {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
  });
}

function addEnumerableProto(target: object): void {
  Object.defineProperty(target, "__proto__", {
    configurable: true,
    enumerable: true,
    value: { polluted: true },
    writable: true,
  });
}

describe("Country Assessment V2 contract isolation", () => {
  test("owns participant scope tokens, order, claim IDs, and identities in one policy", () => {
    const applicant = { kind: "applicant" } as const;
    const spouse = { kind: "companion", relationship: "spouse" } as const;
    const applicantDuration = v2Value("duration", applicant);

    expect(SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER).toEqual([
      "applicant",
      "companion-spouse",
      "companion-minor_child",
      "companion-other_family",
    ]);
    expect(Object.isFrozen(SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER)).toBe(true);
    expect(sloveniaV2ParticipantScopeToken(applicant)).toBe("applicant");
    expect(sloveniaV2ParticipantScopeToken(spouse)).toBe("companion-spouse");
    expect(sloveniaV2ClaimScopeToken("route_basis", v2Value("route_basis")))
      .toBeUndefined();
    expect(sloveniaV2ClaimScopeToken("duration", applicantDuration)).toBe("applicant");
    expect(sloveniaV2ClaimId("route_basis", v2Value("route_basis"))).toBe(
      "si-digital-nomad-route:route_basis:si-route@3",
    );
    expect(sloveniaV2ClaimId("duration", applicantDuration)).toBe(
      "si-digital-nomad-route:duration:applicant:si-route@3",
    );
    expect(sloveniaV2ClaimIdentity("route_basis", v2Value("route_basis")))
      .toBe("route_basis:unscoped");
    expect(sloveniaV2ClaimIdentity("duration", applicantDuration))
      .toBe("duration:applicant");
  });

  test("exports one frozen V2 identity policy for dossier publication and Task 2 reuse", () => {
    // Break caught: parser and dossier branches disagree on source, validator, scope, or rules IDs.
    expect({
      scope: SLOVENIA_V2_RESEARCH_SCOPE,
      sourceOrder: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
      claimSource: SLOVENIA_V2_CLAIM_SOURCE,
      claimValidator: SLOVENIA_V2_CLAIM_VALIDATOR,
    }).toEqual({
      scope: "VS-2 Slovenia cold start",
      sourceOrder: [
        "si-digital-nomad-route",
        "si-income-threshold",
        "si-companion-employment",
        "cbr-eur",
      ],
      parserVersions: {
        "si-digital-nomad-route": "si-route@3",
        "si-income-threshold": "si-income@3",
        "si-companion-employment": "si-companion@3",
        "cbr-eur": "cbr-eur@1",
      },
      rulesVersion: "vs2-si-evidence@3",
      claimSource: {
        route_basis: "si-digital-nomad-route",
        citizenship_applicability: "si-digital-nomad-route",
        remote_work_relations: "si-digital-nomad-route",
        income: "si-income-threshold",
        qualification: "si-digital-nomad-route",
        companion_entry: "si-digital-nomad-route",
        companion_local_work_access: "si-companion-employment",
        duration: "si-digital-nomad-route",
        general_statutory_prerequisites: "si-digital-nomad-route",
      },
      claimValidator: {
        route_basis: "si-route@3",
        citizenship_applicability: "si-route@3",
        remote_work_relations: "si-route@3",
        income: "si-income@3",
        qualification: "si-route@3",
        companion_entry: "si-route@3",
        companion_local_work_access: "si-companion@3",
        duration: "si-route@3",
        general_statutory_prerequisites: "si-route@3",
      },
    });
    expect(Object.isFrozen(SLOVENIA_V2_SOURCE_ORDER)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_V2_PARSER_VERSIONS)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_V2_CLAIM_SOURCE)).toBe(true);
    expect(Object.isFrozen(SLOVENIA_V2_CLAIM_VALIDATOR)).toBe(true);
  });

  test("keeps the historical V1 Evidence manifest, payload, and dossier bytes unchanged", async () => {
    // Break caught: a V2 contract change alters any historical V1 canonical byte stream.
    const prepared = await sealedV1();
    const payload = buildCountryDossier(prepared);
    const database = openEvidenceDatabase(":memory:");
    let dossierBytesHash: string;
    try {
      const evidenceStore = new SqliteEvidenceStore<
        SloveniaSourceId,
        ColdStartEvidenceClaim
      >(database);
      for (const sourceId of COUNTRY_SOURCE_IDS) {
        await evidenceStore.appendArtifact(artifact(sourceId));
      }
      const published = new SqliteDossierStore(database, INTEGRITY_KEY).publishWithEvidence({
        preparedEvidence: prepared,
        publishedAt: "2026-08-22T10:30:00.000Z",
      });
      dossierBytesHash = sha256(JSON.stringify(published.version));
    } finally {
      database.close();
    }

    expect({
      manifest: sha256(prepared.canonicalManifest),
      payload: sha256(JSON.stringify(payload)),
      dossier: dossierBytesHash,
    }).toEqual({
      manifest: "04156ef59097a76cfae2021cab2a7566313ab0d932b369f2ce40aaadb0bcd57d",
      payload: "37a0ea318de79279ca99921de69213af1ec8647c39811aa4c390f33c9dc9e6ed",
      dossier: "5a5de392f04ccaf3306b67051af26067708d3f61898fcdfcfd33a5ae4dfa0ea4",
    });
  });
});

describe("Country Assessment V2 dossier builder", () => {
  test("copies every closed V2 claim value shape and omits the byte-identical CBR claim", async () => {
    // Break caught: a V2-only field is dropped, widened, renamed, or confused with V1 semantics.
    const prepared = await sealedV2([...everyV2ClaimShape()].reverse());

    const payload = buildCountryDossierV2(prepared);

    expect(payload).toEqual({
      country: {
        code: "SI",
        englishName: "Slovenia",
        displayName: "Словения",
        flag: "🇸🇮",
        coordinate: { lat: 46.1512, lng: 14.9955 },
      },
      schemaVersion: "si-dossier@2",
      claims: [
        {
          claimId: "si-digital-nomad-route:route_basis:si-route@3",
          claimKind: "route_basis",
          value: {
            route: "temporary_residence_digital_nomad",
            legalBasis: "ZTuj-2 Article 51a",
            effectiveFrom: "2025-11-21",
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "route_basis exact locator",
            excerptSha256: sha256("route_basis exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:citizenship_applicability:si-route@3",
          claimKind: "citizenship_applicability",
          value: {
            classifications: [
              { countryCode: "RU", status: "eligible" },
              { countryCode: "DE", status: "excluded" },
            ],
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "citizenship_applicability exact locator",
            excerptSha256: sha256("citizenship_applicability exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:remote_work_relations:si-route@3",
          claimKind: "remote_work_relations",
          value: {
            allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
            slovenianLabourMarketWorkIncluded: false,
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "remote_work_relations exact locator",
            excerptSha256: sha256("remote_work_relations exact excerpt"),
          }],
        },
        {
          claimId: "si-income-threshold:income:si-income@3",
          claimKind: "income",
          value: {
            metric: "latest_official_average_monthly_net_salary",
            multiplier: "2",
            thresholdEur: "3361.60",
            currency: "EUR",
            basis: "net",
            appliesTo: "applicant",
            period: "2026M05",
          },
          validatorVersion: "si-income@3",
          evidence: [{
            sourceId: "si-income-threshold",
            navigationUrl: SOURCE_URLS["si-income-threshold"],
            resolvedEvidenceUrl: SOURCE_URLS["si-income-threshold"],
            sourcePeriod: "2026M05",
            locator: "income exact locator",
            excerptSha256: sha256("income exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:qualification:si-route@3",
          claimKind: "qualification",
          value: { rule: "not_listed_in_authoritative_requirements" },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "qualification exact locator",
            excerptSha256: sha256("qualification exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:companion_entry:si-route@3",
          claimKind: "companion_entry",
          value: {
            relationshipClassifications: [
              { relationship: "spouse", status: "eligible" },
              { relationship: "minor_child", status: "eligible" },
              { relationship: "other_family", status: "excluded" },
            ],
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "companion_entry exact locator",
            excerptSha256: sha256("companion_entry exact excerpt"),
          }],
        },
        {
          claimId: "si-companion-employment:companion_local_work_access:si-companion@3",
          claimKind: "companion_local_work_access",
          value: { access: "conditional", labourMarketCheck: true, informationSheet: true },
          validatorVersion: "si-companion@3",
          evidence: [{
            sourceId: "si-companion-employment",
            navigationUrl: SOURCE_URLS["si-companion-employment"],
            resolvedEvidenceUrl: SOURCE_URLS["si-companion-employment"],
            sourcePeriod: "ZAKO6655:NPB 8",
            locator: "companion_local_work_access exact locator",
            excerptSha256: sha256("companion_local_work_access exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:duration:applicant:si-route@3",
          claimKind: "duration",
          value: {
            maximumMonths: 12,
            extendable: false,
            reapplyAfterMonths: 6,
            scope: { kind: "applicant" },
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "duration:applicant exact locator",
            excerptSha256: sha256("duration:applicant exact excerpt"),
          }],
        },
        {
          claimId: "si-digital-nomad-route:general_statutory_prerequisites:applicant:si-route@3",
          claimKind: "general_statutory_prerequisites",
          value: {
            passportBeyondPermitMonths: 3,
            healthInsurance: true,
            article55GroundsApply: true,
            scope: { kind: "applicant" },
          },
          validatorVersion: "si-route@3",
          evidence: [{
            sourceId: "si-digital-nomad-route",
            navigationUrl: SOURCE_URLS["si-digital-nomad-route"],
            resolvedEvidenceUrl: SOURCE_URLS["si-digital-nomad-route"],
            sourcePeriod: "2025-11-21",
            locator: "general_statutory_prerequisites:applicant exact locator",
            excerptSha256: sha256("general_statutory_prerequisites:applicant exact excerpt"),
          }],
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toMatch(/cbr-eur|artifactId|capturedAt/);
  });

  test("keeps simultaneous applicant and companion scopes distinct in canonical kind/scope order", async () => {
    // Break caught: inherited Claim.scope is used instead of value.scope, or one participant scope wins.
    const claims = [v2Claim("route_basis"), ...everyScopedRequirement()].reverse();

    const payload = buildCountryDossierV2(await sealedV2(claims));

    expect(payload.claims.map((claim) => ({
      claimKind: claim.claimKind,
      claimId: claim.claimId,
      scope: "scope" in claim.value ? claim.value.scope : undefined,
      hasTopLevelScope: "scope" in claim,
    }))).toEqual([
      {
        claimKind: "route_basis",
        claimId: "si-digital-nomad-route:route_basis:si-route@3",
        scope: undefined,
        hasTopLevelScope: false,
      },
      ...V2_SCOPED_KINDS.flatMap((claimKind) =>
        REQUIREMENT_SCOPES.map((scope) => ({
          claimKind,
          claimId: `si-digital-nomad-route:${claimKind}:${requirementScopeKey(scope)}:si-route@3`,
          scope,
          hasTopLevelScope: false,
        }))
      ),
    ]);
  });

  test("allows a route-only partial dossier but requires exactly one route basis", async () => {
    // Break caught: optional absence is treated as completeness, or a dossier has no installed route.
    const routeOnly = buildCountryDossierV2(await sealedV2([v2Claim("route_basis")]));
    const missingRoute = await sealedV2([
      v2Claim("income"),
      v2Claim("duration", { kind: "applicant" }),
    ]);

    expect(routeOnly.claims.map(({ claimKind }) => claimKind)).toEqual(["route_basis"]);
    expect(() => buildCountryDossierV2(missingRoute)).toThrow("publication_not_allowed");
  });

  test("rejects duplicate kind/scope pairs and an unsupported extra claim", async () => {
    // Break caught: dossier cardinality silently picks one duplicate or accepts an open-ended kind.
    const route = v2Claim("route_basis");
    const applicantDuration = v2Claim("duration", { kind: "applicant" });
    const futureClaim = {
      ...structuredClone(route),
      claimKind: "future_requirement",
      claimId: "si-digital-nomad-route:future_requirement:si-route@3",
    } as unknown as ColdStartEvidenceClaimV2;
    const invalidSets = [
      [route, structuredClone(route)],
      [route, applicantDuration, structuredClone(applicantDuration)],
      [route, futureClaim],
    ];

    for (const claims of invalidSets) {
      const prepared = await sealedV2(claims);
      expect(() => buildCountryDossierV2(prepared)).toThrow("publication_not_allowed");
    }
  });

  test.each(V2_KINDS)("rejects an extra field in the exact %s value shape", async (kind) => {
    // Break caught: a supposedly closed V2 value becomes an extensible data bag.
    const requirementScope = isScopedKind(kind) ? { kind: "applicant" as const } : undefined;
    const valid = v2Claim(kind, requirementScope);
    const invalid = {
      ...valid,
      value: { ...valid.value, unexpected: true },
    } as unknown as VerifiedCountryClaimV2;
    const claims = kind === "route_basis" ? [invalid] : [v2Claim("route_basis"), invalid];
    const prepared = await sealedV2(claims);

    expect(() => buildCountryDossierV2(prepared)).toThrow("publication_not_allowed");
  });

  test("rejects source, validator, claim ID, inherited scope, artifact, URL, period, and anchor drift", async () => {
    // Break caught: a valid-looking value borrows provenance or validator ownership from another claim.
    const prepared = await sealedV2(everyV2ClaimShape());
    const routeMatch = (claim: VerifiedCountryClaimV2) => claim.claimKind === "route_basis";
    const mutations: readonly ((claim: VerifiedCountryClaimV2) => VerifiedCountryClaimV2)[] = [
      (claim) => ({ ...claim, claimId: `${claim.claimId}:extra` }),
      (claim) => ({
        ...claim,
        validatorVersion: "si-route@2",
        claimId: "si-digital-nomad-route:route_basis:si-route@2",
      }),
      (claim) => ({ ...claim, scope: "applicant" }),
      (claim) => ({ ...claim, sourceId: "si-income-threshold" }),
      (claim) => ({
        ...claim,
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          sourceId: "si-income-threshold",
        })),
      }),
      (claim) => ({
        ...claim,
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          navigationUrl: "https://www.gov.si/borrowed-navigation",
        })),
      }),
      (claim) => ({
        ...claim,
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          resolvedEvidenceUrl: "https://www.gov.si/borrowed-resolution",
        })),
      }),
      (claim) => ({
        ...claim,
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          sourcePeriod: "2024-01-01",
        })),
      }),
      (claim) => ({
        ...claim,
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          anchor: { ...reference.anchor, artifactId: "another-artifact" },
        })),
      }),
      (claim) => ({
        ...claim,
        anchor: { ...claim.anchor, locator: "borrowed final locator" },
      }),
      (claim) => ({ ...claim, evidence: [] }),
    ];

    for (const mutation of mutations) {
      const borrowed = rewriteV2Claim(prepared, routeMatch, mutation);
      expect(() => buildCountryDossierV2(borrowed)).toThrow("publication_not_allowed");
    }
  });

  test("binds the income claim and all its evidence to the official value period", async () => {
    // Break caught: a consistently rewritten provenance period contradicts the retained income month.
    const prepared = await sealedV2([
      v2Claim("route_basis"),
      v2Claim("income"),
    ]);
    const borrowed = rewriteV2Claim(
      prepared,
      (claim) => claim.claimKind === "income",
      (claim) => ({
        ...claim,
        sourcePeriod: "2026M04",
        evidence: claim.evidence.map((reference) => ({
          ...reference,
          sourcePeriod: "2026M04",
        })),
      }),
    );

    expect(() => buildCountryDossierV2(borrowed)).toThrow("publication_not_allowed");
  });

  test("returns a fresh deeply frozen payload isolated from the borrowed Evidence graph", async () => {
    // Break caught: publication aliases a mutable claim classification, scope, or evidence reference.
    const borrowed = structuredClone(await sealedV2(everyV2ClaimShape()));

    const payload = buildCountryDossierV2(borrowed);
    const citizenship = borrowed.snapshot.claims.find(
      (claim) => "claimKind" in claim && claim.claimKind === "citizenship_applicability",
    ) as VerifiedCountryClaimV2<"citizenship_applicability">;
    (citizenship.value.classifications as Array<{ countryCode: string; status: "eligible" }>)
      .splice(0, citizenship.value.classifications.length, { countryCode: "US", status: "eligible" });
    (citizenship.evidence[0] as { navigationUrl: string }).navigationUrl = "https://borrowed.test";

    const copied = payload.claims.find(
      ({ claimKind }) => claimKind === "citizenship_applicability",
    )!;
    expect(copied.value).toEqual({
      classifications: [
        { countryCode: "RU", status: "eligible" },
        { countryCode: "DE", status: "excluded" },
      ],
    });
    expect(copied.evidence[0]?.navigationUrl).toBe(SOURCE_URLS["si-digital-nomad-route"]);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.country)).toBe(true);
    expect(Object.isFrozen(payload.country.coordinate)).toBe(true);
    expect(Object.isFrozen(payload.claims)).toBe(true);
    expect(Object.isFrozen(copied)).toBe(true);
    expect(Object.isFrozen(copied.value)).toBe(true);
    expect(Object.isFrozen(
      (copied.value as ClaimValueByKindV2["citizenship_applicability"]).classifications,
    )).toBe(true);
    expect(Object.isFrozen(copied.evidence)).toBe(true);
    expect(Object.isFrozen(copied.evidence[0])).toBe(true);
  });
});

describe("Country Assessment V2 dossier reconstruction", () => {
  test("reconstructs a fresh deeply frozen canonical copy", async () => {
    // Break caught: persisted dossier JSON is returned by reference or without nested immutability.
    const built = buildCountryDossierV2(await sealedV2([
      ...everyV2ClaimShape(),
      ...everyScopedRequirement().filter((claim) => {
        const scope = requirementScopeOf(claim);
        return scope?.kind === "companion";
      }),
    ]));
    const borrowed = mutablePayload(built);

    const reconstructed = reconstructCountryDossierPayloadV2(borrowed);
    const borrowedClaims = borrowed.claims as DossierClaimArray;
    (borrowedClaims[0]!.evidence[0] as { navigationUrl: string }).navigationUrl =
      "https://mutated.test";

    expect(reconstructed).toEqual(built);
    expect(reconstructed).not.toBe(borrowed);
    expect(reconstructed.claims).not.toBe(borrowed.claims);
    expect(reconstructed.claims[0]!.evidence[0]!.navigationUrl)
      .toBe(SOURCE_URLS["si-digital-nomad-route"]);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.country.coordinate)).toBe(true);
    expect(Object.isFrozen(reconstructed.claims)).toBe(true);
    expect(Object.isFrozen(reconstructed.claims[0])).toBe(true);
    expect(Object.isFrozen(reconstructed.claims[0]!.value)).toBe(true);
    expect(Object.isFrozen(reconstructed.claims[0]!.evidence)).toBe(true);
    expect(Object.isFrozen(reconstructed.claims[0]!.evidence[0])).toBe(true);
  });

  test("rejects noncanonical order, duplicate scope, missing route, wrong IDs, and extra data", async () => {
    // Break caught: persisted JSON bypasses the same closed invariants enforced at publication.
    const payload = buildCountryDossierV2(await sealedV2([
      v2Claim("route_basis"),
      ...everyScopedRequirement(),
    ]));
    const invalidPayloads: unknown[] = [];

    const reordered = mutablePayload(payload);
    (reordered.claims as DossierClaimArray).reverse();
    invalidPayloads.push(reordered);

    const duplicate = mutablePayload(payload);
    (duplicate.claims as DossierClaimArray).push(structuredClone(duplicate.claims[1]!));
    invalidPayloads.push(duplicate);

    const missingRoute = mutablePayload(payload);
    (missingRoute.claims as DossierClaimArray).splice(0, 1);
    invalidPayloads.push(missingRoute);

    const wrongId = mutablePayload(payload);
    (wrongId.claims as DossierClaimArray)[1] = {
      ...wrongId.claims[1]!,
      claimId: `${wrongId.claims[1]!.claimId}:wrong`,
    };
    invalidPayloads.push(wrongId);

    const extraClaimField = mutablePayload(payload);
    (extraClaimField.claims as DossierClaimArray)[0] = {
      ...extraClaimField.claims[0]!,
      unexpected: true,
    } as unknown as DossierClaimArray[number];
    invalidPayloads.push(extraClaimField);

    const wrongSchema = { ...mutablePayload(payload), schemaVersion: "si-dossier@1" };
    invalidPayloads.push(wrongSchema);

    for (const invalid of invalidPayloads) {
      expect(() => reconstructCountryDossierPayloadV2(invalid)).toThrow("integrity_mismatch");
    }
  });

  test("requires one identical sourcePeriod across every evidence reference in a claim", async () => {
    // Break caught: a later persisted evidence reference drifts from the claim's first period.
    const payload = buildCountryDossierV2(await sealedV2(everyV2ClaimShape()));
    const laterReferenceDrift = mutablePayload(payload);
    const routeClaims = laterReferenceDrift.claims as DossierClaimArray;
    const routeIndex = routeClaims.findIndex((claim) => claim.claimKind === "route_basis");
    const route = routeClaims[routeIndex]!;
    routeClaims[routeIndex] = {
      ...route,
      evidence: [
        ...route.evidence,
        { ...route.evidence[0]!, sourcePeriod: "2025-11-20" },
      ],
    };

    expect(() => reconstructCountryDossierPayloadV2(laterReferenceDrift))
      .toThrow("integrity_mismatch");
  });

  test("binds persisted income evidence sourcePeriod to value.period", async () => {
    // Break caught: persisted income provenance names a different month from the official value.
    const payload = buildCountryDossierV2(await sealedV2(everyV2ClaimShape()));
    const incomePeriodDrift = mutablePayload(payload);
    const incomeClaims = incomePeriodDrift.claims as DossierClaimArray;
    const incomeIndex = incomeClaims.findIndex((claim) => claim.claimKind === "income");
    const income = incomeClaims[incomeIndex]!;
    incomeClaims[incomeIndex] = {
      ...income,
      evidence: income.evidence.map((reference) => ({
        ...reference,
        sourcePeriod: "2026M04",
      })),
    };

    expect(() => reconstructCountryDossierPayloadV2(incomePeriodDrift))
      .toThrow("integrity_mismatch");
  });

  test("rejects hostile borrowed graphs without invoking accessors", async () => {
    // Break caught: reconstruction executes caller code or accepts exotic/non-dense object graphs.
    const payload = buildCountryDossierV2(await sealedV2(everyV2ClaimShape()));
    let accessorReads = 0;
    const topLevelGetter = mutablePayload(payload);
    Object.defineProperty(topLevelGetter, "schemaVersion", {
      enumerable: true,
      configurable: true,
      get: () => {
        accessorReads += 1;
        return "si-dossier@2";
      },
    });
    const nestedGetter = mutablePayload(payload);
    Object.defineProperty(nestedGetter.country.coordinate, "lat", {
      enumerable: true,
      configurable: true,
      get: () => {
        accessorReads += 1;
        return 46.1512;
      },
    });
    const customPrototype = mutablePayload(payload);
    Object.setPrototypeOf(customPrototype, { inherited: true });
    const symbolKey = mutablePayload(payload);
    Object.defineProperty(symbolKey, Symbol("hidden"), { value: true });
    const sparseClaims = mutablePayload(payload);
    delete (sparseClaims.claims as DossierClaimArray)[0];
    const decoratedClaims = mutablePayload(payload);
    (decoratedClaims.claims as unknown as Record<string, unknown>).metadata = "borrowed";
    const cyclic = mutablePayload(payload);
    (cyclic.country as unknown as Record<string, unknown>).cycle = cyclic.country;

    for (const hostile of [
      topLevelGetter,
      nestedGetter,
      customPrototype,
      symbolKey,
      sparseClaims,
      decoratedClaims,
      cyclic,
    ]) {
      expect(() => reconstructCountryDossierPayloadV2(hostile)).toThrow("integrity_mismatch");
    }
    expect(accessorReads).toBe(0);
  });

  test("rejects top-level, nested, and revoked Proxies without invoking traps", async () => {
    // Break caught: reconstruction reflects through a caller-owned Proxy and executes its traps.
    const payload = buildCountryDossierV2(await sealedV2(everyV2ClaimShape()));
    let trapCalls = 0;
    const countTrap = (): void => {
      trapCalls += 1;
    };
    const revokedTrap = (): never => {
      countTrap();
      throw new Error("proxy_trap_invoked");
    };
    const topLevel = trappingProxy(mutablePayload(payload), countTrap);
    const nested = mutablePayload(payload);
    const nestedCoordinate = trappingProxy(nested.country.coordinate, countTrap);
    (nested.country as { coordinate: typeof nestedCoordinate }).coordinate = nestedCoordinate;
    const revoked = Proxy.revocable(mutablePayload(payload), {
      get: revokedTrap,
      getOwnPropertyDescriptor: revokedTrap,
      getPrototypeOf: revokedTrap,
      ownKeys: revokedTrap,
    });
    revoked.revoke();

    for (const hostile of [topLevel, nested, revoked.proxy]) {
      expect(() => reconstructCountryDossierPayloadV2(hostile)).toThrow("integrity_mismatch");
    }
    expect(trapCalls).toBe(0);
  });

  test("rejects enumerable __proto__ fields instead of erasing them while cloning", async () => {
    // Break caught: assignment into a plain clone consumes __proto__ and bypasses exact-key checks.
    const payload = buildCountryDossierV2(await sealedV2(everyV2ClaimShape()));
    const topLevel = mutablePayload(payload);
    addEnumerableProto(topLevel);
    const nested = mutablePayload(payload);
    addEnumerableProto(nested.claims[0]!.value);

    expect(() => reconstructCountryDossierPayloadV2(topLevel)).toThrow("integrity_mismatch");
    expect(() => reconstructCountryDossierPayloadV2(nested)).toThrow("integrity_mismatch");
  });
});

describe("Country Assessment V2 hostile publication boundary", () => {
  test("rejects top-level, nested, and revoked Proxies without invoking traps", async () => {
    // Break caught: publication reflects through a caller-owned Proxy and executes its traps.
    const prepared = await sealedV2(everyV2ClaimShape());
    let trapCalls = 0;
    const countTrap = (): void => {
      trapCalls += 1;
    };
    const revokedTrap = (): never => {
      countTrap();
      throw new Error("proxy_trap_invoked");
    };
    const topLevel = trappingProxy(structuredClone(prepared), countTrap);
    const nested = structuredClone(prepared);
    const nestedClaim = nested.snapshot.claims.find((claim) => "claimKind" in claim)!;
    const nestedValue = trappingProxy(nestedClaim.value, countTrap);
    (nestedClaim as { value: typeof nestedValue }).value = nestedValue;
    const revoked = Proxy.revocable(structuredClone(prepared), {
      get: revokedTrap,
      getOwnPropertyDescriptor: revokedTrap,
      getPrototypeOf: revokedTrap,
      ownKeys: revokedTrap,
    });
    revoked.revoke();

    for (const hostile of [topLevel, nested, revoked.proxy]) {
      expect(() => buildCountryDossierV2(hostile)).toThrow("publication_not_allowed");
    }
    expect(trapCalls).toBe(0);
  });

  test("rejects enumerable __proto__ fields instead of erasing them while cloning", async () => {
    // Break caught: assignment into a plain clone consumes __proto__ and bypasses exact-key checks.
    const prepared = await sealedV2(everyV2ClaimShape());
    const topLevel = structuredClone(prepared);
    addEnumerableProto(topLevel);
    const nested = structuredClone(prepared);
    const nestedClaim = nested.snapshot.claims.find((claim) => "claimKind" in claim)!;
    addEnumerableProto(nestedClaim.value);

    expect(() => buildCountryDossierV2(topLevel)).toThrow("publication_not_allowed");
    expect(() => buildCountryDossierV2(nested)).toThrow("publication_not_allowed");
  });
});

describe("Country Assessment V1/V2 rejection boundary", () => {
  test("rejects V1 Evidence and payloads as V2 and rejects V2 Evidence as V1", async () => {
    // Break caught: a schema/rules version is coerced across the historical boundary.
    const v1 = await sealedV1();
    const v2 = await sealedV2(everyV2ClaimShape());

    expect(() => buildCountryDossierV2(v1 as unknown as V2SealedEvidence))
      .toThrow("publication_not_allowed");
    expect(() => buildCountryDossier(
      v2 as unknown as SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
    )).toThrow("publication_not_allowed");
    expect(() => reconstructCountryDossierPayloadV2(buildCountryDossier(v1)))
      .toThrow("integrity_mismatch");
  });
});
