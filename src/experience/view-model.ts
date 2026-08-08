import type { EvidenceReadItem, RunDetails, RunDetailsCore } from "../application/contracts";
import type { HousingBranchDiff } from "../branch/life-git";

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function formatDecimal(value: string): string {
  const match = DECIMAL.exec(value);
  if (match === null) return value;
  const integer = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return match[2] === undefined ? integer : `${integer},${match[2]}`;
}

export function formatSignedDecimal(value: string): string {
  if (value.startsWith("-")) return `−${formatDecimal(value.slice(1))}`;
  return `+${formatDecimal(value)}`;
}

export type BudgetView = NonNullable<RunDetailsCore["budget"]>;
export type EvidencePassportItems = readonly EvidenceReadItem[];
export type LifeDiffView = HousingBranchDiff;

const reasonLabels: Readonly<Record<string, string>> = Object.freeze({
  albanian_employer_only: "Доход зависит только от местного работодателя",
  companion_basis_not_researched_in_vs1: "Основание для спутника не входит в эту проверку",
  relationship_not_verified_in_vs1: "Статус отношений требует отдельного подтверждения",
  housing_not_confirmed: "Условие по жилью ещё не подтверждено",
  foreign_contract_not_verified: "Не подтверждён официальный источник о договоре",
  available_resources_not_confirmed: "Доступные ресурсы не подтверждены официальным правилом",
  lawful_stay_not_verified: "Законное пребывание требует официального подтверждения",
  staged_family_plan_not_verified: "Поэтапный маршрут спутника требует подтверждения",
  tirana_claim_not_verified: "Данные по Тиране требуют повторной проверки",
  spouse_claim_not_verified: "Основание для супруга требует повторной проверки",
});

function sourceIdForClaim(claimId: string): "al-law-79" | "tirana-urban-lines" {
  return claimId === "al-tirana-residence" ? "tirana-urban-lines" : "al-law-79";
}

function housingFrom(details: RunDetails): string {
  const assumption = details.evidenceItems.find((item) =>
    item.class === "assumption" && item.label === "Initial housing"
  );
  if (assumption?.class !== "assumption") return "0";
  const match = assumption.displayValue?.match(/^(\d+(?:\.\d+)?) ALL$/);
  return match?.[1] ?? "0";
}

function officialUrl(details: RunDetails, sourceId: string): string | undefined {
  const official = details.evidenceItems.find((item) =>
    item.class === "official_fact" && item.sourceId === sourceId
  );
  if (official?.class === "official_fact") return official.resolvedUrl;
  const blocked = details.evidenceItems.find((item) =>
    item.class === "unknown" && item.provenance === "source_unavailable" && item.sourceId === sourceId
  );
  return blocked?.class === "unknown" && blocked.provenance === "source_unavailable"
    ? blocked.resolvedUrl ?? blocked.navigationUrl
    : undefined;
}

export function createJourneyView(details: RunDetails) {
  const firstReason = details.run.assessment.reasons[0];
  const reasonSourceId = firstReason === undefined ? undefined : sourceIdForClaim(firstReason.claimId);
  const reasonUrl = reasonSourceId === undefined ? undefined : officialUrl(details, reasonSourceId);
  return Object.freeze({
    profile: Object.freeze({
      housingAll: housingFrom(details),
      hasContract: details.profile.profile.incomeBasis === "foreign_contract",
      hasResources: details.profile.profile.availableResourcesAll.length > 0,
      hasLawfulStay: true,
      companionMode: details.profile.profile.companionBasis === "family"
        ? "staged" as const
        : details.profile.profile.companionBasis === "none"
          ? "none" as const
          : "separate" as const,
    }),
    candidate: Object.freeze({
      id: "tirana",
      origin: "Россия" as const,
      destination: "Тирана" as const,
      status: details.run.assessment.marker,
      ...(firstReason === undefined || reasonUrl === undefined ? {} : {
        reason: Object.freeze({
          summary: reasonLabels[firstReason.code] ?? "Официальное основание требует проверки",
          officialUrl: reasonUrl,
        }),
      }),
    }),
  });
}
