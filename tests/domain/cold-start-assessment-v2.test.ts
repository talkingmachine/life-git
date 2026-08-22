import { types } from "node:util";

import { describe, expect, test } from "vitest";

import {
  assessColdStartV2,
  COLD_START_ASSESSMENT_V2_RULES_VERSION,
  type ColdStartAssessmentInputV2,
  type ColdStartComparatorV2,
} from "../../src/decision/cold-start-assessment-v2";
import {
  projectCountryAssessmentInputV2,
} from "../../src/decision/country-assessment-input-v2";
import {
  reconstructFormalResidenceVerdict,
  type CatalogCompletenessAttestation,
  type FormalEvidenceReference,
} from "../../src/decision/formal-residence-verdict";
import {
  materializeRelocationProfileV2,
  type RelocationParticipantV2,
} from "../../src/decision/relocation-profile";
import {
  REQUIRED_CLAIM_KINDS,
} from "../../src/research/country-registry";
import type {
  ClaimKind,
  CountryEvidenceRef,
  SloveniaSourceId,
} from "../../src/research/cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_FORMAL_ROUTE_ID,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  sloveniaV2ClaimId,
  sloveniaV2ClaimScopeToken,
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type ParticipantRequirementScopeV2,
  type VerifiedCountryClaimV2,
} from "../../src/research/cold-start-contracts-v2";
import type {
  Claim,
  CbrEurFacts,
  EvidenceBlockerKind,
  EvidenceSnapshot,
} from "../../src/research/contracts";
import {
  reconstructCountryDossierPayloadV2,
  type DossierClaimV2,
  type DossierVersionV2,
} from "../../src/research/dossier-v2";

const ASSESSMENT_DATE = "2026-01-31";
const SELF_ID = "00000000-0000-4000-8000-000000000001";
const SPOUSE_ID = "00000000-0000-4000-8000-000000000002";
const SPOUSE_2_ID = "00000000-0000-4000-8000-000000000003";
const CHILD_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_ID = "00000000-0000-4000-8000-000000000005";
const EVIDENCE_ID = "e".repeat(64);
const SOURCE_URLS = Object.freeze({
  "si-digital-nomad-route": "https://www.gov.si/digital-nomad",
  "si-income-threshold": "https://pxweb.stat.si/income",
  "si-companion-employment": "https://www.ess.gov.si/companion",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp",
} as const satisfies Readonly<Record<SloveniaSourceId, string>>);
const RESOLVED_URLS = Object.freeze({
  "si-digital-nomad-route": "https://pisrs.si/route-evidence",
  "si-income-threshold": "https://pxweb.stat.si/income-evidence",
  "si-companion-employment": "https://pisrs.si/companion-evidence",
  "cbr-eur": "https://www.cbr.ru/scripts/XML_daily.asp?date_req=31/01/2026",
} as const satisfies Readonly<Record<SloveniaSourceId, string>>);
const SCOPE_ORDER = [
  "applicant",
  "companion-spouse",
  "companion-minor_child",
  "companion-other_family",
] as const;

type CountryClaim = VerifiedCountryClaimV2<ClaimKind>;
type CbrClaim = Claim<CbrEurFacts, "cbr-eur">;

interface FixtureOptions {
  readonly assessmentAt?: string;
  readonly moveHorizon?:
    | "within_3_months"
    | "3_to_6_months"
    | "6_to_12_months"
    | "more_than_12_months";
  readonly participants?: readonly [
    RelocationParticipantV2,
    ...RelocationParticipantV2[],
  ];
  readonly mutateClaims?: (claims: CountryClaim[]) => void;
  readonly cbrClaims?: readonly CbrClaim[];
  readonly dossier?: boolean;
  readonly completeness?: (
    fixture: Omit<AssessmentFixture, "input">,
  ) => CatalogCompletenessAttestation;
  readonly omitResolvedEvidence?: boolean;
}

interface AssessmentFixture {
  readonly input: ColdStartAssessmentInputV2;
  readonly evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly dossier?: DossierVersionV2;
  readonly profileSnapshotId: string;
  readonly countryClaims: readonly CountryClaim[];
}

interface MutableEvidenceReference {
  sourceId: SloveniaSourceId;
  artifactId: string;
  navigationUrl: string;
  resolvedEvidenceUrl: string;
  sourcePeriod: string;
  anchor: {
    artifactId: string;
    locator: string;
    excerptSha256: string;
  };
}

interface MutableEvidenceClaim {
  claimKind?: string;
  claimId: string;
  sourceId: SloveniaSourceId;
  validatorVersion: string;
  sourcePeriod: string;
  value: Record<string, unknown>;
  anchor: MutableEvidenceReference["anchor"];
  evidence: MutableEvidenceReference[];
}

interface MutableEvidenceBlocker {
  sourceId: SloveniaSourceId;
  kind: EvidenceBlockerKind;
  navigationUrl: string;
  resolvedUrl?: string;
  artifactIds: string[];
  unexpected?: true;
}

interface MutableAssessmentInput {
  assessmentAt: string;
  profile: { profileSnapshotId: string };
  evidence: {
    assessmentDate: string;
    rulesVersion: string;
    parserVersions: Record<SloveniaSourceId, string>;
    artifactIds: string[];
    claims: MutableEvidenceClaim[];
    blockers: MutableEvidenceBlocker[];
    coverage: Record<SloveniaSourceId, "verified" | "unavailable">;
    contextHash?: unknown;
    knowledgeBaselineRevisionId?: unknown;
  };
  sourceResolvedEvidence: Record<SloveniaSourceId, string>;
  dossier: {
    countryCode: string;
    schemaVersion: string;
    evidenceSnapshotId: string;
    payload: { claims: unknown[] };
  };
}

interface MutableCompleteness {
  jurisdiction: string;
  profileSnapshotId: string;
  effectiveTo?: string;
  evidenceSnapshotId: string;
  catalogEvidence: Array<{ artifactId: string }>;
  catalogRoutes: Array<{ routeId: string }>;
}

interface MutableCbrClaim {
  claimId: string;
  value: { rate: unknown };
  anchor: { excerptSha256: string };
  unexpected?: true;
}

function sourceArtifactId(sourceId: SloveniaSourceId): string {
  return `${sourceId}:artifact`;
}

function unavailableBlocker(
  sourceId: SloveniaSourceId,
  artifactIds: readonly string[] = [sourceArtifactId(sourceId)],
): MutableEvidenceBlocker {
  return {
    sourceId,
    kind: "semantic_mismatch",
    navigationUrl: SOURCE_URLS[sourceId],
    resolvedUrl: RESOLVED_URLS[sourceId],
    artifactIds: [...artifactIds],
  };
}

function evidenceRef(
  sourceId: Exclude<SloveniaSourceId, "cbr-eur">,
  sourcePeriod: string,
  suffix: string,
): CountryEvidenceRef {
  return {
    sourceId,
    artifactId: sourceArtifactId(sourceId),
    navigationUrl: SOURCE_URLS[sourceId],
    resolvedEvidenceUrl: RESOLVED_URLS[sourceId],
    sourcePeriod,
    anchor: {
      artifactId: sourceArtifactId(sourceId),
      locator: `locator:${suffix}`,
      excerptSha256: "a".repeat(64),
    },
  };
}

function countryClaim<K extends ClaimKind>(
  claimKind: K,
  value: ClaimValueByKindV2[K],
  suffix: string = claimKind,
): VerifiedCountryClaimV2<K> {
  const sourceId = SLOVENIA_V2_CLAIM_SOURCE[claimKind];
  const sourcePeriod = claimKind === "income"
    ? (value as ClaimValueByKindV2["income"]).period
    : "2025-11-21";
  const references = [evidenceRef(sourceId, sourcePeriod, suffix)];
  return {
    claimId: sloveniaV2ClaimId(claimKind, value),
    claimKind,
    sourceId,
    value: structuredClone(value),
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod,
    anchor: { ...references[0]!.anchor },
    evidence: references,
    validatorVersion: SLOVENIA_V2_CLAIM_VALIDATOR[claimKind],
    status: "verified",
  };
}

function scopedValues(scope: ParticipantRequirementScopeV2): readonly [
  ClaimValueByKindV2["duration"],
  ClaimValueByKindV2["general_statutory_prerequisites"],
] {
  return [
    {
      maximumMonths: 12,
      extendable: false,
      reapplyAfterMonths: 6,
      scope,
    },
    {
      passportBeyondPermitMonths: 3,
      healthInsurance: true,
      article55GroundsApply: true,
      scope,
    },
  ];
}

function baseCountryClaims(): CountryClaim[] {
  const claims: CountryClaim[] = [
    countryClaim("route_basis", {
      route: "temporary_residence_digital_nomad",
      legalBasis: "ZTuj-2 Article 51a",
      effectiveFrom: "2025-11-21",
    }),
    countryClaim("citizenship_applicability", {
      classifications: [
        { countryCode: "RU", status: "eligible" },
        { countryCode: "RS", status: "eligible" },
      ],
    }),
    countryClaim("remote_work_relations", {
      allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
      slovenianLabourMarketWorkIncluded: false,
    }),
    countryClaim("income", {
      metric: "latest_official_average_monthly_net_salary",
      multiplier: "2",
      thresholdEur: "2000.00",
      currency: "EUR",
      basis: "net",
      appliesTo: "applicant",
      period: "2026M01",
    }),
    countryClaim("qualification", {
      rule: "not_listed_in_authoritative_requirements",
    }),
    countryClaim("companion_entry", {
      relationshipClassifications: [
        { relationship: "spouse", status: "eligible" },
        { relationship: "minor_child", status: "eligible" },
        { relationship: "other_family", status: "eligible" },
      ],
    }),
    countryClaim("companion_local_work_access", {
      access: "conditional",
      labourMarketCheck: true,
      informationSheet: true,
    }),
  ];
  const scopes: readonly ParticipantRequirementScopeV2[] = [
    { kind: "applicant" },
    { kind: "companion", relationship: "spouse" },
    { kind: "companion", relationship: "minor_child" },
    { kind: "companion", relationship: "other_family" },
  ];
  for (const scope of scopes) {
    const [duration, statutory] = scopedValues(scope);
    const suffix = scope.kind === "applicant" ? "applicant" : scope.relationship;
    claims.push(countryClaim("duration", duration, `duration:${suffix}`));
    claims.push(countryClaim(
      "general_statutory_prerequisites",
      statutory,
      `statutory:${suffix}`,
    ));
  }
  return canonicalClaims(claims);
}

function canonicalClaims(claims: readonly CountryClaim[]): CountryClaim[] {
  const kindOrder = new Map<ClaimKind, number>(
    REQUIRED_CLAIM_KINDS.map((kind, index) => [kind, index]),
  );
  return [...claims].sort((left, right) => {
    const kindDifference = kindOrder.get(left.claimKind)! - kindOrder.get(right.claimKind)!;
    if (kindDifference !== 0) return kindDifference;
    const leftScope = sloveniaV2ClaimScopeToken(left.claimKind, left.value);
    const rightScope = sloveniaV2ClaimScopeToken(right.claimKind, right.value);
    if (leftScope === undefined || rightScope === undefined) return 0;
    return SCOPE_ORDER.indexOf(leftScope) - SCOPE_ORDER.indexOf(rightScope);
  });
}

function cbrClaim(
  effectiveDate = ASSESSMENT_DATE,
  rate = "100.0000",
  claimId = "cbr-eur-facts-1",
): CbrClaim {
  return {
    claimId,
    sourceId: "cbr-eur",
    value: {
      base: "EUR",
      quote: "RUB",
      nominal: "1",
      rate: rate as CbrEurFacts["rate"],
      effectiveDate,
    },
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod: effectiveDate,
    anchor: {
      artifactId: sourceArtifactId("cbr-eur"),
      locator: "Valute[CharCode=EUR]",
      excerptSha256: "c".repeat(64),
    },
    status: "verified",
  };
}

function malformedCbrClaim(
  mutate: (claim: MutableCbrClaim) => void,
): CbrClaim {
  const claim = structuredClone(cbrClaim()) as unknown as MutableCbrClaim;
  mutate(claim);
  return claim as unknown as CbrClaim;
}

function unrecognizedEvidenceClaim(): MutableEvidenceClaim {
  return {
    claimId: "unknown-claim",
    sourceId: "si-digital-nomad-route",
    value: {},
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod: "2025-11-21",
    anchor: {
      artifactId: sourceArtifactId("si-digital-nomad-route"),
      locator: "unknown",
      excerptSha256: "a".repeat(64),
    },
    status: "verified",
  } as unknown as MutableEvidenceClaim;
}

function selfParticipant(
  input: {
    readonly citizenships?: readonly string[];
    readonly passport?: "absent" | { readonly validUntil: string };
    readonly workStatus?: "not_working" | "employment" | "self_employment" |
      "contract_service" | "other";
    readonly remote?: "yes" | "no";
    readonly income?: {
      readonly amount: string;
      readonly currency: string;
      readonly basis: "net" | "gross";
    };
  } = {},
): RelocationParticipantV2 {
  const workStatus = input.workStatus ?? "employment";
  return {
    participantId: SELF_ID,
    relationship: "self",
    citizenships: input.citizenships ?? ["RU"],
    passport: input.passport ?? { validUntil: "2030-01-01" },
    currentWork: {
      applicability: "required",
      value: { status: workStatus, occupation: "Engineer" },
    },
    remoteContinuation: workStatus === "not_working"
      ? { applicability: "not_applicable" }
      : { applicability: "required", value: input.remote ?? "yes" },
    monthlyIncome: {
      applicability: "required",
      value: input.income ?? { amount: "2500", currency: "EUR", basis: "net" },
    },
    education: {
      applicability: "required",
      value: { level: "higher", field: "Engineering" },
    },
    relevantExperienceYears: { applicability: "required", value: 7 },
  };
}

function companionParticipant(
  participantId: string,
  relationship: "spouse" | "minor_child" | "other_family",
  passport: "absent" | { readonly validUntil: string } = { validUntil: "2030-01-01" },
): RelocationParticipantV2 {
  if (relationship === "minor_child") {
    return {
      participantId,
      relationship,
      citizenships: ["RU"],
      passport,
      currentWork: { applicability: "not_applicable" },
      remoteContinuation: { applicability: "not_applicable" },
      monthlyIncome: { applicability: "not_applicable" },
      education: { applicability: "not_applicable" },
      relevantExperienceYears: { applicability: "not_applicable" },
    };
  }
  return {
    participantId,
    relationship,
    citizenships: ["RU"],
    passport,
    currentWork: {
      applicability: "required",
      value: { status: "not_working" },
    },
    remoteContinuation: { applicability: "not_applicable" },
    monthlyIncome: {
      applicability: "required",
      value: { amount: "0", currency: "EUR", basis: "net" },
    },
    education: {
      applicability: "required",
      value: { level: "higher" },
    },
    relevantExperienceYears: { applicability: "required", value: 0 },
  };
}

function dossierClaim(claim: CountryClaim): DossierClaimV2 {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    value: structuredClone(claim.value),
    validatorVersion: claim.validatorVersion,
    evidence: claim.evidence.map((reference) => ({
      sourceId: reference.sourceId,
      navigationUrl: reference.navigationUrl,
      resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
      sourcePeriod: reference.sourcePeriod,
      locator: reference.anchor.locator,
      excerptSha256: reference.anchor.excerptSha256,
    })),
  };
}

function buildFixture(options: FixtureOptions = {}): AssessmentFixture {
  const assessmentAt = options.assessmentAt ?? ASSESSMENT_DATE;
  const participants = options.participants ?? [selfParticipant()];
  const profile = materializeRelocationProfileV2({
    confirmedAt: "2026-01-30T10:00:00.000Z",
    profile: {
      schemaVersion: "relocation-profile@2",
      profile: {
        currentLocation: { countryCode: "RU", city: "Moscow" },
        moveHorizon: options.moveHorizon ?? "within_3_months",
        movingParty: participants.length === 1 ? "alone" : "with_companions",
        participants,
        savings: { min: "0", max: "10000", currency: "EUR" },
      },
    },
  });
  const countryClaims = baseCountryClaims();
  options.mutateClaims?.(countryClaims);
  const orderedClaims = canonicalClaims(countryClaims);
  const fxClaims = options.cbrClaims ?? [cbrClaim(assessmentAt)];
  const allClaims: ColdStartEvidenceClaimV2[] = [...orderedClaims, ...fxClaims];
  const coverage = Object.fromEntries(SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => [
    sourceId,
    allClaims.some((claim) => claim.sourceId === sourceId) ? "verified" : "unavailable",
  ])) as Record<SloveniaSourceId, "verified" | "unavailable">;
  const evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2> = {
    id: EVIDENCE_ID,
    assessmentDate: assessmentAt,
    artifactIds: SLOVENIA_V2_SOURCE_ORDER.map(sourceArtifactId),
    claims: allClaims,
    blockers: SLOVENIA_V2_SOURCE_ORDER.flatMap((sourceId) =>
      coverage[sourceId] === "verified" ? [] : [unavailableBlocker(sourceId)]
    ),
    coverage,
    parserVersions: { ...SLOVENIA_V2_PARSER_VERSIONS },
    rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    manifestHash: "m".repeat(64),
    hmac: "h".repeat(64),
  };
  const dossier = options.dossier === false
    ? undefined
    : {
        id: "d".repeat(64),
        ordinal: 1,
        countryCode: "SI" as const,
        evidenceSnapshotId: evidence.id,
        schemaVersion: "si-dossier@2" as const,
        payload: reconstructCountryDossierPayloadV2({
          country: {
            code: "SI",
            englishName: "Slovenia",
            displayName: "Словения",
            flag: "🇸🇮",
            coordinate: { lat: 46.1512, lng: 14.9955 },
          },
          schemaVersion: "si-dossier@2",
          claims: orderedClaims.map(dossierClaim),
        }),
        payloadHash: "p".repeat(64),
        manifestHash: "n".repeat(64),
        hmac: "s".repeat(64),
        publishedAt: "2026-01-31T09:00:00.000Z",
      } satisfies DossierVersionV2;
  const partial = {
    evidence,
    ...(dossier === undefined ? {} : { dossier }),
    profileSnapshotId: profile.id,
    countryClaims: orderedClaims,
  };
  const completeness = options.completeness?.(partial);
  const input: ColdStartAssessmentInputV2 = {
    assessmentAt,
    profile: projectCountryAssessmentInputV2(profile),
    evidence,
    ...(dossier === undefined ? {} : { dossier }),
    ...(completeness === undefined ? {} : { completeness }),
    sourceNavigation: { ...SOURCE_URLS },
    ...(options.omitResolvedEvidence === true
      ? {}
      : { sourceResolvedEvidence: { ...RESOLVED_URLS } }),
  };
  return { ...partial, input };
}

function participant(
  comparator: ColdStartComparatorV2,
  participantId: string,
) {
  const result = comparator.participantAssessments.find(
    (candidate) => candidate.participantId === participantId,
  );
  if (result === undefined) throw new Error(`missing participant ${participantId}`);
  return result;
}

function replaceClaim<K extends ClaimKind>(
  claims: CountryClaim[],
  claimKind: K,
  value: ClaimValueByKindV2[K],
): void {
  const index = claims.findIndex((claim) => claim.claimKind === claimKind);
  if (index < 0) throw new Error(`missing ${claimKind}`);
  claims[index] = countryClaim(claimKind, value);
}

function removeClaim(
  claims: CountryClaim[],
  claimKind: ClaimKind,
  scope?: string,
): void {
  const index = claims.findIndex((claim) => claim.claimKind === claimKind &&
    (scope === undefined || sloveniaV2ClaimScopeToken(claim.claimKind, claim.value) === scope));
  if (index < 0) throw new Error(`missing ${claimKind}:${scope ?? "unscoped"}`);
  claims.splice(index, 1);
}

function formalReference(fixture: Omit<AssessmentFixture, "input">): FormalEvidenceReference {
  const claim = fixture.countryClaims.find(({ claimKind }) => claimKind === "route_basis")!;
  const reference = claim.evidence[0]!;
  return {
    evidenceSnapshotId: fixture.evidence.id,
    artifactId: reference.artifactId,
    sourceId: reference.sourceId,
    navigationUrl: reference.navigationUrl,
    resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
    sourcePeriod: reference.sourcePeriod,
    locator: reference.anchor.locator,
    excerptSha256: reference.anchor.excerptSha256,
    validatorVersion: claim.validatorVersion,
  };
}

function exactCompleteness(
  fixture: Omit<AssessmentFixture, "input">,
): CatalogCompletenessAttestation {
  const reference = formalReference(fixture);
  return {
    catalogRevisionId: "si-routes-synthetic@1",
    jurisdiction: "SI",
    authority: "Synthetic exact test authority",
    scopeKind: "all_long_term_residence_routes_for_profile",
    profileSnapshotId: fixture.profileSnapshotId,
    catalogRoutes: [{
      routeId: SLOVENIA_V2_FORMAL_ROUTE_ID,
      applicability: "applicable",
      evidence: [reference],
    }],
    validatorVersion: "synthetic-catalog@1",
    effectiveFrom: "2025-11-21",
    evidenceSnapshotId: fixture.evidence.id,
    catalogEvidence: [reference],
  };
}

describe("Country Assessment V2 input and singleton route boundary", () => {
  test("exports the exact rules and singleton route identities", () => {
    expect(COLD_START_ASSESSMENT_V2_RULES_VERSION).toBe("cold-start-assessment@2");
    expect(SLOVENIA_V2_FORMAL_ROUTE_ID).toBe(
      "si-temporary-residence-digital-nomad",
    );
  });

  test("returns no fabricated route or participant projection without a dossier", () => {
    const comparator = assessColdStartV2(buildFixture({ dossier: false }).input);

    expect(comparator.marker).toBe("yellow");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(comparator.participantAssessments).toEqual([]);
    expect(comparator.formalVerdict.routeOutcomes).toEqual([]);
  });

  test("keeps no-dossier yellow even with a synthetic all-excluded catalog", () => {
    const comparator = assessColdStartV2(buildFixture({
      dossier: false,
      completeness: (partial) => {
        const exact = exactCompleteness(partial);
        return {
          ...exact,
          catalogRoutes: [{
            routeId: "si-temporary-residence-study",
            applicability: "excluded",
            exclusionCode: "profile_not_eligible",
            claimIds: ["si-study:profile-exclusion@1"],
            evidence: [exact.catalogEvidence[0]!],
          }],
        } as CatalogCompletenessAttestation;
      },
    }).input);

    expect(comparator.marker).toBe("yellow");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(comparator.formalVerdict.catalogCompleteness.status).toBe("unproven");
  });

  test("returns research-incomplete for sealed all-unavailable zero-artifact Evidence", () => {
    const borrowed = structuredClone(buildFixture({ dossier: false }).input) as unknown as
      MutableAssessmentInput;
    borrowed.evidence.artifactIds = [];
    borrowed.evidence.claims = [];
    borrowed.evidence.coverage = Object.fromEntries(SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => [
      sourceId,
      "unavailable",
    ])) as Record<SloveniaSourceId, "unavailable">;
    borrowed.evidence.blockers = SLOVENIA_V2_SOURCE_ORDER.map((sourceId) => ({
      sourceId,
      kind: "source_unavailable",
      navigationUrl: SOURCE_URLS[sourceId],
      artifactIds: [],
    }));

    const comparator = assessColdStartV2(
      borrowed as unknown as ColdStartAssessmentInputV2,
    );
    expect(comparator.marker).toBe("yellow");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(comparator.participantAssessments).toEqual([]);
    expect(comparator.formalVerdict.routeOutcomes).toEqual([]);
  });

  const inputMutations: readonly [string, (input: MutableAssessmentInput) => void][] = [
    ["profile binding", (input) => {
      input.profile.profileSnapshotId = "0".repeat(64);
    }],
    ["assessment day", (input) => {
      input.assessmentAt = "2026-01-31T00:00:00.000Z";
    }],
    ["Evidence date", (input) => {
      input.evidence.assessmentDate = "2026-02-01";
    }],
    ["Evidence rules", (input) => {
      input.evidence.rulesVersion = "vs2-si-evidence@2";
    }],
    ["Evidence parser", (input) => {
      input.evidence.parserVersions["si-digital-nomad-route"] = "si-route@2";
    }],
    ["Evidence context hash type", (input) => {
      input.evidence.contextHash = 1;
    }],
    ["Evidence knowledge baseline type", (input) => {
      input.evidence.knowledgeBaselineRevisionId = {};
    }],
    ["partial resolved Evidence map", (input) => {
      delete (input.sourceResolvedEvidence as Partial<Record<SloveniaSourceId, string>>)
        ["cbr-eur"];
    }],
    ["dossier country", (input) => {
      input.dossier.countryCode = "HR";
    }],
    ["dossier schema", (input) => {
      input.dossier.schemaVersion = "si-dossier@1";
    }],
    ["dossier Evidence binding", (input) => {
      input.dossier.evidenceSnapshotId = "0".repeat(64);
    }],
    ["omitted dossier claim", (input) => {
      input.dossier.payload.claims.splice(1, 1);
    }],
    ["duplicate dossier claim", (input) => {
      input.dossier.payload.claims.push(structuredClone(input.dossier.payload.claims[0]));
    }],
    ["extra Evidence claim", (input) => {
      input.evidence.claims.push(structuredClone(input.evidence.claims[0]));
    }],
    ["unrecognized Evidence claim variant", (input) => {
      input.evidence.claims.push(unrecognizedEvidenceClaim());
    }],
  ];

  test.each(inputMutations)("rejects %s drift as integrity mismatch", (_name, mutate) => {
    const borrowed = structuredClone(buildFixture().input) as unknown as
      MutableAssessmentInput;
    mutate(borrowed);
    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test("rejects getters and Proxies without invoking their traps", () => {
    const getterInput = structuredClone(buildFixture().input) as unknown as
      Record<string, unknown>;
    let getterReads = 0;
    Object.defineProperty(getterInput, "assessmentAt", {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return ASSESSMENT_DATE;
      },
    });
    expect(() => assessColdStartV2(getterInput as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
    expect(getterReads).toBe(0);

    let proxyTraps = 0;
    const trap = () => {
      proxyTraps += 1;
      throw new Error("trap invoked");
    };
    const proxy = new Proxy(buildFixture().input, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(types.isProxy(proxy)).toBe(true);
    expect(() => assessColdStartV2(proxy)).toThrow("integrity_mismatch");
    expect(proxyTraps).toBe(0);
  });

  test("omits a hostile completeness getter without invoking it", () => {
    const borrowed = structuredClone(buildFixture({
      participants: [selfParticipant({ remote: "no" })],
    }).input) as unknown as Record<string, unknown>;
    let getterReads = 0;
    Object.defineProperty(borrowed, "completeness", {
      enumerable: true,
      get: () => {
        getterReads += 1;
        throw new Error("getter invoked");
      },
    });

    const comparator = assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2);

    expect(getterReads).toBe(0);
    expect(comparator.marker).toBe("yellow");
    expect(comparator.formalVerdict.catalogCompleteness.status).toBe("unproven");
  });

  test("rejects an unrecognized Evidence claim even without a dossier", () => {
    const borrowed = structuredClone(buildFixture({ dossier: false }).input) as unknown as {
      evidence: { claims: MutableEvidenceClaim[] };
    };
    borrowed.evidence.claims.push(unrecognizedEvidenceClaim());

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["unknown country claim kind", (claims: MutableEvidenceClaim[]) => {
      claims[0]!.claimKind = "future_country_claim";
    }],
    ["malformed country claim", (claims: MutableEvidenceClaim[]) => {
      claims[0]!.validatorVersion = "future-validator@1";
    }],
    ["duplicate country claim identity", (claims: MutableEvidenceClaim[]) => {
      claims.push(structuredClone(claims[0]!));
    }],
  ] as const)("rejects %s without relying on a dossier", (_name, mutate) => {
    const borrowed = structuredClone(buildFixture({ dossier: false }).input) as unknown as
      MutableAssessmentInput;
    mutate(borrowed.evidence.claims);

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test("accepts a valid partial country-claim subset without a dossier", () => {
    const borrowed = structuredClone(buildFixture({ dossier: false }).input) as unknown as
      MutableAssessmentInput;
    borrowed.evidence.claims = borrowed.evidence.claims.filter((claim) =>
      claim.claimKind === "route_basis" || claim.claimKind === undefined
    );
    const unavailableSources = [
      "si-income-threshold",
      "si-companion-employment",
    ] as const;
    for (const sourceId of unavailableSources) {
      borrowed.evidence.coverage[sourceId] = "unavailable";
    }
    borrowed.evidence.blockers = unavailableSources.map((sourceId) =>
      unavailableBlocker(sourceId)
    );

    const comparator = assessColdStartV2(
      borrowed as unknown as ColdStartAssessmentInputV2,
    );
    expect(comparator.marker).toBe("yellow");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(comparator.formalVerdict.routeOutcomes).toEqual([]);
  });

  test.each([
    ["verified source without claims", (input: MutableAssessmentInput) => {
      input.evidence.claims = input.evidence.claims.filter(
        ({ sourceId }) => sourceId !== "si-income-threshold",
      );
    }],
    ["verified source with a blocker", (input: MutableAssessmentInput) => {
      input.evidence.blockers.push(unavailableBlocker("si-income-threshold"));
    }],
    ["unavailable source without a blocker", (input: MutableAssessmentInput) => {
      input.evidence.coverage["si-income-threshold"] = "unavailable";
      input.evidence.claims = input.evidence.claims.filter(
        ({ sourceId }) => sourceId !== "si-income-threshold",
      );
    }],
    ["unavailable source with duplicate blockers", (input: MutableAssessmentInput) => {
      input.evidence.coverage["si-income-threshold"] = "unavailable";
      input.evidence.claims = input.evidence.claims.filter(
        ({ sourceId }) => sourceId !== "si-income-threshold",
      );
      const blocker = unavailableBlocker("si-income-threshold");
      input.evidence.blockers.push(blocker, structuredClone(blocker));
    }],
    ["unavailable source with a claim", (input: MutableAssessmentInput) => {
      input.evidence.coverage["si-income-threshold"] = "unavailable";
      input.evidence.blockers.push(unavailableBlocker("si-income-threshold"));
    }],
  ] as const)("rejects %s in sealed Evidence topology", (_name, mutate) => {
    const borrowed = structuredClone(buildFixture({ dossier: false }).input) as unknown as
      MutableAssessmentInput;
    mutate(borrowed);

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["unknown kind", (blocker: MutableEvidenceBlocker) => {
      (blocker as { kind: string }).kind = "future_blocker";
    }],
    ["non-HTTP navigation", (blocker: MutableEvidenceBlocker) => {
      blocker.navigationUrl = "not-a-url";
    }],
    ["non-HTTP resolved URL", (blocker: MutableEvidenceBlocker) => {
      blocker.resolvedUrl = "not-a-url";
    }],
    ["foreign artifact", (blocker: MutableEvidenceBlocker) => {
      blocker.artifactIds = ["foreign-artifact"];
    }],
    ["duplicate artifact", (blocker: MutableEvidenceBlocker) => {
      blocker.artifactIds = [sourceArtifactId("cbr-eur"), sourceArtifactId("cbr-eur")];
    }],
    ["extra key", (blocker: MutableEvidenceBlocker) => {
      blocker.unexpected = true;
    }],
  ] as const)("rejects unavailable blocker with %s", (_name, mutate) => {
    const borrowed = structuredClone(buildFixture({
      dossier: false,
      cbrClaims: [],
    }).input) as unknown as MutableAssessmentInput;
    const blocker = borrowed.evidence.blockers.find(({ sourceId }) => sourceId === "cbr-eur");
    if (blocker === undefined) throw new Error("missing CBR blocker fixture");
    mutate(blocker);

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test("returns a fresh deeply frozen result isolated from caller mutation", () => {
    const borrowed = structuredClone(buildFixture().input);
    const comparator = assessColdStartV2(borrowed);
    (borrowed.evidence.claims[0] as { claimId: string }).claimId = "changed";

    expect(comparator.formalVerdict.routeOutcomes[0]?.routeId).toBe(
      SLOVENIA_V2_FORMAL_ROUTE_ID,
    );
    expect(Object.isFrozen(comparator)).toBe(true);
    expect(Object.isFrozen(comparator.participantAssessments)).toBe(true);
    expect(Object.isFrozen(comparator.participantAssessments[0]?.reasonCodes)).toBe(true);
  });
});

describe("Country Assessment V2 participant order and exact classifiers", () => {
  test("keeps the singleton route then exact self-and-spouse profile order", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant(), companionParticipant(SPOUSE_ID, "spouse")],
    }).input);

    expect(comparator.participantAssessments.map(({ routeId, participantId }) => ({
      routeId,
      participantId,
    }))).toEqual([
      { routeId: SLOVENIA_V2_FORMAL_ROUTE_ID, participantId: SELF_ID },
      { routeId: SLOVENIA_V2_FORMAL_ROUTE_ID, participantId: SPOUSE_ID },
    ]);
    expect(new Set(comparator.participantAssessments.map(({ routeId, participantId }) =>
      `${routeId}:${participantId}`)).size).toBe(2);
    expect(participant(comparator, SPOUSE_ID).status).toBe("verified");
  });

  test("keeps two companions with the same relationship as distinct ordered pairs", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [
        selfParticipant(),
        companionParticipant(SPOUSE_ID, "spouse"),
        companionParticipant(SPOUSE_2_ID, "spouse"),
      ],
    }).input);

    expect(comparator.participantAssessments.map(({ participantId }) => participantId))
      .toEqual([SELF_ID, SPOUSE_ID, SPOUSE_2_ID]);
  });

  test.each([
    ["spouse", SPOUSE_ID],
    ["minor_child", CHILD_ID],
    ["other_family", OTHER_ID],
  ] as const)("applies only the exact %s relationship classification", (
    relationship,
    participantId,
  ) => {
    const participants = [
      selfParticipant(),
      companionParticipant(participantId, relationship),
    ] as const;
    const excluded = assessColdStartV2(buildFixture({
      participants,
      mutateClaims: (claims) => replaceClaim(claims, "companion_entry", {
        relationshipClassifications: [{ relationship, status: "excluded" }],
      }),
    }).input);
    const missing = assessColdStartV2(buildFixture({
      participants,
      mutateClaims: (claims) => replaceClaim(claims, "companion_entry", {
        relationshipClassifications: [{
          relationship: relationship === "spouse" ? "minor_child" : "spouse",
          status: "eligible",
        }],
      }),
    }).input);

    expect(participant(excluded, participantId)).toMatchObject({
      status: "impossible",
      reasonCodes: expect.arrayContaining(["companion_route_impossible"]),
    });
    expect(participant(missing, participantId)).toMatchObject({
      status: "unknown",
      reasonCodes: expect.arrayContaining(["companion_route_unverified"]),
    });
  });

  test.each([
    ["all excluded", ["RU"], [{ countryCode: "RU", status: "excluded" }], "impossible", "citizenship_excluded"],
    ["eligible", ["RU"], [{ countryCode: "RU", status: "eligible" }], "unknown", undefined],
    ["eligible plus fully classified excluded", ["RU", "RS"], [
      { countryCode: "RU", status: "eligible" },
      { countryCode: "RS", status: "excluded" },
    ], "unknown", undefined],
    ["eligible plus unclassified", ["RU", "RS"], [
      { countryCode: "RU", status: "eligible" },
    ], "unknown", "citizenship_applicability_unknown"],
    ["all unclassified", ["RU"], [{ countryCode: "US", status: "eligible" }], "unknown", "citizenship_applicability_unknown"],
  ] as const)("classifies citizenship when %s", (
    _name,
    citizenships,
    classifications,
    status,
    reasonCode,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ citizenships })],
      mutateClaims: (claims) => replaceClaim(claims, "citizenship_applicability", {
        classifications: structuredClone(classifications),
      }),
    }).input);
    const result = participant(comparator, SELF_ID);

    expect(result.status).toBe(status);
    if (reasonCode === undefined) {
      expect(result.reasonCodes).not.toContain("citizenship_applicability_unknown");
      expect(result.reasonCodes).not.toContain("citizenship_excluded");
    } else {
      expect(result.reasonCodes).toContain(reasonCode);
    }
  });

  test("keeps a missing citizenship classifier unknown", () => {
    const comparator = assessColdStartV2(buildFixture({
      mutateClaims: (claims) => removeClaim(claims, "citizenship_applicability"),
    }).input);

    expect(participant(comparator, SELF_ID).reasonCodes)
      .toContain("citizenship_applicability_unknown");
    expect(comparator.personalFit).toBe("research_incomplete");
  });
});

describe("Country Assessment V2 passport interval and scope", () => {
  test.each([
    ["within_3_months", "2030-01-01", false],
    ["3_to_6_months", "2030-01-01", false],
    ["6_to_12_months", "2030-01-01", false],
    ["more_than_12_months", "2030-01-01", true],
  ] as const)("evaluates %s with its exact inclusive move interval", (
    moveHorizon,
    validUntil,
    isUnknown,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      moveHorizon,
      participants: [selfParticipant({ passport: { validUntil } })],
    }).input);
    expect(participant(comparator, SELF_ID).reasonCodes.includes("passport_validity_unknown"))
      .toBe(isUnknown);
  });

  test.each([
    ["day before required early", "2027-07-29", "passport_validity_insufficient"],
    ["equal required early after sequential Jan-31 clamp", "2027-07-30", "passport_validity_unknown"],
    ["inside interval", "2027-08-01", "passport_validity_unknown"],
    ["equal required late", "2027-10-31", undefined],
  ] as const)("handles %s", (_name, validUntil, reasonCode) => {
    const comparator = assessColdStartV2(buildFixture({
      moveHorizon: "3_to_6_months",
      participants: [selfParticipant({ passport: { validUntil } })],
    }).input);
    const result = participant(comparator, SELF_ID);
    if (reasonCode === undefined) {
      expect(result.reasonCodes).not.toContain("passport_validity_unknown");
      expect(result.reasonCodes).not.toContain("passport_validity_insufficient");
    } else {
      expect(result.reasonCodes).toContain(reasonCode);
    }
  });

  test("makes an absent passport impossible only with both exact scoped claims", () => {
    const proved = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ passport: "absent" })],
    }).input);
    const unproved = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ passport: "absent" })],
      mutateClaims: (claims) => removeClaim(
        claims,
        "general_statutory_prerequisites",
        "applicant",
      ),
    }).input);

    expect(participant(proved, SELF_ID)).toMatchObject({
      status: "impossible",
      reasonCodes: expect.arrayContaining(["passport_validity_insufficient"]),
    });
    expect(participant(unproved, SELF_ID)).toMatchObject({
      status: "unknown",
      reasonCodes: expect.arrayContaining(["passport_validity_unknown"]),
    });
  });

  test.each([
    ["applicant terms do not serve spouse", "spouse", SPOUSE_ID, "companion-spouse"],
    ["spouse terms do not serve child", "minor_child", CHILD_ID, "companion-minor_child"],
  ] as const)("keeps scope closed when %s", (_name, relationship, participantId, scope) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant(), companionParticipant(participantId, relationship)],
      mutateClaims: (claims) => {
        removeClaim(claims, "duration", scope);
        removeClaim(claims, "general_statutory_prerequisites", scope);
      },
    }).input);

    expect(participant(comparator, participantId).reasonCodes)
      .toContain("passport_validity_unknown");
  });
});

describe("Country Assessment V2 current work and income", () => {
  test.each([
    [true, "not_working", undefined, "impossible", "remote_continuation_unavailable"],
    [true, "employment", "no", "impossible", "remote_continuation_unavailable"],
    [true, "employment", "yes", "unknown", "remote_work_prerequisite_unknown"],
    [false, "not_working", undefined, "unknown", "remote_work_prerequisite_unknown"],
    [false, "employment", "no", "unknown", "remote_work_prerequisite_unknown"],
    [false, "employment", "yes", "unknown", "remote_work_prerequisite_unknown"],
  ] as const)("evaluates remote claim=%s work=%s continuation=%s", (
    withRemoteClaim,
    workStatus,
    remote,
    status,
    reasonCode,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ workStatus, ...(remote === undefined ? {} : { remote }) })],
      mutateClaims: withRemoteClaim
        ? undefined
        : (claims) => removeClaim(claims, "remote_work_relations"),
    }).input);
    const result = participant(comparator, SELF_ID);

    expect(result.status).toBe(status);
    expect(result.reasonCodes).toContain(reasonCode);
    expect(comparator.formalVerdict.routeOutcomes[0]?.status).not.toBe("viable");
  });

  test.each([
    ["below", "1999.99", "net", "income_below_verified_threshold"],
    ["equal", "2000", "net", undefined],
    ["above", "2000.01", "net", undefined],
    ["zero", "0", "net", "income_below_verified_threshold"],
    ["gross", "3000", "gross", "income_basis_not_comparable"],
  ] as const)("compares direct EUR when income is %s", (
    _name,
    amount,
    basis,
    reasonCode,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ income: { amount, currency: "EUR", basis } })],
    }).input);
    const result = participant(comparator, SELF_ID);

    if (reasonCode === undefined) expect(result.reasonCodes).not.toContain("income_below_verified_threshold");
    else expect(result.reasonCodes).toContain(reasonCode);
    if (basis === "net") {
      expect(comparator.formula).toEqual({
        formulaId: "FORMULA-VS2-INCOME-EUR-01",
        formulaVersion: "1",
        expression: "monthlyIncomeEur < thresholdEur",
        monthlyIncomeEur: amount === "1999.99" || amount === "2000.01" ? amount : String(Number(amount)),
        thresholdEur: "2000.00",
        rounding: "UNROUNDED_THEN_HALF_UP_2DP",
        sourceClaimIds: ["si-income-threshold:income:si-income@3"],
      });
    } else {
      expect(comparator.formula).toBeUndefined();
    }
  });

  test("rejects malformed CBR independently of dossier and income currency", () => {
    const noDossier = buildFixture({
      dossier: false,
      cbrClaims: [malformedCbrClaim((claim) => {
        claim.value.rate = 100;
      })],
    }).input;
    const directEur = buildFixture({
      cbrClaims: [malformedCbrClaim((claim) => {
        claim.value.rate = "1e2";
      })],
    }).input;

    expect(() => assessColdStartV2(noDossier)).toThrow("integrity_mismatch");
    expect(() => assessColdStartV2(directEur)).toThrow("integrity_mismatch");
  });

  test.each([
    ["fresh", "2026-01-31", true, undefined],
    ["three days old", "2026-01-28", true, undefined],
    ["four days old", "2026-01-27", false, "fx_rate_stale"],
    ["future", "2026-02-01", false, "fx_rate_stale"],
  ] as const)("uses a %s RUB rate only inside the sealed freshness window", (
    _name,
    effectiveDate,
    hasFormula,
    reasonCode,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        income: { amount: "200000", currency: "RUB", basis: "net" },
      })],
      cbrClaims: [cbrClaim(effectiveDate)],
    }).input);

    expect(comparator.formula !== undefined).toBe(hasFormula);
    if (reasonCode !== undefined) {
      expect(participant(comparator, SELF_ID).reasonCodes).toContain(reasonCode);
    }
    if (hasFormula) {
      expect(comparator.formula).toEqual({
        formulaId: "FORMULA-VS2-INCOME-01",
        formulaVersion: "1",
        expression: "monthlyIncomeRub / eurRub < thresholdEur",
        monthlyIncomeRub: "200000",
        eurRub: "100",
        incomeEur: "2000.00",
        thresholdEur: "2000.00",
        rounding: "UNROUNDED_THEN_HALF_UP_2DP",
        sourceClaimIds: [
          "si-income-threshold:income:si-income@3",
          "cbr-eur-facts-1",
        ],
      });
    }
  });

  test("keeps RUB unknown when CBR coverage is honestly unavailable", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        income: { amount: "200000", currency: "RUB", basis: "net" },
      })],
      cbrClaims: [],
    }).input);
    expect(participant(comparator, SELF_ID).reasonCodes).toContain("fx_rate_unavailable");
    expect(comparator.formula).toBeUndefined();
  });

  test.each([
    ["duplicate", [cbrClaim(), cbrClaim(ASSESSMENT_DATE, "100.0000", "cbr-eur-facts-2")]],
    ["malformed", [cbrClaim(ASSESSMENT_DATE, "not-a-rate")]],
    ["noncanonical claim ID", [malformedCbrClaim((claim) => {
      claim.claimId = "cbr-eur-facts-x";
    })]],
    ["numeric rate", [malformedCbrClaim((claim) => {
      claim.value.rate = 100;
    })]],
    ["exponent rate", [malformedCbrClaim((claim) => {
      claim.value.rate = "1e2";
    })]],
    ["zero rate", [malformedCbrClaim((claim) => {
      claim.value.rate = "0";
    })]],
    ["bad anchor", [malformedCbrClaim((claim) => {
      claim.anchor.excerptSha256 = "bad";
    })]],
    ["extra key", [malformedCbrClaim((claim) => {
      claim.unexpected = true;
    })]],
  ] as const)("rejects %s CBR Evidence as integrity mismatch", (_name, cbrClaims) => {
    const borrowed = buildFixture({
      participants: [selfParticipant({
        income: { amount: "200000", currency: "RUB", basis: "net" },
      })],
      cbrClaims,
    }).input;
    expect(() => assessColdStartV2(borrowed)).toThrow("integrity_mismatch");
  });

  test.each([
    ["verified coverage without a claim", [], "verified"],
    ["unavailable coverage with a claim", [cbrClaim()], "unavailable"],
  ] as const)("rejects %s", (_name, cbrClaims, coverage) => {
    const borrowed = structuredClone(buildFixture({
      dossier: false,
      cbrClaims,
    }).input) as unknown as MutableAssessmentInput;
    borrowed.evidence.coverage["cbr-eur"] = coverage;

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test("keeps RUB unknown without a bound resolved Evidence URL", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        income: { amount: "200000", currency: "RUB", basis: "net" },
      })],
      omitResolvedEvidence: true,
    }).input);
    expect(participant(comparator, SELF_ID).reasonCodes).toContain("fx_rate_unavailable");
  });

  test("keeps unsupported ISO currency unknown and never invents FX", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        income: { amount: "2500", currency: "USD", basis: "net" },
      })],
    }).input);

    expect(participant(comparator, SELF_ID).reasonCodes).toContain("fx_rate_unavailable");
    expect(comparator.formula).toBeUndefined();
  });
});

describe("Country Assessment V2 proof precedence and completeness", () => {
  test("orders decisive reasons globally by component across participants", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [
        selfParticipant({
          remote: "no",
          income: { amount: "0", currency: "EUR", basis: "net" },
        }),
        companionParticipant(SPOUSE_ID, "spouse"),
      ],
      mutateClaims: (claims) => replaceClaim(claims, "companion_entry", {
        relationshipClassifications: [{ relationship: "spouse", status: "excluded" }],
      }),
    }).input);

    expect(comparator.formalVerdict.routeOutcomes[0]?.reasons.map(({ code }) => code))
      .toEqual([
        "companion_route_impossible",
        "remote_continuation_unavailable",
        "income_below_verified_threshold",
      ]);
  });

  test("keeps concurrent unknowns in projection but only decisive proofs in an impossible route", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        citizenships: ["UA"],
        income: { amount: "0", currency: "EUR", basis: "net" },
      })],
    }).input);
    const assessment = participant(comparator, SELF_ID);
    const route = comparator.formalVerdict.routeOutcomes[0]!;

    expect(assessment.status).toBe("impossible");
    expect(assessment.reasonCodes).toEqual([
      "citizenship_applicability_unknown",
      "remote_work_prerequisite_unknown",
      "income_below_verified_threshold",
    ]);
    expect(route.status).toBe("impossible");
    expect(route.reasons.map(({ code }) => code)).toEqual([
      "income_below_verified_threshold",
    ]);
    expect(route.reasons[0]?.claimIds.length).toBeGreaterThan(0);
    expect(route.reasons[0]?.evidence.length).toBeGreaterThan(0);
  });

  test("lets a proven companion exclusion dominate its missing scoped passport proof", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant(), companionParticipant(SPOUSE_ID, "spouse")],
      mutateClaims: (claims) => {
        replaceClaim(claims, "companion_entry", {
          relationshipClassifications: [{ relationship: "spouse", status: "excluded" }],
        });
        removeClaim(claims, "duration", "companion-spouse");
      },
    }).input);
    const spouse = participant(comparator, SPOUSE_ID);
    const route = comparator.formalVerdict.routeOutcomes[0]!;

    expect(spouse.status).toBe("impossible");
    expect(spouse.reasonCodes).toEqual([
      "companion_route_impossible",
      "passport_validity_unknown",
    ]);
    expect(route.reasons.map(({ code }) => code)).toEqual(["companion_route_impossible"]);
  });

  test("uses a separate passport proof when stale FX is only unknown", () => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({
        passport: "absent",
        income: { amount: "0", currency: "RUB", basis: "net" },
      })],
      cbrClaims: [cbrClaim("2026-01-27")],
    }).input);
    const route = comparator.formalVerdict.routeOutcomes[0]!;

    expect(participant(comparator, SELF_ID).reasonCodes).toContain("fx_rate_stale");
    expect(route.status).toBe("impossible");
    expect(route.reasons.map(({ code }) => code)).toEqual([
      "passport_validity_insufficient",
    ]);
  });

  test("uses the Formal-normalized route status before the route becomes effective", () => {
    const fixture = buildFixture({
      assessmentAt: "2025-11-20",
      participants: [selfParticipant({ remote: "no" })],
    });
    const comparator = assessColdStartV2(fixture.input);

    expect(comparator.formalVerdict.routeOutcomes[0]?.status).toBe("unknown");
    expect(comparator.formalVerdict.routeOutcomes[0]).not.toHaveProperty("ruleEffectiveFrom");
    expect(comparator.formalVerdict.routeOutcomes[0]?.reasons.map(({ code }) => code))
      .toEqual(["country_evidence_incomplete"]);
    expect(comparator.marker).toBe("yellow");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(reconstructFormalResidenceVerdict(comparator.formalVerdict, {
      profileSnapshotId: fixture.profileSnapshotId,
    })).toEqual(comparator.formalVerdict);
  });

  test("omits a future rule date from an unknown route and round-trips Formal", () => {
    const fixture = buildFixture({ assessmentAt: "2025-11-20" });
    const comparator = assessColdStartV2(fixture.input);

    expect(comparator.formalVerdict.routeOutcomes[0]?.status).toBe("unknown");
    expect(comparator.formalVerdict.routeOutcomes[0]).not.toHaveProperty("ruleEffectiveFrom");
    expect(comparator.personalFit).toBe("research_incomplete");
    expect(reconstructFormalResidenceVerdict(comparator.formalVerdict, {
      profileSnapshotId: fixture.profileSnapshotId,
    })).toEqual(comparator.formalVerdict);
  });

  test("turns all-impossible red only with the exact synthetic attestation", () => {
    const impossible = {
      participants: [selfParticipant({ remote: "no" })] as const,
    };
    const absent = assessColdStartV2(buildFixture(impossible).input);
    const exact = assessColdStartV2(buildFixture({
      ...impossible,
      completeness: exactCompleteness,
    }).input);

    expect(absent.marker).toBe("yellow");
    expect(absent.personalFit).toBe("route_blocked_catalog_incomplete");
    expect(exact.marker).toBe("red");
    expect(exact.personalFit).toBe("all_routes_impossible");
    expect(exact.marker).toBe(exact.formalVerdict.marker);
  });

  test("accepts an exact synthetic catalog with an additional excluded route", () => {
    const fixture = buildFixture({
      participants: [selfParticipant({ remote: "no" })],
      completeness: (partial) => {
        const exact = exactCompleteness(partial);
        const reference = exact.catalogEvidence[0]!;
        return {
          ...exact,
          catalogRoutes: [
            exact.catalogRoutes[0],
            {
              routeId: "si-temporary-residence-study",
              applicability: "excluded",
              exclusionCode: "profile_not_eligible",
              claimIds: ["si-study:profile-exclusion@1"],
              evidence: [reference],
            },
          ],
        } as CatalogCompletenessAttestation;
      },
    });
    const comparator = assessColdStartV2(fixture.input);

    expect(comparator.marker).toBe("red");
    expect(comparator.formalVerdict.catalogCompleteness.status).toBe("verified");
    expect(reconstructFormalResidenceVerdict(comparator.formalVerdict, {
      profileSnapshotId: fixture.profileSnapshotId,
      evidenceSnapshotId: fixture.evidence.id,
    })).toEqual(comparator.formalVerdict);
  });

  const completenessMutations: readonly [
    string,
    (value: MutableCompleteness) => void,
  ][] = [
    ["jurisdiction", (value) => { value.jurisdiction = "HR"; }],
    ["profile", (value) => { value.profileSnapshotId = "0".repeat(64); }],
    ["date", (value) => { value.effectiveTo = "2026-01-30"; }],
    ["Evidence", (value) => { value.evidenceSnapshotId = "0".repeat(64); }],
    ["artifact", (value) => { value.catalogEvidence[0]!.artifactId = "foreign"; }],
    ["route set", (value) => { value.catalogRoutes[0]!.routeId = "si-other"; }],
    ["duplicate catalog route", (value) => {
      value.catalogRoutes.push(structuredClone(value.catalogRoutes[0]!));
    }],
  ];

  test.each(completenessMutations)("omits mismatched synthetic completeness for %s", (
    _name,
    mutate,
  ) => {
    const comparator = assessColdStartV2(buildFixture({
      participants: [selfParticipant({ remote: "no" })],
      completeness: (fixture) => {
        const completeness = structuredClone(exactCompleteness(fixture)) as unknown as
          MutableCompleteness;
        mutate(completeness);
        return completeness as unknown as CatalogCompletenessAttestation;
      },
    }).input);

    expect(comparator.marker).toBe("yellow");
    expect(comparator.formalVerdict.catalogCompleteness.status).toBe("unproven");
  });

  test("keeps an unknown route yellow even with exact synthetic completeness", () => {
    const comparator = assessColdStartV2(buildFixture({
      completeness: exactCompleteness,
    }).input);
    expect(comparator.marker).toBe("yellow");
    expect(comparator.formalVerdict.routeOutcomes[0]?.status).toBe("unknown");
  });
});

describe("Country Assessment V2 exact Evidence/Dossier projection", () => {
  test("accepts artifact-specific URLs for a multi-artifact country claim", () => {
    const borrowed = structuredClone(buildFixture().input) as unknown as
      MutableAssessmentInput;
    const route = borrowed.evidence.claims.find(
      (claim) => claim.claimKind === "route_basis",
    );
    if (route === undefined) throw new Error("missing route fixture");
    const sourceId = "si-digital-nomad-route";
    const lawArtifactId = `${sourceId}:law-artifact`;
    route.evidence = [
      {
        sourceId,
        artifactId: sourceArtifactId(sourceId),
        navigationUrl: "https://www.gov.si/digital-nomad",
        resolvedEvidenceUrl: "https://www.gov.si/digital-nomad",
        sourcePeriod: route.sourcePeriod,
        anchor: {
          artifactId: sourceArtifactId(sourceId),
          locator: "GOV.SI route title and publication date",
          excerptSha256: "a".repeat(64),
        },
      },
      {
        sourceId,
        artifactId: lawArtifactId,
        navigationUrl: "https://pisrs.si/pregledPredpisa?id=ZAKO5761",
        resolvedEvidenceUrl: "https://pisrs.si/pregledPredpisa?id=ZAKO5761",
        sourcePeriod: route.sourcePeriod,
        anchor: {
          artifactId: lawArtifactId,
          locator: "PISRS > 51.a člen > route basis",
          excerptSha256: "b".repeat(64),
        },
      },
    ];
    route.anchor = { ...route.evidence[1]!.anchor };
    borrowed.evidence.artifactIds.push(lawArtifactId);
    const dossierIndex = borrowed.dossier.payload.claims.findIndex((claim) =>
      (claim as { claimKind?: string }).claimKind === "route_basis"
    );
    if (dossierIndex < 0) throw new Error("missing dossier route fixture");
    borrowed.dossier.payload.claims[dossierIndex] = dossierClaim(
      route as unknown as CountryClaim,
    );

    expect(assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2)
      .formalVerdict.routeOutcomes[0]?.routeId).toBe(SLOVENIA_V2_FORMAL_ROUTE_ID);
  });

  test("requires each synchronized country reference URL to remain HTTP", () => {
    const borrowed = structuredClone(buildFixture({
      omitResolvedEvidence: true,
    }).input) as unknown as MutableAssessmentInput;
    const remote = borrowed.evidence.claims.find(
      (claim) => claim.claimKind === "remote_work_relations",
    );
    if (remote === undefined) throw new Error("missing remote-work fixture");
    remote.evidence[0]!.resolvedEvidenceUrl = "not-a-url";
    const dossierIndex = borrowed.dossier.payload.claims.findIndex((claim) =>
      (claim as { claimKind?: string }).claimKind === "remote_work_relations"
    );
    if (dossierIndex < 0) throw new Error("missing dossier remote-work fixture");
    borrowed.dossier.payload.claims[dossierIndex] = dossierClaim(
      remote as unknown as CountryClaim,
    );

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });

  test("round-trips a hard country proof without the optional resolved map", () => {
    const fixture = buildFixture({
      participants: [selfParticipant({ remote: "no" })],
      omitResolvedEvidence: true,
    });
    const comparator = assessColdStartV2(fixture.input);

    expect(reconstructFormalResidenceVerdict(comparator.formalVerdict, {
      profileSnapshotId: fixture.profileSnapshotId,
      evidenceSnapshotId: fixture.evidence.id,
    })).toEqual(comparator.formalVerdict);
  });

  const evidenceMutations: readonly [string, (claim: MutableEvidenceClaim) => void][] = [
    ["value", (claim) => { claim.value.thresholdEur = "2100.00"; }],
    ["claim ID", (claim) => { claim.claimId = "foreign"; }],
    ["validator", (claim) => { claim.validatorVersion = "si-income@2"; }],
    ["source period", (claim) => { claim.sourcePeriod = "2026M02"; }],
    ["artifact", (claim) => { claim.evidence[0]!.artifactId = "foreign"; }],
    ["navigation", (claim) => {
      claim.evidence[0]!.navigationUrl = "https://example.test/foreign";
    }],
    ["resolved URL", (claim) => {
      claim.evidence[0]!.resolvedEvidenceUrl = "https://example.test/foreign";
    }],
    ["locator", (claim) => { claim.evidence[0]!.anchor.locator = "foreign"; }],
    ["hash", (claim) => {
      claim.evidence[0]!.anchor.excerptSha256 = "f".repeat(64);
    }],
  ];

  test.each(evidenceMutations)("rejects Evidence %s drift from the reconstructed dossier", (
    _name,
    mutate,
  ) => {
    const borrowed = structuredClone(buildFixture().input) as unknown as
      MutableAssessmentInput;
    const income = borrowed.evidence.claims.find((claim) => claim.claimKind === "income");
    if (income === undefined) throw new Error("missing income fixture");
    mutate(income);

    expect(() => assessColdStartV2(borrowed as unknown as ColdStartAssessmentInputV2))
      .toThrow("integrity_mismatch");
  });
});
