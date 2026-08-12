import {
  reconstructFormalResidenceVerdict,
  type FormalResidenceVerdict,
} from "../decision/formal-residence-verdict";
import type { RankablePlace, RankedPlace } from "../decision/place-ranker";

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

export interface CountryVerificationResult {
  readonly countryCheckRunId: string;
  readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
  readonly verdict: FormalResidenceVerdict;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly lastCheckedAt: string;
}

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
  }): Promise<Omit<CountryVerificationResult, "countryCheckRunId">>;
}

export interface FrontierCountry {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
}

export interface FrontierMarker {
  readonly country: FrontierCountry;
  readonly rank: number;
  readonly countryCheckRunId: string;
  readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
  readonly lastCheckedAt: string;
  readonly evidenceSnapshotId: string;
  readonly currentKnowledgeRevisionId?: string;
  readonly updatedKnowledgeRevisionId?: string;
  readonly knowledgeUpdatedAt?: string;
  readonly formalVerdict: FormalResidenceVerdict;
}

export interface CountryVerifierIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
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
  const { checked } = input;
  const optionalKeys = [
    ...(checked.currentKnowledgeRevisionId === undefined ? [] : ["currentKnowledgeRevisionId"]),
    ...(checked.updatedKnowledgeRevisionId === undefined ? [] : ["updatedKnowledgeRevisionId"]),
    ...(checked.knowledgeUpdatedAt === undefined ? [] : ["knowledgeUpdatedAt"]),
  ];
  const expectedKeys = [
    "countryCheckRunId",
    "sourceAssessmentRulesVersion",
    "verdict",
    "evidenceSnapshotId",
    "lastCheckedAt",
    ...optionalKeys,
  ].sort();
  if (
    Object.keys(checked).sort().some((key, index) => key !== expectedKeys[index]) ||
    Object.keys(checked).length !== expectedKeys.length ||
    checked.sourceAssessmentRulesVersion !== "cold-start-assessment@1" ||
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

export function countryVerificationReplayExpectation(
  marker: FrontierMarker,
): Omit<CountryVerificationResult, "countryCheckRunId"> {
  return {
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
  };
}
