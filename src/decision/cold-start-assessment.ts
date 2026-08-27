import Decimal from "decimal.js";
import {
  REQUIRED_CLAIM_KINDS,
} from "../research/country-registry";
import type {
  ClaimKind,
  ClaimValueByKind,
  ColdStartEvidenceClaim,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../research/cold-start-contracts";
import {
  isCountryDossierPayload,
  type DossierClaim,
  type DossierVersion,
} from "../research/dossier";
import type { EvidenceSnapshot } from "../research/contracts";
import type { RelocationProfileSnapshot } from "./relocation-profile";

export const COLD_START_ASSESSMENT_RULES_VERSION = "cold-start-assessment@1";

export interface ColdStartFormula {
  readonly formulaId: "FORMULA-VS2-INCOME-01";
  readonly formulaVersion: "1";
  readonly expression: "monthlyIncomeRub / eurRub < thresholdEur";
  readonly monthlyIncomeRub: string;
  readonly eurRub: string;
  readonly incomeEur: string;
  readonly thresholdEur: string;
  readonly rounding: "UNROUNDED_THEN_HALF_UP_2DP";
  readonly sourceClaimIds: readonly string[];
}

export interface ColdStartComparator {
  readonly marker: "red" | "yellow";
  readonly personalFit:
    | "verified_veto"
    | "research_incomplete"
    | "personal_evidence_missing"
    | "route_compatible_city_unverified";
  readonly cityScope: "not_checked";
  readonly reasons: readonly {
    readonly code: string;
    readonly summary: string;
    readonly claimIds: readonly string[];
    readonly officialUrls: readonly string[];
  }[];
  readonly formula?: ColdStartFormula;
}

export interface ColdStartAssessmentInput {
  readonly assessmentAt: string;
  readonly profile: RelocationProfileSnapshot;
  readonly evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>;
  readonly dossier?: DossierVersion;
  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;
}

type AssessmentReason = ColdStartComparator["reasons"][number];

const SUMMARY: Readonly<Record<string, string>> = {
  income_below_verified_threshold:
    "Подтверждённого чистого дохода недостаточно для порога маршрута.",
  citizenship_excluded: "Гражданство явно исключено из подтверждённой категории маршрута.",
  remote_work_relation_not_allowed:
    "Подтверждённый маршрут не допускает выбранный формат удалённой работы.",
  remote_work_not_legally_allowed:
    "Пользователь подтвердил, что выбранный формат удалённой работы юридически недоступен.",
  passport_validity_insufficient:
    "Срок действия паспорта меньше подтверждённого срока маршрута и обязательного запаса.",
  country_evidence_incomplete: "Официальные данные по стране подтверждены не полностью.",
  country_not_installed: "Страна пока не установлена для проверки официальных данных.",
  income_basis_not_net: "Для сравнения нужен подтверждённый чистый доход.",
  fx_rate_unavailable: "Актуальный официальный курс EUR/RUB не подтверждён.",
  fx_rate_stale: "Подтверждённый курс EUR/RUB старше допустимого окна.",
  remote_work_prerequisite_unknown: "Юридическая допустимость удалённой работы не подтверждена.",
  passport_validity_unknown: "Срок действия паспорта не подтверждён.",
  health_insurance_not_confirmed: "Медицинская страховка не подтверждена.",
  companion_route_unverified: "Маршрут для этого типа сопровождающего не подтверждён.",
  city_not_checked: "Страна совместима с профилем, но подходящий город ещё не проверен.",
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function reason(
  code: keyof typeof SUMMARY,
  claimIds: readonly string[] = [],
  officialUrls: readonly string[] = [],
): AssessmentReason {
  return {
    code,
    summary: SUMMARY[code],
    claimIds: unique(claimIds),
    officialUrls: unique(officialUrls),
  };
}

function canonicalDay(value: string): Date | undefined {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? date
    : undefined;
}

function countryClaims(
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>,
): readonly VerifiedCountryClaim[] {
  return evidence.claims.filter(
    (claim): claim is VerifiedCountryClaim => "claimKind" in claim,
  );
}

function projectedDossierClaim(claim: VerifiedCountryClaim): DossierClaim {
  return {
    claimId: claim.claimId,
    claimKind: claim.claimKind,
    value: claim.value,
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

function verifiedDossierClaims(
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>,
  dossier: DossierVersion,
): Readonly<Record<ClaimKind, DossierClaim>> {
  if (
    dossier.schemaVersion !== "si-dossier@1" || dossier.countryCode !== "SI" ||
    !isCountryDossierPayload(dossier.payload)
  ) integrityMismatch();
  const current = countryClaims(evidence);
  if (
    current.length !== REQUIRED_CLAIM_KINDS.length ||
    REQUIRED_CLAIM_KINDS.some((kind) =>
      current.filter((claim) => claim.claimKind === kind).length !== 1
    )
  ) integrityMismatch();
  const claims = {} as Record<ClaimKind, DossierClaim>;
  for (const kind of REQUIRED_CLAIM_KINDS) {
    const dossierClaim = dossier.payload.claims.find((claim) => claim.claimKind === kind);
    const currentClaim = current.find((claim) => claim.claimKind === kind);
    if (
      dossierClaim === undefined || currentClaim === undefined ||
      canonicalJson(dossierClaim) !== canonicalJson(projectedDossierClaim(currentClaim))
    ) integrityMismatch();
    claims[kind] = dossierClaim;
  }
  return claims;
}

function cbrClaim(
  evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaim>,
  assessmentAt: string,
): { readonly claim: Extract<ColdStartEvidenceClaim, { readonly sourceId: "cbr-eur" }>; readonly rate: Decimal } |
  "unavailable" | "stale" {
  const candidates = evidence.claims.filter(
    (claim): claim is Extract<ColdStartEvidenceClaim, { readonly sourceId: "cbr-eur" }> =>
      claim.sourceId === "cbr-eur" && !("claimKind" in claim),
  );
  if (evidence.coverage["cbr-eur"] !== "verified" || candidates.length !== 1) {
    return "unavailable";
  }
  const claim = candidates[0]!;
  const effective = canonicalDay(claim.value.effectiveDate);
  const assessment = canonicalDay(assessmentAt);
  let rate: Decimal;
  try {
    rate = new Decimal(claim.value.rate);
  } catch {
    return "unavailable";
  }
  if (
    assessment === undefined || effective === undefined ||
    claim.value.base !== "EUR" || claim.value.quote !== "RUB" ||
    claim.value.nominal !== "1" || !rate.isFinite() || !rate.isPositive()
  ) return "unavailable";
  const ageDays = (assessment.valueOf() - effective.valueOf()) / 86_400_000;
  if (!Number.isInteger(ageDays) || ageDays < 0 || ageDays > 3) return "stale";
  return { claim, rate };
}

function addMonths(dateText: string, months: number): Date | undefined {
  const date = canonicalDay(dateText);
  if (date === undefined) return undefined;
  const absoluteMonth = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(date.getUTCDate(), lastTargetDay),
  ));
}

function researchIncomplete(input: ColdStartAssessmentInput): ColdStartComparator {
  const blockers = input.evidence.blockers.filter(({ sourceId }) => sourceId !== "cbr-eur");
  const countryNotInstalled = blockers.length > 0 && blockers.every(
    ({ kind }) => kind === "country_not_installed",
  );
  return deepFreeze({
    marker: "yellow",
    personalFit: "research_incomplete",
    cityScope: "not_checked",
    reasons: countryNotInstalled
      ? [reason("country_not_installed")]
      : blockers.length === 0
      ? [reason("country_evidence_incomplete")]
      : blockers.map((blocker) => reason(
          "country_evidence_incomplete",
          [],
          [blocker.navigationUrl],
        )),
  });
}

export function assessColdStart(input: ColdStartAssessmentInput): ColdStartComparator {
  if (
    input.profile.schemaVersion !== "relocation-profile@1" ||
    input.evidence.rulesVersion !== "vs2-si-evidence@2" ||
    input.evidence.assessmentDate !== input.assessmentAt ||
    canonicalDay(input.assessmentAt) === undefined
  ) integrityMismatch();

  const countryComplete = REQUIRED_CLAIM_KINDS.every((kind) =>
    countryClaims(input.evidence).filter((claim) => claim.claimKind === kind).length === 1
  ) && [
    "si-digital-nomad-route",
    "si-income-threshold",
    "si-companion-employment",
  ].every((sourceId) => input.evidence.coverage[sourceId as SloveniaSourceId] === "verified");
  if (!countryComplete || input.dossier === undefined) {
    if (countryComplete) integrityMismatch();
    return researchIncomplete(input);
  }

  const dossierClaims = verifiedDossierClaims(input.evidence, input.dossier);
  const hardVetoes: AssessmentReason[] = [];
  const personalUnknowns: AssessmentReason[] = [];
  let formula: ColdStartFormula | undefined;

  const citizenship = dossierClaims.citizenship_applicability;
  const citizenshipValue = citizenship.value as ClaimValueByKind["citizenship_applicability"];
  if (citizenshipValue.explicitNationalityExclusions.includes("RU")) {
    hardVetoes.push(reason(
      "citizenship_excluded",
      [citizenship.claimId],
      citizenship.evidence.map(({ navigationUrl }) => navigationUrl),
    ));
  }

  const remote = dossierClaims.remote_work_relations;
  const remoteValue = remote.value as ClaimValueByKind["remote_work_relations"];
  if (input.profile.profile.remoteWork.legallyAllowed === false) {
    hardVetoes.push(reason(
      "remote_work_not_legally_allowed",
      [remote.claimId],
      remote.evidence.map(({ navigationUrl }) => navigationUrl),
    ));
  } else if (
    input.profile.profile.remoteWork.relation === "foreign_employment" &&
    !remoteValue.allowedRelations.includes("foreign_employer") ||
    input.profile.profile.remoteWork.relation === "foreign_service" &&
    !remoteValue.allowedRelations.includes("foreign_clients")
  ) {
    hardVetoes.push(reason(
      "remote_work_relation_not_allowed",
      [remote.claimId],
      remote.evidence.map(({ navigationUrl }) => navigationUrl),
    ));
  } else if (
    input.profile.profile.remoteWork.relation === "unknown" ||
    input.profile.profile.remoteWork.legallyAllowed === "unknown"
  ) {
    personalUnknowns.push(reason("remote_work_prerequisite_unknown", [remote.claimId]));
  }

  const duration = dossierClaims.duration;
  const statutory = dossierClaims.general_statutory_prerequisites;
  if (input.profile.profile.passportValidUntil === "unknown") {
    personalUnknowns.push(reason("passport_validity_unknown", [duration.claimId, statutory.claimId]));
  } else {
    const durationValue = duration.value as ClaimValueByKind["duration"];
    const statutoryValue = statutory.value as ClaimValueByKind["general_statutory_prerequisites"];
    const requiredUntil = addMonths(
      input.assessmentAt,
      durationValue.maximumMonths + statutoryValue.passportBeyondPermitMonths,
    );
    const passportUntil = canonicalDay(input.profile.profile.passportValidUntil);
    if (requiredUntil === undefined || passportUntil === undefined) integrityMismatch();
    if (passportUntil < requiredUntil) {
      hardVetoes.push(reason(
        "passport_validity_insufficient",
        [duration.claimId, statutory.claimId],
        [...duration.evidence, ...statutory.evidence].map(({ navigationUrl }) => navigationUrl),
      ));
    }
  }

  if (input.profile.profile.healthInsurance !== "confirmed") {
    personalUnknowns.push(reason("health_insurance_not_confirmed", [statutory.claimId]));
  }
  if (input.profile.profile.companions.some(({ relationship }) => relationship === "other_family")) {
    const companion = dossierClaims.companion_entry;
    personalUnknowns.push(reason(
      "companion_route_unverified",
      [companion.claimId],
      companion.evidence.map(({ navigationUrl }) => navigationUrl),
    ));
  }

  const income = dossierClaims.income;
  const incomeValue = income.value as ClaimValueByKind["income"];
  const currentCbr = cbrClaim(input.evidence, input.assessmentAt);
  if (input.profile.profile.monthlyIncome.basis !== "net") {
    personalUnknowns.push(reason("income_basis_not_net", [income.claimId]));
  } else if (currentCbr === "unavailable") {
    personalUnknowns.push(reason("fx_rate_unavailable"));
  } else if (currentCbr === "stale") {
    personalUnknowns.push(reason("fx_rate_stale"));
  } else if (incomeValue.metric !== "latest_official_average_monthly_net_salary") {
    integrityMismatch();
  } else {
    const monthlyIncome = new Decimal(input.profile.profile.monthlyIncome.amount);
    const threshold = new Decimal(incomeValue.thresholdEur);
    const incomeEur = monthlyIncome.div(currentCbr.rate);
    const claimIds = [income.claimId, currentCbr.claim.claimId];
    const officialUrls = [
      ...income.evidence.map(({ navigationUrl }) => navigationUrl),
      input.sourceNavigation["cbr-eur"],
    ];
    formula = {
      formulaId: "FORMULA-VS2-INCOME-01",
      formulaVersion: "1",
      expression: "monthlyIncomeRub / eurRub < thresholdEur",
      monthlyIncomeRub: monthlyIncome.toFixed(),
      eurRub: currentCbr.rate.toFixed(),
      incomeEur: incomeEur.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
      thresholdEur: threshold.toFixed(2),
      rounding: "UNROUNDED_THEN_HALF_UP_2DP",
      sourceClaimIds: claimIds,
    };
    if (incomeEur.lessThan(threshold)) {
      hardVetoes.push(reason("income_below_verified_threshold", claimIds, officialUrls));
    }
  }

  if (hardVetoes.length > 0) {
    return deepFreeze({
      marker: "red",
      personalFit: "verified_veto",
      cityScope: "not_checked",
      reasons: hardVetoes,
      ...(formula === undefined ? {} : { formula }),
    });
  }
  if (personalUnknowns.length > 0) {
    return deepFreeze({
      marker: "yellow",
      personalFit: "personal_evidence_missing",
      cityScope: "not_checked",
      reasons: personalUnknowns,
      ...(formula === undefined ? {} : { formula }),
    });
  }
  return deepFreeze({
    marker: "yellow",
    personalFit: "route_compatible_city_unverified",
    cityScope: "not_checked",
    reasons: [reason("city_not_checked")],
    ...(formula === undefined ? {} : { formula }),
  });
}
