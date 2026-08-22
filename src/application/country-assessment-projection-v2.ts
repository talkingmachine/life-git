import { types } from "node:util";

import type {
  CountryAssessmentV2ReasonCode,
  ParticipantRouteAssessmentV2,
} from "../decision/cold-start-assessment-v2";

export interface CountryAssessmentProjectionV2 {
  readonly schemaVersion: "country-assessment-projection@2";
  readonly profileSnapshotId: string;
  readonly evidenceSnapshotId: string;
  readonly participantAssessments: readonly ParticipantRouteAssessmentV2[];
}

interface ExpectedProjectionOrder {
  readonly profileSnapshotId: string;
  readonly evidenceSnapshotId: string;
  readonly orderedPairs: readonly {
    readonly routeId: string;
    readonly participantId: string;
  }[];
}

const REASON_CODES = new Set<CountryAssessmentV2ReasonCode>([
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

const RELATIONSHIPS = new Set([
  "self",
  "spouse",
  "minor_child",
  "other_family",
]);

const PARTICIPANT_STATUSES = new Set([
  "verified",
  "unknown",
  "impossible",
]);

export function reconstructCountryAssessmentProjectionV2(
  value: unknown,
  expected: ExpectedProjectionOrder,
): CountryAssessmentProjectionV2 {
  try {
    const ownedExpected = reconstructExpectedOrder(descriptorSafeCopy(expected));
    const projection = reconstructCountryAssessmentProjectionV2Structure(value, {
      profileSnapshotId: ownedExpected.profileSnapshotId,
      evidenceSnapshotId: ownedExpected.evidenceSnapshotId,
    });
    if (
      projection.participantAssessments.length !== ownedExpected.orderedPairs.length ||
      projection.participantAssessments.some((assessment, index) => {
        const expectedPair = ownedExpected.orderedPairs[index]!;
        return assessment.routeId !== expectedPair.routeId ||
          assessment.participantId !== expectedPair.participantId;
      })
    ) integrityMismatch();
    return projection;
  } catch {
    return integrityMismatch();
  }
}

export function reconstructCountryAssessmentProjectionV2Structure(
  value: unknown,
  expected: {
    readonly profileSnapshotId: string;
    readonly evidenceSnapshotId: string;
  },
): CountryAssessmentProjectionV2 {
  try {
    const bindings = reconstructExpectedBindings(descriptorSafeCopy(expected));
    const projection = exactRecord(descriptorSafeCopy(value), [
      "schemaVersion",
      "profileSnapshotId",
      "evidenceSnapshotId",
      "participantAssessments",
    ]);
    if (
      projection.schemaVersion !== "country-assessment-projection@2" ||
      !isNonEmptyString(projection.profileSnapshotId) ||
      projection.profileSnapshotId !== bindings.profileSnapshotId ||
      !isNonEmptyString(projection.evidenceSnapshotId) ||
      projection.evidenceSnapshotId !== bindings.evidenceSnapshotId ||
      !Array.isArray(projection.participantAssessments)
    ) integrityMismatch();

    const participantAssessments = projection.participantAssessments.map(
      reconstructParticipantAssessment,
    );
    validateDenseRouteMajorRectangle(participantAssessments);
    return deepFreeze({
      schemaVersion: "country-assessment-projection@2" as const,
      profileSnapshotId: bindings.profileSnapshotId,
      evidenceSnapshotId: bindings.evidenceSnapshotId,
      participantAssessments,
    });
  } catch {
    return integrityMismatch();
  }
}

function reconstructExpectedBindings(value: unknown): {
  readonly profileSnapshotId: string;
  readonly evidenceSnapshotId: string;
} {
  const expected = exactRecord(value, ["profileSnapshotId", "evidenceSnapshotId"]);
  if (
    !isNonEmptyString(expected.profileSnapshotId) ||
    !isNonEmptyString(expected.evidenceSnapshotId)
  ) integrityMismatch();
  return {
    profileSnapshotId: expected.profileSnapshotId,
    evidenceSnapshotId: expected.evidenceSnapshotId,
  };
}

function reconstructExpectedOrder(value: unknown): ExpectedProjectionOrder {
  const expected = exactRecord(value, [
    "profileSnapshotId",
    "evidenceSnapshotId",
    "orderedPairs",
  ]);
  if (
    !isNonEmptyString(expected.profileSnapshotId) ||
    !isNonEmptyString(expected.evidenceSnapshotId) ||
    !Array.isArray(expected.orderedPairs)
  ) integrityMismatch();

  const orderedPairs = expected.orderedPairs.map((value) => {
    const pair = exactRecord(value, ["routeId", "participantId"]);
    if (!isNonEmptyString(pair.routeId) || !isNonEmptyString(pair.participantId)) {
      return integrityMismatch();
    }
    return { routeId: pair.routeId, participantId: pair.participantId };
  });
  if (new Set(orderedPairs.map(pairKey)).size !== orderedPairs.length) integrityMismatch();

  return {
    profileSnapshotId: expected.profileSnapshotId,
    evidenceSnapshotId: expected.evidenceSnapshotId,
    orderedPairs,
  };
}

function reconstructParticipantAssessment(
  value: unknown,
): ParticipantRouteAssessmentV2 {
  const assessment = exactRecord(value, [
    "routeId",
    "participantId",
    "relationship",
    "status",
    "reasonCodes",
    "claimIds",
  ]);
  if (
    !isNonEmptyString(assessment.routeId) ||
    !isNonEmptyString(assessment.participantId) ||
    !RELATIONSHIPS.has(assessment.relationship as string) ||
    !PARTICIPANT_STATUSES.has(assessment.status as string)
  ) integrityMismatch();

  const reasonCodes = reconstructStringArray(assessment.reasonCodes, false);
  if (!reasonCodes.every((code) => REASON_CODES.has(code as CountryAssessmentV2ReasonCode))) {
    integrityMismatch();
  }
  const claimIds = reconstructStringArray(assessment.claimIds, true);

  return {
    routeId: assessment.routeId,
    participantId: assessment.participantId,
    relationship: assessment.relationship as ParticipantRouteAssessmentV2["relationship"],
    status: assessment.status as ParticipantRouteAssessmentV2["status"],
    reasonCodes: reasonCodes as CountryAssessmentV2ReasonCode[],
    claimIds,
  };
}

function validateDenseRouteMajorRectangle(
  assessments: readonly ParticipantRouteAssessmentV2[],
): void {
  if (assessments.length === 0) return;
  const firstRouteId = assessments[0]!.routeId;
  const firstRouteBoundary = assessments.findIndex(
    ({ routeId }) => routeId !== firstRouteId,
  );
  const firstRoute = assessments.slice(
    0,
    firstRouteBoundary === -1 ? assessments.length : firstRouteBoundary,
  );
  const participantIds = firstRoute.map(({ participantId }) => participantId);
  if (
    participantIds.length === 0 ||
    new Set(participantIds).size !== participantIds.length ||
    assessments.length % participantIds.length !== 0 ||
    new Set(assessments.map(pairKey)).size !== assessments.length
  ) integrityMismatch();

  const relationships = new Map(firstRoute.map(({ participantId, relationship }) => [
    participantId,
    relationship,
  ]));
  const routeIds = new Set<string>();
  for (let offset = 0; offset < assessments.length; offset += participantIds.length) {
    const routeId = assessments[offset]!.routeId;
    if (routeIds.has(routeId)) integrityMismatch();
    routeIds.add(routeId);
    for (let participantIndex = 0; participantIndex < participantIds.length; participantIndex++) {
      const assessment = assessments[offset + participantIndex]!;
      const participantId = participantIds[participantIndex]!;
      if (
        assessment.routeId !== routeId ||
        assessment.participantId !== participantId ||
        assessment.relationship !== relationships.get(participantId)
      ) integrityMismatch();
    }
  }
}

function reconstructStringArray(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
    !value.every(isNonEmptyString) || new Set(value).size !== value.length) {
    return integrityMismatch();
  }
  return [...value];
}

function pairKey(pair: ExpectedProjectionOrder["orderedPairs"][number]): string {
  return `${pair.routeId}\u0000${pair.participantId}`;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return integrityMismatch();
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])) {
    return integrityMismatch();
  }
  return value;
}

function descriptorSafeCopy(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) integrityMismatch();
    return value;
  }
  if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) {
    return integrityMismatch();
  }

  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(descriptors).length !== 0) integrityMismatch();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) integrityMismatch();
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        return integrityMismatch();
      }
      const length = lengthDescriptor.value as number;
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      const actualKeys = Object.keys(descriptors).sort();
      if (actualKeys.length !== expectedKeys.length ||
        actualKeys.some((key, index) => key !== expectedKeys[index])) {
        return integrityMismatch();
      }
      return Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          return integrityMismatch();
        }
        return descriptorSafeCopy(descriptor.value, ancestors);
      });
    }

    if (prototype !== Object.prototype && prototype !== null) integrityMismatch();
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "__proto__" || !("value" in descriptor) || !descriptor.enumerable) {
        return integrityMismatch();
      }
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: descriptorSafeCopy(descriptor.value, ancestors),
        writable: true,
      });
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
