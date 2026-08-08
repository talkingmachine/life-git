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
  available_resources_rule_unavailable: "Официальное правило о доступных средствах недоступно",
  available_resources_below_threshold: "Заявленные ресурсы ниже подтверждённого официального порога",
  lawful_stay_not_verified: "Законное пребывание требует официального подтверждения",
  staged_family_plan_not_verified: "Поэтапный маршрут спутника требует подтверждения",
  cbr_rate_not_verified: "Официальный курс Банка России недоступен",
  boa_rate_not_verified: "Официальный курс Банка Албании недоступен",
  tirana_claim_not_verified: "Данные по Тиране требуют повторной проверки",
  spouse_claim_not_verified: "Основание для супруга требует повторной проверки",
  income_continuation_not_confirmed: "Поступление дохода в течение двенадцати месяцев не подтверждено",
  lawful_stay_prerequisite_not_accepted: "Предварительное условие законного пребывания не принято",
  staged_spouse_route_not_accepted: "Поэтапный маршрут супруга после разрешения спонсора не принят",
});

const blockerLabels: Readonly<Record<string, string>> = Object.freeze({
  timeout: "не ответил вовремя",
  deadline: "не ответил в отведённый срок",
  rate_limited: "временно ограничил доступ",
  server_error: "временно недоступен",
  http_error: "вернул ошибку",
  wrong_media_type: "вернул неподдерживаемый формат",
  too_large: "вернул слишком большой документ",
  navigation_mismatch: "не подтвердил официальный адрес",
  integrity_mismatch: "не прошёл проверку целостности",
  semantic_mismatch: "не прошло смысловую проверку",
  stale: "устарел для даты оценки",
  conflict: "содержит конфликтующие данные",
});

const scenarioConditionReasonCodes = new Set([
  "income_continuation_not_confirmed",
  "lawful_stay_prerequisite_not_accepted",
  "staged_spouse_route_not_accepted",
]);

function reasonSummary(code: string, blockerKind?: string): string {
  if (code === "available_resources_rule_unavailable" && blockerKind === "semantic_mismatch") {
    return "Официальное правило о доступных средствах не прошло смысловую проверку";
  }
  const base = reasonLabels[code] ?? "Официальное основание требует проверки";
  return blockerKind === undefined ? base : `${base}: ${blockerLabels[blockerKind] ?? blockerKind}`;
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
  const reasonSourceId = firstReason === undefined || scenarioConditionReasonCodes.has(firstReason.code)
    ? undefined
    : firstReason.sourceId;
  const reasonUrl = reasonSourceId === undefined ? undefined : officialUrl(details, reasonSourceId);
  return Object.freeze({
    profile: Object.freeze({
      housingAll: housingFrom(details),
      incomeBasis: details.profile.profile.incomeBasis,
      monthlyIncomeRub: details.profile.profile.monthlyIncome.amount,
      availableResourcesAll: details.profile.profile.availableResourcesAll,
      conditions: details.profile.profile.conditions,
      companionMode: details.profile.profile.companionBasis === "family" &&
          details.profile.profile.relationship === "spouse"
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
      ...(firstReason === undefined ? {} : {
        reason: Object.freeze({
          summary: reasonSummary(firstReason.code, firstReason.blockerKind),
          ...(reasonUrl === undefined ? {} : { officialUrl: reasonUrl }),
        }),
      }),
    }),
  });
}
