import { createHash } from "node:crypto";
import { types } from "node:util";

import type {
  ClaimKind,
  CountryEvidenceRef,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../cold-start-contracts";
import {
  SLOVENIA_V2_CLAIM_SOURCE,
  SLOVENIA_V2_CLAIM_VALIDATOR,
  SLOVENIA_V2_RESEARCH_SCOPE,
  sloveniaV2ClaimId,
  type ClaimValueByKindV2,
  type ColdStartEvidenceClaimV2,
  type VerifiedCountryClaimV2,
} from "../cold-start-contracts-v2";
import type {
  LiveCapturedArtifact,
  ParserEntry,
} from "../contracts";
import {
  validateSloveniaEntry,
  validateSloveniaRouteClaimSubset,
} from "./slovenia";

export type SloveniaV2ValidationResult =
  | { readonly ok: true; readonly claims: readonly ColdStartEvidenceClaimV2[] }
  | {
      readonly ok: false;
      readonly kind:
        | "integrity_mismatch"
        | "semantic_mismatch"
        | "stale"
        | "conflict";
    };

interface ArtifactExpectation {
  readonly role: string;
  readonly method: "GET" | "POST";
  readonly mediaType: string;
  readonly requestUrl: string;
  readonly hasJsonBody?: true;
}

const SOURCE_LINEAGE: Readonly<Record<SloveniaSourceId, {
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly artifacts: readonly ArtifactExpectation[];
}>> = Object.freeze({
  "si-digital-nomad-route": Object.freeze({
    navigationUrl:
      "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    indexedSourceUrl:
      "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
    artifacts: Object.freeze([
      {
        role: "gov-route-page",
        method: "GET",
        mediaType: "text/html",
        requestUrl:
          "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
      },
      {
        role: "ztuj2-registry",
        method: "GET",
        mediaType: "application/json",
        requestUrl: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761",
      },
      {
        role: "ztuj2-details",
        method: "GET",
        mediaType: "application/json",
        requestUrl:
          "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/298532110/details",
      },
    ]),
  }),
  "si-income-threshold": Object.freeze({
    navigationUrl: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
    indexedSourceUrl:
      "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
    artifacts: Object.freeze([
      {
        role: "salary-registry",
        method: "GET",
        mediaType: "application/json",
        requestUrl: "https://pisrs.si/api/rezultat/zbirka/sop/2026-01-1950",
      },
      {
        role: "salary-details",
        method: "GET",
        mediaType: "application/json",
        requestUrl:
          "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/613486752/details",
      },
      {
        role: "sistat-metadata",
        method: "GET",
        mediaType: "application/json",
        requestUrl: "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px",
      },
      {
        role: "sistat-series",
        method: "POST",
        mediaType: "application/json",
        requestUrl: "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px",
        hasJsonBody: true,
      },
    ]),
  }),
  "si-companion-employment": Object.freeze({
    navigationUrl:
      "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
    indexedSourceUrl: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
    artifacts: Object.freeze([
      {
        role: "ess-companion-page",
        method: "GET",
        mediaType: "text/html",
        requestUrl:
          "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
      },
      {
        role: "zzsdt-registry",
        method: "GET",
        mediaType: "application/json",
        requestUrl: "https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655",
      },
      {
        role: "zzsdt-details",
        method: "GET",
        mediaType: "application/json",
        requestUrl:
          "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details",
      },
    ]),
  }),
  "cbr-eur": Object.freeze({
    navigationUrl: "https://www.cbr.ru/scripts/XML_daily.asp",
    artifacts: Object.freeze([
      {
        role: "official-document",
        method: "GET",
        mediaType: "application/xml",
        requestUrl: "https://www.cbr.ru/scripts/XML_daily.asp",
      },
    ]),
  }),
}) as Readonly<Record<SloveniaSourceId, {
  readonly navigationUrl: string;
  readonly indexedSourceUrl?: string;
  readonly artifacts: readonly ArtifactExpectation[];
}>>;

const ROUTE_V2_KINDS = Object.freeze([
  "route_basis",
  "remote_work_relations",
  "qualification",
  "duration",
  "general_statutory_prerequisites",
] as const satisfies readonly ClaimKind[]);

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSloveniaSourceId(value: unknown): value is SloveniaSourceId {
  return value === "si-digital-nomad-route" || value === "si-income-threshold" ||
    value === "si-companion-employment" || value === "cbr-eur";
}

function invalidBorrowedData(): never {
  throw new TypeError("invalid borrowed data");
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)!.get!;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)!.get!;
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!;

function isSharedArrayBuffer(buffer: ArrayBufferLike): boolean {
  if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined) return false;
  try {
    Reflect.apply(SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotUint8Array(value: object): Uint8Array | undefined {
  const brand = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []);
  if (brand === undefined) return undefined;
  if (brand !== "Uint8Array") return invalidBorrowedData();
  const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBufferLike;
  const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
  const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []) as number;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length: byteLength }, (_, index) => String(index)).sort();
  const actualKeys = Object.keys(descriptors).sort();
  if (
    !Number.isSafeInteger(byteLength) || byteLength < 0 ||
    !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
    isSharedArrayBuffer(buffer) || Object.getOwnPropertySymbols(descriptors).length !== 0 ||
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    Object.values(descriptors).some((descriptor) =>
      !("value" in descriptor) || !descriptor.enumerable
    ) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype
  ) return invalidBorrowedData();
  try {
    const copy = Reflect.apply(
      ARRAY_BUFFER_SLICE,
      buffer,
      [byteOffset, byteOffset + byteLength],
    ) as ArrayBuffer;
    return new Uint8Array(copy);
  } catch {
    return invalidBorrowedData();
  }
}

function snapshotBorrowed<T>(borrowed: T, ancestors = new Set<object>()): T {
  if (
    borrowed === null || borrowed === undefined || typeof borrowed === "string" ||
    typeof borrowed === "boolean"
  ) return borrowed;
  if (typeof borrowed === "number") {
    if (!Number.isFinite(borrowed)) return invalidBorrowedData();
    return borrowed;
  }
  if (typeof borrowed !== "object" || types.isProxy(borrowed)) {
    return invalidBorrowedData();
  }
  const copiedBytes = snapshotUint8Array(borrowed);
  if (copiedBytes !== undefined) return copiedBytes as T;
  if (ancestors.has(borrowed)) return invalidBorrowedData();

  const prototype = Object.getPrototypeOf(borrowed);
  const descriptors = Object.getOwnPropertyDescriptors(borrowed);
  if (Object.getOwnPropertySymbols(descriptors).length !== 0) return invalidBorrowedData();
  ancestors.add(borrowed);
  try {
    if (Array.isArray(borrowed)) {
      if (prototype !== Array.prototype) return invalidBorrowedData();
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
        return invalidBorrowedData();
      }
      const length = lengthDescriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) return invalidBorrowedData();
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      const descriptorKeys = Object.keys(descriptors).sort();
      if (
        descriptorKeys.length !== expectedKeys.length ||
        descriptorKeys.some((key, index) => key !== expectedKeys[index])
      ) return invalidBorrowedData();
      const copy: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined || !("value" in descriptor) ||
          !descriptor.enumerable
        ) return invalidBorrowedData();
        copy.push(snapshotBorrowed(descriptor.value, ancestors));
      }
      return copy as T;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      return invalidBorrowedData();
    }
    const copy: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        key === "__proto__" || !("value" in descriptor) ||
        !descriptor.enumerable
      ) return invalidBorrowedData();
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: snapshotBorrowed(descriptor.value, ancestors),
        writable: true,
      });
    }
    return copy as T;
  } finally {
    ancestors.delete(borrowed);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isLiveArtifact(
  value: unknown,
): value is LiveCapturedArtifact<SloveniaSourceId> {
  return isRecord(value) && "runId" in value && "sourceId" in value && "origin" in value &&
    "capturedAt" in value && "responseStatus" in value &&
    "responseUrl" in value && "request" in value;
}

function validRequest(
  request: unknown,
  expected: ArtifactExpectation,
): boolean {
  if (!isRecord(request)) return false;
  if (expected.hasJsonBody === true) {
    return exactKeys(request, ["method", "url", "bodyMediaType", "bodySha256"]) &&
      request.method === expected.method && request.url === expected.requestUrl &&
      request.bodyMediaType === "application/json" &&
      typeof request.bodySha256 === "string" && /^[a-f\d]{64}$/.test(request.bodySha256);
  }
  return exactKeys(request, ["method", "url"]) &&
    request.method === expected.method && request.url === expected.requestUrl;
}

function hasValidArtifactIntegrity(value: unknown): value is ParserEntry<SloveniaSourceId> {
  return isRecord(value) && isSloveniaSourceId(value.sourceId) &&
    Array.isArray(value.artifacts) && value.artifacts.every((artifact) =>
      isRecord(artifact) && artifact.bytes instanceof Uint8Array &&
      typeof artifact.sha256 === "string" && sha256(artifact.bytes) === artifact.sha256
    );
}

function hasExactTopology(entry: ParserEntry<SloveniaSourceId>): boolean {
  const lineage = SOURCE_LINEAGE[entry.sourceId];
  const entryKeys = [
    "sourceId",
    "navigationUrl",
    ...(lineage.indexedSourceUrl === undefined ? [] : ["indexedSourceUrl"]),
    "resolvedEvidenceUrl",
    "artifacts",
    ...(entry.versionHint === undefined ? [] : ["versionHint"]),
  ];
  if (
    !exactKeys(entry, entryKeys) || entry.navigationUrl !== lineage.navigationUrl ||
    entry.indexedSourceUrl !== lineage.indexedSourceUrl ||
    entry.artifacts.length !== lineage.artifacts.length ||
    (entry.versionHint !== undefined &&
      (typeof entry.versionHint !== "string" || entry.versionHint.length === 0))
  ) return false;

  const runIds = new Set<string>();
  for (let index = 0; index < lineage.artifacts.length; index += 1) {
    const artifact = entry.artifacts[index];
    const expected = lineage.artifacts[index]!;
    if (
      artifact === undefined || !isLiveArtifact(artifact) ||
      !exactKeys(artifact, [
        "artifactId",
        "runId",
        "sourceId",
        "role",
        "request",
        "url",
        "responseUrl",
        "capturedAt",
        "responseStatus",
        "mediaType",
        "origin",
        "sha256",
        "bytes",
      ]) || artifact.sourceId !== entry.sourceId || artifact.role !== expected.role ||
      artifact.origin !== "live" || artifact.responseStatus !== 200 ||
      artifact.mediaType !== expected.mediaType || artifact.url !== expected.requestUrl ||
      artifact.responseUrl !== expected.requestUrl ||
      artifact.artifactId !== `${entry.sourceId}:${expected.role}:${artifact.sha256}` ||
      typeof artifact.runId !== "string" || artifact.runId.length === 0 ||
      typeof artifact.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(artifact.capturedAt)) ||
      !validRequest(artifact.request, expected)
    ) return false;
    runIds.add(artifact.runId);
  }
  const lastArtifact = entry.artifacts.at(-1) as
    | LiveCapturedArtifact<SloveniaSourceId>
    | undefined;
  return runIds.size === 1 &&
    lastArtifact !== undefined && entry.resolvedEvidenceUrl === lastArtifact.responseUrl;
}

function copyEvidence(
  evidence: readonly CountryEvidenceRef[],
): readonly CountryEvidenceRef[] {
  return evidence.map((reference) => ({
    sourceId: reference.sourceId,
    artifactId: reference.artifactId,
    navigationUrl: reference.navigationUrl,
    resolvedEvidenceUrl: reference.resolvedEvidenceUrl,
    sourcePeriod: reference.sourcePeriod,
    anchor: { ...reference.anchor },
  }));
}

function v2Value(
  claim: VerifiedCountryClaim,
): ClaimValueByKindV2[ClaimKind] {
  switch (claim.claimKind) {
    case "route_basis": {
      const value = (claim as VerifiedCountryClaim<"route_basis">).value;
      return {
        route: value.route,
        legalBasis: value.legalBasis,
        effectiveFrom: value.effectiveFrom,
      };
    }
    case "remote_work_relations": {
      const value = (claim as VerifiedCountryClaim<"remote_work_relations">).value;
      return {
        allowedRelations: [...value.allowedRelations],
        slovenianLabourMarketWorkIncluded: value.slovenianLabourMarketWorkIncluded,
      };
    }
    case "qualification": {
      const value = (claim as VerifiedCountryClaim<"qualification">).value;
      return { rule: value.rule };
    }
    case "companion_local_work_access": {
      const value = (claim as VerifiedCountryClaim<"companion_local_work_access">).value;
      return {
        access: value.access,
        labourMarketCheck: value.labourMarketCheck,
        informationSheet: value.informationSheet,
      };
    }
    case "duration": {
      const value = (claim as VerifiedCountryClaim<"duration">).value;
      return {
        maximumMonths: value.maximumMonths,
        extendable: value.extendable,
        reapplyAfterMonths: value.reapplyAfterMonths,
        scope: { kind: "applicant" },
      };
    }
    case "general_statutory_prerequisites": {
      const value = (
        claim as VerifiedCountryClaim<"general_statutory_prerequisites">
      ).value;
      return {
        passportBeyondPermitMonths: value.passportBeyondPermitMonths,
        healthInsurance: value.healthInsurance,
        article55GroundsApply: value.article55GroundsApply,
        scope: { kind: "applicant" },
      };
    }
    case "citizenship_applicability":
    case "income":
    case "companion_entry":
      return invalidBorrowedData();
  }
}

function v2Claim(claim: VerifiedCountryClaim): VerifiedCountryClaimV2 {
  const kind = claim.claimKind;
  const evidence = copyEvidence(claim.evidence);
  const value = v2Value(claim);
  return {
    claimId: sloveniaV2ClaimId(kind, value),
    claimKind: kind,
    sourceId: SLOVENIA_V2_CLAIM_SOURCE[kind],
    value,
    scope: SLOVENIA_V2_RESEARCH_SCOPE,
    sourcePeriod: claim.sourcePeriod,
    anchor: { ...evidence.at(-1)!.anchor },
    evidence,
    validatorVersion: SLOVENIA_V2_CLAIM_VALIDATOR[kind],
    status: "verified",
  } as VerifiedCountryClaimV2;
}

export function validateSloveniaV2Entry(
  borrowedEntry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaV2ValidationResult {
  let owned: unknown;
  try {
    owned = snapshotBorrowed(borrowedEntry);
  } catch {
    return { ok: false, kind: "integrity_mismatch" };
  }
  if (!hasValidArtifactIntegrity(owned)) {
    return { ok: false, kind: "integrity_mismatch" };
  }
  const entry = owned;
  if (!hasExactTopology(entry)) return { ok: false, kind: "semantic_mismatch" };

  if (entry.sourceId === "si-digital-nomad-route") {
    const subset = validateSloveniaRouteClaimSubset(entry, assessmentAt);
    if (!subset.ok) return subset;
    const claims = subset.claims
      .filter((claim) => ROUTE_V2_KINDS.includes(claim.claimKind as never))
      .map(v2Claim);
    return claims.length === 0
      ? { ok: false, kind: "semantic_mismatch" }
      : deepFreeze({ ok: true, claims });
  }
  const v1 = validateSloveniaEntry(entry, assessmentAt);
  if (!v1.ok || entry.sourceId === "cbr-eur") {
    return v1 as SloveniaV2ValidationResult;
  }
  if (entry.sourceId === "si-income-threshold") {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const kinds = ["companion_local_work_access"] as const;
  const claims = v1.claims
    .filter((claim): claim is VerifiedCountryClaim => "claimKind" in claim)
    .filter((claim) => kinds.includes(claim.claimKind as never))
    .map(v2Claim);
  if (claims.length !== kinds.length) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  return deepFreeze({ ok: true, claims });
}
