import { z } from "zod";

import type { CountryAssessmentProjectionV2 } from
  "../application/country-assessment-projection-v2";

const nonEmptyStringSchema = z.string().min(1);

const reasonCodeSchema = z.enum([
  "citizenship_excluded",
  "citizenship_applicability_unknown",
  "companion_route_unverified",
  "companion_route_impossible",
  "passport_validity_insufficient",
  "passport_validity_unknown",
  "remote_continuation_unavailable",
  "remote_work_prerequisite_unknown",
  "income_below_verified_threshold",
  "income_basis_not_comparable",
  "fx_rate_unavailable",
  "fx_rate_stale",
  "country_evidence_incomplete",
  "country_not_installed",
  "route_requirements_verified",
]);

function uniqueStringArray<T extends z.ZodType<string>>(item: T, minimum: number) {
  return z.array(item).min(minimum).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "duplicate_value" });
    }
  });
}

export const participantRouteAssessmentV2Schema = z.object({
  routeId: nonEmptyStringSchema,
  participantId: nonEmptyStringSchema,
  relationship: z.enum(["self", "spouse", "minor_child", "other_family"]),
  status: z.enum(["verified", "unknown", "impossible"]),
  reasonCodes: uniqueStringArray(reasonCodeSchema, 1),
  claimIds: uniqueStringArray(nonEmptyStringSchema, 0),
}).strict();

type ParticipantAssessment = z.infer<typeof participantRouteAssessmentV2Schema>;
type ReasonCode = z.infer<typeof reasonCodeSchema>;

interface ParticipantAssessmentLike {
  readonly routeId: string;
  readonly participantId: string;
  readonly relationship: ParticipantAssessment["relationship"];
  readonly status: ParticipantAssessment["status"];
  readonly reasonCodes: readonly ReasonCode[];
  readonly claimIds: readonly string[];
}

const projectionSchema = z.object({
  schemaVersion: z.literal("country-assessment-projection@2"),
  profileSnapshotId: nonEmptyStringSchema,
  evidenceSnapshotId: nonEmptyStringSchema,
  participantAssessments: z.array(participantRouteAssessmentV2Schema),
}).strict().superRefine((projection, context) => {
  if (!isDenseRouteMajorRectangle(projection.participantAssessments)) {
    context.addIssue({
      code: "custom",
      message: "non_dense_participant_projection",
      path: ["participantAssessments"],
    });
  }
});

export interface CountryAssessmentProjectionExpectation {
  readonly evidenceSnapshotId: string;
  readonly profileSnapshotId?: string;
}

export interface CountryAssessmentExplanation {
  readonly routeLabel: string;
  readonly participantLabel: string;
  readonly status: "unknown" | "impossible";
  readonly reasonLabels: readonly string[];
}

const ROUTE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "si-temporary-residence-digital-nomad": "ВНЖ цифрового кочевника",
});

const RELATIONSHIP_LABELS: Readonly<Record<ParticipantAssessment["relationship"], string>> =
  Object.freeze({
    self: "Заявитель",
    spouse: "Супруг или супруга",
    minor_child: "Несовершеннолетний ребёнок",
    other_family: "Другой член семьи",
  });

const REASON_LABELS: Readonly<Record<z.infer<typeof reasonCodeSchema>, string>> = Object.freeze({
  citizenship_excluded: "Гражданство не подходит под условия маршрута",
  citizenship_applicability_unknown: "Не подтверждена применимость гражданства",
  companion_route_unverified: "Не подтверждён маршрут для сопровождающего",
  companion_route_impossible: "Сопровождающий не подходит под условия маршрута",
  passport_validity_insufficient: "Срок действия паспорта недостаточен",
  passport_validity_unknown: "Нужно уточнить срок действия паспорта",
  remote_continuation_unavailable: "Удалённая работа для маршрута недоступна",
  remote_work_prerequisite_unknown: "Не подтверждены условия удалённой работы",
  income_below_verified_threshold: "Доход ниже подтверждённого порога",
  income_basis_not_comparable: "Доход нельзя сопоставить с официальным порогом",
  fx_rate_unavailable: "Нет подтверждённого курса для пересчёта",
  fx_rate_stale: "Курс для пересчёта устарел",
  country_evidence_incomplete: "Не хватает официальных данных страны",
  country_not_installed: "Проверка этой страны пока недоступна",
  route_requirements_verified: "Требования маршрута подтверждены",
});

export function parseCountryAssessmentProjectionV2(
  value: unknown,
  expected: CountryAssessmentProjectionExpectation,
): CountryAssessmentProjectionV2 {
  const result = projectionSchema.safeParse(value);
  if (
    !result.success ||
    result.data.evidenceSnapshotId !== expected.evidenceSnapshotId ||
    expected.profileSnapshotId !== undefined &&
      result.data.profileSnapshotId !== expected.profileSnapshotId
  ) throw new Error("integrity_mismatch");
  return deepFreeze(result.data) as CountryAssessmentProjectionV2;
}

export function sameParticipantAssessments(
  left: readonly ParticipantAssessmentLike[],
  right: readonly ParticipantAssessmentLike[],
): boolean {
  return left.length === right.length && left.every((assessment, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      assessment.routeId === candidate.routeId &&
      assessment.participantId === candidate.participantId &&
      assessment.relationship === candidate.relationship &&
      assessment.status === candidate.status &&
      sameStrings(assessment.reasonCodes, candidate.reasonCodes) &&
      sameStrings(assessment.claimIds, candidate.claimIds);
  });
}

export function projectCountryAssessmentExplanations(
  projection: CountryAssessmentProjectionV2,
): readonly CountryAssessmentExplanation[] {
  const parsed = parseCountryAssessmentProjectionV2(projection, {
    profileSnapshotId: projection.profileSnapshotId,
    evidenceSnapshotId: projection.evidenceSnapshotId,
  });
  return deepFreeze(parsed.participantAssessments.flatMap((assessment) => {
    if (assessment.status === "verified") return [];
    return [{
      routeLabel: ROUTE_LABELS[assessment.routeId] ?? "Маршрут проживания",
      participantLabel: RELATIONSHIP_LABELS[assessment.relationship],
      status: assessment.status,
      reasonLabels: assessment.reasonCodes.map((reason) => REASON_LABELS[reason]),
    }];
  }));
}

function isDenseRouteMajorRectangle(assessments: readonly ParticipantAssessment[]): boolean {
  if (assessments.length === 0) return true;
  const firstRouteId = assessments[0]!.routeId;
  const firstDifferentRoute = assessments.findIndex(({ routeId }) => routeId !== firstRouteId);
  const participantCount = firstDifferentRoute === -1
    ? assessments.length
    : firstDifferentRoute;
  const firstRoute = assessments.slice(0, participantCount);
  const participantIds = firstRoute.map(({ participantId }) => participantId);
  if (
    participantCount === 0 ||
    new Set(participantIds).size !== participantCount ||
    assessments.length % participantCount !== 0 ||
    new Set(assessments.map(pairKey)).size !== assessments.length
  ) return false;

  const relationships = new Map(firstRoute.map(({ participantId, relationship }) => [
    participantId,
    relationship,
  ]));
  const routeIds = new Set<string>();
  for (let offset = 0; offset < assessments.length; offset += participantCount) {
    const routeId = assessments[offset]!.routeId;
    if (routeIds.has(routeId)) return false;
    routeIds.add(routeId);
    for (let participantIndex = 0; participantIndex < participantCount; participantIndex++) {
      const assessment = assessments[offset + participantIndex]!;
      const participantId = participantIds[participantIndex]!;
      if (
        assessment.routeId !== routeId ||
        assessment.participantId !== participantId ||
        assessment.relationship !== relationships.get(participantId)
      ) return false;
    }
  }
  return true;
}

function pairKey(assessment: ParticipantAssessment): string {
  return `${assessment.routeId}\u0000${assessment.participantId}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
