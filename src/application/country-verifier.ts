import { types } from "node:util";

import {
  reconstructFormalResidenceVerdict,
  type FormalResidenceVerdict,
} from "../decision/formal-residence-verdict";
import type { RankablePlace, RankedPlace } from "../decision/place-ranker";
import {
  reconstructCountryAssessmentProjectionV2Structure,
  type CountryAssessmentProjectionV2,
} from "./country-assessment-projection-v2";

export interface CountryVerificationProgress {
  readonly stage:
    | "source_discovered"
    | "authority_verified"
    | "artifact_captured"
    | "claim_verified"
    | "dossier_published";
  readonly label: string;
  readonly detail?: string;
  readonly sourceUrl?: string;
}

export interface CountryVerificationResultCommon {
  readonly countryCheckRunId: string;
  readonly verdict: FormalResidenceVerdict;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly lastCheckedAt: string;
}

export type CountryVerificationResult =
  | (CountryVerificationResultCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
      readonly assessmentProjection?: never;
    })
  | (CountryVerificationResultCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@2";
      readonly assessmentProjection: CountryAssessmentProjectionV2;
    });

export type CountryVerificationPresentation =
  | Omit<Extract<CountryVerificationResult, {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
    }>, "countryCheckRunId">
  | Omit<Extract<CountryVerificationResult, {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@2";
    }>, "countryCheckRunId">;

export interface CountryVerifierPort {
  check(input: {
    readonly country: RankablePlace;
    readonly profileId: string;
    readonly parentRunId: string;
    readonly emitProgress: (
      progress: CountryVerificationProgress,
    ) => void | Promise<void>;
    readonly signal: AbortSignal;
  }): Promise<CountryVerificationResult>;
  present(input: {
    readonly parentRunId: string;
    readonly countryCode: string;
    readonly countryCheckRunId: string;
    readonly profileId: string;
  }): Promise<CountryVerificationPresentation>;
}

export interface FrontierCountry {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
}

export interface FrontierMarkerCommon {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly countryCheckRunId: string;
  readonly lastCheckedAt: string;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly formalVerdict: FormalResidenceVerdict;
}

export type FrontierMarker =
  | (FrontierMarkerCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
      readonly assessmentProjection?: never;
    })
  | (FrontierMarkerCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@2";
      readonly assessmentProjection: CountryAssessmentProjectionV2;
    });

export interface CountryVerifierIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
}

function integrityMismatch(): never {
  throw new Error("integrity_mismatch");
}

function reconstructCountryVerificationResult(
  value: unknown,
): CountryVerificationResult {
  try {
    return descriptorSafeCopy(value) as CountryVerificationResult;
  } catch {
    return integrityMismatch();
  }
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function isCanonicalDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

export function countryCheckRunId(
  parentRunId: string,
  countryCode: string,
  integrity: CountryVerifierIntegrity,
): string {
  return `frontier-country:${integrity.hash(integrity.canonical({ parentRunId, countryCode }))}`;
}

function frontierCountry(place: RankedPlace): FrontierCountry {
  return {
    countryCode: place.countryCode,
    label: place.label,
    flag: place.flag,
    coordinate: { ...place.coordinate },
  };
}

export function materializeFrontierMarker(input: {
  readonly place: RankedPlace;
  readonly checked: CountryVerificationResult;
  readonly parentRunId: string;
  readonly profileId: string;
  readonly integrity: CountryVerifierIntegrity;
}): FrontierMarker {
  const checked = reconstructCountryVerificationResult(input.checked);
  const optionalKeys = [
    ...(checked.currentKnowledgeRevisionId === undefined ? [] : ["currentKnowledgeRevisionId"]),
    ...(checked.updatedKnowledgeRevisionId === undefined ? [] : ["updatedKnowledgeRevisionId"]),
    ...(checked.knowledgeUpdatedAt === undefined ? [] : ["knowledgeUpdatedAt"]),
  ];
  const isV1 = checked.sourceAssessmentRulesVersion === "cold-start-assessment@1";
  const isV2 = checked.sourceAssessmentRulesVersion === "cold-start-assessment@2";
  const expectedKeys = [
    "countryCheckRunId",
    "sourceAssessmentRulesVersion",
    "verdict",
    "evidenceSnapshotId",
    "lastCheckedAt",
    ...(isV2 ? ["assessmentProjection"] : []),
    ...optionalKeys,
  ].sort();
  if (
    Object.keys(checked).sort().some((key, index) => key !== expectedKeys[index]) ||
    Object.keys(checked).length !== expectedKeys.length ||
    (!isV1 && !isV2) ||
    typeof checked.evidenceSnapshotId !== "string" ||
    checked.evidenceSnapshotId.length === 0 ||
    !isCanonicalDay(checked.lastCheckedAt) ||
    !isOptionalNonEmptyString(checked.currentKnowledgeRevisionId) ||
    !isOptionalNonEmptyString(checked.updatedKnowledgeRevisionId) ||
    (checked.knowledgeUpdatedAt !== undefined &&
      !isCanonicalInstant(checked.knowledgeUpdatedAt)) ||
    (checked.currentKnowledgeRevisionId === undefined) !==
      (checked.knowledgeUpdatedAt === undefined) ||
    (checked.updatedKnowledgeRevisionId !== undefined &&
      checked.updatedKnowledgeRevisionId !== checked.currentKnowledgeRevisionId) ||
    checked.countryCheckRunId !== countryCheckRunId(
      input.parentRunId,
      input.place.countryCode,
      input.integrity,
    )
  ) integrityMismatch();
  let formalVerdict: FormalResidenceVerdict;
  try {
    formalVerdict = reconstructFormalResidenceVerdict(checked.verdict, {
      profileSnapshotId: input.profileId,
      evidenceSnapshotId: checked.evidenceSnapshotId,
    });
  } catch {
    integrityMismatch();
  }
  if (isV1) {
    return immutableCopy({
      countryCheckRunId: checked.countryCheckRunId,
      sourceAssessmentRulesVersion: checked.sourceAssessmentRulesVersion,
      evidenceSnapshotId: checked.evidenceSnapshotId,
      ...(checked.currentKnowledgeRevisionId === undefined ? {} : {
        currentKnowledgeRevisionId: checked.currentKnowledgeRevisionId,
      }),
      ...(checked.updatedKnowledgeRevisionId === undefined ? {} : {
        updatedKnowledgeRevisionId: checked.updatedKnowledgeRevisionId,
      }),
      ...(checked.knowledgeUpdatedAt === undefined ? {} : {
        knowledgeUpdatedAt: checked.knowledgeUpdatedAt,
      }),
      lastCheckedAt: checked.lastCheckedAt,
      country: frontierCountry(input.place),
      rank: input.place.rank,
      formalVerdict,
    });
  }
  const assessmentProjection = reconstructCountryAssessmentProjectionV2Structure(
    checked.assessmentProjection,
    {
      profileSnapshotId: input.profileId,
      evidenceSnapshotId: checked.evidenceSnapshotId,
    },
  );
  return immutableCopy({
    countryCheckRunId: checked.countryCheckRunId,
    sourceAssessmentRulesVersion: checked.sourceAssessmentRulesVersion,
    evidenceSnapshotId: checked.evidenceSnapshotId,
    assessmentProjection,
    ...(checked.currentKnowledgeRevisionId === undefined ? {} : {
      currentKnowledgeRevisionId: checked.currentKnowledgeRevisionId,
    }),
    ...(checked.updatedKnowledgeRevisionId === undefined ? {} : {
      updatedKnowledgeRevisionId: checked.updatedKnowledgeRevisionId,
    }),
    ...(checked.knowledgeUpdatedAt === undefined ? {} : {
      knowledgeUpdatedAt: checked.knowledgeUpdatedAt,
    }),
    lastCheckedAt: checked.lastCheckedAt,
    country: frontierCountry(input.place),
    rank: input.place.rank,
    formalVerdict,
  });
}

export function countryVerificationReplayExpectation(
  marker: FrontierMarker,
): CountryVerificationPresentation {
  if (marker.sourceAssessmentRulesVersion === "cold-start-assessment@1") {
    return immutableCopy({
      sourceAssessmentRulesVersion: marker.sourceAssessmentRulesVersion,
      verdict: marker.formalVerdict,
      evidenceSnapshotId: marker.evidenceSnapshotId,
      ...(marker.currentKnowledgeRevisionId === undefined ? {} : {
        currentKnowledgeRevisionId: marker.currentKnowledgeRevisionId,
      }),
      ...(marker.updatedKnowledgeRevisionId === undefined ? {} : {
        updatedKnowledgeRevisionId: marker.updatedKnowledgeRevisionId,
      }),
      ...(marker.knowledgeUpdatedAt === undefined ? {} : {
        knowledgeUpdatedAt: marker.knowledgeUpdatedAt,
      }),
      lastCheckedAt: marker.lastCheckedAt,
    });
  }
  const assessmentProjection = reconstructCountryAssessmentProjectionV2Structure(
    marker.assessmentProjection,
    {
      profileSnapshotId: marker.assessmentProjection.profileSnapshotId,
      evidenceSnapshotId: marker.evidenceSnapshotId,
    },
  );
  return immutableCopy({
    sourceAssessmentRulesVersion: marker.sourceAssessmentRulesVersion,
    verdict: marker.formalVerdict,
    evidenceSnapshotId: marker.evidenceSnapshotId,
    assessmentProjection,
    ...(marker.currentKnowledgeRevisionId === undefined ? {} : {
      currentKnowledgeRevisionId: marker.currentKnowledgeRevisionId,
    }),
    ...(marker.updatedKnowledgeRevisionId === undefined ? {} : {
      updatedKnowledgeRevisionId: marker.updatedKnowledgeRevisionId,
    }),
    ...(marker.knowledgeUpdatedAt === undefined ? {} : {
      knowledgeUpdatedAt: marker.knowledgeUpdatedAt,
    }),
    lastCheckedAt: marker.lastCheckedAt,
  });
}
