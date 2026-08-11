import {
  REQUIRED_CLAIM_KINDS,
  resolveCountry,
} from "./country-registry";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  CountryRef,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "./cold-start-contracts";
import type { ClaimAnchor } from "./contracts";
import {
  assertSealedEvidenceStructure,
  type SealedEvidence,
} from "./research-plan";

export interface DossierClaim<K extends ClaimKind = ClaimKind> {
  readonly claimId: string;
  readonly claimKind: K;
  readonly value: ClaimValueByKind[K];
  readonly validatorVersion: string;
  readonly evidence: readonly {
    readonly sourceId: SloveniaSourceId;
    readonly navigationUrl: string;
    readonly resolvedEvidenceUrl: string;
    readonly sourcePeriod: string;
    readonly locator: string;
    readonly excerptSha256: string;
  }[];
}

export interface CountryDossierPayload {
  readonly country: CountryRef;
  readonly schemaVersion: "si-dossier@1";
  readonly claims: readonly DossierClaim[];
}

export interface DossierVersion {
  readonly id: string;
  readonly ordinal: number;
  readonly countryCode: "SI";
  readonly predecessorId?: string;
  readonly evidenceSnapshotId: string;
  readonly schemaVersion: "si-dossier@1";
  readonly payload: CountryDossierPayload;
  readonly payloadHash: string;
  readonly manifestHash: string;
  readonly hmac: string;
  readonly publishedAt: string;
}

export interface DossierPublishResult {
  readonly version: DossierVersion;
  readonly created: boolean;
}

const HEX_64 = /^[a-f\d]{64}$/;
const COUNTRY_SOURCES = [
  "si-digital-nomad-route",
  "si-income-threshold",
  "si-companion-employment",
] as const;
const EXPECTED_SOURCE: Readonly<Record<ClaimKind, typeof COUNTRY_SOURCES[number]>> = {
  route_basis: "si-digital-nomad-route",
  citizenship_applicability: "si-digital-nomad-route",
  remote_work_relations: "si-digital-nomad-route",
  income: "si-income-threshold",
  qualification: "si-digital-nomad-route",
  companion_entry: "si-digital-nomad-route",
  companion_local_work_access: "si-companion-employment",
  duration: "si-digital-nomad-route",
  general_statutory_prerequisites: "si-digital-nomad-route",
};
const EXPECTED_VALIDATOR = {
  "si-digital-nomad-route": "si-route@2",
  "si-income-threshold": "si-income@2",
  "si-companion-employment": "si-companion@2",
} as const;
const EXPECTED_PARSERS: Readonly<Record<SloveniaSourceId, string>> = {
  ...EXPECTED_VALIDATOR,
  "cbr-eur": "cbr-eur@1",
};

function publicationNotAllowed(): never {
  throw new Error("publication_not_allowed");
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length &&
    [...keys].sort().every((key, index) => actual[index] === key);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validValue(kind: ClaimKind, value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  switch (kind) {
    case "route_basis":
      return exactKeys(candidate, ["route", "legalBasis", "effectiveFrom"]) &&
        candidate.route === "temporary_residence_digital_nomad" &&
        candidate.legalBasis === "ZTuj-2 Article 51a" && candidate.effectiveFrom === "2025-11-21";
    case "citizenship_applicability":
      return exactKeys(candidate, ["eligibleCategory", "explicitNationalityExclusions"]) &&
        candidate.eligibleCategory === "third_country_national" &&
        stringArray(candidate.explicitNationalityExclusions);
    case "remote_work_relations":
      return exactKeys(candidate, ["allowedRelations", "slovenianLabourMarketWorkIncluded"]) &&
        Array.isArray(candidate.allowedRelations) &&
        candidate.allowedRelations.length === 3 &&
        candidate.allowedRelations[0] === "foreign_employer" &&
        candidate.allowedRelations[1] === "own_foreign_business" &&
        candidate.allowedRelations[2] === "foreign_clients" &&
        candidate.slovenianLabourMarketWorkIncluded === false;
    case "income":
      return exactKeys(candidate, ["metric", "multiplier", "thresholdEur", "period"]) &&
        candidate.metric === "latest_official_average_monthly_net_salary" &&
        candidate.multiplier === "2" &&
        typeof candidate.thresholdEur === "string" && /^(?:0|[1-9]\d*)\.\d{2}$/.test(candidate.thresholdEur) &&
        typeof candidate.period === "string" && /^\d{4}M(?:0[1-9]|1[0-2])$/.test(candidate.period);
    case "qualification":
      return exactKeys(candidate, ["rule"]) &&
        candidate.rule === "not_listed_in_authoritative_requirements";
    case "companion_entry":
      return exactKeys(candidate, ["rule"]) &&
        candidate.rule === "immediate_family_reunification_without_waiting_period";
    case "companion_local_work_access":
      return exactKeys(candidate, ["access", "labourMarketCheck", "informationSheet"]) &&
        candidate.access === "conditional" && candidate.labourMarketCheck === true &&
        candidate.informationSheet === true;
    case "duration":
      return exactKeys(candidate, ["maximumMonths", "extendable", "reapplyAfterMonths"]) &&
        candidate.maximumMonths === 12 && candidate.extendable === false &&
        candidate.reapplyAfterMonths === 6;
    case "general_statutory_prerequisites":
      return exactKeys(candidate, ["passportBeyondPermitMonths", "healthInsurance", "article55GroundsApply"]) &&
        candidate.passportBeyondPermitMonths === 3 && candidate.healthInsurance === true &&
        candidate.article55GroundsApply === true;
  }
}

function copyClaimValue(
  kind: ClaimKind,
  value: ClaimValueByKind[ClaimKind],
): ClaimValueByKind[ClaimKind] {
  switch (kind) {
    case "route_basis": {
      const typed = value as ClaimValueByKind["route_basis"];
      return { route: typed.route, legalBasis: typed.legalBasis, effectiveFrom: typed.effectiveFrom };
    }
    case "citizenship_applicability": {
      const typed = value as ClaimValueByKind["citizenship_applicability"];
      return {
        eligibleCategory: typed.eligibleCategory,
        explicitNationalityExclusions: [...typed.explicitNationalityExclusions],
      };
    }
    case "remote_work_relations": {
      const typed = value as ClaimValueByKind["remote_work_relations"];
      return {
        allowedRelations: [...typed.allowedRelations],
        slovenianLabourMarketWorkIncluded: typed.slovenianLabourMarketWorkIncluded,
      };
    }
    case "income": {
      const typed = value as ClaimValueByKind["income"];
      return {
        metric: typed.metric,
        multiplier: typed.multiplier,
        thresholdEur: typed.thresholdEur,
        period: typed.period,
      };
    }
    case "qualification": {
      const typed = value as ClaimValueByKind["qualification"];
      return { rule: typed.rule };
    }
    case "companion_entry": {
      const typed = value as ClaimValueByKind["companion_entry"];
      return { rule: typed.rule };
    }
    case "companion_local_work_access": {
      const typed = value as ClaimValueByKind["companion_local_work_access"];
      return {
        access: typed.access,
        labourMarketCheck: typed.labourMarketCheck,
        informationSheet: typed.informationSheet,
      };
    }
    case "duration": {
      const typed = value as ClaimValueByKind["duration"];
      return {
        maximumMonths: typed.maximumMonths,
        extendable: typed.extendable,
        reapplyAfterMonths: typed.reapplyAfterMonths,
      };
    }
    case "general_statutory_prerequisites": {
      const typed = value as ClaimValueByKind["general_statutory_prerequisites"];
      return {
        passportBeyondPermitMonths: typed.passportBeyondPermitMonths,
        healthInsurance: typed.healthInsurance,
        article55GroundsApply: typed.article55GroundsApply,
      };
    }
  }
}

function validAnchor(value: unknown): value is ClaimAnchor {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    exactKeys(value, ["artifactId", "locator", "excerptSha256"]) &&
    nonEmptyString((value as ClaimAnchor).artifactId) &&
    nonEmptyString((value as ClaimAnchor).locator) &&
    HEX_64.test((value as ClaimAnchor).excerptSha256);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactParserVersions(value: Readonly<Record<SloveniaSourceId, string>>): boolean {
  return exactKeys(value, Object.keys(EXPECTED_PARSERS)) &&
    COUNTRY_SOURCES.every((sourceId) => value[sourceId] === EXPECTED_PARSERS[sourceId]) &&
    value["cbr-eur"] === EXPECTED_PARSERS["cbr-eur"];
}

function countryClaims(
  preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
): readonly VerifiedCountryClaim[] {
  const { snapshot, manifest } = preparedEvidence;
  if (
    snapshot.rulesVersion !== "vs2-si-evidence@2" ||
    !exactParserVersions(snapshot.parserVersions) ||
    COUNTRY_SOURCES.some((sourceId) => snapshot.coverage[sourceId] !== "verified") ||
    !exactKeys(snapshot.coverage, ["si-digital-nomad-route", "si-income-threshold", "si-companion-employment", "cbr-eur"]) ||
    snapshot.blockers.some((blocker) => blocker.sourceId !== "cbr-eur")
  ) publicationNotAllowed();
  const claims = snapshot.claims.filter(
    (claim): claim is VerifiedCountryClaim => "claimKind" in claim,
  );
  if (
    claims.length !== REQUIRED_CLAIM_KINDS.length ||
    snapshot.claims.some((claim) => !COUNTRY_SOURCES.includes(
      claim.sourceId as typeof COUNTRY_SOURCES[number],
    ) && claim.sourceId !== "cbr-eur") ||
    REQUIRED_CLAIM_KINDS.some((kind) => claims.filter((claim) => claim.claimKind === kind).length !== 1)
  ) publicationNotAllowed();

  const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const entries = new Map(manifest.entries.map((entry) => [entry.sourceId, entry]));
  for (const claim of claims) {
    const expectedSource = EXPECTED_SOURCE[claim.claimKind];
    if (
      claim.sourceId !== expectedSource || claim.status !== "verified" ||
      claim.scope !== "VS-2 Slovenia cold start" ||
      claim.claimId !== `${expectedSource}:${claim.claimKind}:${EXPECTED_VALIDATOR[expectedSource]}` ||
      claim.validatorVersion !== EXPECTED_VALIDATOR[expectedSource] ||
      !validValue(claim.claimKind, claim.value) || !nonEmptyString(claim.claimId) ||
      !nonEmptyString(claim.sourcePeriod) || !validAnchor(claim.anchor) ||
      !Array.isArray(claim.evidence) || claim.evidence.length === 0 ||
      entries.get(expectedSource) === undefined
    ) publicationNotAllowed();
    for (const reference of claim.evidence) {
      const sourceArtifact = artifacts.get(reference.artifactId);
      const entry = entries.get(expectedSource)!;
      if (
        !exactKeys(reference, ["sourceId", "artifactId", "navigationUrl", "resolvedEvidenceUrl", "sourcePeriod", "anchor"]) ||
        reference.sourceId !== expectedSource || reference.sourcePeriod !== claim.sourcePeriod ||
        !nonEmptyString(reference.navigationUrl) || !nonEmptyString(reference.resolvedEvidenceUrl) ||
        !validAnchor(reference.anchor) || sourceArtifact === undefined ||
        reference.anchor.artifactId !== reference.artifactId ||
        sourceArtifact.sourceId !== expectedSource ||
        sourceArtifact.request.url !== reference.navigationUrl ||
        sourceArtifact.responseUrl !== reference.resolvedEvidenceUrl ||
        !entry.artifactIds.includes(reference.artifactId)
      ) publicationNotAllowed();
    }
    const lastAnchor = claim.evidence.at(-1)!.anchor;
    if (
      claim.anchor.artifactId !== lastAnchor.artifactId ||
      claim.anchor.locator !== lastAnchor.locator ||
      claim.anchor.excerptSha256 !== lastAnchor.excerptSha256
    ) publicationNotAllowed();
  }
  return claims;
}

export function buildCountryDossier(
  preparedEvidence: SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaim>,
): CountryDossierPayload {
  try {
    assertSealedEvidenceStructure(preparedEvidence, [
      "si-digital-nomad-route",
      "si-income-threshold",
      "si-companion-employment",
      "cbr-eur",
    ] as const);
  } catch {
    publicationNotAllowed();
  }
  const resolved = resolveCountry("SI");
  if (!resolved.ok) publicationNotAllowed();
  const claims = countryClaims(preparedEvidence);
  const payload: CountryDossierPayload = {
    country: resolved.country,
    schemaVersion: "si-dossier@1",
    claims: REQUIRED_CLAIM_KINDS.map((kind) => {
      const claim = claims.find((candidate) => candidate.claimKind === kind)!;
      return {
        claimId: claim.claimId,
        claimKind: kind,
        value: copyClaimValue(kind, claim.value),
        validatorVersion: claim.validatorVersion,
        evidence: claim.evidence.map((reference) => ({
          sourceId: reference.sourceId,
          navigationUrl: reference.navigationUrl,
          resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
          sourcePeriod: reference.sourcePeriod,
          locator: reference.anchor.locator,
          excerptSha256: reference.anchor.excerptSha256,
        })),
      } as DossierClaim;
    }),
  };
  return deepFreeze(payload);
}

/** @internal Used only to fail closed while loading persisted dossier JSON. */
export function isCountryDossierPayload(value: unknown): value is CountryDossierPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Partial<CountryDossierPayload>;
  if (
    !exactKeys(value, ["country", "schemaVersion", "claims"]) ||
    payload.schemaVersion !== "si-dossier@1" || !Array.isArray(payload.claims) ||
    payload.claims.length !== REQUIRED_CLAIM_KINDS.length ||
    typeof payload.country !== "object" || payload.country === null ||
    !exactKeys(payload.country, ["code", "englishName", "displayName", "flag", "coordinate"]) ||
    payload.country.code !== "SI" || payload.country.englishName !== "Slovenia" ||
    payload.country.displayName !== "Словения" || payload.country.flag !== "🇸🇮" ||
    typeof payload.country.coordinate !== "object" || payload.country.coordinate === null ||
    !exactKeys(payload.country.coordinate, ["lat", "lng"]) ||
    payload.country.coordinate.lat !== 46.1512 || payload.country.coordinate.lng !== 14.9955
  ) return false;
  return payload.claims.every((claim, index) => {
    const kind = REQUIRED_CLAIM_KINDS[index]!;
    return typeof claim === "object" && claim !== null &&
      exactKeys(claim, ["claimId", "claimKind", "value", "validatorVersion", "evidence"]) &&
      claim.claimKind === kind &&
      claim.claimId === `${EXPECTED_SOURCE[kind]}:${kind}:${EXPECTED_VALIDATOR[EXPECTED_SOURCE[kind]]}` &&
      validValue(kind, claim.value) &&
      claim.validatorVersion === EXPECTED_VALIDATOR[EXPECTED_SOURCE[kind]] &&
      Array.isArray(claim.evidence) && claim.evidence.length > 0 && claim.evidence.every((
        reference: DossierClaim["evidence"][number],
      ) =>
        typeof reference === "object" && reference !== null &&
        exactKeys(reference, ["sourceId", "navigationUrl", "resolvedEvidenceUrl", "sourcePeriod", "locator", "excerptSha256"]) &&
        reference.sourceId === EXPECTED_SOURCE[kind] && nonEmptyString(reference.navigationUrl) &&
        nonEmptyString(reference.resolvedEvidenceUrl) && nonEmptyString(reference.sourcePeriod) &&
        nonEmptyString(reference.locator) && HEX_64.test(reference.excerptSha256)
      );
  });
}

/** @internal */
export function freezeDossierVersion<T extends DossierVersion>(value: T): T {
  return deepFreeze(value);
}
