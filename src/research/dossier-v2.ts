import { types } from "node:util";

import {
  REQUIRED_CLAIM_KINDS,
  resolveCountry,
} from "./country-registry";
import type {
  ClaimKind,
  CountryRef,
  SloveniaSourceId,
} from "./cold-start-contracts";
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
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type ParticipantRequirementScopeV2,
  type VerifiedCountryClaimV2,
} from "./cold-start-contracts-v2";
import type { ClaimAnchor } from "./contracts";
import {
  assertSealedEvidenceStructure,
  type SealedEvidence,
} from "./research-plan";

export interface DossierClaimV2<K extends ClaimKind = ClaimKind> {
  readonly claimId: string;
  readonly claimKind: K;
  readonly value: ClaimValueByKindV2[K];
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

export interface CountryDossierPayloadV2 {
  readonly country: CountryRef;
  readonly schemaVersion: "si-dossier@2";
  readonly claims: readonly DossierClaimV2[];
}

export interface DossierVersionV2 {
  readonly id: string;
  readonly ordinal: number;
  readonly countryCode: "SI";
  readonly predecessorId?: string;
  readonly evidenceSnapshotId: string;
  readonly schemaVersion: "si-dossier@2";
  readonly payload: CountryDossierPayloadV2;
  readonly payloadHash: string;
  readonly manifestHash: string;
  readonly hmac: string;
  readonly publishedAt: string;
}

export interface DossierPublishResultV2 {
  readonly version: DossierVersionV2;
  readonly created: boolean;
}

const HEX_64 = /^[a-f\d]{64}$/;
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;
const MONEY_TEXT = /^(?:0|[1-9]\d*)\.\d{2}$/;
const MONTH_PERIOD = /^\d{4}M(?:0[1-9]|1[0-2])$/;
const DAY_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DECIMAL_TEXT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const KIND_ORDER = new Map<ClaimKind, number>(
  REQUIRED_CLAIM_KINDS.map((kind, index) => [kind, index]),
);

function publicationNotAllowed(): never {
  throw new Error("publication_not_allowed");
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function cloneBorrowedData<T>(value: T, ancestors = new Set<object>()): T {
  if (
    value === null || value === undefined || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("invalid borrowed data");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("invalid borrowed data");
  if (types.isProxy(value)) throw new TypeError("invalid borrowed data");
  if (ancestors.has(value)) throw new TypeError("invalid borrowed data");

  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length !== 0) {
    throw new TypeError("invalid borrowed data");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new TypeError("invalid borrowed data");
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
        throw new TypeError("invalid borrowed data");
      }
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("invalid borrowed data");
      const descriptorKeys = Object.keys(descriptors);
      if (descriptorKeys.length !== length + 1) throw new TypeError("invalid borrowed data");
      const clone: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("invalid borrowed data");
        }
        clone.push(cloneBorrowedData(descriptor.value, ancestors));
      }
      return clone as T;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("invalid borrowed data");
    }
    const clone: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("invalid borrowed data");
      }
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneBorrowedData(descriptor.value, ancestors),
        writable: true,
      });
    }
    return clone as T;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isClaimKind(value: unknown): value is ClaimKind {
  return typeof value === "string" &&
    REQUIRED_CLAIM_KINDS.includes(value as ClaimKind);
}

function validAnchor(value: unknown): value is ClaimAnchor {
  return isRecord(value) && exactKeys(value, ["artifactId", "locator", "excerptSha256"]) &&
    nonEmptyString(value.artifactId) && nonEmptyString(value.locator) &&
    typeof value.excerptSha256 === "string" && HEX_64.test(value.excerptSha256);
}

function validRequirementScope(value: unknown): value is ParticipantRequirementScopeV2 {
  if (!isRecord(value)) return false;
  if (value.kind === "applicant") return exactKeys(value, ["kind"]);
  return exactKeys(value, ["kind", "relationship"]) && value.kind === "companion" &&
    (value.relationship === "spouse" || value.relationship === "minor_child" ||
      value.relationship === "other_family");
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sourcePeriodMatchesValue(
  kind: ClaimKind,
  value: unknown,
  sourcePeriod: string,
): boolean {
  return kind !== "income" || (isRecord(value) && value.period === sourcePeriod);
}

function validValue(kind: ClaimKind, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (kind) {
    case "route_basis":
      return exactKeys(value, ["route", "legalBasis", "effectiveFrom"]) &&
        value.route === "temporary_residence_digital_nomad" &&
        value.legalBasis === "ZTuj-2 Article 51a" && value.effectiveFrom === "2025-11-21";
    case "citizenship_applicability": {
      if (!exactKeys(value, ["classifications"]) || !Array.isArray(value.classifications) ||
        value.classifications.length === 0) return false;
      const countryCodes: string[] = [];
      for (const classification of value.classifications) {
        if (!isRecord(classification) ||
          !exactKeys(classification, ["countryCode", "status"]) ||
          typeof classification.countryCode !== "string" ||
          !ISO_COUNTRY_CODE.test(classification.countryCode) ||
          (classification.status !== "eligible" && classification.status !== "excluded")) {
          return false;
        }
        countryCodes.push(classification.countryCode);
      }
      return uniqueStrings(countryCodes);
    }
    case "remote_work_relations":
      return exactKeys(value, ["allowedRelations", "slovenianLabourMarketWorkIncluded"]) &&
        Array.isArray(value.allowedRelations) && value.allowedRelations.length === 3 &&
        value.allowedRelations[0] === "foreign_employer" &&
        value.allowedRelations[1] === "own_foreign_business" &&
        value.allowedRelations[2] === "foreign_clients" &&
        value.slovenianLabourMarketWorkIncluded === false;
    case "income":
      return exactKeys(value, [
        "metric",
        "multiplier",
        "thresholdEur",
        "currency",
        "basis",
        "appliesTo",
        "period",
      ]) && value.metric === "latest_official_average_monthly_net_salary" &&
        value.multiplier === "2" && typeof value.thresholdEur === "string" &&
        MONEY_TEXT.test(value.thresholdEur) && value.currency === "EUR" &&
        value.basis === "net" && value.appliesTo === "applicant" &&
        typeof value.period === "string" && MONTH_PERIOD.test(value.period);
    case "qualification":
      return exactKeys(value, ["rule"]) &&
        value.rule === "not_listed_in_authoritative_requirements";
    case "companion_entry": {
      if (!exactKeys(value, ["relationshipClassifications"]) ||
        !Array.isArray(value.relationshipClassifications) ||
        value.relationshipClassifications.length === 0) return false;
      const relationships: string[] = [];
      for (const classification of value.relationshipClassifications) {
        if (!isRecord(classification) ||
          !exactKeys(classification, ["relationship", "status"]) ||
          (classification.relationship !== "spouse" &&
            classification.relationship !== "minor_child" &&
            classification.relationship !== "other_family") ||
          (classification.status !== "eligible" && classification.status !== "excluded")) {
          return false;
        }
        relationships.push(classification.relationship);
      }
      return uniqueStrings(relationships);
    }
    case "companion_local_work_access":
      return exactKeys(value, ["access", "labourMarketCheck", "informationSheet"]) &&
        value.access === "conditional" && value.labourMarketCheck === true &&
        value.informationSheet === true;
    case "duration":
      return exactKeys(value, ["maximumMonths", "extendable", "reapplyAfterMonths", "scope"]) &&
        value.maximumMonths === 12 && value.extendable === false &&
        value.reapplyAfterMonths === 6 && validRequirementScope(value.scope);
    case "general_statutory_prerequisites":
      return exactKeys(value, [
        "passportBeyondPermitMonths",
        "healthInsurance",
        "article55GroundsApply",
        "scope",
      ]) && value.passportBeyondPermitMonths === 3 && value.healthInsurance === true &&
        value.article55GroundsApply === true && validRequirementScope(value.scope);
  }
}

function copyRequirementScope(
  scope: ParticipantRequirementScopeV2,
): ParticipantRequirementScopeV2 {
  return scope.kind === "applicant"
    ? { kind: "applicant" }
    : { kind: "companion", relationship: scope.relationship };
}

function copyClaimValue(
  kind: ClaimKind,
  value: ClaimValueByKindV2[ClaimKind],
): ClaimValueByKindV2[ClaimKind] {
  switch (kind) {
    case "route_basis": {
      const typed = value as ClaimValueByKindV2["route_basis"];
      return { route: typed.route, legalBasis: typed.legalBasis, effectiveFrom: typed.effectiveFrom };
    }
    case "citizenship_applicability": {
      const typed = value as ClaimValueByKindV2["citizenship_applicability"];
      return {
        classifications: typed.classifications.map(({ countryCode, status }) => ({
          countryCode,
          status,
        })),
      };
    }
    case "remote_work_relations": {
      const typed = value as ClaimValueByKindV2["remote_work_relations"];
      return {
        allowedRelations: [...typed.allowedRelations],
        slovenianLabourMarketWorkIncluded: typed.slovenianLabourMarketWorkIncluded,
      };
    }
    case "income": {
      const typed = value as ClaimValueByKindV2["income"];
      return {
        metric: typed.metric,
        multiplier: typed.multiplier,
        thresholdEur: typed.thresholdEur,
        currency: typed.currency,
        basis: typed.basis,
        appliesTo: typed.appliesTo,
        period: typed.period,
      };
    }
    case "qualification": {
      const typed = value as ClaimValueByKindV2["qualification"];
      return { rule: typed.rule };
    }
    case "companion_entry": {
      const typed = value as ClaimValueByKindV2["companion_entry"];
      return {
        relationshipClassifications: typed.relationshipClassifications.map(
          ({ relationship, status }) => ({ relationship, status }),
        ),
      };
    }
    case "companion_local_work_access": {
      const typed = value as ClaimValueByKindV2["companion_local_work_access"];
      return {
        access: typed.access,
        labourMarketCheck: typed.labourMarketCheck,
        informationSheet: typed.informationSheet,
      };
    }
    case "duration": {
      const typed = value as ClaimValueByKindV2["duration"];
      return {
        maximumMonths: typed.maximumMonths,
        extendable: typed.extendable,
        reapplyAfterMonths: typed.reapplyAfterMonths,
        scope: copyRequirementScope(typed.scope),
      };
    }
    case "general_statutory_prerequisites": {
      const typed = value as ClaimValueByKindV2["general_statutory_prerequisites"];
      return {
        passportBeyondPermitMonths: typed.passportBeyondPermitMonths,
        healthInsurance: typed.healthInsurance,
        article55GroundsApply: typed.article55GroundsApply,
        scope: copyRequirementScope(typed.scope),
      };
    }
  }
}

function compareClaims(
  left: Pick<DossierClaimV2, "claimKind" | "value">,
  right: Pick<DossierClaimV2, "claimKind" | "value">,
): number {
  const kindDifference = KIND_ORDER.get(left.claimKind)! - KIND_ORDER.get(right.claimKind)!;
  if (kindDifference !== 0) return kindDifference;
  const leftScope = sloveniaV2ClaimScopeToken(left.claimKind, left.value);
  const rightScope = sloveniaV2ClaimScopeToken(right.claimKind, right.value);
  if (leftScope === undefined || rightScope === undefined) return 0;
  return SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER.indexOf(leftScope) -
    SLOVENIA_V2_PARTICIPANT_SCOPE_ORDER.indexOf(rightScope);
}

function sameAnchor(left: ClaimAnchor, right: ClaimAnchor): boolean {
  return left.artifactId === right.artifactId && left.locator === right.locator &&
    left.excerptSha256 === right.excerptSha256;
}

function exactParserVersions(value: Readonly<Record<SloveniaSourceId, string>>): boolean {
  return exactKeys(value, SLOVENIA_V2_SOURCE_ORDER) &&
    SLOVENIA_V2_SOURCE_ORDER.every(
      (sourceId) => value[sourceId] === SLOVENIA_V2_PARSER_VERSIONS[sourceId],
    );
}

function hasClaimKind(claim: ColdStartEvidenceClaimV2): claim is VerifiedCountryClaimV2 {
  return "claimKind" in claim;
}

function validCbrClaim(claim: ColdStartEvidenceClaimV2): boolean {
  if (hasClaimKind(claim) || !isRecord(claim)) return false;
  if (!exactKeys(claim, [
    "claimId",
    "sourceId",
    "value",
    "scope",
    "sourcePeriod",
    "anchor",
    "status",
  ])) return false;
  if (claim.sourceId !== "cbr-eur" || claim.scope !== SLOVENIA_V2_RESEARCH_SCOPE ||
    claim.status !== "verified" || !/^cbr-eur-facts-[1-9]\d*$/.test(claim.claimId) ||
    !nonEmptyString(claim.sourcePeriod) || !validAnchor(claim.anchor) ||
    !isRecord(claim.value) || !exactKeys(claim.value, [
      "base",
      "quote",
      "nominal",
      "rate",
      "effectiveDate",
    ])) return false;
  return claim.value.base === "EUR" && claim.value.quote === "RUB" &&
    claim.value.nominal === "1" && typeof claim.value.rate === "string" &&
    DECIMAL_TEXT.test(claim.value.rate) && typeof claim.value.effectiveDate === "string" &&
    DAY_PERIOD.test(claim.value.effectiveDate) && claim.sourcePeriod === claim.value.effectiveDate;
}

function validateCountryClaim(
  claim: VerifiedCountryClaimV2,
  sealed: V2Sealed,
): void {
  if (!isClaimKind(claim.claimKind)) publicationNotAllowed();
  const kind = claim.claimKind;
  const expectedSource = SLOVENIA_V2_CLAIM_SOURCE[kind];
  const expectedValidator = SLOVENIA_V2_CLAIM_VALIDATOR[kind];
  if (
    !exactKeys(claim, [
      "claimId",
      "claimKind",
      "sourceId",
      "value",
      "scope",
      "sourcePeriod",
      "anchor",
      "status",
      "evidence",
      "validatorVersion",
    ]) || claim.sourceId !== expectedSource || claim.status !== "verified" ||
    claim.scope !== SLOVENIA_V2_RESEARCH_SCOPE ||
    claim.validatorVersion !== expectedValidator || !validValue(kind, claim.value) ||
    claim.claimId !== sloveniaV2ClaimId(kind, claim.value) ||
    !nonEmptyString(claim.sourcePeriod) ||
    !sourcePeriodMatchesValue(kind, claim.value, claim.sourcePeriod) ||
    !validAnchor(claim.anchor) ||
    !Array.isArray(claim.evidence) || claim.evidence.length === 0
  ) publicationNotAllowed();

  const entry = sealed.manifest.entries.find(({ sourceId }) => sourceId === expectedSource);
  if (entry === undefined) publicationNotAllowed();
  for (const reference of claim.evidence) {
    if (
      !isRecord(reference) || !exactKeys(reference, [
        "sourceId",
        "artifactId",
        "navigationUrl",
        "resolvedEvidenceUrl",
        "sourcePeriod",
        "anchor",
      ]) || reference.sourceId !== expectedSource ||
      reference.sourcePeriod !== claim.sourcePeriod ||
      !nonEmptyString(reference.navigationUrl) ||
      !nonEmptyString(reference.resolvedEvidenceUrl) || !validAnchor(reference.anchor) ||
      reference.anchor.artifactId !== reference.artifactId
    ) publicationNotAllowed();
    const sourceArtifact = sealed.manifest.artifacts.find(
      ({ artifactId }) => artifactId === reference.artifactId,
    );
    if (
      sourceArtifact === undefined || sourceArtifact.sourceId !== expectedSource ||
      !entry.artifactIds.includes(reference.artifactId) ||
      !isRecord(sourceArtifact.request) ||
      sourceArtifact.request.url !== reference.navigationUrl ||
      sourceArtifact.responseUrl !== reference.resolvedEvidenceUrl
    ) publicationNotAllowed();
  }
  if (!sameAnchor(claim.anchor, claim.evidence.at(-1)!.anchor)) publicationNotAllowed();
}

type V2Sealed = SealedEvidence<SloveniaSourceId, ColdStartEvidenceClaimV2>;

function verifiedCountryClaims(sealed: V2Sealed): readonly VerifiedCountryClaimV2[] {
  if (
    sealed.snapshot.rulesVersion !== SLOVENIA_V2_EVIDENCE_RULES_VERSION ||
    !exactParserVersions(sealed.snapshot.parserVersions)
  ) publicationNotAllowed();

  const claims: VerifiedCountryClaimV2[] = [];
  for (const claim of sealed.snapshot.claims) {
    if (hasClaimKind(claim)) {
      validateCountryClaim(claim, sealed);
      claims.push(claim);
    } else if (!validCbrClaim(claim)) {
      publicationNotAllowed();
    }
  }
  const identities = claims.map((claim) =>
    sloveniaV2ClaimIdentity(claim.claimKind, claim.value)
  );
  if (
    new Set(identities).size !== identities.length ||
    claims.filter(({ claimKind }) => claimKind === "route_basis").length !== 1
  ) publicationNotAllowed();
  return claims;
}

function dossierClaimFromEvidence(claim: VerifiedCountryClaimV2): DossierClaimV2 {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    value: copyClaimValue(claim.claimKind, claim.value),
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

export function buildCountryDossierV2(
  preparedEvidence: V2Sealed,
): CountryDossierPayloadV2 {
  try {
    const owned = cloneBorrowedData(preparedEvidence);
    if (!exactKeys(owned, ["snapshot", "manifest", "canonicalManifest"])) {
      publicationNotAllowed();
    }
    assertSealedEvidenceStructure(owned, SLOVENIA_V2_SOURCE_ORDER);
    const resolved = resolveCountry("SI");
    if (!resolved.ok) publicationNotAllowed();
    const claims = verifiedCountryClaims(owned)
      .map(dossierClaimFromEvidence)
      .sort(compareClaims);
    return deepFreeze({
      country: {
        ...resolved.country,
        coordinate: { ...resolved.country.coordinate },
      },
      schemaVersion: "si-dossier@2" as const,
      claims,
    });
  } catch {
    return publicationNotAllowed();
  }
}

function validCountry(value: unknown): value is CountryRef {
  return isRecord(value) && exactKeys(value, [
    "code",
    "englishName",
    "displayName",
    "flag",
    "coordinate",
  ]) && value.code === "SI" && value.englishName === "Slovenia" &&
    value.displayName === "Словения" && value.flag === "🇸🇮" &&
    isRecord(value.coordinate) && exactKeys(value.coordinate, ["lat", "lng"]) &&
    value.coordinate.lat === 46.1512 && value.coordinate.lng === 14.9955;
}

function validDossierEvidence(
  kind: ClaimKind,
  evidence: unknown,
): evidence is DossierClaimV2["evidence"] {
  return Array.isArray(evidence) && evidence.length > 0 && evidence.every((reference) =>
    isRecord(reference) && exactKeys(reference, [
      "sourceId",
      "navigationUrl",
      "resolvedEvidenceUrl",
      "sourcePeriod",
      "locator",
      "excerptSha256",
    ]) && reference.sourceId === SLOVENIA_V2_CLAIM_SOURCE[kind] &&
    nonEmptyString(reference.navigationUrl) && nonEmptyString(reference.resolvedEvidenceUrl) &&
    nonEmptyString(reference.sourcePeriod) && nonEmptyString(reference.locator) &&
    typeof reference.excerptSha256 === "string" && HEX_64.test(reference.excerptSha256)
  );
}

function validDossierClaim(value: unknown): value is DossierClaimV2 {
  if (!isRecord(value) || !exactKeys(value, [
    "claimId",
    "claimKind",
    "value",
    "validatorVersion",
    "evidence",
  ]) || !isClaimKind(value.claimKind)) return false;
  const kind = value.claimKind;
  if (!validValue(kind, value.value) ||
    value.validatorVersion !== SLOVENIA_V2_CLAIM_VALIDATOR[kind] ||
    value.claimId !== sloveniaV2ClaimId(
      kind,
      value.value as ClaimValueByKindV2[ClaimKind],
    ) ||
    !validDossierEvidence(kind, value.evidence)) return false;
  const sourcePeriod = value.evidence[0]!.sourcePeriod;
  return value.evidence.every((reference) => reference.sourcePeriod === sourcePeriod) &&
    sourcePeriodMatchesValue(kind, value.value, sourcePeriod);
}

function copyDossierClaim(claim: DossierClaimV2): DossierClaimV2 {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    value: copyClaimValue(claim.claimKind, claim.value),
    validatorVersion: claim.validatorVersion,
    evidence: claim.evidence.map((reference) => ({ ...reference })),
  };
}

function reconstructOwnedPayload(value: unknown): CountryDossierPayloadV2 {
  if (!isRecord(value) || !exactKeys(value, ["country", "schemaVersion", "claims"]) ||
    value.schemaVersion !== "si-dossier@2" || !validCountry(value.country) ||
    !Array.isArray(value.claims) || !value.claims.every(validDossierClaim)) {
    return integrityMismatch();
  }
  const claims = value.claims as readonly DossierClaimV2[];
  const identities = claims.map((claim) =>
    sloveniaV2ClaimIdentity(claim.claimKind, claim.value)
  );
  const canonical = [...claims].sort(compareClaims);
  if (
    claims.filter(({ claimKind }) => claimKind === "route_basis").length !== 1 ||
    new Set(identities).size !== identities.length ||
    claims.some((claim, index) =>
      sloveniaV2ClaimIdentity(claim.claimKind, claim.value) !==
      sloveniaV2ClaimIdentity(
        canonical[index]!.claimKind,
        canonical[index]!.value,
      )
    )
  ) return integrityMismatch();

  return deepFreeze({
    country: {
      code: "SI",
      englishName: "Slovenia",
      displayName: "Словения",
      flag: "🇸🇮",
      coordinate: { lat: 46.1512, lng: 14.9955 },
    },
    schemaVersion: "si-dossier@2",
    claims: claims.map(copyDossierClaim),
  });
}

export function reconstructCountryDossierPayloadV2(
  value: unknown,
): CountryDossierPayloadV2 {
  try {
    return reconstructOwnedPayload(cloneBorrowedData(value));
  } catch {
    return integrityMismatch();
  }
}
